package errors

import (
	"errors"
	"fmt"
	"net/http"
)

type Code string

const (
	CodeInternal     Code = "INTERNAL_ERROR"
	CodeBadRequest   Code = "BAD_REQUEST"
	CodeUnauthorized Code = "UNAUTHORIZED"
	CodeForbidden    Code = "FORBIDDEN"
	CodeNotFound     Code = "NOT_FOUND"
	CodeConflict     Code = "CONFLICT"
	CodeValidation   Code = "VALIDATION_FAILED"
	CodeRateLimited  Code = "RATE_LIMITED"

	// User-service-specific
	CodeUsernameTaken          Code = "USERNAME_TAKEN"
	CodeUserNotFound           Code = "USER_NOT_FOUND"
	CodeTeamNotFound           Code = "TEAM_NOT_FOUND"
	CodeTeamFull               Code = "TEAM_FULL"
	CodeAlreadyInTeam          Code = "ALREADY_IN_TEAM"
	CodeNotInTeam              Code = "NOT_IN_TEAM"
	CodeNotCaptain             Code = "NOT_CAPTAIN"
	CodeInvitationNotFound     Code = "INVITATION_NOT_FOUND"
	CodeInvitationExpired      Code = "INVITATION_EXPIRED"
	CodeAlreadyFriends         Code = "ALREADY_FRIENDS"
	CodeNotFriends             Code = "NOT_FRIENDS"
	CodeFriendRequestNotFound  Code = "FRIEND_REQUEST_NOT_FOUND"
	CodeBlockedByOther         Code = "BLOCKED_BY_OTHER"
	CodeBlockedByYou           Code = "BLOCKED_BY_YOU"
	CodeFollowSelf             Code = "FOLLOW_SELF"
	CodeAvatarTooLarge         Code = "AVATAR_TOO_LARGE"
	CodeAvatarBadFormat        Code = "AVATAR_BAD_FORMAT"
	CodeDeletionAlreadyPending Code = "DELETION_ALREADY_PENDING"
	CodeDeletionNotPending     Code = "DELETION_NOT_PENDING"
	CodeExportInProgress       Code = "EXPORT_IN_PROGRESS"
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
	case CodeBadRequest, CodeValidation, CodeAvatarBadFormat:
		return http.StatusBadRequest
	case CodeUnauthorized:
		return http.StatusUnauthorized
	case CodeForbidden, CodeNotCaptain, CodeBlockedByOther, CodeBlockedByYou, CodeFollowSelf:
		return http.StatusForbidden
	case CodeNotFound, CodeUserNotFound, CodeTeamNotFound, CodeInvitationNotFound,
		CodeFriendRequestNotFound, CodeNotInTeam, CodeNotFriends, CodeDeletionNotPending:
		return http.StatusNotFound
	case CodeConflict, CodeUsernameTaken, CodeTeamFull, CodeAlreadyInTeam, CodeAlreadyFriends,
		CodeDeletionAlreadyPending, CodeExportInProgress, CodeInvitationExpired:
		return http.StatusConflict
	case CodeRateLimited:
		return http.StatusTooManyRequests
	case CodeAvatarTooLarge:
		return http.StatusRequestEntityTooLarge
	default:
		return http.StatusInternalServerError
	}
}

func Internal(cause error) *Error { return Wrap(cause, CodeInternal, "internal server error") }
