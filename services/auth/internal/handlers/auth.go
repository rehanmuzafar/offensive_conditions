package handlers

import (
	"net/http"
	"net/netip"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/auth/internal/config"
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
	RefreshToken string `json:"refresh_token"`
}

type RefreshResponse struct {
	AccessToken string `json:"access_token"`
	// Never populated: the refresh token is delivered as an HttpOnly cookie.
	// Kept so older clients deserialising this shape do not break.
	RefreshToken string `json:"refresh_token,omitempty"`
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

// =============================================================================
// Refresh token cookie
//
// The refresh token used to be handed to the page in the response body, and the
// frontend kept it in a cookie that JavaScript could read, on the parent domain
// — so any XSS anywhere on the site, and any script running on a
// lab-<port>.<domain> challenge host, could lift a seven-day credential.
//
// It now travels as an HttpOnly cookie. Page scripts cannot read it, and the
// edge already strips Cookie on its way to a challenge container, so both routes
// are closed.
//
// Path is "/" deliberately. The browser reaches the API through the Next
// application's own /api/* rewrite, so a cookie scoped to /v1/auth would never
// be attached to the request that needs it.
// =============================================================================

func setRefreshCookieCfg(c *gin.Context, cfg *config.Config, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		cfg.Security.RefreshCookieName,
		token,
		int(cfg.JWT.RefreshTTL.Seconds()),
		"/",
		cfg.Security.RefreshCookieDomain,
		cfg.Security.RefreshCookieSecure,
		true, // HttpOnly — the entire point
	)
}

func clearRefreshCookieCfg(c *gin.Context, cfg *config.Config) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(cfg.Security.RefreshCookieName, "", -1, "/",
		cfg.Security.RefreshCookieDomain, cfg.Security.RefreshCookieSecure, true)
}

func (h *AuthHandler) setRefreshCookie(c *gin.Context, token string) {
	setRefreshCookieCfg(c, h.svc.Config(), token)
}

func (h *AuthHandler) clearRefreshCookie(c *gin.Context) {
	clearRefreshCookieCfg(c, h.svc.Config())
}

// refreshTokenFrom prefers the cookie and falls back to the body.
//
// The fallback is kept on purpose: it lets the cookie be rolled out before the
// clients that still post the token are updated, and it keeps non-browser
// callers working. It is not a weakness — a caller that holds the token can
// already refresh with it.
func (h *AuthHandler) refreshTokenFrom(c *gin.Context, body string) string {
	if ck, err := c.Cookie(h.svc.Config().Security.RefreshCookieName); err == nil && ck != "" {
		return ck
	}
	return body
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
	// The refresh token goes back only as an HttpOnly cookie. It is deliberately
	// absent from the body: anything in the body is readable by page scripts,
	// which is the whole thing this finding was about.
	h.setRefreshCookie(c, out.RefreshToken)
	resp.AccessToken = out.AccessToken
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

	h.setRefreshCookie(c, out.RefreshToken)
	c.JSON(200, LoginResponse{
		AccessToken: out.AccessToken,
		TokenType:   "Bearer",
		ExpiresIn:   out.ExpiresIn,
		UserID:      out.UserID.String(),
	})
}

// POST /v1/auth/refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	token := h.refreshTokenFrom(c, req.RefreshToken)
	if token == "" {
		respondErr(c, autherrors.InvalidToken("no refresh token supplied"))
		return
	}

	out, err := h.svc.Refresh(c.Request.Context(), token, requestMeta(c))
	if err != nil {
		// A refresh that fails is the end of this session: clear the cookie so
		// the browser stops presenting a token that will never work again.
		h.clearRefreshCookie(c)
		respondErr(c, err)
		return
	}

	// Rotation issues a new token every time, so the cookie is replaced too.
	// The new token is not returned in the body, for the same reason as login.
	h.setRefreshCookie(c, out.RefreshToken)
	c.JSON(200, RefreshResponse{
		AccessToken: out.AccessToken,
		TokenType:   "Bearer",
		ExpiresIn:   out.ExpiresIn,
	})
}

// POST /v1/auth/logout
func (h *AuthHandler) Logout(c *gin.Context) {
	var req LogoutRequest
	_ = c.ShouldBindJSON(&req) // logout is idempotent — ignore body errors

	if err := h.svc.Logout(c.Request.Context(), h.refreshTokenFrom(c, req.RefreshToken), requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	h.clearRefreshCookie(c)
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
	h.clearRefreshCookie(c)
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

type ChangeUsernameRequest struct {
	Username string `json:"username" binding:"required,username"`
}

// PATCH /v1/auth/me/username
//
// Lives in auth rather than in user-svc because auth.users owns the column.
// user-svc reads it through a join rather than keeping a copy, so nothing else
// has to be told about the change.
func (h *AuthHandler) ChangeUsername(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user in context"))
		return
	}

	var req ChangeUsernameRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}

	if err := h.svc.ChangeUsername(c.Request.Context(), userID, req.Username, requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"username": req.Username})
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
