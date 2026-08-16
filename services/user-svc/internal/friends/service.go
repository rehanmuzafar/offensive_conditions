// Package friends implements friendship and blocking logic.
package friends

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/user-svc/internal/config"
	uerrors "github.com/offensive-conditions/user-svc/internal/errors"
	"github.com/offensive-conditions/user-svc/internal/producers"
	"github.com/offensive-conditions/user-svc/internal/repository"
)

type Service struct {
	friendRepo  repository.FriendRepository
	profileRepo repository.ProfileRepository
	publisher   *producers.Publisher
	cfg         *config.Config
	log         zerolog.Logger
}

type Deps struct {
	FriendRepo  repository.FriendRepository
	ProfileRepo repository.ProfileRepository
	Publisher   *producers.Publisher
	Cfg         *config.Config
	Log         zerolog.Logger
}

func New(d Deps) *Service {
	return &Service{
		friendRepo:  d.FriendRepo,
		profileRepo: d.ProfileRepo,
		publisher:   d.Publisher,
		cfg:         d.Cfg,
		log:         d.Log,
	}
}

// =============================================================================
// Friend requests
// =============================================================================

// SendRequest creates a pending request from requesterID to receiverID.
func (s *Service) SendRequest(ctx context.Context, requesterID, receiverID uuid.UUID, message, requestID string) (*repository.FriendRequest, error) {
	if requesterID == receiverID {
		return nil, uerrors.New(uerrors.CodeBadRequest, "cannot friend yourself")
	}
	// Verify receiver exists and accepts friend requests
	receiver, err := s.profileRepo.Get(ctx, receiverID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, uerrors.New(uerrors.CodeUserNotFound, "user not found")
		}
		return nil, uerrors.Internal(err)
	}
	if !receiver.Privacy.AllowFriendRequests {
		return nil, uerrors.New(uerrors.CodeForbidden, "user is not accepting friend requests")
	}

	// Check blocks both ways
	blocked, err := s.friendRepo.IsBlockedEither(ctx, requesterID, receiverID)
	if err != nil {
		return nil, uerrors.Internal(err)
	}
	if blocked {
		return nil, uerrors.New(uerrors.CodeBlockedByOther, "cannot send request due to blocking")
	}

	// Already friends?
	already, err := s.friendRepo.AreFriends(ctx, requesterID, receiverID)
	if err != nil {
		return nil, uerrors.Internal(err)
	}
	if already {
		return nil, uerrors.New(uerrors.CodeAlreadyFriends, "already friends")
	}

	// Pending request already exists in either direction?
	existing, err := s.friendRepo.ExistingPendingBetween(ctx, requesterID, receiverID)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return nil, uerrors.Internal(err)
	}
	if existing != nil {
		// If the receiver had previously sent to requester, treat as auto-accept.
		// Otherwise, just return the existing one.
		if existing.RequesterID == receiverID && existing.ReceiverID == requesterID {
			// Auto-accept the reverse pending request
			if err := s.AcceptRequest(ctx, existing.ID, requesterID, requestID); err != nil {
				return nil, err
			}
			return existing, nil
		}
		return nil, uerrors.New(uerrors.CodeConflict, "a pending request already exists")
	}

	// Friend list capacity check (best-effort)
	count, err := s.friendRepo.CountFriends(ctx, requesterID)
	if err == nil {
		limit := s.cfg.Limits.MaxFriendsFree
		// We don't have tier here; assume free; a tier-aware path goes through team service patterns.
		if count >= limit*2 {
			return nil, uerrors.New(uerrors.CodeConflict, "friend list is at capacity")
		}
	}

	req := &repository.FriendRequest{
		ID:          uuid.New(),
		RequesterID: requesterID,
		ReceiverID:  receiverID,
		Status:      "pending",
		Message:     strings.TrimSpace(message),
		ExpiresAt:   time.Now().Add(s.cfg.Limits.FriendRequestTTL),
	}
	if err := s.friendRepo.CreateRequest(ctx, req); err != nil {
		if errors.Is(err, repository.ErrConflict) {
			return nil, uerrors.New(uerrors.CodeConflict, "a pending request already exists")
		}
		return nil, uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishFriendRequested(ctx, req.ID, requesterID, receiverID, requestID)
	}
	return req, nil
}

// AcceptRequest accepts a pending request, atomically creating the friendship.
func (s *Service) AcceptRequest(ctx context.Context, reqID, actorID uuid.UUID, requestID string) error {
	req, err := s.friendRepo.GetRequest(ctx, reqID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeFriendRequestNotFound, "friend request not found")
		}
		return uerrors.Internal(err)
	}
	if req.ReceiverID != actorID {
		return uerrors.New(uerrors.CodeForbidden, "this request is not for you")
	}
	if req.Status != "pending" {
		return uerrors.New(uerrors.CodeConflict, "request is no longer pending")
	}
	if time.Now().After(req.ExpiresAt) {
		return uerrors.New(uerrors.CodeConflict, "request has expired")
	}

	// Re-check blocks (defense in depth)
	blocked, err := s.friendRepo.IsBlockedEither(ctx, req.RequesterID, req.ReceiverID)
	if err != nil {
		return uerrors.Internal(err)
	}
	if blocked {
		return uerrors.New(uerrors.CodeBlockedByOther, "cannot complete due to blocking")
	}

	if err := s.friendRepo.UpdateRequestStatus(ctx, reqID, "accepted"); err != nil {
		return uerrors.Internal(err)
	}
	if err := s.friendRepo.AddFriendship(ctx, req.RequesterID, req.ReceiverID); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishFriendAdded(ctx, req.RequesterID, req.ReceiverID, requestID)
	}
	return nil
}

// DeclineRequest marks a pending request as declined.
func (s *Service) DeclineRequest(ctx context.Context, reqID, actorID uuid.UUID) error {
	req, err := s.friendRepo.GetRequest(ctx, reqID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeFriendRequestNotFound, "friend request not found")
		}
		return uerrors.Internal(err)
	}
	if req.ReceiverID != actorID {
		return uerrors.New(uerrors.CodeForbidden, "this request is not for you")
	}
	if req.Status != "pending" {
		return nil // idempotent
	}
	return s.friendRepo.UpdateRequestStatus(ctx, reqID, "declined")
}

// CancelRequest lets the requester cancel their own outgoing request.
func (s *Service) CancelRequest(ctx context.Context, reqID, actorID uuid.UUID) error {
	req, err := s.friendRepo.GetRequest(ctx, reqID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeFriendRequestNotFound, "friend request not found")
		}
		return uerrors.Internal(err)
	}
	if req.RequesterID != actorID {
		return uerrors.New(uerrors.CodeForbidden, "this is not your request")
	}
	if req.Status != "pending" {
		return nil
	}
	return s.friendRepo.UpdateRequestStatus(ctx, reqID, "cancelled")
}

// ListIncoming returns the user's pending incoming friend requests.
func (s *Service) ListIncoming(ctx context.Context, userID uuid.UUID) ([]*repository.FriendRequest, error) {
	return s.friendRepo.ListIncomingRequests(ctx, userID)
}

// ListOutgoing returns the user's pending outgoing requests.
func (s *Service) ListOutgoing(ctx context.Context, userID uuid.UUID) ([]*repository.FriendRequest, error) {
	return s.friendRepo.ListOutgoingRequests(ctx, userID)
}

// =============================================================================
// Friendships
// =============================================================================

// ListFriends returns friend IDs for userID.
func (s *Service) ListFriends(ctx context.Context, userID uuid.UUID, limit, offset int) ([]uuid.UUID, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.friendRepo.ListFriends(ctx, userID, limit, offset)
}

// Unfriend removes a friendship between userID and otherID.
func (s *Service) Unfriend(ctx context.Context, userID, otherID uuid.UUID, requestID string) error {
	already, err := s.friendRepo.AreFriends(ctx, userID, otherID)
	if err != nil {
		return uerrors.Internal(err)
	}
	if !already {
		return uerrors.New(uerrors.CodeNotFriends, "not friends")
	}
	if err := s.friendRepo.RemoveFriendship(ctx, userID, otherID); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishFriendRemoved(ctx, userID, otherID, requestID)
	}
	return nil
}

// =============================================================================
// Blocks
// =============================================================================

// Block adds an asymmetric block. Also removes any existing friendship and cancels pending requests.
func (s *Service) Block(ctx context.Context, blockerID, blockedID uuid.UUID, reason, requestID string) error {
	if blockerID == blockedID {
		return uerrors.New(uerrors.CodeBadRequest, "cannot block yourself")
	}
	if _, err := s.profileRepo.Get(ctx, blockedID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeUserNotFound, "user not found")
		}
		return uerrors.Internal(err)
	}
	if err := s.friendRepo.AddBlock(ctx, blockerID, blockedID, reason); err != nil {
		return uerrors.Internal(err)
	}
	// Sever any existing friendship
	if err := s.friendRepo.RemoveFriendship(ctx, blockerID, blockedID); err != nil {
		s.log.Warn().Err(err).Msg("remove friendship on block failed")
	}
	if s.publisher != nil {
		_ = s.publisher.PublishBlocked(ctx, blockerID, blockedID, requestID)
	}
	return nil
}

// Unblock removes the block.
func (s *Service) Unblock(ctx context.Context, blockerID, blockedID uuid.UUID, requestID string) error {
	if err := s.friendRepo.RemoveBlock(ctx, blockerID, blockedID); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishUnblocked(ctx, blockerID, blockedID, requestID)
	}
	return nil
}

// IsBlockedEither returns true if either user has blocked the other.
func (s *Service) IsBlockedEither(ctx context.Context, a, b uuid.UUID) (bool, error) {
	return s.friendRepo.IsBlockedEither(ctx, a, b)
}

// ListBlocked returns the IDs the blocker has blocked.
func (s *Service) ListBlocked(ctx context.Context, blockerID uuid.UUID) ([]uuid.UUID, error) {
	return s.friendRepo.ListBlocked(ctx, blockerID)
}
