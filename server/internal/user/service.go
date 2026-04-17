package user

import (
	"context"
	"errors"
)

var ErrNotFound = errors.New("user not found")

type Service interface {
	GetProfile(ctx context.Context, userID string) (*User, error)
}

type service struct {
	repo Repository
}

func NewService(repo Repository) Service {
	return &service{repo: repo}
}

func (s *service) GetProfile(ctx context.Context, userID string) (*User, error) {
	u, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, ErrNotFound
	}
	return u, nil
}
