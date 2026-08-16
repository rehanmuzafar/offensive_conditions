// Package handlers implements the HTTP API surface.
package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	uerrors "github.com/offensive-conditions/user-svc/internal/errors"
	"github.com/offensive-conditions/user-svc/internal/follows"
	"github.com/offensive-conditions/user-svc/internal/friends"
	"github.com/offensive-conditions/user-svc/internal/gdpr"
	"github.com/offensive-conditions/user-svc/internal/middleware"
	"github.com/offensive-conditions/user-svc/internal/profiles"
	"github.com/offensive-conditions/user-svc/internal/repository"
	"github.com/offensive-conditions/user-svc/internal/search"
	"github.com/offensive-conditions/user-svc/internal/teams"
)

// =============================================================================
// Health
// =============================================================================

type HealthHandler struct {
	db      *pgxpool.Pool
	rdb     *redis.Client
	version string
}

func NewHealthHandler(db *pgxpool.Pool, rdb *redis.Client, version string) *HealthHandler {
	return &HealthHandler{db: db, rdb: rdb, version: version}
}

func (h *HealthHandler) Live(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "version": h.version})
}

func (h *HealthHandler) Ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	checks := gin.H{}
	overall := true
	if err := h.db.Ping(ctx); err != nil {
		checks["postgres"] = "down: " + err.Error()
		overall = false
	} else {
		checks["postgres"] = "ok"
	}
	if h.rdb != nil {
		if err := h.rdb.Ping(ctx).Err(); err != nil {
			checks["redis"] = "down: " + err.Error()
			overall = false
		} else {
			checks["redis"] = "ok"
		}
	}
	status := http.StatusOK
	if !overall {
		status = http.StatusServiceUnavailable
	}
	c.JSON(status, gin.H{"ok": overall, "checks": checks})
}

// =============================================================================
// Profile handler
// =============================================================================

type ProfileHandler struct {
	svc *profiles.Service
	log zerolog.Logger
}

func NewProfileHandler(svc *profiles.Service, log zerolog.Logger) *ProfileHandler {
	return &ProfileHandler{svc: svc, log: log}
}

func (h *ProfileHandler) Me(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	p, err := h.svc.Get(c.Request.Context(), uid)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": serializeProfile(p, true)})
}

func (h *ProfileHandler) GetByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	viewerID, _ := middleware.UserIDFrom(c)
	p, err2 := h.svc.Get(c.Request.Context(), id)
	if err2 != nil {
		respondError(c, asUErr(err2))
		return
	}
	owner := viewerID == p.UserID
	if !owner && p.Privacy.ProfileVisibility == "private" {
		respondError(c, uerrors.New(uerrors.CodeForbidden, "profile is private"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": serializeProfile(p, owner)})
}

func (h *ProfileHandler) GetByUsername(c *gin.Context) {
	username := c.Param("username")
	viewerID, _ := middleware.UserIDFrom(c)
	p, err := h.svc.GetByUsername(c.Request.Context(), username)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	owner := viewerID == p.UserID
	if !owner && p.Privacy.ProfileVisibility == "private" {
		respondError(c, uerrors.New(uerrors.CodeForbidden, "profile is private"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": serializeProfile(p, owner)})
}

func (h *ProfileHandler) UpdateMe(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	var req profiles.UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid body"))
		return
	}
	p, err := h.svc.Update(c.Request.Context(), uid, &req, middleware.RequestIDFrom(c))
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": serializeProfile(p, true)})
}

type privacyRequest struct {
	ProfileVisibility   string `json:"profile_visibility"`
	ShowCountry         bool   `json:"show_country"`
	ShowTeam            bool   `json:"show_team"`
	ShowAchievements    bool   `json:"show_achievements"`
	ShowOnLeaderboard   bool   `json:"show_on_leaderboard"`
	AllowFriendRequests bool   `json:"allow_friend_requests"`
	AllowMessages       string `json:"allow_messages"`
}

func (h *ProfileHandler) UpdatePrivacy(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	var req privacyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid body"))
		return
	}
	if err := h.svc.UpdatePrivacy(c.Request.Context(), uid, repository.PrivacySettings{
		ProfileVisibility:   req.ProfileVisibility,
		ShowCountry:         req.ShowCountry,
		ShowTeam:            req.ShowTeam,
		ShowAchievements:    req.ShowAchievements,
		ShowOnLeaderboard:   req.ShowOnLeaderboard,
		AllowFriendRequests: req.AllowFriendRequests,
		AllowMessages:       req.AllowMessages,
	}, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *ProfileHandler) UploadAvatar(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	file, header, err := c.Request.FormFile("avatar")
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "missing 'avatar' multipart field"))
		return
	}
	defer file.Close()
	ct := header.Header.Get("Content-Type")
	url, err := h.svc.UploadAvatar(c.Request.Context(), uid, file, ct, middleware.RequestIDFrom(c))
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"avatar_url": url})
}

func (h *ProfileHandler) DeleteAvatar(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	if err := h.svc.DeleteAvatar(c.Request.Context(), uid, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// =============================================================================
// Team handler
// =============================================================================

type TeamHandler struct {
	svc *teams.Service
	log zerolog.Logger
}

func NewTeamHandler(svc *teams.Service, log zerolog.Logger) *TeamHandler {
	return &TeamHandler{svc: svc, log: log}
}

func (h *TeamHandler) Create(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	tier := middleware.UserTierFrom(c)
	var req teams.CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid body"))
		return
	}
	team, err := h.svc.Create(c.Request.Context(), uid, tier, &req, middleware.RequestIDFrom(c))
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusCreated, gin.H{"team": team})
}

func (h *TeamHandler) Get(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid team id"))
		return
	}
	team, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"team": team})
}

func (h *TeamHandler) GetBySlug(c *gin.Context) {
	team, err := h.svc.GetBySlug(c.Request.Context(), c.Param("slug"))
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"team": team})
}

func (h *TeamHandler) ListMembers(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid team id"))
		return
	}
	members, err := h.svc.ListMembers(c.Request.Context(), id)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"members": members})
}

func (h *TeamHandler) ListMine(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	mine, err := h.svc.ListMyTeams(c.Request.Context(), uid)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"teams": mine})
}

func (h *TeamHandler) Update(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid team id"))
		return
	}
	var req teams.UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid body"))
		return
	}
	team, err := h.svc.Update(c.Request.Context(), id, uid, &req, middleware.RequestIDFrom(c))
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"team": team})
}

func (h *TeamHandler) Disband(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid team id"))
		return
	}
	if err := h.svc.Disband(c.Request.Context(), id, uid, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type inviteRequest struct {
	InviteeID uuid.UUID `json:"invitee_id"`
	Message   string    `json:"message,omitempty"`
}

func (h *TeamHandler) Invite(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid team id"))
		return
	}
	var req inviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid body"))
		return
	}
	inv, err := h.svc.Invite(c.Request.Context(), teamID, uid, req.InviteeID, req.Message, middleware.RequestIDFrom(c))
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusCreated, gin.H{"invitation": inv})
}

func (h *TeamHandler) AcceptInvite(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	invID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid invitation id"))
		return
	}
	if err := h.svc.AcceptInvite(c.Request.Context(), invID, uid, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *TeamHandler) DeclineInvite(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	invID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid invitation id"))
		return
	}
	if err := h.svc.DeclineInvite(c.Request.Context(), invID, uid); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *TeamHandler) ListMyInvitations(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	invs, err := h.svc.ListMyInvitations(c.Request.Context(), uid)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"invitations": invs})
}

func (h *TeamHandler) Leave(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid team id"))
		return
	}
	if err := h.svc.Leave(c.Request.Context(), teamID, uid, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *TeamHandler) Kick(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid team id"))
		return
	}
	targetID, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	if err := h.svc.Kick(c.Request.Context(), teamID, uid, targetID, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *TeamHandler) Promote(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid team id"))
		return
	}
	newOwner, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	if err := h.svc.Promote(c.Request.Context(), teamID, uid, newOwner, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// =============================================================================
// Friends handler
// =============================================================================

type FriendsHandler struct {
	svc *friends.Service
	log zerolog.Logger
}

func NewFriendsHandler(svc *friends.Service, log zerolog.Logger) *FriendsHandler {
	return &FriendsHandler{svc: svc, log: log}
}

type sendFriendRequestBody struct {
	ReceiverID uuid.UUID `json:"receiver_id"`
	Message    string    `json:"message,omitempty"`
}

func (h *FriendsHandler) SendRequest(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	var body sendFriendRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid body"))
		return
	}
	req, err := h.svc.SendRequest(c.Request.Context(), uid, body.ReceiverID, body.Message, middleware.RequestIDFrom(c))
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusCreated, gin.H{"request": req})
}

func (h *FriendsHandler) ListRequests(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	in, err := h.svc.ListIncoming(c.Request.Context(), uid)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	out, err := h.svc.ListOutgoing(c.Request.Context(), uid)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"incoming": in, "outgoing": out})
}

func (h *FriendsHandler) AcceptRequest(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid request id"))
		return
	}
	if err := h.svc.AcceptRequest(c.Request.Context(), id, uid, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *FriendsHandler) DeclineRequest(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid request id"))
		return
	}
	if err := h.svc.DeclineRequest(c.Request.Context(), id, uid); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *FriendsHandler) CancelRequest(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid request id"))
		return
	}
	if err := h.svc.CancelRequest(c.Request.Context(), id, uid); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *FriendsHandler) ListFriends(c *gin.Context) {
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	limit, offset := paginationParams(c)
	ids, err := h.svc.ListFriends(c.Request.Context(), uid, limit, offset)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"friends": ids})
}

func (h *FriendsHandler) Unfriend(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	other, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	if err := h.svc.Unfriend(c.Request.Context(), uid, other, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type blockBody struct {
	Reason string `json:"reason,omitempty"`
}

func (h *FriendsHandler) Block(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	target, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	var body blockBody
	_ = c.ShouldBindJSON(&body)
	if err := h.svc.Block(c.Request.Context(), uid, target, body.Reason, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *FriendsHandler) Unblock(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	target, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	if err := h.svc.Unblock(c.Request.Context(), uid, target, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *FriendsHandler) ListBlocked(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	ids, err := h.svc.ListBlocked(c.Request.Context(), uid)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"blocked": ids})
}

// =============================================================================
// Follows handler
// =============================================================================

type FollowsHandler struct {
	svc *follows.Service
	log zerolog.Logger
}

func NewFollowsHandler(svc *follows.Service, log zerolog.Logger) *FollowsHandler {
	return &FollowsHandler{svc: svc, log: log}
}

func (h *FollowsHandler) Follow(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	target, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	if err := h.svc.Follow(c.Request.Context(), uid, target, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *FollowsHandler) Unfollow(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	target, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	if err := h.svc.Unfollow(c.Request.Context(), uid, target, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *FollowsHandler) ListFollowers(c *gin.Context) {
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	limit, offset := paginationParams(c)
	ids, err := h.svc.ListFollowers(c.Request.Context(), uid, limit, offset)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	counts, _ := h.svc.Counts(c.Request.Context(), uid)
	c.JSON(http.StatusOK, gin.H{"followers": ids, "counts": counts})
}

func (h *FollowsHandler) ListFollowing(c *gin.Context) {
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid user id"))
		return
	}
	limit, offset := paginationParams(c)
	ids, err := h.svc.ListFollowing(c.Request.Context(), uid, limit, offset)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	counts, _ := h.svc.Counts(c.Request.Context(), uid)
	c.JSON(http.StatusOK, gin.H{"following": ids, "counts": counts})
}

// =============================================================================
// Search handler
// =============================================================================

type SearchHandler struct {
	svc *search.Service
}

func NewSearchHandler(svc *search.Service) *SearchHandler {
	return &SearchHandler{svc: svc}
}

func (h *SearchHandler) SearchUsers(c *gin.Context) {
	q := c.Query("q")
	country := c.Query("country")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
	results, err := h.svc.SearchUsers(c.Request.Context(), q, country, limit)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	out := make([]gin.H, 0, len(results))
	for _, p := range results {
		out = append(out, serializeProfile(p, false))
	}
	c.JSON(http.StatusOK, gin.H{"results": out})
}

func (h *SearchHandler) CountByCountry(c *gin.Context) {
	code := c.Param("code")
	n, err := h.svc.CountByCountry(c.Request.Context(), code)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"country": code, "count": n})
}

// =============================================================================
// GDPR handler
// =============================================================================

type GDPRHandler struct {
	svc *gdpr.Service
	log zerolog.Logger
}

func NewGDPRHandler(svc *gdpr.Service, log zerolog.Logger) *GDPRHandler {
	return &GDPRHandler{svc: svc, log: log}
}

func (h *GDPRHandler) RequestExport(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	expID, err := h.svc.RequestExport(c.Request.Context(), uid, middleware.RequestIDFrom(c))
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"export_id": expID, "status": "pending"})
}

func (h *GDPRHandler) GetExport(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "invalid export id"))
		return
	}
	exp, url, err := h.svc.GetExport(c.Request.Context(), id, uid)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"export": exp, "download_url": url})
}

func (h *GDPRHandler) RequestDeletion(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	if err := h.svc.RequestDeletion(c.Request.Context(), uid, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"ok": true, "message": "deletion scheduled; check status for the date"})
}

func (h *GDPRHandler) CancelDeletion(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	if err := h.svc.CancelDeletion(c.Request.Context(), uid, middleware.RequestIDFrom(c)); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *GDPRHandler) DeletionStatus(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	r, err := h.svc.GetDeletionStatus(c.Request.Context(), uid)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	if r == nil {
		c.JSON(http.StatusOK, gin.H{"pending": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"pending":      r.Status == "pending",
		"status":       r.Status,
		"scheduled_at": r.ScheduledAt,
		"requested_at": r.RequestedAt,
	})
}

// =============================================================================
// Helpers
// =============================================================================

func respondError(c *gin.Context, err *uerrors.Error) {
	c.AbortWithStatusJSON(err.HTTPStatus(), gin.H{"error": err})
}

func asUErr(err error) *uerrors.Error {
	if err == nil {
		return uerrors.Internal(errors.New("unknown"))
	}
	if e, ok := uerrors.As(err); ok {
		return e
	}
	return uerrors.Internal(err)
}

func paginationParams(c *gin.Context) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	return limit, offset
}

func serializeProfile(p *repository.Profile, owner bool) gin.H {
	out := gin.H{
		"user_id":      p.UserID,
		"username":     p.Username,
		"display_name": p.DisplayName,
		"bio":          p.Bio,
		"avatar_url":   p.AvatarURL,
		"timezone":     p.Timezone,
		"tier":         p.Tier,
		"is_staff":     p.IsStaff,
		"created_at":   p.CreatedAt,
	}
	if p.Privacy.ShowCountry || owner {
		out["country_code"] = p.CountryCode
	}
	out["social"] = gin.H{
		"twitter":  p.TwitterHandle,
		"github":   p.GitHubHandle,
		"linkedin": p.LinkedInURL,
		"website":  p.PersonalSiteURL,
	}
	if owner {
		out["email"] = p.Email
		out["email_verified"] = p.EmailVerified
		out["onboarding_complete"] = p.OnboardingComplete
		out["last_seen_at"] = p.LastSeenAt
		out["privacy"] = p.Privacy
	}
	return out
}

// =============================================================================
// Team discovery + join requests
// =============================================================================

// Browse lists public teams so players can find one to join.
func (h *TeamHandler) Browse(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	filter := repository.TeamFilter{
		Query:       c.Query("q"),
		Category:    c.Query("category"),
		CountryCode: c.Query("country"),
		Detail:      c.Query("detail"),
	}
	teams, err := h.svc.Browse(c.Request.Context(), filter, limit, offset)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	if teams == nil {
		teams = []*repository.Team{}
	}
	c.JSON(http.StatusOK, gin.H{"teams": teams})
}

func (h *TeamHandler) RequestJoin(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "bad team id"))
		return
	}
	var body struct {
		Message string `json:"message"`
	}
	_ = c.ShouldBindJSON(&body)

	jr, err := h.svc.RequestJoin(c.Request.Context(), teamID, uid, body.Message)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusCreated, jr)
}

func (h *TeamHandler) ListJoinRequests(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "bad team id"))
		return
	}
	reqs, err := h.svc.ListJoinRequests(c.Request.Context(), teamID, uid)
	if err != nil {
		respondError(c, asUErr(err))
		return
	}
	if reqs == nil {
		reqs = []*repository.TeamJoinRequest{}
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

func (h *TeamHandler) DecideJoinRequest(c *gin.Context) {
	uid, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, uerrors.New(uerrors.CodeUnauthorized, "no user"))
		return
	}
	reqID, err := uuid.Parse(c.Param("req_id"))
	if err != nil {
		respondError(c, uerrors.New(uerrors.CodeBadRequest, "bad request id"))
		return
	}
	accept := c.Param("decision") == "accept"
	if err := h.svc.DecideJoinRequest(c.Request.Context(), reqID, uid, accept); err != nil {
		respondError(c, asUErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": map[bool]string{true: "accepted", false: "declined"}[accept]})
}
