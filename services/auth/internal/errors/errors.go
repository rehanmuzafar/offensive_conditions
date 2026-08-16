package errors

import (
	"errors"
	"fmt"
	"net/http"
)

// Code represents a stable, machine-readable error code returned to clients.
type Code string

const (
	CodeInternal              Code = "INTERNAL_ERROR"
	CodeBadRequest            Code = "BAD_REQUEST"
	CodeUnauthorized          Code = "UNAUTHORIZED"
	CodeForbidden             Code = "FORBIDDEN"
	CodeNotFound              Code = "NOT_FOUND"
	CodeConflict              Code = "CONFLICT"
	CodeRateLimited           Code = "RATE_LIMITED"
	CodeValidation            Code = "VALIDATION_FAILED"

	// Auth-specific
	CodeInvalidCredentials    Code = "INVALID_CREDENTIALS"
	CodeAccountLocked         Code = "ACCOUNT_LOCKED"
	CodeAccountSuspended      Code = "ACCOUNT_SUSPENDED"
	CodeAccountBanned         Code = "ACCOUNT_BANNED"
	CodeEmailNotVerified      Code = "EMAIL_NOT_VERIFIED"
	CodeEmailAlreadyVerified  Code = "EMAIL_ALREADY_VERIFIED"
	CodeEmailTaken            Code = "EMAIL_ALREADY_REGISTERED"
	CodeUsernameTaken         Code = "USERNAME_ALREADY_TAKEN"
	CodeWeakPassword          Code = "PASSWORD_TOO_WEAK"
	CodeInvalidToken          Code = "INVALID_TOKEN"
	CodeExpiredToken          Code = "EXPIRED_TOKEN"
	CodeTokenReused           Code = "TOKEN_REUSE_DETECTED"
	CodeTFARequired           Code = "TFA_REQUIRED"
	CodeTFAInvalidCode        Code = "TFA_INVALID_CODE"
	CodeTFAAlreadyEnabled     Code = "TFA_ALREADY_ENABLED"
	CodeTFANotEnabled         Code = "TFA_NOT_ENABLED"
	CodeOAuthProvider         Code = "OAUTH_PROVIDER_ERROR"
	CodeOAuthStateMismatch    Code = "OAUTH_STATE_MISMATCH"
	CodeSamePassword          Code = "SAME_AS_OLD_PASSWORD"
)

// Error is the typed error returned across the service.
// Implementations attach a stable Code and an HTTP status hint.
type Error struct {
	Code    Code           `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
	cause   error
	status  int
}

func (e *Error) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.cause)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *Error) Unwrap() error { return e.cause }

// HTTPStatus returns the suggested HTTP status code.
func (e *Error) HTTPStatus() int {
	if e.status != 0 {
		return e.status
	}
	return defaultStatus(e.Code)
}

// WithDetails attaches structured details for the client.
func (e *Error) WithDetails(d map[string]any) *Error {
	e.Details = d
	return e
}

// WithCause wraps an underlying error (not exposed to client).
func (e *Error) WithCause(err error) *Error {
	e.cause = err
	return e
}

// New creates a typed error.
func New(code Code, msg string) *Error {
	return &Error{Code: code, Message: msg, status: defaultStatus(code)}
}

// Wrap creates a typed error wrapping the original cause.
func Wrap(err error, code Code, msg string) *Error {
	return &Error{Code: code, Message: msg, cause: err, status: defaultStatus(code)}
}

// Is reports whether err matches the given Error's Code.
func Is(err error, code Code) bool {
	var e *Error
	if errors.As(err, &e) {
		return e.Code == code
	}
	return false
}

// As extracts the typed Error if present.
func As(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}

// defaultStatus maps Code → HTTP status.
func defaultStatus(c Code) int {
	switch c {
	case CodeBadRequest, CodeValidation, CodeWeakPassword, CodeOAuthStateMismatch, CodeSamePassword:
		return http.StatusBadRequest
	case CodeUnauthorized, CodeInvalidCredentials, CodeInvalidToken, CodeExpiredToken,
		CodeTokenReused, CodeTFAInvalidCode:
		return http.StatusUnauthorized
	case CodeForbidden, CodeAccountLocked, CodeAccountSuspended, CodeAccountBanned,
		CodeEmailNotVerified, CodeTFARequired:
		return http.StatusForbidden
	case CodeNotFound:
		return http.StatusNotFound
	case CodeConflict, CodeEmailTaken, CodeUsernameTaken, CodeEmailAlreadyVerified,
		CodeTFAAlreadyEnabled, CodeTFANotEnabled:
		return http.StatusConflict
	case CodeRateLimited:
		return http.StatusTooManyRequests
	case CodeOAuthProvider:
		return http.StatusBadGateway
	default:
		return http.StatusInternalServerError
	}
}

// Common error constructors (convenience)

func InvalidCredentials() *Error {
	return New(CodeInvalidCredentials, "Email or password is incorrect")
}

func AccountLocked(retryAfter string) *Error {
	return New(CodeAccountLocked, "Account temporarily locked due to failed login attempts").
		WithDetails(map[string]any{"retry_after": retryAfter})
}

func EmailNotVerified() *Error {
	return New(CodeEmailNotVerified, "Email address is not verified")
}

func TFARequired(challenge string) *Error {
	return New(CodeTFARequired, "Two-factor authentication required").
		WithDetails(map[string]any{"challenge": challenge})
}

func InvalidToken(reason string) *Error {
	e := New(CodeInvalidToken, "Token is invalid")
	if reason != "" {
		e.WithDetails(map[string]any{"reason": reason})
	}
	return e
}

func ExpiredToken() *Error {
	return New(CodeExpiredToken, "Token has expired")
}

func RateLimited(retryAfter string) *Error {
	return New(CodeRateLimited, "Too many requests").
		WithDetails(map[string]any{"retry_after": retryAfter})
}

func Internal(cause error) *Error {
	return Wrap(cause, CodeInternal, "An internal error occurred")
}
