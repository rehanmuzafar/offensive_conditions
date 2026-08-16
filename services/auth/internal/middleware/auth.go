package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	autherrors "github.com/offensive-conditions/auth/internal/errors"
	"github.com/offensive-conditions/auth/internal/tokens"
)

// Context keys for storing authenticated user info.
const (
	CtxUserID    = "auth_user_id"
	CtxSessionID = "auth_session_id"
	CtxRoles     = "auth_roles"
	CtxTier      = "auth_tier"
	CtxClaims    = "auth_claims"
)

// RequireAuth validates the Bearer token and sets user info in context.
// Returns 401 on any failure.
func RequireAuth(jwt *tokens.JWTIssuer) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			respondAuthError(c, autherrors.New(autherrors.CodeUnauthorized, "Missing Authorization header"))
			return
		}

		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			respondAuthError(c, autherrors.New(autherrors.CodeUnauthorized, "Invalid Authorization scheme"))
			return
		}

		claims, err := jwt.Verify(parts[1])
		if err != nil {
			switch err {
			case tokens.ErrTokenExpired:
				respondAuthError(c, autherrors.ExpiredToken())
			case tokens.ErrInvalidSignature:
				respondAuthError(c, autherrors.InvalidToken("signature"))
			default:
				respondAuthError(c, autherrors.InvalidToken(""))
			}
			return
		}

		userID, err := uuid.Parse(claims.UserID)
		if err != nil {
			respondAuthError(c, autherrors.InvalidToken("sub"))
			return
		}

		c.Set(CtxUserID, userID)
		c.Set(CtxSessionID, claims.SessionID)
		c.Set(CtxRoles, claims.Roles)
		c.Set(CtxTier, claims.Tier)
		c.Set(CtxClaims, claims)

		c.Next()
	}
}

// RequireRole restricts the route to users having at least one of the given roles.
// Must run after RequireAuth.
func RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userRoles, _ := c.Get(CtxRoles)
		actual, ok := userRoles.([]string)
		if !ok || len(actual) == 0 {
			respondAuthError(c, autherrors.New(autherrors.CodeForbidden, "Insufficient permissions"))
			return
		}
		for _, required := range roles {
			for _, have := range actual {
				if have == required {
					c.Next()
					return
				}
			}
		}
		respondAuthError(c, autherrors.New(autherrors.CodeForbidden, "Insufficient permissions"))
	}
}

// GetUserID returns the authenticated user's UUID from context.
func GetUserID(c *gin.Context) (uuid.UUID, bool) {
	v, ok := c.Get(CtxUserID)
	if !ok {
		return uuid.Nil, false
	}
	id, ok := v.(uuid.UUID)
	return id, ok
}

// GetSessionID returns the session ID from context.
func GetSessionID(c *gin.Context) string {
	v, ok := c.Get(CtxSessionID)
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}

func respondAuthError(c *gin.Context, err *autherrors.Error) {
	c.AbortWithStatusJSON(err.HTTPStatus(), gin.H{
		"error": gin.H{
			"code":    err.Code,
			"message": err.Message,
			"details": err.Details,
		},
	})
}

// silence unused
var _ = http.StatusOK
