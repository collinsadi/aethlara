package user

import (
	"net/http"
	"time"

	"github.com/collinsadi/aethlara/internal/middleware"
	"github.com/collinsadi/aethlara/pkg/response"
)

type Handler struct {
	svc Service
}

func NewHandler(svc Service) *Handler {
	return &Handler{svc: svc}
}

type userResponse struct {
	ID          string     `json:"id"`
	FullName    string     `json:"full_name"`
	Email       string     `json:"email"`
	BillingPlan string     `json:"billing_plan"`
	IsVerified  bool       `json:"is_verified"`
	LastLoginAt *time.Time `json:"last_login_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	u, err := h.svc.GetProfile(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusOK, userResponse{
		ID:          u.ID,
		FullName:    u.FullName,
		Email:       u.Email,
		BillingPlan: u.BillingPlan,
		IsVerified:  u.IsVerified,
		LastLoginAt: u.LastLoginAt,
		CreatedAt:   u.CreatedAt,
	}, "")
}
