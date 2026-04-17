package auth

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/user"
	"github.com/collinsadi/aethlara/pkg/tokenutil"
)

var (
	ErrUserExists      = errors.New("email already registered")
	ErrInvalidOTP      = errors.New("invalid verification code")
	ErrOTPExpired      = errors.New("verification code has expired")
	ErrOTPMaxAttempts  = errors.New("too many incorrect attempts")
	ErrUserNotFound    = errors.New("user not found")
	ErrTokenNotFound   = errors.New("token not found")
	ErrTokenRevoked    = errors.New("token has been revoked")
	ErrTokenExpired    = errors.New("token has expired")
	ErrTokenOwnership  = errors.New("token does not belong to user")
	ErrInternal        = errors.New("internal error")
)

type SignupRequest struct {
	FullName string
	Email    string
}

type LoginRequest struct {
	Email string
}

type VerifyOTPRequest struct {
	Email     string
	OTP       string
	Type      string
	UserAgent string
	IPAddress string
}

type TokenPair struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
	User         *user.User
}

type RefreshRequest struct {
	RefreshToken string
	UserAgent    string
	IPAddress    string
}

type Service interface {
	Signup(ctx context.Context, req SignupRequest) error
	VerifyOTP(ctx context.Context, req VerifyOTPRequest) (*TokenPair, error)
	Login(ctx context.Context, req LoginRequest) error
	Refresh(ctx context.Context, req RefreshRequest) (*TokenPair, error)
	Logout(ctx context.Context, userID, refreshToken string) error
	LogoutAll(ctx context.Context, userID string) error
}

type service struct {
	authRepo Repository
	userRepo user.Repository
	email    *email.Client
	cfg      *config.Config
}

func NewService(authRepo Repository, userRepo user.Repository, emailClient *email.Client, cfg *config.Config) Service {
	return &service{
		authRepo: authRepo,
		userRepo: userRepo,
		email:    emailClient,
		cfg:      cfg,
	}
}

func (s *service) Signup(ctx context.Context, req SignupRequest) error {
	existing, err := s.userRepo.GetByEmail(ctx, req.Email)
	if err != nil {
		slog.Error("signup: GetByEmail", "error", err, "email", req.Email)
		return ErrInternal
	}
	if existing != nil && existing.IsVerified {
		return ErrUserExists
	}

	if err := s.authRepo.InvalidateOTPsByEmailAndType(ctx, req.Email, "signup"); err != nil {
		slog.Error("signup: InvalidateOTPsByEmailAndType", "error", err, "email", req.Email)
		return ErrInternal
	}

	otp, err := tokenutil.GenerateOTP()
	if err != nil {
		slog.Error("signup: GenerateOTP", "error", err)
		return ErrInternal
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(otp), s.cfg.BcryptCost)
	if err != nil {
		slog.Error("signup: bcrypt hash OTP", "error", err)
		return ErrInternal
	}

	expiresAt := time.Now().Add(time.Duration(s.cfg.OTPExpiryMinutes) * time.Minute)
	if err := s.authRepo.CreateOTP(ctx, req.Email, string(hash), "signup", req.FullName, expiresAt); err != nil {
		slog.Error("signup: CreateOTP", "error", err, "email", req.Email)
		return ErrInternal
	}

	if err := s.email.SendOTP(ctx, req.Email, otp, s.cfg.OTPExpiryMinutes, "signup"); err != nil {
		slog.Error("signup: SendOTP (check Resend domain/API key or set EMAIL_DEV_LOG_ONLY=true)", "error", err, "email", req.Email)
		return ErrInternal
	}

	return nil
}

func (s *service) VerifyOTP(ctx context.Context, req VerifyOTPRequest) (*TokenPair, error) {
	otpRecord, err := s.authRepo.GetLatestUnusedOTP(ctx, req.Email, req.Type)
	if err != nil {
		return nil, ErrInternal
	}
	if otpRecord == nil {
		return nil, ErrInvalidOTP
	}

	newAttempts, err := s.authRepo.IncrementOTPAttempts(ctx, otpRecord.ID)
	if err != nil {
		return nil, ErrInternal
	}
	if newAttempts >= s.cfg.OTPMaxAttempts {
		_ = s.authRepo.MarkOTPUsed(ctx, otpRecord.ID)
		return nil, ErrOTPMaxAttempts
	}

	// Check expiry before running bcrypt to avoid wasted work
	if time.Now().After(otpRecord.ExpiresAt) {
		_ = s.authRepo.MarkOTPUsed(ctx, otpRecord.ID)
		return nil, ErrOTPExpired
	}

	if err := bcrypt.CompareHashAndPassword([]byte(otpRecord.CodeHash), []byte(req.OTP)); err != nil {
		return nil, ErrInvalidOTP
	}

	if err := s.authRepo.MarkOTPUsed(ctx, otpRecord.ID); err != nil {
		return nil, ErrInternal
	}

	var u *user.User

	switch req.Type {
	case "signup":
		u, err = s.userRepo.Create(ctx, otpRecord.FullName, req.Email)
		if err != nil {
			return nil, ErrInternal
		}
	case "login":
		u, err = s.userRepo.GetByEmail(ctx, req.Email)
		if err != nil {
			return nil, ErrInternal
		}
		if u == nil {
			return nil, ErrUserNotFound
		}
		if err := s.userRepo.UpdateLastLogin(ctx, u.ID); err != nil {
			return nil, ErrInternal
		}
	}

	return s.issueTokenPair(ctx, u, req.UserAgent, req.IPAddress)
}

func (s *service) Login(ctx context.Context, req LoginRequest) error {
	u, err := s.userRepo.GetByEmail(ctx, req.Email)
	if err != nil {
		return ErrInternal
	}

	// Always perform the same work regardless of user existence (timing-safe)
	if u != nil && u.IsVerified {
		if err := s.authRepo.InvalidateOTPsByEmailAndType(ctx, req.Email, "login"); err != nil {
			return ErrInternal
		}

		otp, err := tokenutil.GenerateOTP()
		if err != nil {
			return ErrInternal
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(otp), s.cfg.BcryptCost)
		if err != nil {
			return ErrInternal
		}

		expiresAt := time.Now().Add(time.Duration(s.cfg.OTPExpiryMinutes) * time.Minute)
		if err := s.authRepo.CreateOTP(ctx, req.Email, string(hash), "login", "", expiresAt); err != nil {
			return ErrInternal
		}

		if err := s.email.SendOTP(ctx, req.Email, otp, s.cfg.OTPExpiryMinutes, "login"); err != nil {
			return ErrInternal
		}
	} else {
		// Perform a dummy bcrypt to match timing when user does not exist
		dummyHash, _ := bcrypt.GenerateFromPassword([]byte("dummy"), s.cfg.BcryptCost)
		_ = dummyHash
	}

	return nil
}

func (s *service) Refresh(ctx context.Context, req RefreshRequest) (*TokenPair, error) {
	tokenHash := tokenutil.HashToken(req.RefreshToken)

	rt, err := s.authRepo.GetRefreshToken(ctx, tokenHash)
	if err != nil {
		return nil, ErrInternal
	}
	if rt == nil {
		return nil, ErrTokenNotFound
	}

	// Reuse detection: revoked token presented → full breach response
	if rt.Revoked {
		_ = s.authRepo.RevokeAllUserRefreshTokens(ctx, rt.UserID)
		return nil, ErrTokenRevoked
	}

	if time.Now().After(rt.ExpiresAt) {
		return nil, ErrTokenExpired
	}

	u, err := s.userRepo.GetByID(ctx, rt.UserID)
	if err != nil {
		return nil, ErrInternal
	}
	if u == nil {
		return nil, ErrUserNotFound
	}

	// Rotate: revoke old token
	if err := s.authRepo.RevokeRefreshToken(ctx, rt.ID); err != nil {
		return nil, ErrInternal
	}

	return s.issueTokenPair(ctx, u, req.UserAgent, req.IPAddress)
}

func (s *service) Logout(ctx context.Context, userID, rawToken string) error {
	tokenHash := tokenutil.HashToken(rawToken)

	rt, err := s.authRepo.GetRefreshToken(ctx, tokenHash)
	if err != nil {
		return ErrInternal
	}
	if rt == nil {
		return ErrTokenNotFound
	}
	if rt.UserID != userID {
		return ErrTokenOwnership
	}

	return s.authRepo.RevokeRefreshToken(ctx, rt.ID)
}

func (s *service) LogoutAll(ctx context.Context, userID string) error {
	return s.authRepo.RevokeAllUserRefreshTokens(ctx, userID)
}

func (s *service) issueTokenPair(ctx context.Context, u *user.User, userAgent, ipAddress string) (*TokenPair, error) {
	accessToken, err := tokenutil.GenerateAccessToken(u.ID, s.cfg.JWTAccessSecret, s.cfg.JWTAccessExpiry())
	if err != nil {
		return nil, ErrInternal
	}

	rawRefresh, hashRefresh, err := tokenutil.GenerateRefreshToken()
	if err != nil {
		return nil, ErrInternal
	}

	expiresAt := time.Now().Add(s.cfg.JWTRefreshExpiry())
	if err := s.authRepo.CreateRefreshToken(ctx, RefreshToken{
		UserID:    u.ID,
		TokenHash: hashRefresh,
		UserAgent: userAgent,
		IPAddress: ipAddress,
		ExpiresAt: expiresAt,
	}); err != nil {
		return nil, ErrInternal
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    s.cfg.JWTAccessExpiryMinutes * 60,
		User:         u,
	}, nil
}
