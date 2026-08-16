package grpcsrv

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	autherrors "github.com/offensive-conditions/auth/internal/errors"
	"github.com/offensive-conditions/auth/internal/repository"
	"github.com/offensive-conditions/auth/internal/service"
	"github.com/offensive-conditions/auth/internal/tokens"
)

// AuthGRPCServer exposes internal-only token validation for other microservices.
//
// IMPORTANT: We use a hand-rolled minimal proto-free implementation here for portability.
// In a production deployment you'd generate proto stubs from proto/auth/v1/auth.proto
// and embed `proto.UnimplementedAuthServiceServer`.
//
// The actual proto would look like:
//   service AuthService {
//     rpc ValidateToken(ValidateTokenRequest) returns (ValidateTokenResponse);
//     rpc GetUser(GetUserRequest) returns (UserResponse);
//     rpc RevokeUserSessions(RevokeUserSessionsRequest) returns (Empty);
//   }
//
// For now, this struct + methods are wired through the gRPC server in cmd/server/main.go
// using a generated stub. The methods below are the actual implementations.

type AuthGRPCServer struct {
	jwt   *tokens.JWTIssuer
	users repository.UserRepository
	svc   *service.AuthService
	log   zerolog.Logger
}

func NewAuthGRPCServer(
	jwt *tokens.JWTIssuer,
	users repository.UserRepository,
	svc *service.AuthService,
	log zerolog.Logger,
) *AuthGRPCServer {
	return &AuthGRPCServer{jwt: jwt, users: users, svc: svc, log: log}
}

// ValidateTokenResult is what ValidateToken returns to callers.
// When proto is generated, the .proto message mirrors these fields.
type ValidateTokenResult struct {
	Valid     bool
	UserID    string
	SessionID string
	Tier      string
	Roles     []string
	ExpiresAt int64 // unix
	Reason    string
}

// ValidateToken verifies a JWT and returns user info.
// Called by every other microservice on every authenticated request via mTLS.
func (s *AuthGRPCServer) ValidateToken(ctx context.Context, accessToken string) (*ValidateTokenResult, error) {
	claims, err := s.jwt.Verify(accessToken)
	if err != nil {
		reason := "invalid"
		switch {
		case errors.Is(err, tokens.ErrTokenExpired):
			reason = "expired"
		case errors.Is(err, tokens.ErrInvalidSignature):
			reason = "bad_signature"
		}
		return &ValidateTokenResult{Valid: false, Reason: reason}, nil
	}

	return &ValidateTokenResult{
		Valid:     true,
		UserID:    claims.UserID,
		SessionID: claims.SessionID,
		Tier:      claims.Tier,
		Roles:     claims.Roles,
		ExpiresAt: claims.ExpiresAt.Unix(),
	}, nil
}

// UserResult is the data returned by GetUser.
type UserResult struct {
	UserID        string
	Email         string
	Username      string
	Status        string
	Role          string
	EmailVerified bool
	TFAEnabled    bool
	CreatedAt     int64
}

// GetUser fetches a user by ID. Used by other services to enrich requests.
func (s *AuthGRPCServer) GetUser(ctx context.Context, userIDStr string) (*UserResult, error) {
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid user_id: %v", err)
	}
	u, err := s.users.GetByID(ctx, userID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, status.Error(codes.NotFound, "user not found")
		}
		return nil, status.Errorf(codes.Internal, "lookup failed")
	}
	return &UserResult{
		UserID:        u.ID.String(),
		Email:         u.Email,
		Username:      u.Username,
		Status:        string(u.Status),
		Role:          u.Role,
		EmailVerified: u.EmailVerified,
		TFAEnabled:    u.TFAEnabled,
		CreatedAt:     u.CreatedAt.Unix(),
	}, nil
}

// RevokeUserSessions kills all sessions for a user. Called by admin service on ban/suspend.
func (s *AuthGRPCServer) RevokeUserSessions(ctx context.Context, userIDStr, reason string) error {
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "invalid user_id: %v", err)
	}
	if err := s.svc.LogoutAll(ctx, userID, service.RequestMeta{}); err != nil {
		return status.Errorf(codes.Internal, "%v", err)
	}
	return nil
}

// silence unused
var _ = fmt.Sprintf
var _ = autherrors.CodeInternal
