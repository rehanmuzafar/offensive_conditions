package errors

import (
	"errors"
	"fmt"
	"net/http"
)

type Code string

const (
	CodeInternal       Code = "INTERNAL_ERROR"
	CodeBadRequest     Code = "BAD_REQUEST"
	CodeUnauthorized   Code = "UNAUTHORIZED"
	CodeForbidden      Code = "FORBIDDEN"
	CodeNotFound       Code = "NOT_FOUND"
	CodeConflict       Code = "CONFLICT"
	CodeValidation     Code = "VALIDATION_FAILED"
	CodeRateLimited    Code = "RATE_LIMITED"

	// Flag-verifier-specific
	CodeMalformedFlag      Code = "MALFORMED_FLAG"
	CodeWrongFlag          Code = "WRONG_FLAG"
	CodeFlagExpired        Code = "FLAG_EXPIRED"
	CodeInstanceNotFound   Code = "INSTANCE_NOT_FOUND"
	CodeInstanceNotOwned   Code = "INSTANCE_NOT_OWNED"
	CodeContentNotFound    Code = "CONTENT_NOT_FOUND"
	CodeSecretUnavailable  Code = "SECRET_UNAVAILABLE"
	CodeCooldownActive     Code = "COOLDOWN_ACTIVE"
)

type Error struct {
	Code               Code           `json:"code"`
	Message            string         `json:"message"`
	Details            map[string]any `json:"details,omitempty"`
	RetryAfterSeconds  int            `json:"retry_after_seconds,omitempty"`
	cause              error
	status             int
}

func (e *Error) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.cause)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *Error) Unwrap() error { return e.cause }

func (e *Error) HTTPStatus() int {
	if e.status != 0 {
		return e.status
	}
	return defaultStatus(e.Code)
}

func (e *Error) WithDetails(d map[string]any) *Error {
	e.Details = d
	return e
}

func (e *Error) WithCause(err error) *Error {
	e.cause = err
	return e
}

func (e *Error) WithRetryAfter(seconds int) *Error {
	e.RetryAfterSeconds = seconds
	return e
}

func New(code Code, msg string) *Error {
	return &Error{Code: code, Message: msg, status: defaultStatus(code)}
}

func Wrap(err error, code Code, msg string) *Error {
	return &Error{Code: code, Message: msg, cause: err, status: defaultStatus(code)}
}

func Is(err error, code Code) bool {
	var e *Error
	if errors.As(err, &e) {
		return e.Code == code
	}
	return false
}

func As(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}

func defaultStatus(c Code) int {
	switch c {
	case CodeBadRequest, CodeValidation, CodeMalformedFlag:
		return http.StatusBadRequest
	case CodeUnauthorized:
		return http.StatusUnauthorized
	case CodeForbidden, CodeInstanceNotOwned:
		return http.StatusForbidden
	case CodeNotFound, CodeInstanceNotFound, CodeContentNotFound:
		return http.StatusNotFound
	case CodeConflict:
		return http.StatusConflict
	case CodeRateLimited, CodeCooldownActive:
		return http.StatusTooManyRequests
	case CodeSecretUnavailable:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

func Internal(cause error) *Error { return Wrap(cause, CodeInternal, "internal server error") }
