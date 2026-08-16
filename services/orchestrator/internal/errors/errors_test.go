package errors

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestError_HTTPStatus(t *testing.T) {
	cases := []struct {
		code   Code
		status int
	}{
		{CodeBadRequest, http.StatusBadRequest},
		{CodeUnauthorized, http.StatusUnauthorized},
		{CodeForbidden, http.StatusForbidden},
		{CodeNotFound, http.StatusNotFound},
		{CodeMachineNotFound, http.StatusNotFound},
		{CodeInstanceNotFound, http.StatusNotFound},
		{CodeConflict, http.StatusConflict},
		{CodeFlagAlreadySolved, http.StatusConflict},
		{CodeRateLimited, http.StatusTooManyRequests},
		{CodeQuotaExceeded, http.StatusPaymentRequired},
		{CodeConcurrentExceeded, http.StatusPaymentRequired},
		{CodeMaxExtensionsReached, http.StatusPaymentRequired},
		{CodeCapacityExhausted, http.StatusServiceUnavailable},
		{CodeBackendFailure, http.StatusServiceUnavailable},
		{CodeNetworkAllocFailed, http.StatusServiceUnavailable},
		{CodeInternal, http.StatusInternalServerError},
	}
	for _, c := range cases {
		e := New(c.code, "test")
		assert.Equal(t, c.status, e.HTTPStatus(), string(c.code))
	}
}

func TestError_Is(t *testing.T) {
	e := New(CodeQuotaExceeded, "limit")
	assert.True(t, Is(e, CodeQuotaExceeded))
	assert.False(t, Is(e, CodeForbidden))
	assert.False(t, Is(errors.New("plain"), CodeQuotaExceeded))
}

func TestError_As(t *testing.T) {
	e := New(CodeBackendFailure, "k8s down")
	got, ok := As(e)
	assert.True(t, ok)
	assert.Equal(t, CodeBackendFailure, got.Code)

	_, ok = As(errors.New("plain"))
	assert.False(t, ok)
}

func TestError_WithDetails(t *testing.T) {
	e := New(CodeQuotaExceeded, "test").WithDetails(map[string]any{"limit": 40})
	assert.Equal(t, 40, e.Details["limit"])
}

func TestError_Wrap(t *testing.T) {
	root := errors.New("db connection refused")
	e := Wrap(root, CodeInternal, "failed to query")
	assert.ErrorIs(t, e, root)
	assert.Contains(t, e.Error(), "db connection refused")
}

func TestQuotaExceeded_Helper(t *testing.T) {
	e := QuotaExceeded(40, "free")
	assert.Equal(t, CodeQuotaExceeded, e.Code)
	assert.Equal(t, 40, e.Details["limit"])
	assert.Equal(t, "free", e.Details["tier"])
	assert.Equal(t, http.StatusPaymentRequired, e.HTTPStatus())
}
