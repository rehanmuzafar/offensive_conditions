// Package service is the application layer for scoring.
//
// It coordinates: points calculation → DB persistence → Redis leaderboard
// updates → badge evaluation → event publishing.
package service

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/scoring/internal/anticheat"
	"github.com/offensive-conditions/scoring/internal/badges"
	"github.com/offensive-conditions/scoring/internal/config"
	scoringerrors "github.com/offensive-conditions/scoring/internal/errors"
	"github.com/offensive-conditions/scoring/internal/elo"
	"github.com/offensive-conditions/scoring/internal/leaderboard"
	"github.com/offensive-conditions/scoring/internal/points"
	"github.com/offensive-conditions/scoring/internal/repository"
)

type Scoring struct {
	cfg              *config.Config
	log              zerolog.Logger
	pointsCalc       *points.Calculator
	eloCalc          *elo.Calculator
	leaderboards     *leaderboard.Manager
	badgeEngine      *badges.Engine
	antiCheat        *anticheat.Detector
	eventPublisher   EventPublisher
	contentResolver  ContentResolver

	submissions      repository.SubmissionRepository
	owns             repository.OwnRepository
	pointHistory     repository.PointHistoryRepository
	userScores       repository.UserScoreRepository
	achievements     repository.AchievementRepository
	userAchievements repository.UserAchievementRepository
	rankTiers        repository.RankTierRepository
	seasons          repository.SeasonRepository
	seasonScores     repository.SeasonUserScoreRepository
	seasonSnapshots  repository.SeasonSnapshotRepository
	eloRepo          repository.ELORepository
	dailyActivity    repository.DailyActivityRepository

	// Per-user metadata source (optional injection for country lookup)
	userMeta UserMetadataLookup
}

// EventPublisher interface allows tests to inject a noop.
type EventPublisher interface {
	BadgeAwarded(ctx context.Context, userID, achievementID uuid.UUID, code, name string, points int)
	RankTierUp(ctx context.Context, userID uuid.UUID, fromTier, toTier string)
	StreakMilestone(ctx context.Context, userID uuid.UUID, days int)
	ELOUpdated(ctx context.Context, userID uuid.UUID, before, after int, matchID uuid.UUID)
}

// UserMetadataLookup gives us per-user data we don't own (country, team).
// Injected from the user service via an HTTP/gRPC client.
type UserMetadataLookup interface {
	GetMetadata(ctx context.Context, userID uuid.UUID) (UserMetadata, error)
}

type UserMetadata struct {
	CountryCode string    // ISO-2
	TeamID      uuid.UUID // nil UUID if no team
}

// ContentResolver knows how to fetch difficulty + release date for content.
// Provided by the content service. We need it to compute points correctly.
type ContentResolver interface {
	Resolve(ctx context.Context, contentType string, contentID uuid.UUID) (ContentInfo, error)
}

type ContentInfo struct {
	Difficulty  string
	Category    string
	ReleasedAt  time.Time
}

// noopContentResolver — fallback when no resolver is configured.
type noopContentResolver struct{}

func (noopContentResolver) Resolve(_ context.Context, _ string, _ uuid.UUID) (ContentInfo, error) {
	return ContentInfo{Difficulty: "medium", ReleasedAt: time.Now()}, nil
}

// noopUserMeta — fallback.
type noopUserMeta struct{}

func (noopUserMeta) GetMetadata(_ context.Context, _ uuid.UUID) (UserMetadata, error) {
	return UserMetadata{}, nil
}

type Deps struct {
	Cfg              *config.Config
	Log              zerolog.Logger
	PointsCalc       *points.Calculator
	ELOCalc          *elo.Calculator
	Leaderboards     *leaderboard.Manager
	BadgeEngine      *badges.Engine
	AntiCheat        *anticheat.Detector
	EventPublisher   EventPublisher
	UserMeta         UserMetadataLookup
	ContentResolver  ContentResolver

	Submissions      repository.SubmissionRepository
	Owns             repository.OwnRepository
	PointHistory     repository.PointHistoryRepository
	UserScores       repository.UserScoreRepository
	Achievements     repository.AchievementRepository
	UserAchievements repository.UserAchievementRepository
	RankTiers        repository.RankTierRepository
	Seasons          repository.SeasonRepository
	SeasonScores     repository.SeasonUserScoreRepository
	SeasonSnapshots  repository.SeasonSnapshotRepository
	ELORepo          repository.ELORepository
	DailyActivity    repository.DailyActivityRepository
}

func New(d Deps) *Scoring {
	if d.UserMeta == nil {
		d.UserMeta = noopUserMeta{}
	}
	if d.ContentResolver == nil {
		d.ContentResolver = noopContentResolver{}
	}
	return &Scoring{
		cfg: d.Cfg, log: d.Log,
		pointsCalc: d.PointsCalc, eloCalc: d.ELOCalc,
		leaderboards: d.Leaderboards, badgeEngine: d.BadgeEngine,
		antiCheat: d.AntiCheat, eventPublisher: d.EventPublisher,
		contentResolver: d.ContentResolver,
		submissions: d.Submissions, owns: d.Owns,
		pointHistory: d.PointHistory, userScores: d.UserScores,
		achievements: d.Achievements, userAchievements: d.UserAchievements,
		rankTiers: d.RankTiers, seasons: d.Seasons, seasonScores: d.SeasonScores,
		seasonSnapshots: d.SeasonSnapshots,
		eloRepo:       d.ELORepo, dailyActivity: d.DailyActivity,
		userMeta: d.UserMeta,
	}
}

// AwardInput is the data needed to record a solve and update scores.
type AwardInput struct {
	UserID         uuid.UUID
	ContentType    string // machine|challenge|ctf_challenge|...
	ContentID      uuid.UUID
	FlagType       string // user|root|challenge|prolab
	InstanceID     *uuid.UUID
	SecondsToSolve int
	FlagHash       string // SHA-256 hex
	IPAddress      string // textual
	UserAgent      string
	SubmittedAt    time.Time
	// Optional override (when caller already knows the difficulty)
	Difficulty string
	RequestID  string
}

// AwardResult is what AwardSolve returns.
type AwardResult struct {
	PointsAwarded   int
	IsFirstBlood    bool
	BloodRank       int
	NewTotalPoints  int64
	NewRankTier     string
	AchievementsAwarded []badges.Award
	WasAlreadyOwned bool
	WasBlocked      bool
}

// =============================================================================
// AwardSolve — the main entry point. Called by the Kafka consumer on a
// successful flag submission.
// =============================================================================

func (s *Scoring) AwardSolve(ctx context.Context, in AwardInput) (*AwardResult, error) {
	log := s.log.With().
		Str("user_id", in.UserID.String()).
		Str("content_type", in.ContentType).
		Str("content_id", in.ContentID.String()).
		Str("flag_type", in.FlagType).
		Logger()

	// 1. Idempotency check — has user already owned this flag?
	owned, err := s.owns.HasOwned(ctx, in.UserID, in.ContentType, in.ContentID, in.FlagType)
	if err != nil {
		return nil, scoringerrors.Internal(err)
	}
	if owned {
		log.Debug().Msg("already owned; skipping")
		return &AwardResult{WasAlreadyOwned: true}, nil
	}

	// 2. Resolve content metadata
	info, err := s.contentResolver.Resolve(ctx, in.ContentType, in.ContentID)
	if err != nil {
		log.Warn().Err(err).Msg("content resolve failed; using defaults")
		info = ContentInfo{Difficulty: "medium", ReleasedAt: in.SubmittedAt}
	}
	if in.Difficulty != "" {
		info.Difficulty = in.Difficulty
	}

	// 3. Compute blood rank for this solve
	bloodRank, err := s.computeBloodRank(ctx, in)
	if err != nil {
		return nil, scoringerrors.Internal(err)
	}
	isFirstBlood := points.IsBlood(bloodRank)

	// 4. Calculate points
	calc := s.pointsCalc.Compute(points.Input{
		Difficulty:        points.ParseDifficulty(info.Difficulty),
		FlagType:          points.FlagType(in.FlagType),
		BloodRank:         bloodRank,
		ContentReleasedAt: info.ReleasedAt,
		SolvedAt:          in.SubmittedAt,
	})

	// 5. Anti-cheat
	var antiCheatBlocked bool
	if s.antiCheat != nil {
		ipAddr, _ := netip.ParseAddr(in.IPAddress)
		check := s.antiCheat.Check(ctx, anticheat.CheckInput{
			UserID:         in.UserID,
			SubmissionID:   uuid.New(), // will be assigned by DB
			ContentType:    in.ContentType,
			ContentID:      in.ContentID,
			FlagType:       in.FlagType,
			SubmittedHash:  in.FlagHash,
			SecondsToSolve: in.SecondsToSolve,
			IPAddress:      ipAddr,
			UserAgent:      in.UserAgent,
			SubmittedAt:    in.SubmittedAt,
		})
		if check.ShouldBlock {
			log.Warn().Msg("anti-cheat blocked the solve")
			antiCheatBlocked = true
		}
		_ = s.antiCheat.RecordSuspicions(ctx, anticheat.CheckInput{
			UserID:       in.UserID,
			SubmissionID: uuid.New(),
			ContentType:  in.ContentType,
			ContentID:    in.ContentID,
		}, check)
	}

	if antiCheatBlocked {
		// We still record the submission for audit trail
		_ = s.submissions.Insert(ctx, &repository.Submission{
			UserID:           in.UserID,
			ContentType:      in.ContentType,
			ContentID:        in.ContentID,
			InstanceID:       in.InstanceID,
			FlagType:         in.FlagType,
			SubmittedValue:   in.FlagHash,
			Accepted:         false,
			RejectionReason:  "anti_cheat_blocked",
			PointsAwarded:    0,
			IPAddress:        parseIP(in.IPAddress),
			UserAgent:        in.UserAgent,
			SecondsSinceSpawn: in.SecondsToSolve,
			FlaggedForReview: true,
			SubmittedAt:      in.SubmittedAt,
		})
		return &AwardResult{WasBlocked: true}, scoringerrors.New(scoringerrors.CodeAntiCheatBlocked,
			"submission blocked by anti-cheat")
	}

	// 6. Persist submission
	submissionID := uuid.New()
	if err := s.submissions.Insert(ctx, &repository.Submission{
		ID:                submissionID,
		UserID:            in.UserID,
		ContentType:       in.ContentType,
		ContentID:         in.ContentID,
		InstanceID:        in.InstanceID,
		FlagType:          in.FlagType,
		SubmittedValue:    in.FlagHash,
		Accepted:          true,
		PointsAwarded:     calc.FinalPoints,
		IsFirstBlood:      isFirstBlood,
		BloodRank:         bloodRank,
		IPAddress:         parseIP(in.IPAddress),
		UserAgent:         in.UserAgent,
		SecondsSinceSpawn: in.SecondsToSolve,
		SubmittedAt:       in.SubmittedAt,
	}); err != nil {
		return nil, scoringerrors.Internal(err)
	}

	// 7. Insert "own" record (idempotent guard against concurrent duplicate)
	err = s.owns.Insert(ctx, &repository.Own{
		UserID:           in.UserID,
		ContentType:      in.ContentType,
		ContentID:        in.ContentID,
		FlagType:         in.FlagType,
		Points:           calc.FinalPoints,
		IsFirstBlood:     isFirstBlood,
		BloodRank:        bloodRank,
		SolveTimeSeconds: in.SecondsToSolve,
		SubmissionID:     &submissionID,
		OwnedAt:          in.SubmittedAt,
	})
	if err != nil {
		if errors.Is(err, repository.ErrDuplicate) {
			return &AwardResult{WasAlreadyOwned: true}, nil
		}
		return nil, scoringerrors.Internal(err)
	}

	// 8. Update user scores (atomic increment)
	delta := buildIncrement(in.ContentType, in.FlagType, calc.FinalPoints, isFirstBlood)
	if err := s.userScores.IncrementPoints(ctx, in.UserID, delta); err != nil {
		return nil, scoringerrors.Internal(err)
	}

	// 9. Streak bump
	if err := s.userScores.BumpStreak(ctx, in.UserID, in.SubmittedAt); err != nil {
		log.Warn().Err(err).Msg("streak bump failed")
	}

	// 10. Point history log
	_ = s.pointHistory.Insert(ctx, &repository.PointHistory{
		UserID:        in.UserID,
		EventType:     deriveEventType(in.ContentType, isFirstBlood),
		Points:        calc.FinalPoints,
		ReferenceType: in.ContentType,
		ReferenceID:   &in.ContentID,
		Description:   fmt.Sprintf("solved %s flag %s", in.FlagType, in.ContentType),
		Metadata: map[string]any{
			"base":          calc.Base,
			"flag_share":    calc.FlagShare,
			"blood_mult":    calc.BloodMult,
			"time_decay":    calc.TimeDecay,
			"blood_rank":    bloodRank,
			"submission_id": submissionID.String(),
		},
		OccurredAt: in.SubmittedAt,
	})

	// 11. Daily activity (streak source)
	_ = s.dailyActivity.Upsert(ctx, &repository.DailyActivity{
		UserID:       in.UserID,
		ActivityDate: in.SubmittedAt,
		PointsEarned: int64(calc.FinalPoints),
		SolvesCount:  1,
		FirstSolveAt: &in.SubmittedAt,
		LastSolveAt:  &in.SubmittedAt,
	})

	// 12. Leaderboards
	meta, _ := s.userMeta.GetMetadata(ctx, in.UserID)
	activeSeason, _ := s.seasons.GetActive(ctx)
	var seasonID uuid.UUID
	if activeSeason != nil {
		seasonID = activeSeason.ID
		_ = s.seasonScores.IncrementPoints(ctx, seasonID, in.UserID, delta)
	}

	boardCtx := leaderboard.BoardContext{
		UserID:      in.UserID,
		SeasonID:    seasonID,
		CountryCode: meta.CountryCode,
		TeamID:      meta.TeamID,
		Category:    info.Category,
	}
	if err := s.leaderboards.PublishToAllRelevantBoards(ctx, boardCtx, int64(calc.FinalPoints)); err != nil {
		log.Warn().Err(err).Msg("leaderboard publish failed")
	}

	// 13. Rank tier check
	sc, _ := s.userScores.Get(ctx, in.UserID)
	if sc != nil {
		newTier, _ := s.rankTiers.TierForPoints(ctx, sc.TotalPoints)
		if newTier != nil && newTier.Code != sc.RankTier {
			oldTier := sc.RankTier
			_ = s.userScores.UpdateRankTier(ctx, in.UserID, newTier.Code)
			s.eventPublisher.RankTierUp(ctx, in.UserID, oldTier, newTier.Code)
			sc.RankTier = newTier.Code
		}
	}

	// 14. Badge evaluation
	var awarded []badges.Award
	if s.badgeEngine != nil && sc != nil {
		awarded, _ = s.badgeEngine.EvaluateOnSolve(ctx, in.UserID, sc)
		if isFirstBlood {
			firstBloodAwards, _ := s.badgeEngine.EvaluateFirstBlood(ctx, in.UserID, in.ContentType, bloodRank)
			awarded = append(awarded, firstBloodAwards...)
		}
		for _, a := range awarded {
			s.eventPublisher.BadgeAwarded(ctx, a.UserID, a.AchievementID, a.Code, a.Name, a.PointsAwarded)
			// Apply bonus points from achievement
			if a.PointsAwarded > 0 {
				_ = s.userScores.IncrementPoints(ctx, in.UserID, repository.IncrementInput{
					Total: int64(a.PointsAwarded), BonusPoints: int64(a.PointsAwarded),
				})
			}
		}
	}

	// 15. Streak milestone notifications
	if sc != nil && sc.CurrentStreakDays > 0 && sc.CurrentStreakDays%7 == 0 {
		s.eventPublisher.StreakMilestone(ctx, in.UserID, sc.CurrentStreakDays)
	}

	result := &AwardResult{
		PointsAwarded:       calc.FinalPoints,
		IsFirstBlood:        isFirstBlood,
		BloodRank:           bloodRank,
		AchievementsAwarded: awarded,
	}
	if sc != nil {
		result.NewTotalPoints = sc.TotalPoints
		result.NewRankTier = sc.RankTier
	}

	log.Info().
		Int("points", calc.FinalPoints).
		Int("blood_rank", bloodRank).
		Int("achievements_awarded", len(awarded)).
		Msg("solve awarded")

	return result, nil
}

// computeBloodRank determines what blood rank (1, 2, 3, or 0) this solve gets.
// Done atomically via DB query — checks how many users have solved this content
// before this user.
func (s *Scoring) computeBloodRank(ctx context.Context, in AwardInput) (int, error) {
	winners, err := s.submissions.GetFirstNBloodWinners(ctx, in.ContentType, in.ContentID, in.FlagType, 3)
	if err != nil {
		return 0, err
	}
	// If user already in winners list, no new blood
	for _, w := range winners {
		if w == in.UserID {
			return 0, nil
		}
	}
	// First N solvers get blood
	rank := len(winners) + 1
	if rank > 3 {
		return 0, nil
	}
	return rank, nil
}

// =============================================================================
// RecordELOMatch — handles ctf.match.completed events
// =============================================================================

type ELOMatchInput struct {
	MatchID         uuid.UUID
	PlayerAID       uuid.UUID
	PlayerBID       uuid.UUID
	Result          float64 // 1, 0.5, 0
	DurationSeconds int
	CompletedAt     time.Time
}

func (s *Scoring) RecordELOMatch(ctx context.Context, in ELOMatchInput) error {
	playerA, err := s.getOrInitELO(ctx, in.PlayerAID)
	if err != nil {
		return err
	}
	playerB, err := s.getOrInitELO(ctx, in.PlayerBID)
	if err != nil {
		return err
	}

	out := s.eloCalc.Calculate(
		elo.PlayerState{Rating: playerA.Rating, MatchesPlayed: playerA.MatchesPlayed, LastMatchAt: derefTime(playerA.LastMatchAt)},
		elo.PlayerState{Rating: playerB.Rating, MatchesPlayed: playerB.MatchesPlayed, LastMatchAt: derefTime(playerB.LastMatchAt)},
		elo.Result(in.Result),
	)

	// Update player A
	playerA.Rating = out.PlayerARatingAfter
	if out.PlayerARatingAfter > playerA.PeakRating {
		playerA.PeakRating = out.PlayerARatingAfter
	}
	playerA.MatchesPlayed++
	switch in.Result {
	case 1.0:
		playerA.Wins++
	case 0.0:
		playerA.Losses++
	default:
		playerA.Draws++
	}
	playerA.LastMatchAt = &in.CompletedAt
	playerA.IsProvisional = s.eloCalc.IsProvisional(playerA.MatchesPlayed)
	if err := s.eloRepo.Upsert(ctx, playerA); err != nil {
		return err
	}

	// Update player B
	playerB.Rating = out.PlayerBRatingAfter
	if out.PlayerBRatingAfter > playerB.PeakRating {
		playerB.PeakRating = out.PlayerBRatingAfter
	}
	playerB.MatchesPlayed++
	switch in.Result {
	case 1.0:
		playerB.Losses++
	case 0.0:
		playerB.Wins++
	default:
		playerB.Draws++
	}
	playerB.LastMatchAt = &in.CompletedAt
	playerB.IsProvisional = s.eloCalc.IsProvisional(playerB.MatchesPlayed)
	if err := s.eloRepo.Upsert(ctx, playerB); err != nil {
		return err
	}

	// Record the match
	_ = s.eloRepo.RecordMatch(ctx, &repository.ELOMatch{
		MatchID:              in.MatchID,
		PlayerAID:            in.PlayerAID,
		PlayerBID:            in.PlayerBID,
		PlayerARatingBefore:  out.PlayerARatingBefore,
		PlayerBRatingBefore:  out.PlayerBRatingBefore,
		Result:               in.Result,
		PlayerARatingAfter:   out.PlayerARatingAfter,
		PlayerBRatingAfter:   out.PlayerBRatingAfter,
		RatingDelta:          out.RatingDelta,
		KFactor:              out.KFactor,
		MatchDurationSeconds: in.DurationSeconds,
		CompletedAt:          in.CompletedAt,
	})

	s.eventPublisher.ELOUpdated(ctx, in.PlayerAID, out.PlayerARatingBefore, out.PlayerARatingAfter, in.MatchID)
	s.eventPublisher.ELOUpdated(ctx, in.PlayerBID, out.PlayerBRatingBefore, out.PlayerBRatingAfter, in.MatchID)

	return nil
}

func (s *Scoring) getOrInitELO(ctx context.Context, userID uuid.UUID) (*repository.ELORating, error) {
	r, err := s.eloRepo.Get(ctx, userID)
	if errors.Is(err, repository.ErrNotFound) {
		r = &repository.ELORating{
			UserID:        userID,
			Rating:        s.eloCalc.InitialRating(),
			PeakRating:    s.eloCalc.InitialRating(),
			IsProvisional: true,
		}
		if err := s.eloRepo.Upsert(ctx, r); err != nil {
			return nil, err
		}
		return r, nil
	}
	return r, err
}

// =============================================================================
// Query methods (read-side)
// =============================================================================

func (s *Scoring) GetProfile(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	sc, err := s.userScores.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return &Profile{UserID: userID}, nil
		}
		return nil, scoringerrors.Internal(err)
	}
	rank, _ := s.userScores.GetRankOf(ctx, userID)
	tier, _ := s.rankTiers.TierForPoints(ctx, sc.TotalPoints)

	eloR, _ := s.eloRepo.Get(ctx, userID)

	achievements, _ := s.userAchievements.ListForUser(ctx, userID)

	p := &Profile{
		UserID:          userID,
		Score:           sc,
		GlobalRank:      rank,
		Tier:            tier,
		ELORating:       eloR,
		AchievementsCount: len(achievements),
	}
	return p, nil
}

type Profile struct {
	UserID            uuid.UUID
	Score             *repository.UserScore
	GlobalRank        int
	Tier              *repository.RankTier
	ELORating         *repository.ELORating
	AchievementsCount int
}

// =============================================================================
// Helpers
// =============================================================================

// buildIncrement constructs the field-specific delta given a content type.
func buildIncrement(contentType, flagType string, awarded int, isFirstBlood bool) repository.IncrementInput {
	d := repository.IncrementInput{Total: int64(awarded)}
	switch contentType {
	case "machine":
		d.MachinePoints = int64(awarded)
		if flagType == "user" {
			d.UserFlags = 1
		} else if flagType == "root" {
			d.RootFlags = 1
			d.MachinesOwned = 1 // owning root counts as owning the machine
		}
	case "challenge":
		d.ChallengePoints = int64(awarded)
		d.ChallengesSolved = 1
	case "dojo_level":
		d.DojoPoints = int64(awarded)
	case "ctf_challenge":
		d.CTFPoints = int64(awarded)
	case "prolab_flag":
		d.ProLabPoints = int64(awarded)
	}
	if isFirstBlood {
		d.FirstBloods = 1
	}
	return d
}

func deriveEventType(contentType string, isFirstBlood bool) string {
	if isFirstBlood {
		return "first_blood"
	}
	switch contentType {
	case "machine":
		return "machine_own"
	case "challenge", "ctf_challenge":
		return "challenge_solve"
	case "dojo_level":
		return "dojo_progress"
	case "prolab_flag":
		return "prolab_solve"
	}
	return "machine_own"
}

func derefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

func parseIP(s string) netip.Addr {
	if s == "" {
		return netip.Addr{}
	}
	addr, _ := netip.ParseAddr(s)
	return addr
}
