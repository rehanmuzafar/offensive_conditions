package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

// =============================================================================
// Profile
// =============================================================================

type ProfileRepository interface {
	Get(ctx context.Context, userID uuid.UUID) (*Profile, error)
	GetByUsername(ctx context.Context, username string) (*Profile, error)
	BatchGet(ctx context.Context, userIDs []uuid.UUID) (map[uuid.UUID]*Profile, error)
	Create(ctx context.Context, p *Profile) error
	UpdateBio(ctx context.Context, userID uuid.UUID, bio string) error
	UpdateDisplayName(ctx context.Context, userID uuid.UUID, name string) error
	UpdateCountry(ctx context.Context, userID uuid.UUID, code string) error
	UpdateTimezone(ctx context.Context, userID uuid.UUID, tz string) error
	UpdateSocialLinks(ctx context.Context, userID uuid.UUID, twitter, github, linkedin, site string) error
	UpdateAvatar(ctx context.Context, userID uuid.UUID, url, storageKey string) error
	SetAccountType(ctx context.Context, userID uuid.UUID, kind, companyName, companyWebsite string) error
	UpdatePrivacy(ctx context.Context, userID uuid.UUID, p PrivacySettings) error
	UpdateLastSeen(ctx context.Context, userID uuid.UUID) error
	MarkEmailVerified(ctx context.Context, userID uuid.UUID) error
	Delete(ctx context.Context, userID uuid.UUID) error

	// Search
	SearchByUsername(ctx context.Context, prefix string, country string, limit int) ([]*Profile, error)
	CountByCountry(ctx context.Context, code string) (int, error)
}

// =============================================================================
// Team
// =============================================================================

// TeamFilter narrows team discovery. Every field is optional; an empty string
// means "do not filter on this".
type TeamFilter struct {
	Query       string // free text: name, affiliation, slug or id
	Category    string // open|country|company|university|school
	CountryCode string // ISO code, exact match
	Detail      string // the affiliation itself, e.g. a university name
	// Codes the caller resolved from the same free text, so typing "Pakistan"
	// finds PK teams. Resolved by the caller rather than here because the
	// code→name list is curated at the edge (some codes are deliberately not
	// offered), and a second copy in SQL would drift away from it.
	CountryAny []string
}

type TeamRepository interface {
	Get(ctx context.Context, teamID uuid.UUID) (*Team, error)
	GetBySlug(ctx context.Context, slug string) (*Team, error)
	Create(ctx context.Context, t *Team) error
	Update(ctx context.Context, t *Team) error
	Disband(ctx context.Context, teamID uuid.UUID) error
	IncrementMemberCount(ctx context.Context, teamID uuid.UUID, delta int) error

	ListByMember(ctx context.Context, userID uuid.UUID) ([]*Team, error)
	// Discovery: public teams, filtered by name and category.
	ListPublic(ctx context.Context, f TeamFilter, limit, offset int) ([]*Team, error)
	CountByMember(ctx context.Context, userID uuid.UUID) (int, error)

	// Members
	AddMember(ctx context.Context, m *TeamMembership) error
	RemoveMember(ctx context.Context, teamID, userID uuid.UUID) error
	UpdateMemberRole(ctx context.Context, teamID, userID uuid.UUID, role string) error
	ListMembers(ctx context.Context, teamID uuid.UUID) ([]*TeamMembership, error)
	GetMembership(ctx context.Context, teamID, userID uuid.UUID) (*TeamMembership, error)

	// Invitations
	CreateInvitation(ctx context.Context, inv *TeamInvitation) error
	GetInvitation(ctx context.Context, invID uuid.UUID) (*TeamInvitation, error)
	UpdateInvitationStatus(ctx context.Context, invID uuid.UUID, status string) error
	ListPendingInvitationsForUser(ctx context.Context, userID uuid.UUID) ([]*TeamInvitation, error)

	// Join requests — the player asks, a captain decides.
	CreateJoinRequest(ctx context.Context, jr *TeamJoinRequest) error
	GetJoinRequest(ctx context.Context, id uuid.UUID) (*TeamJoinRequest, error)
	ListJoinRequests(ctx context.Context, teamID uuid.UUID) ([]*TeamJoinRequest, error)
	DecideJoinRequest(ctx context.Context, id uuid.UUID, status string, deciderID uuid.UUID) error
	ListPendingInvitationsForTeam(ctx context.Context, teamID uuid.UUID) ([]*TeamInvitation, error)
	ExpireOldInvitations(ctx context.Context) (int64, error)
}

// =============================================================================
// Friends
// =============================================================================

type FriendRepository interface {
	// Requests
	CreateRequest(ctx context.Context, r *FriendRequest) error
	GetRequest(ctx context.Context, id uuid.UUID) (*FriendRequest, error)
	UpdateRequestStatus(ctx context.Context, id uuid.UUID, status string) error
	ListIncomingRequests(ctx context.Context, userID uuid.UUID) ([]*FriendRequest, error)
	ListOutgoingRequests(ctx context.Context, userID uuid.UUID) ([]*FriendRequest, error)
	ExistingPendingBetween(ctx context.Context, a, b uuid.UUID) (*FriendRequest, error)

	// Friendships
	AreFriends(ctx context.Context, a, b uuid.UUID) (bool, error)
	AddFriendship(ctx context.Context, a, b uuid.UUID) error
	RemoveFriendship(ctx context.Context, a, b uuid.UUID) error
	ListFriends(ctx context.Context, userID uuid.UUID, limit, offset int) ([]uuid.UUID, error)
	CountFriends(ctx context.Context, userID uuid.UUID) (int, error)

	// Blocks
	AddBlock(ctx context.Context, blocker, blocked uuid.UUID, reason string) error
	RemoveBlock(ctx context.Context, blocker, blocked uuid.UUID) error
	IsBlocked(ctx context.Context, blocker, blocked uuid.UUID) (bool, error)
	IsBlockedEither(ctx context.Context, a, b uuid.UUID) (bool, error)
	ListBlocked(ctx context.Context, blocker uuid.UUID) ([]uuid.UUID, error)
}

// =============================================================================
// Follows
// =============================================================================

type FollowRepository interface {
	Follow(ctx context.Context, follower, following uuid.UUID) error
	Unfollow(ctx context.Context, follower, following uuid.UUID) error
	IsFollowing(ctx context.Context, follower, following uuid.UUID) (bool, error)
	ListFollowers(ctx context.Context, userID uuid.UUID, limit, offset int) ([]uuid.UUID, error)
	ListFollowing(ctx context.Context, userID uuid.UUID, limit, offset int) ([]uuid.UUID, error)
	CountFollowers(ctx context.Context, userID uuid.UUID) (int, error)
	CountFollowing(ctx context.Context, userID uuid.UUID) (int, error)
}

// =============================================================================
// GDPR
// =============================================================================

type GDPRRepository interface {
	CreateDeletionRequest(ctx context.Context, r *DeletionRequest) error
	GetDeletionRequest(ctx context.Context, userID uuid.UUID) (*DeletionRequest, error)
	CancelDeletionRequest(ctx context.Context, userID uuid.UUID) error
	CompleteDeletionRequest(ctx context.Context, userID uuid.UUID) error
	ListDueForDeletion(ctx context.Context, limit int) ([]*DeletionRequest, error)

	CreateExport(ctx context.Context, e *DataExport) error
	GetExport(ctx context.Context, id uuid.UUID) (*DataExport, error)
	GetActiveExportForUser(ctx context.Context, userID uuid.UUID) (*DataExport, error)
	UpdateExportStatus(ctx context.Context, id uuid.UUID, status, storageKey, errMsg string, size int64) error
	ListExpiredExports(ctx context.Context, limit int) ([]*DataExport, error)
	DeleteExport(ctx context.Context, id uuid.UUID) error
}
