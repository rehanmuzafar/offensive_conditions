package handlers

import (
	"net/url"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	autherrors "github.com/offensive-conditions/auth/internal/errors"
	"github.com/offensive-conditions/auth/internal/middleware"
	"github.com/offensive-conditions/auth/internal/service"
)

// ============================================================================
// 2FA Handler
// ============================================================================

type TFAHandler struct {
	svc *service.AuthService
	log zerolog.Logger
}

func NewTFAHandler(svc *service.AuthService, log zerolog.Logger) *TFAHandler {
	return &TFAHandler{svc: svc, log: log}
}

type TFAEnrollResponse struct {
	Secret      string   `json:"secret"`        // base32, for manual entry
	OtpAuthURL  string   `json:"otpauth_url"`   // for QR code generation
	BackupCodes []string `json:"backup_codes"`  // shown once
}

type TFAConfirmRequest struct {
	Code string `json:"code" binding:"required,totp_code"`
}

type TFADisableRequest struct {
	Password string `json:"password" binding:"required"`
	Code     string `json:"code" binding:"required"`
}

// POST /v1/auth/2fa/enroll
func (h *TFAHandler) Enroll(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user"))
		return
	}
	out, err := h.svc.EnrollTFA(c.Request.Context(), userID, requestMeta(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, TFAEnrollResponse{
		Secret: out.Secret, OtpAuthURL: out.OtpAuthURL, BackupCodes: out.BackupCodes,
	})
}

// POST /v1/auth/2fa/confirm
func (h *TFAHandler) Confirm(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user"))
		return
	}
	var req TFAConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}
	if err := h.svc.ConfirmTFA(c.Request.Context(), userID, req.Code, requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"message": "2FA enabled. Store your backup codes safely."})
}

// POST /v1/auth/2fa/disable
func (h *TFAHandler) Disable(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user"))
		return
	}
	var req TFADisableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondValidation(c, err)
		return
	}
	if err := h.svc.DisableTFA(c.Request.Context(), userID, req.Password, req.Code, requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"message": "2FA disabled."})
}

// POST /v1/auth/2fa/backup-codes
func (h *TFAHandler) RegenerateBackupCodes(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user"))
		return
	}
	codes, err := h.svc.RegenerateBackupCodes(c.Request.Context(), userID, requestMeta(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{
		"backup_codes": codes,
		"message":      "Backup codes regenerated. Old codes are invalidated.",
	})
}

// ============================================================================
// Session Handler
// ============================================================================

type SessionHandler struct {
	svc *service.AuthService
	log zerolog.Logger
}

func NewSessionHandler(svc *service.AuthService, log zerolog.Logger) *SessionHandler {
	return &SessionHandler{svc: svc, log: log}
}

// GET /v1/auth/sessions
func (h *SessionHandler) List(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user"))
		return
	}

	sessions, err := h.svc.ListSessions(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}

	currentSessionID := middleware.GetSessionID(c)
	out := make([]gin.H, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, gin.H{
			"id":             s.ID,
			"user_agent":     s.UserAgent,
			"ip_address":     s.IPAddress.String(),
			"country":        s.CountryCode,
			"city":           s.City,
			"last_active_at": s.LastActiveAt,
			"created_at":     s.CreatedAt,
			"is_current":     s.ID.String() == currentSessionID,
		})
	}
	c.JSON(200, gin.H{"sessions": out})
}

// DELETE /v1/auth/sessions/:id
func (h *SessionHandler) Revoke(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		respondErr(c, autherrors.New(autherrors.CodeUnauthorized, "no user"))
		return
	}
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, autherrors.New(autherrors.CodeBadRequest, "invalid session id"))
		return
	}
	if err := h.svc.RevokeSession(c.Request.Context(), userID, sessionID, requestMeta(c)); err != nil {
		respondErr(c, err)
		return
	}
	c.Status(204)
}

// ============================================================================
// OAuth Handler
// ============================================================================

type OAuthHandler struct {
	svc                  *service.AuthService
	postLoginRedirectURL string // Frontend URL to redirect to after OAuth login
	log                  zerolog.Logger
}

func NewOAuthHandler(svc *service.AuthService, postLoginRedirectURL string, log zerolog.Logger) *OAuthHandler {
	return &OAuthHandler{svc: svc, postLoginRedirectURL: postLoginRedirectURL, log: log}
}

// GET /v1/auth/providers
//
// Returns the list of enabled OAuth provider names so the frontend can
// conditionally render sign-in buttons.
func (h *OAuthHandler) Providers(c *gin.Context) {
	providers := h.svc.OAuthProviders()
	if providers == nil {
		providers = []string{}
	}
	c.JSON(200, gin.H{"providers": providers})
}

// GET /v1/auth/oauth/:provider
//
// Initiates the OAuth flow.
// If user is authenticated, defaults to "link" mode. Otherwise "login" mode.
func (h *OAuthHandler) Begin(c *gin.Context) {
	provider := c.Param("provider")
	if provider == "" {
		respondErr(c, autherrors.New(autherrors.CodeBadRequest, "missing provider"))
		return
	}

	mode := "login"
	var linkUser *uuid.UUID
	if uid, ok := middleware.GetUserID(c); ok {
		mode = "link"
		linkUser = &uid
	}

	authURL, _, err := h.svc.OAuthBegin(c.Request.Context(), provider, mode, linkUser)
	if err != nil {
		respondErr(c, err)
		return
	}

	// API returns the URL; the browser navigates there.
	// (We don't 302 because clients may want to log the URL or open in popup.)
	c.JSON(200, gin.H{"auth_url": authURL})
}

// GET /v1/auth/oauth/:provider/callback?code=...&state=...
//
// Completes the OAuth flow and redirects to the frontend with tokens in the URL fragment.
func (h *OAuthHandler) Callback(c *gin.Context) {
	provider := c.Param("provider")
	code := c.Query("code")
	state := c.Query("state")
	errParam := c.Query("error")

	if errParam != "" {
		h.redirectError(c, errParam)
		return
	}
	if code == "" || state == "" {
		h.redirectError(c, "missing_params")
		return
	}

	out, err := h.svc.OAuthCallback(c.Request.Context(), provider, code, state, requestMeta(c))
	if err != nil {
		if e, ok := autherrors.As(err); ok {
			h.redirectError(c, string(e.Code))
		} else {
			h.redirectError(c, "internal_error")
		}
		return
	}

	// Redirect to frontend with tokens in fragment (so they aren't sent to server)
	u, _ := url.Parse(h.postLoginRedirectURL)
	q := url.Values{}
	q.Set("access_token", out.AccessToken)
	q.Set("refresh_token", out.RefreshToken)
	q.Set("expires_in", itoa(out.ExpiresIn))
	q.Set("user_id", out.UserID.String())
	u.Fragment = q.Encode()
	c.Redirect(302, u.String())
}

func (h *OAuthHandler) redirectError(c *gin.Context, code string) {
	u, err := url.Parse(h.postLoginRedirectURL)
	if err != nil {
		c.JSON(400, gin.H{"error": gin.H{"code": code, "message": "OAuth failed"}})
		return
	}
	q := u.Query()
	q.Set("oauth_error", code)
	u.RawQuery = q.Encode()
	c.Redirect(302, u.String())
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var buf [20]byte
	n := len(buf)
	for i > 0 {
		n--
		buf[n] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		n--
		buf[n] = '-'
	}
	return string(buf[n:])
}
