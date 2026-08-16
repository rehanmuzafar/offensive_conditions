package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	scoringerrors "github.com/offensive-conditions/scoring/internal/errors"
	"github.com/offensive-conditions/scoring/internal/leaderboard"
	"github.com/offensive-conditions/scoring/internal/middleware"
	"github.com/offensive-conditions/scoring/internal/repository"
	"github.com/offensive-conditions/scoring/internal/seasons"
	"github.com/offensive-conditions/scoring/internal/service"
)

// =============================================================================
// Health
// =============================================================================

type HealthHandler struct {
	db      *pgxpool.Pool
	redis   *redis.Client
	version string
}

func NewHealthHandler(db *pgxpool.Pool, rdb *redis.Client, version string) *HealthHandler {
	return &HealthHandler{db: db, redis: rdb, version: version}
}

func (h *HealthHandler) Register(r *gin.Engine) {
	r.GET("/healthz", h.healthz)
	r.GET("/readyz", h.readyz)
	r.GET("/livez", h.healthz)
}

func (h *HealthHandler) healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "scoring", "version": h.version})
}

func (h *HealthHandler) readyz(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	result := gin.H{"status": "ok"}
	failed := false
	if h.db != nil {
		if err := h.db.Ping(ctx); err != nil {
			result["db"] = err.Error()
			failed = true
		} else {
			result["db"] = "ok"
		}
	}
	if h.redis != nil {
		if err := h.redis.Ping(ctx).Err(); err != nil {
			result["redis"] = err.Error()
			failed = true
		} else {
			result["redis"] = "ok"
		}
	}
	if failed {
		result["status"] = "degraded"
		c.JSON(http.StatusServiceUnavailable, result)
		return
	}
	c.JSON(http.StatusOK, result)
}

// =============================================================================
// Profile
// =============================================================================

type ProfileHandler struct {
	svc *service.Scoring
	log zerolog.Logger
}

func NewProfileHandler(svc *service.Scoring, log zerolog.Logger) *ProfileHandler {
	return &ProfileHandler{svc: svc, log: log}
}

func (h *ProfileHandler) Register(g *gin.RouterGroup) {
	g.GET("/profile/me", h.me)
	g.GET("/profile/:user_id", h.byID)
}

type profileResponse struct {
	UserID         string `json:"user_id"`
	TotalPoints    int64  `json:"total_points"`
	MachinePoints  int64  `json:"machine_points"`
	ChallengePoints int64 `json:"challenge_points"`
	CTFPoints      int64  `json:"ctf_points"`
	BonusPoints    int64  `json:"bonus_points"`
	MachinesOwned  int    `json:"machines_owned"`
	ChallengesSolved int  `json:"challenges_solved"`
	FirstBloods    int    `json:"first_bloods"`
	UserFlagsCount int    `json:"user_flags_count"`
	RootFlagsCount int    `json:"root_flags_count"`
	GlobalRank     int    `json:"global_rank,omitempty"`
	CountryCode    string `json:"country_code,omitempty"`
	RankTier       string `json:"rank_tier,omitempty"`
	RankTierName   string `json:"rank_tier_name,omitempty"`
	CurrentStreak  int    `json:"current_streak_days"`
	LongestStreak  int    `json:"longest_streak_days"`
	ELORating      *eloResponse `json:"elo,omitempty"`
	AchievementsCount int  `json:"achievements_count"`
}

type eloResponse struct {
	Rating        int  `json:"rating"`
	PeakRating    int  `json:"peak_rating"`
	MatchesPlayed int  `json:"matches_played"`
	Wins          int  `json:"wins"`
	Losses        int  `json:"losses"`
	Draws         int  `json:"draws"`
	IsProvisional bool `json:"is_provisional"`
}

func toProfileResponse(p *service.Profile) profileResponse {
	r := profileResponse{UserID: p.UserID.String()}
	if p.Score != nil {
		s := p.Score
		r.TotalPoints = s.TotalPoints
		r.MachinePoints = s.MachinePoints
		r.ChallengePoints = s.ChallengePoints
		r.CTFPoints = s.CTFPoints
		r.BonusPoints = s.BonusPoints
		r.MachinesOwned = s.MachinesOwned
		r.ChallengesSolved = s.ChallengesSolved
		r.FirstBloods = s.FirstBloods
		r.UserFlagsCount = s.UserFlagsCount
		r.RootFlagsCount = s.RootFlagsCount
		r.CountryCode = s.CountryCode
		r.RankTier = s.RankTier
		r.CurrentStreak = s.CurrentStreakDays
		r.LongestStreak = s.LongestStreakDays
	}
	r.GlobalRank = p.GlobalRank
	if p.Tier != nil {
		r.RankTierName = p.Tier.Name
	}
	if p.ELORating != nil {
		r.ELORating = &eloResponse{
			Rating: p.ELORating.Rating, PeakRating: p.ELORating.PeakRating,
			MatchesPlayed: p.ELORating.MatchesPlayed, Wins: p.ELORating.Wins,
			Losses: p.ELORating.Losses, Draws: p.ELORating.Draws,
			IsProvisional: p.ELORating.IsProvisional,
		}
	}
	r.AchievementsCount = p.AchievementsCount
	return r
}

func (h *ProfileHandler) me(c *gin.Context) {
	userID, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, scoringerrors.New(scoringerrors.CodeUnauthorized, "auth required"))
		return
	}
	p, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusOK, toProfileResponse(p))
}

func (h *ProfileHandler) byID(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, "invalid user_id"))
		return
	}
	p, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	// Public version — strip ELO if user opted out (not implemented yet)
	c.JSON(http.StatusOK, toProfileResponse(p))
}

// =============================================================================
// Leaderboard
// =============================================================================

type LeaderboardHandler struct {
	manager *leaderboard.Manager
	pool    *pgxpool.Pool
	log     zerolog.Logger
}

func NewLeaderboardHandler(m *leaderboard.Manager, pool *pgxpool.Pool, log zerolog.Logger) *LeaderboardHandler {
	return &LeaderboardHandler{manager: m, pool: pool, log: log}
}

// enrich turns bare ranked entries (rank/user_id/score) into display-ready rows
// by joining the user's identity (auth.users), profile (users.profiles) and
// score metadata (scoring.user_scores). One query for the whole page — no N+1.
func (h *LeaderboardHandler) enrich(ctx context.Context, entries []leaderboard.Entry) []gin.H {
	out := make([]gin.H, 0, len(entries))
	if len(entries) == 0 {
		return out
	}
	ids := make([]uuid.UUID, len(entries))
	for i, e := range entries {
		ids[i] = e.UserID
	}
	type disp struct {
		username, displayName, avatarURL, country, tier string
		ownedMachines, solvedChallenges                 int
	}
	info := make(map[uuid.UUID]disp, len(ids))
	if h.pool != nil {
		const q = `
			SELECT u.id, u.username,
			       COALESCE(p.display_name, u.username) AS display_name,
			       COALESCE(p.avatar_url, '')           AS avatar_url,
			       COALESCE(s.country_code, '')         AS country,
			       COALESCE(s.rank_tier, '')            AS tier,
			       COALESCE(s.machines_owned, 0)        AS owned_machines,
			       COALESCE(s.challenges_solved, 0)     AS solved_challenges
			FROM auth.users u
			LEFT JOIN users.profiles p     ON p.user_id = u.id
			LEFT JOIN scoring.user_scores s ON s.user_id = u.id
			WHERE u.id = ANY($1)`
		rows, err := h.pool.Query(ctx, q, ids)
		if err != nil {
			h.log.Warn().Err(err).Msg("leaderboard enrich query failed")
		} else {
			defer rows.Close()
			for rows.Next() {
				var id uuid.UUID
				var d disp
				if err := rows.Scan(&id, &d.username, &d.displayName, &d.avatarURL, &d.country, &d.tier, &d.ownedMachines, &d.solvedChallenges); err == nil {
					info[id] = d
				}
			}
		}
	}
	emptyToNil := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	for _, e := range entries {
		d := info[e.UserID]
		out = append(out, gin.H{
			"rank":              e.Rank,
			"user_id":           e.UserID,
			"score":             e.Score,
			"username":          emptyToNil(d.username),
			"display_name":      emptyToNil(d.displayName),
			"avatar_url":        emptyToNil(d.avatarURL),
			"country":           emptyToNil(d.country),
			"tier":              emptyToNil(d.tier),
			"owned_machines":    d.ownedMachines,
			"solved_challenges": d.solvedChallenges,
		})
	}
	return out
}

func (h *LeaderboardHandler) Register(g *gin.RouterGroup) {
	g.GET("/leaderboard/global", h.global)
	g.GET("/leaderboard/season/:id", h.season)
	g.GET("/leaderboard/country/:iso", h.country)
	g.GET("/leaderboard/category/:cat", h.category)
	g.GET("/leaderboard/surrounding", h.surrounding)
}

func parsePagination(c *gin.Context) (limit, offset int) {
	limit = 50
	offset = 0
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	if o := c.Query("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}
	return
}

func (h *LeaderboardHandler) global(c *gin.Context) {
	limit, offset := parsePagination(c)
	entries, err := h.manager.Top(c.Request.Context(), leaderboard.ScopeGlobalAll, "", limit, offset)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"scope":   "global",
		"entries": h.enrich(c.Request.Context(), entries),
		"limit":   limit,
		"offset":  offset,
	})
}

func (h *LeaderboardHandler) season(c *gin.Context) {
	limit, offset := parsePagination(c)
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, "invalid season id"))
		return
	}
	entries, err := h.manager.Top(c.Request.Context(), leaderboard.ScopeSeason, id, limit, offset)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"scope":   "season",
		"season_id": id,
		"entries": h.enrich(c.Request.Context(), entries),
		"limit":   limit,
		"offset":  offset,
	})
}

func (h *LeaderboardHandler) country(c *gin.Context) {
	limit, offset := parsePagination(c)
	iso := c.Param("iso")
	if len(iso) != 2 {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, "ISO-2 country code required"))
		return
	}
	entries, err := h.manager.Top(c.Request.Context(), leaderboard.ScopeCountry, iso, limit, offset)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"scope": "country", "country": iso, "entries": h.enrich(c.Request.Context(), entries)})
}

func (h *LeaderboardHandler) category(c *gin.Context) {
	limit, offset := parsePagination(c)
	cat := c.Param("cat")
	entries, err := h.manager.Top(c.Request.Context(), leaderboard.ScopeCategory, cat, limit, offset)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"scope": "category", "category": cat, "entries": h.enrich(c.Request.Context(), entries)})
}

func (h *LeaderboardHandler) surrounding(c *gin.Context) {
	userID, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, scoringerrors.New(scoringerrors.CodeUnauthorized, "auth required"))
		return
	}
	before := 5
	after := 5
	if b := c.Query("before"); b != "" {
		if n, err := strconv.Atoi(b); err == nil && n >= 0 && n <= 20 {
			before = n
		}
	}
	if a := c.Query("after"); a != "" {
		if n, err := strconv.Atoi(a); err == nil && n >= 0 && n <= 20 {
			after = n
		}
	}
	entries, err := h.manager.Surrounding(c.Request.Context(), leaderboard.ScopeGlobalAll, "", userID, before, after)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": h.enrich(c.Request.Context(), entries)})
}

// =============================================================================
// Seasons
// =============================================================================

type SeasonHandler struct {
	seasons       repository.SeasonRepository
	seasonScores  repository.SeasonUserScoreRepository
	manager       *seasons.Manager
	log           zerolog.Logger
}

func NewSeasonHandler(s repository.SeasonRepository, ss repository.SeasonUserScoreRepository, m *seasons.Manager, log zerolog.Logger) *SeasonHandler {
	return &SeasonHandler{seasons: s, seasonScores: ss, manager: m, log: log}
}

func (h *SeasonHandler) Register(g *gin.RouterGroup) {
	g.GET("/seasons", h.list)
	g.GET("/seasons/current", h.current)
	g.GET("/seasons/:id", h.byID)
}

func (h *SeasonHandler) list(c *gin.Context) {
	limit, offset := parsePagination(c)
	list, err := h.seasons.List(c.Request.Context(), limit, offset)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"seasons": list})
}

func (h *SeasonHandler) current(c *gin.Context) {
	s, err := h.seasons.GetActive(c.Request.Context())
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	resp := gin.H{"season": s}
	// Include user's rank if logged in
	if userID, ok := middleware.UserIDFrom(c); ok {
		if rank, err := h.seasonScores.GetRankOf(c.Request.Context(), s.ID, userID); err == nil {
			resp["your_rank"] = rank
		}
		if score, err := h.seasonScores.Get(c.Request.Context(), s.ID, userID); err == nil {
			resp["your_points"] = score.TotalPoints
		}
	}
	c.JSON(http.StatusOK, resp)
}

func (h *SeasonHandler) byID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, "invalid id"))
		return
	}
	s, err := h.seasons.GetByID(c.Request.Context(), id)
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusOK, s)
}

// =============================================================================
// Badges
// =============================================================================

type BadgeHandler struct {
	achievements     repository.AchievementRepository
	userAchievements repository.UserAchievementRepository
	log              zerolog.Logger
}

func NewBadgeHandler(a repository.AchievementRepository, ua repository.UserAchievementRepository, log zerolog.Logger) *BadgeHandler {
	return &BadgeHandler{achievements: a, userAchievements: ua, log: log}
}

func (h *BadgeHandler) Register(g *gin.RouterGroup) {
	g.GET("/badges", h.list)
	g.GET("/badges/me", h.mine)
	g.POST("/badges/me/:id/seen", h.markSeen)
}

func (h *BadgeHandler) list(c *gin.Context) {
	list, err := h.achievements.ListActive(c.Request.Context())
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"badges": list})
}

func (h *BadgeHandler) mine(c *gin.Context) {
	userID, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, scoringerrors.New(scoringerrors.CodeUnauthorized, "auth required"))
		return
	}
	earned, err := h.userAchievements.ListForUser(c.Request.Context(), userID)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"earned": earned})
}

func (h *BadgeHandler) markSeen(c *gin.Context) {
	userID, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, scoringerrors.New(scoringerrors.CodeUnauthorized, "auth required"))
		return
	}
	achievementID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, "invalid id"))
		return
	}
	if err := h.userAchievements.MarkDisplayed(c.Request.Context(), userID, achievementID); err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// =============================================================================
// Admin
// =============================================================================

type AdminHandler struct {
	seasonManager *seasons.Manager
	cheatFlags    repository.CheatFlagRepository
	log           zerolog.Logger
}

func NewAdminHandler(sm *seasons.Manager, cf repository.CheatFlagRepository, log zerolog.Logger) *AdminHandler {
	return &AdminHandler{seasonManager: sm, cheatFlags: cf, log: log}
}

func (h *AdminHandler) Register(g *gin.RouterGroup) {
	g.GET("/admin/anti-cheat-flags", h.listCheatFlags)
	g.POST("/admin/anti-cheat-flags/:id/decide", h.decideCheatFlag)
	g.POST("/admin/seasons/:id/rollover", h.rolloverSeason)
}

func (h *AdminHandler) listCheatFlags(c *gin.Context) {
	limit, offset := parsePagination(c)
	list, err := h.cheatFlags.ListPending(c.Request.Context(), limit, offset)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"flags": list})
}

type decideCheatFlagRequest struct {
	Status string `json:"status" binding:"required,oneof=confirmed dismissed appealed"`
	Notes  string `json:"notes"`
	Action string `json:"action"` // none|warning|points_revoked|suspended|banned
}

func (h *AdminHandler) decideCheatFlag(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, "invalid id"))
		return
	}
	reviewerID, _ := middleware.UserIDFrom(c)
	var req decideCheatFlagRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, err.Error()))
		return
	}
	if err := h.cheatFlags.UpdateStatus(c.Request.Context(), id, req.Status, reviewerID, req.Notes, req.Action); err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *AdminHandler) rolloverSeason(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, "invalid id"))
		return
	}
	res, err := h.seasonManager.Rollover(c.Request.Context(), id)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}
	c.JSON(http.StatusOK, res)
}

// =============================================================================
// Helpers
// =============================================================================

func respondError(c *gin.Context, err *scoringerrors.Error) {
	c.AbortWithStatusJSON(err.HTTPStatus(), gin.H{"error": err})
}

func toErr(err error) *scoringerrors.Error {
	if e, ok := scoringerrors.As(err); ok {
		return e
	}
	return scoringerrors.Internal(err)
}
