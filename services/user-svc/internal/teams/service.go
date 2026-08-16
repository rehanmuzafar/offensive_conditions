// Package teams implements team CRUD and member management.
package teams

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/user-svc/internal/config"
	uerrors "github.com/offensive-conditions/user-svc/internal/errors"
	"github.com/offensive-conditions/user-svc/internal/producers"
	"github.com/offensive-conditions/user-svc/internal/repository"
)

// Service handles team operations.
type Service struct {
	teamRepo    repository.TeamRepository
	profileRepo repository.ProfileRepository
	friendRepo  repository.FriendRepository
	publisher   *producers.Publisher
	cfg         *config.Config
	log         zerolog.Logger
}

type Deps struct {
	TeamRepo    repository.TeamRepository
	ProfileRepo repository.ProfileRepository
	FriendRepo  repository.FriendRepository
	Publisher   *producers.Publisher
	Cfg         *config.Config
	Log         zerolog.Logger
}

func New(d Deps) *Service {
	return &Service{
		teamRepo:    d.TeamRepo,
		profileRepo: d.ProfileRepo,
		friendRepo:  d.FriendRepo,
		publisher:   d.Publisher,
		cfg:         d.Cfg,
		log:         d.Log,
	}
}

var (
	teamNameRe = regexp.MustCompile(`^[\p{L}\p{N} _'.-]{3,50}$`)
	teamSlugRe = regexp.MustCompile(`^[a-z0-9-]{3,32}$`)
)

// CreateRequest is the wire payload to create a new team.
type CreateRequest struct {
	Name             string `json:"name"`
	Slug             string `json:"slug"`
	Description      string `json:"description,omitempty"`
	CountryCode      string `json:"country_code,omitempty"`
	Website          string `json:"website,omitempty"`
	Category         string `json:"category,omitempty"`
	CategoryDetail   string `json:"category_detail,omitempty"`
	IsPrivate        bool   `json:"is_private,omitempty"`
	IsRecruiting     bool   `json:"is_recruiting,omitempty"`
}

// Create makes a new team with creator as owner.
func (s *Service) Create(ctx context.Context, creatorID uuid.UUID, tier string, req *CreateRequest, requestID string) (*repository.Team, error) {
	if req == nil {
		return nil, uerrors.New(uerrors.CodeBadRequest, "missing body")
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))

	if !teamNameRe.MatchString(req.Name) {
		return nil, uerrors.New(uerrors.CodeValidation, "team name must be 3-50 chars")
	}
	if !teamSlugRe.MatchString(req.Slug) {
		return nil, uerrors.New(uerrors.CodeValidation, "team slug must be 3-32 lowercase alphanumeric+hyphen")
	}

	// Check user's existing team count against limit
	count, err := s.teamRepo.CountByMember(ctx, creatorID)
	if err != nil {
		return nil, uerrors.Internal(err)
	}
	if count >= s.cfg.Limits.MaxTeamsPerUser {
		return nil, uerrors.New(uerrors.CodeConflict, "you have reached the team limit")
	}

	// Determine max team size based on tier
	maxSize := s.cfg.Limits.MaxTeamSizeFree
	if isProTier(tier) {
		maxSize = s.cfg.Limits.MaxTeamSizePro
	}

	team := &repository.Team{
		ID:           uuid.New(),
		Name:         req.Name,
		Slug:         req.Slug,
		Description:  req.Description,
		CountryCode:  strings.ToUpper(req.CountryCode),
		Website:      req.Website,
		IsPrivate:    req.IsPrivate,
		IsRecruiting: req.IsRecruiting,
		MaxMembers:   maxSize,
		OwnerID:      creatorID,
		MemberCount:  1,
		Category:       req.Category,
		CategoryDetail: req.CategoryDetail,
	}
	if err := s.teamRepo.Create(ctx, team); err != nil {
		if errors.Is(err, repository.ErrConflict) {
			return nil, uerrors.New(uerrors.CodeUsernameTaken, "team slug already taken")
		}
		return nil, uerrors.Internal(err)
	}

	// Add creator as owner
	if err := s.teamRepo.AddMember(ctx, &repository.TeamMembership{
		TeamID: team.ID, UserID: creatorID, Role: "captain",
	}); err != nil {
		return nil, uerrors.Internal(err)
	}

	if s.publisher != nil {
		_ = s.publisher.PublishTeamCreated(ctx, team.ID, creatorID, requestID)
	}
	return team, nil
}

// Get returns a team if it exists and isn't disbanded.
func (s *Service) Get(ctx context.Context, teamID uuid.UUID) (*repository.Team, error) {
	t, err := s.teamRepo.Get(ctx, teamID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, uerrors.New(uerrors.CodeTeamNotFound, "team not found")
		}
		return nil, uerrors.Internal(err)
	}
	if t.DisbandedAt != nil {
		return nil, uerrors.New(uerrors.CodeTeamNotFound, "team has been disbanded")
	}
	return t, nil
}

// GetBySlug resolves a slug to a team.
func (s *Service) GetBySlug(ctx context.Context, slug string) (*repository.Team, error) {
	t, err := s.teamRepo.GetBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, uerrors.New(uerrors.CodeTeamNotFound, "team not found")
		}
		return nil, uerrors.Internal(err)
	}
	if t.DisbandedAt != nil {
		return nil, uerrors.New(uerrors.CodeTeamNotFound, "team has been disbanded")
	}
	return t, nil
}

// ListMyTeams returns active teams userID is currently a member of.
func (s *Service) ListMyTeams(ctx context.Context, userID uuid.UUID) ([]*repository.Team, error) {
	teams, err := s.teamRepo.ListByMember(ctx, userID)
	if err != nil {
		return nil, uerrors.Internal(err)
	}
	return teams, nil
}

// ListMembers returns active members of a team.
func (s *Service) ListMembers(ctx context.Context, teamID uuid.UUID) ([]*repository.TeamMembership, error) {
	if _, err := s.Get(ctx, teamID); err != nil {
		return nil, err
	}
	return s.teamRepo.ListMembers(ctx, teamID)
}

// UpdateRequest is the partial-update payload for a team.
type UpdateRequest struct {
	Name         *string `json:"name,omitempty"`
	Description  *string `json:"description,omitempty"`
	CountryCode  *string `json:"country_code,omitempty"`
	Website      *string `json:"website,omitempty"`
	// Empty string clears these — that is how "remove the picture" and
	// "this team has no affiliation" are expressed.
	AvatarURL      *string `json:"avatar_url,omitempty"`
	CategoryDetail *string `json:"category_detail,omitempty"`
	IsPrivate      *bool   `json:"is_private,omitempty"`
	IsRecruiting   *bool   `json:"is_recruiting,omitempty"`
}

// Update modifies team fields. Only the owner can update.
func (s *Service) Update(ctx context.Context, teamID, actorID uuid.UUID, req *UpdateRequest, requestID string) (*repository.Team, error) {
	team, err := s.Get(ctx, teamID)
	if err != nil {
		return nil, err
	}
	if team.OwnerID != actorID {
		return nil, uerrors.New(uerrors.CodeNotCaptain, "only the team owner can update")
	}
	if req != nil {
		if req.Name != nil {
			name := strings.TrimSpace(*req.Name)
			if !teamNameRe.MatchString(name) {
				return nil, uerrors.New(uerrors.CodeValidation, "invalid team name")
			}
			team.Name = name
		}
		if req.Description != nil {
			team.Description = strings.TrimSpace(*req.Description)
		}
		if req.CountryCode != nil {
			team.CountryCode = strings.ToUpper(strings.TrimSpace(*req.CountryCode))
		}
		if req.Website != nil {
			team.Website = strings.TrimSpace(*req.Website)
		}
		if req.AvatarURL != nil {
			team.AvatarURL = strings.TrimSpace(*req.AvatarURL)
		}
		if req.CategoryDetail != nil {
			team.CategoryDetail = strings.TrimSpace(*req.CategoryDetail)
		}
		if req.IsPrivate != nil {
			team.IsPrivate = *req.IsPrivate
		}
		if req.IsRecruiting != nil {
			team.IsRecruiting = *req.IsRecruiting
		}
	}
	if err := s.teamRepo.Update(ctx, team); err != nil {
		return nil, uerrors.Internal(err)
	}
	return team, nil
}

// Disband marks the team and all memberships as ended. Owner-only.
func (s *Service) Disband(ctx context.Context, teamID, actorID uuid.UUID, requestID string) error {
	team, err := s.Get(ctx, teamID)
	if err != nil {
		return err
	}
	if team.OwnerID != actorID {
		return uerrors.New(uerrors.CodeNotCaptain, "only the team owner can disband")
	}
	if err := s.teamRepo.Disband(ctx, teamID); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTeamDisbanded(ctx, teamID, actorID, requestID)
	}
	return nil
}

// =============================================================================
// Invitations
// =============================================================================

// Invite creates a pending invitation from inviterID to inviteeID.
func (s *Service) Invite(ctx context.Context, teamID, inviterID, inviteeID uuid.UUID, message, requestID string) (*repository.TeamInvitation, error) {
	team, err := s.Get(ctx, teamID)
	if err != nil {
		return nil, err
	}
	// Inviter must be an active member (owner or admin)
	mem, err := s.teamRepo.GetMembership(ctx, teamID, inviterID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, uerrors.New(uerrors.CodeForbidden, "you are not a member of this team")
		}
		return nil, uerrors.Internal(err)
	}
	if mem.LeftAt != nil || !isTeamLead(mem.Role) {
		return nil, uerrors.New(uerrors.CodeForbidden, "only owners and admins can invite")
	}
	if team.MemberCount >= team.MaxMembers {
		return nil, uerrors.New(uerrors.CodeTeamFull, "team is full")
	}
	if inviterID == inviteeID {
		return nil, uerrors.New(uerrors.CodeBadRequest, "cannot invite yourself")
	}
	// Invitee must exist and be invitable
	if _, err := s.profileRepo.Get(ctx, inviteeID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, uerrors.New(uerrors.CodeUserNotFound, "invitee not found")
		}
		return nil, uerrors.Internal(err)
	}
	// Invitee must not already be a member
	if m, err := s.teamRepo.GetMembership(ctx, teamID, inviteeID); err == nil && m.LeftAt == nil {
		return nil, uerrors.New(uerrors.CodeAlreadyInTeam, "user is already a member")
	}
	// Check blocking either direction
	if s.friendRepo != nil {
		blocked, err := s.friendRepo.IsBlockedEither(ctx, inviterID, inviteeID)
		if err != nil {
			return nil, uerrors.Internal(err)
		}
		if blocked {
			return nil, uerrors.New(uerrors.CodeBlockedByOther, "cannot invite due to blocking")
		}
	}

	inv := &repository.TeamInvitation{
		ID:        uuid.New(),
		TeamID:    teamID,
		InviterID: inviterID,
		InviteeID: inviteeID,
		Status:    "pending",
		Message:   message,
		ExpiresAt: time.Now().Add(s.cfg.Limits.InvitationTTL),
	}
	if err := s.teamRepo.CreateInvitation(ctx, inv); err != nil {
		return nil, uerrors.Internal(err)
	}
	return inv, nil
}

// AcceptInvite accepts a pending invitation atomically (mark accepted + add member + increment count).
func (s *Service) AcceptInvite(ctx context.Context, invID, actorID uuid.UUID, requestID string) error {
	inv, err := s.teamRepo.GetInvitation(ctx, invID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeInvitationNotFound, "invitation not found")
		}
		return uerrors.Internal(err)
	}
	if inv.InviteeID != actorID {
		return uerrors.New(uerrors.CodeForbidden, "this invitation is not for you")
	}
	if inv.Status != "pending" {
		return uerrors.New(uerrors.CodeInvitationExpired, "invitation is no longer pending")
	}
	if time.Now().After(inv.ExpiresAt) {
		return uerrors.New(uerrors.CodeInvitationExpired, "invitation expired")
	}

	team, err := s.Get(ctx, inv.TeamID)
	if err != nil {
		return err
	}
	if team.MemberCount >= team.MaxMembers {
		return uerrors.New(uerrors.CodeTeamFull, "team is full")
	}

	if err := s.teamRepo.UpdateInvitationStatus(ctx, invID, "accepted"); err != nil {
		return uerrors.Internal(err)
	}
	if err := s.teamRepo.AddMember(ctx, &repository.TeamMembership{
		TeamID: inv.TeamID, UserID: actorID, Role: "member",
	}); err != nil {
		return uerrors.Internal(err)
	}
	if err := s.teamRepo.IncrementMemberCount(ctx, inv.TeamID, 1); err != nil {
		s.log.Warn().Err(err).Msg("increment member count failed")
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTeamJoined(ctx, inv.TeamID, actorID, "member", requestID)
	}
	return nil
}

// DeclineInvite marks an invitation as declined.
func (s *Service) DeclineInvite(ctx context.Context, invID, actorID uuid.UUID) error {
	inv, err := s.teamRepo.GetInvitation(ctx, invID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeInvitationNotFound, "invitation not found")
		}
		return uerrors.Internal(err)
	}
	if inv.InviteeID != actorID {
		return uerrors.New(uerrors.CodeForbidden, "this invitation is not for you")
	}
	if inv.Status != "pending" {
		return nil // idempotent
	}
	return s.teamRepo.UpdateInvitationStatus(ctx, invID, "declined")
}

// ListMyInvitations returns pending invitations for the user.
func (s *Service) ListMyInvitations(ctx context.Context, userID uuid.UUID) ([]*repository.TeamInvitation, error) {
	return s.teamRepo.ListPendingInvitationsForUser(ctx, userID)
}

// =============================================================================
// Member operations
// =============================================================================

// Leave: the actor leaves the team. The owner can't simply leave; they must transfer first.
func (s *Service) Leave(ctx context.Context, teamID, actorID uuid.UUID, requestID string) error {
	team, err := s.Get(ctx, teamID)
	if err != nil {
		return err
	}
	mem, err := s.teamRepo.GetMembership(ctx, teamID, actorID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeNotInTeam, "you are not a member of this team")
		}
		return uerrors.Internal(err)
	}
	if mem.LeftAt != nil {
		return uerrors.New(uerrors.CodeNotInTeam, "you have already left this team")
	}
	if team.OwnerID == actorID {
		return uerrors.New(uerrors.CodeForbidden, "owner must transfer ownership before leaving")
	}
	if err := s.teamRepo.RemoveMember(ctx, teamID, actorID); err != nil {
		return uerrors.Internal(err)
	}
	if err := s.teamRepo.IncrementMemberCount(ctx, teamID, -1); err != nil {
		s.log.Warn().Err(err).Msg("decrement member count failed")
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTeamLeft(ctx, teamID, actorID, requestID)
	}
	return nil
}

// Kick removes a member. Owner can kick anyone (except themselves); admins can kick members but not other admins.
func (s *Service) Kick(ctx context.Context, teamID, actorID, targetID uuid.UUID, requestID string) error {
	team, err := s.Get(ctx, teamID)
	if err != nil {
		return err
	}
	if actorID == targetID {
		return uerrors.New(uerrors.CodeBadRequest, "use leave to remove yourself")
	}

	actorMem, err := s.teamRepo.GetMembership(ctx, teamID, actorID)
	if err != nil || actorMem.LeftAt != nil {
		return uerrors.New(uerrors.CodeForbidden, "you are not a member of this team")
	}
	targetMem, err := s.teamRepo.GetMembership(ctx, teamID, targetID)
	if err != nil || targetMem.LeftAt != nil {
		return uerrors.New(uerrors.CodeNotInTeam, "target is not a member of this team")
	}

	// Only owner or admin can kick
	if !isTeamLead(actorMem.Role) {
		return uerrors.New(uerrors.CodeForbidden, "only owners and admins can kick")
	}
	// Admin cannot kick owner or another admin
	if actorMem.Role == "admin" && isTeamLead(targetMem.Role) {
		return uerrors.New(uerrors.CodeForbidden, "admins cannot kick owner or other admins")
	}
	// Owner cannot kick themselves (covered above) but otherwise can kick anyone
	if targetID == team.OwnerID {
		return uerrors.New(uerrors.CodeForbidden, "cannot kick the team owner")
	}

	if err := s.teamRepo.RemoveMember(ctx, teamID, targetID); err != nil {
		return uerrors.Internal(err)
	}
	if err := s.teamRepo.IncrementMemberCount(ctx, teamID, -1); err != nil {
		s.log.Warn().Err(err).Msg("decrement member count failed")
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTeamKicked(ctx, teamID, targetID, actorID, requestID)
	}
	return nil
}

// Promote: the current owner transfers ownership to targetID. Old owner stays as admin.
func (s *Service) Promote(ctx context.Context, teamID, currentOwnerID, newOwnerID uuid.UUID, requestID string) error {
	team, err := s.Get(ctx, teamID)
	if err != nil {
		return err
	}
	if team.OwnerID != currentOwnerID {
		return uerrors.New(uerrors.CodeNotCaptain, "only the current owner can transfer ownership")
	}
	if currentOwnerID == newOwnerID {
		return uerrors.New(uerrors.CodeBadRequest, "you are already the owner")
	}
	targetMem, err := s.teamRepo.GetMembership(ctx, teamID, newOwnerID)
	if err != nil || targetMem.LeftAt != nil {
		return uerrors.New(uerrors.CodeNotInTeam, "target is not a member of this team")
	}
	if err := s.teamRepo.UpdateMemberRole(ctx, teamID, newOwnerID, "captain"); err != nil {
		return uerrors.Internal(err)
	}
	if err := s.teamRepo.UpdateMemberRole(ctx, teamID, currentOwnerID, "admin"); err != nil {
		return uerrors.Internal(err)
	}
	team.OwnerID = newOwnerID
	if err := s.teamRepo.Update(ctx, team); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTeamPromoted(ctx, teamID, newOwnerID, currentOwnerID, requestID)
	}
	return nil
}

func isProTier(t string) bool {
	switch strings.ToLower(t) {
	case "vip", "vip_plus", "team", "enterprise":
		return true
	}
	return false
}

// isTeamLead reports whether a role may administer the team. "owner" is the
// pre-rename spelling and is still accepted so existing rows keep working.
func isTeamLead(role string) bool {
	return role == "captain" || role == "owner" || role == "admin"
}

// Browse lists public teams for discovery. Private teams are excluded: they are
// invitation-only, so listing them would only produce failed join requests.
func (s *Service) Browse(
	ctx context.Context, f repository.TeamFilter, limit, offset int,
) ([]*repository.Team, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	return s.teamRepo.ListPublic(ctx, f, limit, offset)
}

// RequestJoin records a player's request to join a team.
func (s *Service) RequestJoin(
	ctx context.Context, teamID, userID uuid.UUID, message string,
) (*repository.TeamJoinRequest, error) {
	team, err := s.Get(ctx, teamID)
	if err != nil {
		return nil, err
	}
	if team.IsPrivate {
		return nil, uerrors.New(uerrors.CodeForbidden, "this team is invitation-only")
	}
	if team.MemberCount >= team.MaxMembers {
		return nil, uerrors.New(uerrors.CodeConflict, "this team is full")
	}
	if mem, _ := s.teamRepo.GetMembership(ctx, teamID, userID); mem != nil && mem.LeftAt == nil {
		return nil, uerrors.New(uerrors.CodeConflict, "you are already on this team")
	}

	jr := &repository.TeamJoinRequest{TeamID: teamID, UserID: userID, Message: message}
	if err := s.teamRepo.CreateJoinRequest(ctx, jr); err != nil {
		if errors.Is(err, repository.ErrConflict) {
			return nil, uerrors.New(uerrors.CodeConflict, "you already have a pending request")
		}
		return nil, uerrors.Internal(err)
	}
	return jr, nil
}

// ListJoinRequests returns pending requests; captains only.
func (s *Service) ListJoinRequests(
	ctx context.Context, teamID, actorID uuid.UUID,
) ([]*repository.TeamJoinRequest, error) {
	mem, err := s.teamRepo.GetMembership(ctx, teamID, actorID)
	if err != nil || mem == nil || mem.LeftAt != nil || !isTeamLead(mem.Role) {
		return nil, uerrors.New(uerrors.CodeForbidden, "only a captain can review join requests")
	}
	return s.teamRepo.ListJoinRequests(ctx, teamID)
}

// DecideJoinRequest accepts or declines; accepting adds the member.
func (s *Service) DecideJoinRequest(
	ctx context.Context, requestID, actorID uuid.UUID, accept bool,
) error {
	jr, err := s.teamRepo.GetJoinRequest(ctx, requestID)
	if err != nil {
		return uerrors.New(uerrors.CodeNotFound, "request not found")
	}
	if jr.Status != "pending" {
		return uerrors.New(uerrors.CodeConflict, "this request was already decided")
	}
	mem, err := s.teamRepo.GetMembership(ctx, jr.TeamID, actorID)
	if err != nil || mem == nil || mem.LeftAt != nil || !isTeamLead(mem.Role) {
		return uerrors.New(uerrors.CodeForbidden, "only a captain can decide join requests")
	}

	status := "declined"
	if accept {
		team, err := s.Get(ctx, jr.TeamID)
		if err != nil {
			return err
		}
		if team.MemberCount >= team.MaxMembers {
			return uerrors.New(uerrors.CodeConflict, "this team is full")
		}
		if err := s.teamRepo.AddMember(ctx, &repository.TeamMembership{
			TeamID: jr.TeamID, UserID: jr.UserID, Role: "member",
		}); err != nil {
			return uerrors.Internal(err)
		}
		if err := s.teamRepo.IncrementMemberCount(ctx, jr.TeamID, 1); err != nil {
			return uerrors.Internal(err)
		}
		status = "accepted"
	}
	return s.teamRepo.DecideJoinRequest(ctx, requestID, status, actorID)
}
