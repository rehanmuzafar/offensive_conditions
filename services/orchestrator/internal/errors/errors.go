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
	CodeRateLimited    Code = "RATE_LIMITED"
	CodeValidation     Code = "VALIDATION_FAILED"

	// Lab-specific
	CodeMachineNotFound      Code = "MACHINE_NOT_FOUND"
	CodeMachineNotAvailable  Code = "MACHINE_NOT_AVAILABLE"
	CodeMachineRequiresTier  Code = "MACHINE_REQUIRES_TIER"
	CodeQuotaExceeded        Code = "QUOTA_EXCEEDED"
	CodeConcurrentExceeded   Code = "CONCURRENT_LIMIT_EXCEEDED"
	CodeCapacityExhausted    Code = "CAPACITY_EXHAUSTED"
	CodeInstanceNotFound     Code = "INSTANCE_NOT_FOUND"
	CodeInstanceNotReady     Code = "INSTANCE_NOT_READY"
	CodeInstanceTerminating  Code = "INSTANCE_TERMINATING"
	CodeInstanceFailed       Code = "INSTANCE_FAILED"
	CodeBackendFailure       Code = "BACKEND_FAILURE"
	CodeNetworkAllocFailed   Code = "NETWORK_ALLOCATION_FAILED"
	CodeMaxExtensionsReached Code = "MAX_EXTENSIONS_REACHED"
	CodeFlagSubmitInvalid    Code = "FLAG_INVALID"
	CodeFlagAlreadySolved    Code = "FLAG_ALREADY_SOLVED"
)

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

func (e *Error) Unwrap() error  { return e.cause }
func (e *Error) HTTPStatus() int {
	if e.status != 0 {
		return e.status
	}
	return defaultStatus(e.Code)
}
func (e *Error) WithDetails(d map[string]any) *Error { e.Details = d; return e }
func (e *Error) WithCause(err error) *Error           { e.cause = err; return e }

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
	case CodeBadRequest, CodeValidation, CodeFlagSubmitInvalid:
		return http.StatusBadRequest
	case CodeUnauthorized:
		return http.StatusUnauthorized
	case CodeForbidden, CodeMachineRequiresTier:
		return http.StatusForbidden
	case CodeNotFound, CodeMachineNotFound, CodeInstanceNotFound:
		return http.StatusNotFound
	case CodeConflict, CodeFlagAlreadySolved, CodeInstanceTerminating:
		return http.StatusConflict
	case CodeRateLimited:
		return http.StatusTooManyRequests
	case CodeQuotaExceeded, CodeConcurrentExceeded, CodeMaxExtensionsReached:
		return http.StatusPaymentRequired // 402 — signals upgrade
	case CodeCapacityExhausted, CodeBackendFailure, CodeNetworkAllocFailed:
		return http.StatusServiceUnavailable
	case CodeMachineNotAvailable, CodeInstanceNotReady, CodeInstanceFailed:
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

// Constructors
func Internal(cause error) *Error { return Wrap(cause, CodeInternal, "An internal error occurred") }

func QuotaExceeded(limit int, tier string) *Error {
	return New(CodeQuotaExceeded, "Monthly hours quota exceeded").WithDetails(map[string]any{
		"limit": limit, "tier": tier,
	})
}

func ConcurrentExceeded(limit int, tier string) *Error {
	return New(CodeConcurrentExceeded, "Too many concurrent instances").WithDetails(map[string]any{
		"limit": limit, "tier": tier,
	})
}

func MachineRequiresTier(required string) *Error {
	return New(CodeMachineRequiresTier, "Machine requires a higher subscription tier").
		WithDetails(map[string]any{"required_tier": required})
}

func CapacityExhausted() *Error {
	return New(CodeCapacityExhausted, "Cluster capacity exhausted; try again later")
}

func BackendFailure(backend string, cause error) *Error {
	return Wrap(cause, CodeBackendFailure, fmt.Sprintf("%s backend failed", backend)).
		WithDetails(map[string]any{"backend": backend})
}
