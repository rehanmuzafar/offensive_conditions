package repository

import (
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// Profile
// =============================================================================

type Profile struct {
	UserID             uuid.UUID
	Username           string // mirrored from auth.users for fast lookup
	Email              string // mirrored from auth.users (not exposed via public API)
	DisplayName        string
	Bio                string
	AvatarURL          string
	AvatarStorageKey   string
	CountryCode        string // ISO-3166-1 alpha-2
	Timezone           string
	Locale             string
	Tier               string // free | pro | enterprise
	IsStaff            bool
	IsVerifiedHuman    bool
	EmailVerified      bool
	TwitterHandle      string
	GitHubHandle       string
	LinkedInURL        string
	PersonalSiteURL    string
	Privacy            PrivacySettings
	OnboardingComplete bool
	// Which audience this account belongs to: "hacker", "company", or "" when
	// the onboarding question has not been asked yet. See users/0007.
	AccountType        string
	CompanyName        string
	CompanyWebsite     string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	LastSeenAt         *time.Time
}

type PrivacySettings struct {
	ProfileVisibility   string // public | friends_only | private
	ShowCountry         bool
	ShowTeam            bool
	ShowAchievements    bool
	ShowOnLeaderboard   bool
	AllowFriendRequests bool
	AllowMessages       string // anyone | friends_only | nobody
}

// =============================================================================
// Team
// =============================================================================

// Team is serialised straight to the wire, so it carries explicit json tags.
// Without them Go emits Go field names (ID, AvatarURL, …) and this was the only
// service on the platform answering in PascalCase.
type Team struct {
	ID           uuid.UUID  `json:"id"`
	Name         string     `json:"name"`
	Slug         string     `json:"slug"`
	Description  string     `json:"description"`
	AvatarURL    string     `json:"avatar_url"`
	BannerURL    string     `json:"banner_url"`
	CountryCode  string     `json:"country_code"`
	Website      string     `json:"website"`
	// open | country | company | university | school
	Category       string `json:"category"`
	CategoryDetail string `json:"category_detail"`
	IsPrivate    bool       `json:"is_private"`
	IsRecruiting bool       `json:"is_recruiting"`
	MaxMembers   int        `json:"max_members"`
	OwnerID      uuid.UUID  `json:"owner_id"`
	MemberCount  int        `json:"member_count"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	DisbandedAt  *time.Time `json:"disbanded_at"`
}

type TeamMembership struct {
	TeamID uuid.UUID `json:"team_id"`
	UserID uuid.UUID `json:"user_id"`
	Role   string    `json:"role"` // captain | member
	// Joined from users.profiles. Membership stores only ids, so every caller
	// that wanted to show a roster was left printing a uuid — the CTF roster
	// screen showed "07addb04" where a name belonged. One join here fixes it
	// for all of them; the alternative was a lookup per row in each caller.
	Username    string     `json:"username"`
	DisplayName string     `json:"display_name"`
	AvatarURL   string     `json:"avatar_url"`
	CountryCode string     `json:"country_code"`
	JoinedAt    time.Time  `json:"joined_at"`
	LeftAt      *time.Time `json:"left_at"`
}

type TeamInvitation struct {
	ID          uuid.UUID  `json:"id"`
	TeamID      uuid.UUID  `json:"team_id"`
	InviterID   uuid.UUID  `json:"inviter_id"`
	InviteeID   uuid.UUID  `json:"invitee_id"`
	Status      string     `json:"status"` // pending | accepted | declined | expired | revoked
	Message     string     `json:"message"`
	CreatedAt   time.Time  `json:"created_at"`
	RespondedAt *time.Time `json:"responded_at"`
	ExpiresAt   time.Time  `json:"expires_at"`
}

// =============================================================================
// Friendships
// =============================================================================

type FriendRequest struct {
	ID          uuid.UUID
	RequesterID uuid.UUID
	ReceiverID  uuid.UUID
	Status      string // pending | accepted | declined | cancelled | expired
	Message     string
	CreatedAt   time.Time
	RespondedAt *time.Time
	ExpiresAt   time.Time
}

// Friendship is stored once with (user_id_a, user_id_b) where a < b for uniqueness.
type Friendship struct {
	UserIDA   uuid.UUID
	UserIDB   uuid.UUID
	CreatedAt time.Time
}

type Block struct {
	BlockerID uuid.UUID
	BlockedID uuid.UUID
	Reason    string
	CreatedAt time.Time
}

// =============================================================================
// Follows (asymmetric)
// =============================================================================

type Follow struct {
	FollowerID  uuid.UUID
	FollowingID uuid.UUID
	CreatedAt   time.Time
}

// =============================================================================
// GDPR
// =============================================================================

type DeletionRequest struct {
	UserID      uuid.UUID
	Status      string // pending | cancelled | completed
	ScheduledAt time.Time
	RequestedAt time.Time
	CompletedAt *time.Time
}

type DataExport struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Status      string // pending | processing | completed | failed
	StorageKey  string
	SizeBytes   int64
	CreatedAt   time.Time
	CompletedAt *time.Time
	ExpiresAt   time.Time
	ErrorMsg    string
}

// TeamJoinRequest is the mirror of TeamInvitation: the player asks to join and
// a captain decides.
type TeamJoinRequest struct {
	ID        uuid.UUID  `json:"id"`
	TeamID    uuid.UUID  `json:"team_id"`
	UserID    uuid.UUID  `json:"user_id"`
	Message   string     `json:"message"`
	Status    string     `json:"status"`
	DecidedBy *uuid.UUID `json:"decided_by"`
	DecidedAt *time.Time `json:"decided_at"`
	CreatedAt time.Time  `json:"created_at"`
}
