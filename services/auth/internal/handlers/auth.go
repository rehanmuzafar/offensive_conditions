package handlers

import (
	"net/netip"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	autherrors "github.com/offensive-conditions/auth/internal/errors"
	"github.com/offensive-conditions/auth/internal/middleware"
	"github.com/offensive-conditions/auth/internal/service"
	"github.com/offensive-conditions/auth/internal/validators"
)

// AuthHandler exposes auth-related HTTP endpoints.
type AuthHandler struct {
	svc *service.AuthService
	log zerolog.Logger
}

func NewAuthHandler(svc *service.AuthService, log zerolog.Logger) *AuthHandler {
	return &AuthHandler{svc: svc, log: log}
}

// ============================================================================
// Request/Response DTOs
// ============================================================================

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email,max=255"`
	Username string `json:"username" binding:"required,username"`
	Password string `json:"password" binding:"required,min=12,max=128"`
}

type RegisterResponse struct {
	UserID               string `json:"user_id"`
	VerificationRequired bool   `json:"verification_required"`
	Message              string `json:"message"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	TokenType    string `json:"token_type,omitempty"`
	ExpiresIn    int    `json:"expires_in,omitempty"`
	TFAChallenge string `json:"tfa_challenge,omitempty"`
	UserID       string `json:"user_id,omitempty"`
}

type LoginTFARequest struct {
	Challenge string `json:"challenge" binding:"required"`
	Code      string `json:"code" binding:"required,totp_code"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type RefreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
}

type LogoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type VerifyEmailRequest struct {
	Token string `json:"token" binding:"required,min=20"`
}

type ForgotPasswordRequest struct {
	Email string `json:"email" binding:"required,email"`
}

type ResetPasswordRequest struct {
	Token       string `json:"token" binding:"required,min=20"`
	NewPassword string `json:"new_password" binding:"required,min=12,max=128"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=12,max=128"`
}

// ============================================================================
// Handlers
// ============================================================================

// POST /v1/auth/register
func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	out, err := h.svc.Register(c.Request.Context(),
		service.RegisterInput{Email: req.Email, Username: req.Username, Password: req.Password},
		requestMeta(c))
	if err != nil {
		respondErr(c, err)
		return
	}

	msg := "Account created. You can log in now."
	if out.VerificationRequired {
		msg = "Account created. Please check your email to verify."
	}
	c.JSON(201, RegisterResponse{
		UserID:               out.UserID.String(),
		VerificationRequired: out.VerificationRequired,
		Message:              msg,
	})
}

// POST /v1/auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	out, err := h.svc.Login(c.Request.Context(),
		service.LoginInput{Email: req.Email, Password: req.Password},
		requestMeta(c))
	if err != nil {
		respondErr(c, err)
		return
	}

	resp := LoginResponse{UserID: out.UserID.String()}
	if out.TFAChallenge != "" {
		resp.TFAChallenge = out.TFAChallenge
		c.JSON(202, resp) // 202 Accepted — needs another step
		return
	}
	resp.AccessToken = out.AccessToken
	resp.RefreshToken = out.RefreshToken
	resp.TokenType = "Bearer"
	resp.ExpiresIn = out.ExpiresIn
	c.JSON(200, resp)
}

// POST /v1/auth/login/2fa
func (h *AuthHandler) LoginTFA(c *gin.Context) {
	var req LoginTFARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	out, err := h.svc.LoginTFA(c.Request.Context(), req.Challenge, req.Code, requestMeta(c))
	if err != nil {
		respondErr(c, err)
		return
	}

	c.JSON(200, LoginResponse{
		AccessToken:  out.AccessToken,
		RefreshToken: out.RefreshToken,
		TokenType:    "Bearer",
		ExpiresIn:    out.ExpiresIn,
		UserID:       out.UserID.String(),
	})
}

// POST /v1/auth/refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	out, err := h.svc.Refresh(c.Request.Context(), req.RefreshToken, requestMeta(c))
	if err != nil {
		respondErr(c, err)
		return
	}

	c.JSON(200, RefreshResponse{
		AccessToken:  out.AccessToken,
		RefreshToken: out.RefreshToken,
		TokenType:    "Bearer",
		ExpiresIn:    out.ExpiresIn,
	})
}

// POST /v1/auth/logout
func (h *AuthHandler) Logout(c *gin.Context) {
	var req LogoutRequest
	_ = c.ShouldBindJSON(&req) // logout is idempotent — ignore body errors

	if err := h.svc.Logout(c.Request.Context(), req.RefreshToken, requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	c.Status(204)
}

// POST /v1/auth/logout-all
func (h *AuthHandler) LogoutAll(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user in context"))
		return
	}
	if err := h.svc.LogoutAll(c.Request.Context(), userID, requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	c.Status(204)
}

// POST /v1/auth/verify-email
func (h *AuthHandler) VerifyEmail(c *gin.Context) {
	var req VerifyEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	if err := h.svc.VerifyEmail(c.Request.Context(), req.Token, requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"message": "Email verified. You can log in now."})
}

// POST /v1/auth/forgot-password
func (h *AuthHandler) ForgotPassword(c *gin.Context) {
	var req ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	// Always 200 — don't leak whether email exists
	_ = h.svc.ForgotPassword(c.Request.Context(), req.Email, requestMeta(c))
	c.JSON(200, gin.H{
		"message": "If an account exists with that email, a reset link has been sent.",
	})
}

// POST /v1/auth/reset-password
func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	if err := h.svc.ResetPassword(c.Request.Context(), req.Token, req.NewPassword, requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"message": "Password reset successful. Please log in with your new password."})
}

// POST /v1/auth/password/change
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user in context"))
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	if err := h.svc.ChangePassword(c.Request.Context(), userID, req.CurrentPassword, req.NewPassword, requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"message": "Password changed. All other sessions have been revoked."})
}

// GET /v1/auth/me
func (h *AuthHandler) Me(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user in context"))
		return
	}
	roles, _ := c.Get(middleware.CtxRoles)
	tier, _ := c.Get(middleware.CtxTier)

	// Load the full profile from the DB so the frontend gets the real username,
	// email, etc. (the JWT only carries id/roles/tier).
	user, err := h.svc.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}

	c.JSON(200, gin.H{
		"user_id":            userID,
		"session_id":         middleware.GetSessionID(c),
		"username":           user.Username,
		"email":              user.Email,
		"email_verified":     user.EmailVerified,
		"two_factor_enabled": user.TFAEnabled,
		"avatar_url":         nil,
		"country":            nil,
		"roles":              roles,
		"tier":               tier,
		"created_at":         user.CreatedAt,
	})
}

// ============================================================================
// Helpers
// ============================================================================

func requestMeta(c *gin.Context) service.RequestMeta {
	ip, _ := netip.ParseAddr(c.ClientIP())
	return service.RequestMeta{
		IP:        ip,
		UserAgent: c.Request.UserAgent(),
		Country:   c.GetHeader("CF-IPCountry"),
		RequestID: middleware.GetRequestID(c),
	}
}

// respondErr writes a typed error response.
func respondErr(c *gin.Context, err error) {
	if e, ok := autherrors.As(err); ok {
		body := gin.H{
			"code":    e.Code,
			"message": e.Message,
		}
		if e.Details != nil {
			body["details"] = e.Details
		}
		c.AbortWithStatusJSON(e.HTTPStatus(), gin.H{"error": body})
		return
	}
	c.AbortWithStatusJSON(500, gin.H{
		"error": gin.H{"code": "INTERNAL_ERROR", "message": "An internal error occurred"},
	})
}

// respondValidation writes a 400 with field-level details.
func respondValidation(c *gin.Context, err error) {
	fields := validators.FormatErrors(err)
	c.AbortWithStatusJSON(400, gin.H{
		"error": gin.H{
			"code":    "VALIDATION_FAILED",
			"message": "Request validation failed",
			"details": gin.H{"fields": fields},
		},
	})
}

// silence unused import
var _ = uuid.Nil
var _ = strings.Builder{}
