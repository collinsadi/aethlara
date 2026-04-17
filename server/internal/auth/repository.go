package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OTPRecord struct {
	ID        string
	Email     string
	CodeHash  string
	Type      string
	FullName  string
	Attempts  int
	Used      bool
	ExpiresAt time.Time
	CreatedAt time.Time
}

type RefreshToken struct {
	ID        string
	UserID    string
	TokenHash string
	UserAgent string
	IPAddress string
	Revoked   bool
	ExpiresAt time.Time
	CreatedAt time.Time
}

type Repository interface {
	CreateOTP(ctx context.Context, email, codeHash, otpType, fullName string, expiresAt time.Time) error
	InvalidateOTPsByEmailAndType(ctx context.Context, email, otpType string) error
	GetLatestUnusedOTP(ctx context.Context, email, otpType string) (*OTPRecord, error)
	IncrementOTPAttempts(ctx context.Context, id string) (int, error)
	MarkOTPUsed(ctx context.Context, id string) error

	CreateRefreshToken(ctx context.Context, rt RefreshToken) error
	GetRefreshToken(ctx context.Context, tokenHash string) (*RefreshToken, error)
	RevokeRefreshToken(ctx context.Context, id string) error
	RevokeAllUserRefreshTokens(ctx context.Context, userID string) error

	CleanupExpired(ctx context.Context) error
}

type pgxRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &pgxRepository{db: db}
}

func (r *pgxRepository) CreateOTP(ctx context.Context, email, codeHash, otpType, fullName string, expiresAt time.Time) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO otps (email, code_hash, type, full_name, expires_at)
		VALUES ($1, $2, $3, $4, $5)
	`, email, codeHash, otpType, nullableString(fullName), expiresAt)
	return err
}

func (r *pgxRepository) InvalidateOTPsByEmailAndType(ctx context.Context, email, otpType string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE otps SET used = true
		WHERE email = $1 AND type = $2 AND used = false
	`, email, otpType)
	return err
}

// GetLatestUnusedOTP fetches the most recent non-used OTP regardless of expiry,
// so callers can return a meaningful "code expired" message.
func (r *pgxRepository) GetLatestUnusedOTP(ctx context.Context, email, otpType string) (*OTPRecord, error) {
	var o OTPRecord
	var fullName *string
	err := r.db.QueryRow(ctx, `
		SELECT id, email, code_hash, type, full_name, attempts, used, expires_at, created_at
		FROM otps
		WHERE email = $1 AND type = $2 AND used = false
		ORDER BY created_at DESC
		LIMIT 1
	`, email, otpType).Scan(
		&o.ID, &o.Email, &o.CodeHash, &o.Type, &fullName,
		&o.Attempts, &o.Used, &o.ExpiresAt, &o.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if fullName != nil {
		o.FullName = *fullName
	}
	return &o, nil
}

func (r *pgxRepository) IncrementOTPAttempts(ctx context.Context, id string) (int, error) {
	var attempts int
	err := r.db.QueryRow(ctx, `
		UPDATE otps SET attempts = attempts + 1 WHERE id = $1
		RETURNING attempts
	`, id).Scan(&attempts)
	return attempts, err
}

func (r *pgxRepository) MarkOTPUsed(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE otps SET used = true WHERE id = $1`, id)
	return err
}

func (r *pgxRepository) CreateRefreshToken(ctx context.Context, rt RefreshToken) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
		VALUES ($1, $2, $3, $4, $5)
	`, rt.UserID, rt.TokenHash, rt.UserAgent, rt.IPAddress, rt.ExpiresAt)
	return err
}

func (r *pgxRepository) GetRefreshToken(ctx context.Context, tokenHash string) (*RefreshToken, error) {
	var rt RefreshToken
	err := r.db.QueryRow(ctx, `
		SELECT id, user_id, token_hash, user_agent, ip_address, revoked, expires_at, created_at
		FROM refresh_tokens WHERE token_hash = $1
	`, tokenHash).Scan(
		&rt.ID, &rt.UserID, &rt.TokenHash, &rt.UserAgent,
		&rt.IPAddress, &rt.Revoked, &rt.ExpiresAt, &rt.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rt, nil
}

func (r *pgxRepository) RevokeRefreshToken(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE refresh_tokens SET revoked = true WHERE id = $1`, id)
	return err
}

func (r *pgxRepository) RevokeAllUserRefreshTokens(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx, `UPDATE refresh_tokens SET revoked = true WHERE user_id = $1`, userID)
	return err
}

func (r *pgxRepository) CleanupExpired(ctx context.Context) error {
	if _, err := r.db.Exec(ctx, `
		DELETE FROM otps
		WHERE expires_at < NOW() OR (used = true AND created_at < NOW() - INTERVAL '24 hours')
	`); err != nil {
		return err
	}
	_, err := r.db.Exec(ctx, `
		DELETE FROM refresh_tokens
		WHERE expires_at < NOW() OR (revoked = true AND created_at < NOW() - INTERVAL '7 days')
	`)
	return err
}

func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
