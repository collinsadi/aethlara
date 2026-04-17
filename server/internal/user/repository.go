package user

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type User struct {
	ID          string
	FullName    string
	Email       string
	BillingPlan string
	IsVerified  bool
	LastLoginAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Repository interface {
	Create(ctx context.Context, fullName, email string) (*User, error)
	GetByID(ctx context.Context, id string) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	UpdateLastLogin(ctx context.Context, id string) error
}

type pgxRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &pgxRepository{db: db}
}

func (r *pgxRepository) Create(ctx context.Context, fullName, email string) (*User, error) {
	var u User
	err := r.db.QueryRow(ctx, `
		INSERT INTO users (full_name, email, billing_plan, is_verified)
		VALUES ($1, $2, 'free', true)
		RETURNING id, full_name, email, billing_plan, is_verified, last_login_at, created_at, updated_at
	`, fullName, email).Scan(
		&u.ID, &u.FullName, &u.Email, &u.BillingPlan,
		&u.IsVerified, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *pgxRepository) GetByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := r.db.QueryRow(ctx, `
		SELECT id, full_name, email, billing_plan, is_verified, last_login_at, created_at, updated_at
		FROM users WHERE id = $1
	`, id).Scan(
		&u.ID, &u.FullName, &u.Email, &u.BillingPlan,
		&u.IsVerified, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *pgxRepository) GetByEmail(ctx context.Context, email string) (*User, error) {
	var u User
	err := r.db.QueryRow(ctx, `
		SELECT id, full_name, email, billing_plan, is_verified, last_login_at, created_at, updated_at
		FROM users WHERE email = $1
	`, email).Scan(
		&u.ID, &u.FullName, &u.Email, &u.BillingPlan,
		&u.IsVerified, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *pgxRepository) UpdateLastLogin(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1
	`, id)
	return err
}
