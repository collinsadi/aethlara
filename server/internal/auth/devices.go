package auth

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/collinsadi/aethlara/pkg/tokenutil"
)

// Extension devices are long-lived, revocable credentials for the Chrome
// extension. The handshake (dashboard -> single-use token -> exchange) now
// also returns a device token; the extension trades it for fresh access
// tokens without reconnecting. Device tokens rotate on every refresh.

// rotationGrace is how long the previous device token stays "benign" after a
// rotation: two refreshes racing inside the extension must not look like a
// stolen token.
const rotationGrace = 2 * time.Minute

var (
	ErrExtensionDeviceInvalid = errors.New("extension device token invalid or revoked")
	ErrExtensionDeviceRotated = errors.New("extension device token was just rotated")
)

// ExtensionDevice is a connected extension install.
type ExtensionDevice struct {
	ID                string
	UserID            string
	Name              string
	TokenHash         string
	PreviousTokenHash *string
	UserAgent         *string
	LastUsedAt        *time.Time
	RevokedAt         *time.Time
	CreatedAt         time.Time
}

const deviceCols = `id, user_id, name, token_hash, previous_token_hash, user_agent, last_used_at, revoked_at, created_at`

func scanDevice(row pgx.Row) (*ExtensionDevice, error) {
	var d ExtensionDevice
	err := row.Scan(&d.ID, &d.UserID, &d.Name, &d.TokenHash, &d.PreviousTokenHash, &d.UserAgent,
		&d.LastUsedAt, &d.RevokedAt, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &d, err
}

func (r *pgxRepository) CreateExtensionDevice(ctx context.Context, d ExtensionDevice) (*ExtensionDevice, error) {
	return scanDevice(r.db.QueryRow(ctx, `
		INSERT INTO extension_devices (user_id, name, token_hash, user_agent, last_used_at)
		VALUES ($1, $2, $3, $4, NOW())
		RETURNING `+deviceCols, d.UserID, d.Name, d.TokenHash, d.UserAgent))
}

func (r *pgxRepository) GetExtensionDeviceByToken(ctx context.Context, tokenHash string) (*ExtensionDevice, error) {
	return scanDevice(r.db.QueryRow(ctx, `SELECT `+deviceCols+` FROM extension_devices WHERE token_hash = $1`, tokenHash))
}

func (r *pgxRepository) GetExtensionDeviceByPreviousToken(ctx context.Context, tokenHash string) (*ExtensionDevice, error) {
	return scanDevice(r.db.QueryRow(ctx, `SELECT `+deviceCols+` FROM extension_devices WHERE previous_token_hash = $1`, tokenHash))
}

// RotateExtensionDevice swaps in a new token hash, keeping the old one as
// previous_token_hash for reuse detection. Returns false if the device was
// revoked or the token changed concurrently.
func (r *pgxRepository) RotateExtensionDevice(ctx context.Context, id, oldHash, newHash, userAgent string) (bool, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE extension_devices
		SET previous_token_hash = token_hash, token_hash = $3, last_used_at = NOW(),
		    user_agent = COALESCE(NULLIF($4, ''), user_agent)
		WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL`, id, oldHash, newHash, userAgent)
	return tag.RowsAffected() == 1, err
}

func (r *pgxRepository) RevokeExtensionDevice(ctx context.Context, userID, id string) (bool, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE extension_devices SET revoked_at = NOW()
		WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, id, userID)
	return tag.RowsAffected() == 1, err
}

func (r *pgxRepository) ListExtensionDevices(ctx context.Context, userID string) ([]ExtensionDevice, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+deviceCols+` FROM extension_devices
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY COALESCE(last_used_at, created_at) DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ExtensionDevice
	for rows.Next() {
		d, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

// RevokeExcessExtensionDevices keeps the keep most recently used devices.
func (r *pgxRepository) RevokeExcessExtensionDevices(ctx context.Context, userID string, keep int) error {
	_, err := r.db.Exec(ctx, `
		UPDATE extension_devices SET revoked_at = NOW()
		WHERE id IN (
			SELECT id FROM extension_devices
			WHERE user_id = $1 AND revoked_at IS NULL
			ORDER BY COALESCE(last_used_at, created_at) DESC
			OFFSET $2
		)`, userID, keep)
	return err
}

// ── Service ───────────────────────────────────────────────────────────────────

func cleanDeviceName(name, userAgent string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Chrome extension"
		ua := strings.ToLower(userAgent)
		switch {
		case strings.Contains(ua, "mac os"):
			name += " on macOS"
		case strings.Contains(ua, "windows"):
			name += " on Windows"
		case strings.Contains(ua, "linux"):
			name += " on Linux"
		}
	}
	if len(name) > 80 {
		name = name[:80]
	}
	return name
}

// issueDevice creates a device for userID and returns its raw token.
func (s *service) issueDevice(ctx context.Context, userID, deviceName, userAgent string) (*ExtensionDevice, string, error) {
	raw, hash, err := tokenutil.GenerateRefreshToken()
	if err != nil {
		return nil, "", ErrInternal
	}
	ua := userAgent
	if len(ua) > 300 {
		ua = ua[:300]
	}
	d, err := s.authRepo.CreateExtensionDevice(ctx, ExtensionDevice{
		UserID: userID, Name: cleanDeviceName(deviceName, userAgent), TokenHash: hash, UserAgent: nullableString(ua),
	})
	if err != nil || d == nil {
		slog.Error("issueDevice: create", "error", err)
		return nil, "", ErrInternal
	}
	if max := s.cfg.ExtensionDeviceMaxPerUser; max > 0 {
		if err := s.authRepo.RevokeExcessExtensionDevices(ctx, userID, max); err != nil {
			slog.Warn("issueDevice: revoke excess devices failed", "error", err)
		}
	}
	return d, raw, nil
}

// RefreshExtensionDevice trades a device token for a new access token and a
// rotated device token.
func (s *service) RefreshExtensionDevice(ctx context.Context, rawDeviceToken, userAgent string) (*ExtensionAuthResult, error) {
	hash := tokenutil.HashToken(rawDeviceToken)
	d, err := s.authRepo.GetExtensionDeviceByToken(ctx, hash)
	if err != nil {
		return nil, ErrInternal
	}
	if d == nil {
		// An old token: a benign race right after rotation, or a stolen token.
		prev, err := s.authRepo.GetExtensionDeviceByPreviousToken(ctx, hash)
		if err == nil && prev != nil && prev.RevokedAt == nil {
			if prev.LastUsedAt != nil && time.Since(*prev.LastUsedAt) < rotationGrace {
				return nil, ErrExtensionDeviceRotated
			}
			_, _ = s.authRepo.RevokeExtensionDevice(ctx, prev.UserID, prev.ID)
			slog.Warn("extension device token reuse detected; device revoked", "user_id", prev.UserID, "device_id", prev.ID)
		}
		return nil, ErrExtensionDeviceInvalid
	}
	if d.RevokedAt != nil {
		return nil, ErrExtensionDeviceInvalid
	}

	u, err := s.userRepo.GetByID(ctx, d.UserID)
	if err != nil || u == nil {
		return nil, ErrExtensionDeviceInvalid
	}

	raw, newHash, err := tokenutil.GenerateRefreshToken()
	if err != nil {
		return nil, ErrInternal
	}
	ok, err := s.authRepo.RotateExtensionDevice(ctx, d.ID, hash, newHash, userAgent)
	if err != nil {
		return nil, ErrInternal
	}
	if !ok {
		return nil, ErrExtensionDeviceRotated
	}

	expiry := s.cfg.JWTAccessExpiry()
	access, err := tokenutil.GenerateAccessToken(u.ID, s.cfg.JWTAccessSecret, expiry)
	if err != nil {
		return nil, ErrInternal
	}
	return &ExtensionAuthResult{
		AccessToken: access,
		ExpiresAt:   time.Now().Add(expiry),
		User:        u,
		DeviceID:    d.ID,
		DeviceToken: raw,
	}, nil
}

func (s *service) ListExtensionDevices(ctx context.Context, userID string) ([]ExtensionDevice, error) {
	devices, err := s.authRepo.ListExtensionDevices(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	return devices, nil
}

func (s *service) RevokeExtensionDevice(ctx context.Context, userID, deviceID string) error {
	ok, err := s.authRepo.RevokeExtensionDevice(ctx, userID, deviceID)
	if err != nil {
		return ErrInternal
	}
	if !ok {
		return ErrTokenNotFound
	}
	return nil
}
