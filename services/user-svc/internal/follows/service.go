// Package follows implements asymmetric follow relationships.
package follows

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	uerrors "github.com/offensive-conditions/user-svc/internal/errors"
	"github.com/offensive-conditions/user-svc/internal/producers"
	"github.com/offensive-conditions/user-svc/internal/repository"
)

type Service struct {
	followRepo  repository.FollowRepository
	friendRepo  repository.FriendRepository
	profileRepo repository.ProfileRepository
	publisher   *producers.Publisher
	log         zerolog.Logger
}

type Deps struct {
	FollowRepo  repository.FollowRepository
	FriendRepo  repository.FriendRepository
	ProfileRepo repository.ProfileRepository
	Publisher   *producers.Publisher
	Log         zerolog.Logger
}

func New(d Deps) *Service {
	return &Service{
		followRepo:  d.FollowRepo,
		friendRepo:  d.FriendRepo,
		profileRepo: d.ProfileRepo,
		publisher:   d.Publisher,
		log:         d.Log,
	}
}

func (s *Service) Follow(ctx context.Context, followerID, followingID uuid.UUID, requestID string) error {
	if followerID == followingID {
		return uerrors.New(uerrors.CodeFollowSelf, "cannot follow yourself")
	}
	if _, err := s.profileRepo.Get(ctx, followingID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeUserNotFound, "user not found")
		}
		return uerrors.Internal(err)
	}
	// Either-direction block check
	if s.friendRepo != nil {
		blocked, err := s.friendRepo.IsBlockedEither(ctx, followerID, followingID)
		if err != nil {
			return uerrors.Internal(err)
		}
		if blocked {
			return uerrors.New(uerrors.CodeBlockedByOther, "cannot follow due to blocking")
		}
	}
	if err := s.followRepo.Follow(ctx, followerID, followingID); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishFollowed(ctx, followerID, followingID, requestID)
	}
	return nil
}

func (s *Service) Unfollow(ctx context.Context, followerID, followingID uuid.UUID, requestID string) error {
	if err := s.followRepo.Unfollow(ctx, followerID, followingID); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishUnfollowed(ctx, followerID, followingID, requestID)
	}
	return nil
}

func (s *Service) ListFollowers(ctx context.Context, userID uuid.UUID, limit, offset int) ([]uuid.UUID, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.followRepo.ListFollowers(ctx, userID, limit, offset)
}

func (s *Service) ListFollowing(ctx context.Context, userID uuid.UUID, limit, offset int) ([]uuid.UUID, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.followRepo.ListFollowing(ctx, userID, limit, offset)
}

func (s *Service) IsFollowing(ctx context.Context, followerID, followingID uuid.UUID) (bool, error) {
	return s.followRepo.IsFollowing(ctx, followerID, followingID)
}

type Counts struct {
	Followers int `json:"followers"`
	Following int `json:"following"`
}

func (s *Service) Counts(ctx context.Context, userID uuid.UUID) (*Counts, error) {
	f, err := s.followRepo.CountFollowers(ctx, userID)
	if err != nil {
		return nil, uerrors.Internal(err)
	}
	g, err := s.followRepo.CountFollowing(ctx, userID)
	if err != nil {
		return nil, uerrors.Internal(err)
	}
	return &Counts{Followers: f, Following: g}, nil
}
