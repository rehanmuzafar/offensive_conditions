package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	"github.com/offensive-conditions/user-svc/internal/auth"
	"github.com/offensive-conditions/user-svc/internal/config"
	"github.com/offensive-conditions/user-svc/internal/follows"
	"github.com/offensive-conditions/user-svc/internal/friends"
	"github.com/offensive-conditions/user-svc/internal/gdpr"
	grpcserver "github.com/offensive-conditions/user-svc/internal/grpc"
	"github.com/offensive-conditions/user-svc/internal/handlers"
	"github.com/offensive-conditions/user-svc/internal/middleware"
	"github.com/offensive-conditions/user-svc/internal/producers"
	"github.com/offensive-conditions/user-svc/internal/profiles"
	"github.com/offensive-conditions/user-svc/internal/repository"
	"github.com/offensive-conditions/user-svc/internal/search"
	"github.com/offensive-conditions/user-svc/internal/storage"
	"github.com/offensive-conditions/user-svc/internal/teams"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}

	log := setupLogger(cfg)
	log.Info().Str("env", cfg.App.Env).Str("version", cfg.App.Version).Msg("starting user-svc")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- Postgres ---
	pool, err := repository.NewPool(ctx, repository.PoolConfig{
		DSN:      cfg.DB.DSN(),
		MaxConns: int32(cfg.DB.MaxConns),
		MinConns: int32(cfg.DB.MinConns),
	})
	if err != nil {
		log.Fatal().Err(err).Msg("postgres connect failed")
	}
	defer pool.Close()
	log.Info().Msg("postgres connected")

	// --- Redis ---
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
		PoolSize: cfg.Redis.PoolSize,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatal().Err(err).Msg("redis ping failed")
	}
	defer rdb.Close()
	log.Info().Msg("redis connected")

	// --- Storage (MinIO) ---
	store, err := storage.New(storage.Config{
		Endpoint:     cfg.Storage.Endpoint,
		AccessKey:    cfg.Storage.AccessKey,
		SecretKey:    cfg.Storage.SecretKey,
		UseSSL:       cfg.Storage.UseSSL,
		Region:       cfg.Storage.Region,
		AvatarBucket: cfg.Storage.AvatarBucket,
		ExportBucket: cfg.Storage.ExportBucket,
		CDNBaseURL:   cfg.Storage.CDNBaseURL,
	}, log.With().Str("component", "storage").Logger())
	if err != nil {
		log.Fatal().Err(err).Msg("storage init failed")
	}
	if err := store.EnsureBuckets(ctx); err != nil {
		log.Warn().Err(err).Msg("ensure buckets failed; may need manual creation")
	}

	// --- Auth ---
	validator, err := auth.NewValidator(auth.Config{
		PublicKeyPath: cfg.Auth.JWTPublicKeyPath,
		Issuer:        cfg.Auth.JWTIssuer,
		Audience:      cfg.Auth.JWTAudience,
		ClockSkew:     cfg.Auth.JWTClockSkew,
		CacheTTL:      cfg.Auth.TokenCacheTTL,
	})
	if err != nil {
		log.Fatal().Err(err).Msg("jwt validator init failed")
	}

	// --- Kafka publisher ---
	var publisher *producers.Publisher
	if len(cfg.Kafka.Brokers) > 0 {
		publisher, err = producers.New(producers.Config{
			Brokers: cfg.Kafka.Brokers,
			Topic:   cfg.Kafka.TopicUserEvents,
			UseTLS:  cfg.Kafka.UseTLS,
			Acks:    "all",
		}, log.With().Str("component", "kafka").Logger())
		if err != nil {
			log.Warn().Err(err).Msg("kafka publisher init failed; events disabled")
		} else {
			defer publisher.Close()
		}
	}

	// --- Repos ---
	profileRepo := repository.NewPGProfileRepo(pool)
	teamRepo := repository.NewPGTeamRepo(pool)
	friendRepo := repository.NewPGFriendRepo(pool)
	followRepo := repository.NewPGFollowRepo(pool)
	gdprRepo := repository.NewPGGDPRRepo(pool)

	// --- Services ---
	profileSvc := profiles.New(profiles.Deps{
		Repo: profileRepo, Storage: store, Publisher: publisher,
		Redis: rdb, Cfg: cfg, Log: log.With().Str("svc", "profiles").Logger(),
	})
	teamSvc := teams.New(teams.Deps{
		TeamRepo: teamRepo, ProfileRepo: profileRepo, FriendRepo: friendRepo,
		Publisher: publisher, Cfg: cfg,
		Log: log.With().Str("svc", "teams").Logger(),
	})
	friendSvc := friends.New(friends.Deps{
		FriendRepo: friendRepo, ProfileRepo: profileRepo,
		Publisher: publisher, Cfg: cfg,
		Log: log.With().Str("svc", "friends").Logger(),
	})
	followSvc := follows.New(follows.Deps{
		FollowRepo: followRepo, FriendRepo: friendRepo, ProfileRepo: profileRepo,
		Publisher: publisher,
		Log:       log.With().Str("svc", "follows").Logger(),
	})
	searchSvc := search.New(search.Deps{
		ProfileRepo: profileRepo, Redis: rdb,
		Log: log.With().Str("svc", "search").Logger(),
	})
	gdprSvc := gdpr.New(gdpr.Deps{
		GDPRRepo: gdprRepo, ProfileRepo: profileRepo, FriendRepo: friendRepo,
		FollowRepo: followRepo, TeamRepo: teamRepo, Storage: store,
		Publisher: publisher, Pool: pool, Cfg: cfg,
		Log: log.With().Str("svc", "gdpr").Logger(),
	})

	// --- Last-seen tracker (throttled in-memory dedupe) ---
	lastSeenTracker := newLastSeenTracker(profileRepo, log)
	defer lastSeenTracker.Stop()

	// --- HTTP server ---
	if cfg.App.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	router := gin.New()
	if len(cfg.HTTP.TrustedProxies) > 0 {
		_ = router.SetTrustedProxies(cfg.HTTP.TrustedProxies)
	}
	router.Use(middleware.RequestID())
	router.Use(middleware.Logger(log))
	router.Use(middleware.Recovery(log))
	router.Use(middleware.CORS(cfg.HTTP.CORSOrigins))
	router.Use(middleware.SecurityHeaders())

	health := handlers.NewHealthHandler(pool, rdb, cfg.App.Version)
	router.GET("/livez", health.Live)
	router.GET("/readyz", health.Ready)

	registerRoutes(router, &routeDeps{
		validator: validator, log: log,
		profile: handlers.NewProfileHandler(profileSvc, log),
		team:    handlers.NewTeamHandler(teamSvc, log),
		friends: handlers.NewFriendsHandler(friendSvc, log),
		follows: handlers.NewFollowsHandler(followSvc, log),
		search:  handlers.NewSearchHandler(searchSvc),
		gdpr:    handlers.NewGDPRHandler(gdprSvc, log),
		track:   lastSeenTracker.Track,
	})

	httpSrv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.HTTP.Port),
		Handler:      router,
		ReadTimeout:  cfg.HTTP.ReadTimeout,
		WriteTimeout: cfg.HTTP.WriteTimeout,
		IdleTimeout:  cfg.HTTP.IdleTimeout,
	}

	// --- gRPC server ---
	grpcSrv := grpc.NewServer(
		grpc.MaxRecvMsgSize(8*1024*1024),
		grpc.MaxSendMsgSize(8*1024*1024),
	)
	grpcserver.Register(grpcSrv, grpcserver.New(grpcserver.Deps{
		Profiles: profileSvc, Teams: teamSvc,
		Friends: friendSvc, Follows: followSvc,
		Log: log.With().Str("svc", "grpc").Logger(),
	}))
	if cfg.GRPC.EnableReflection {
		reflection.Register(grpcSrv)
	}

	grpcListener, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.GRPC.Port))
	if err != nil {
		log.Fatal().Err(err).Int("port", cfg.GRPC.Port).Msg("grpc listen failed")
	}

	// --- Start servers ---
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		log.Info().Int("port", cfg.HTTP.Port).Msg("HTTP server listening")
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error().Err(err).Msg("http server error")
		}
	}()
	go func() {
		defer wg.Done()
		log.Info().Int("port", cfg.GRPC.Port).Msg("gRPC server listening")
		if err := grpcSrv.Serve(grpcListener); err != nil {
			log.Error().Err(err).Msg("grpc server error")
		}
	}()

	// --- Graceful shutdown ---
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	log.Info().Msg("shutdown signal received")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
	defer shutdownCancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Warn().Err(err).Msg("http server shutdown error")
	}

	stopped := make(chan struct{})
	go func() {
		grpcSrv.GracefulStop()
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-shutdownCtx.Done():
		log.Warn().Msg("grpc graceful stop timeout; forcing")
		grpcSrv.Stop()
	}

	wg.Wait()
	log.Info().Msg("shutdown complete")
}

// =============================================================================
// Routing
// =============================================================================

type routeDeps struct {
	validator *auth.Validator
	log       zerolog.Logger
	profile   *handlers.ProfileHandler
	team      *handlers.TeamHandler
	friends   *handlers.FriendsHandler
	follows   *handlers.FollowsHandler
	search    *handlers.SearchHandler
	gdpr      *handlers.GDPRHandler
	track     func(uid uuid.UUID)
}

func registerRoutes(r *gin.Engine, d *routeDeps) {
	v1 := r.Group("/v1")
	authed := v1.Group("")
	authed.Use(middleware.RequireAuth(d.validator, d.log))
	authed.Use(middleware.LastSeenTracker(d.track))

	// Profile
	authed.GET("/users/me", d.profile.Me)
	authed.PATCH("/users/me", d.profile.UpdateMe)
	authed.PATCH("/users/me/privacy", d.profile.UpdatePrivacy)
	authed.POST("/users/me/avatar", d.profile.UploadAvatar)
	authed.DELETE("/users/me/avatar", d.profile.DeleteAvatar)
	authed.GET("/users/:id", d.profile.GetByID)
	authed.GET("/users/by-username/:username", d.profile.GetByUsername)
	authed.GET("/users/search", d.search.SearchUsers)
	authed.GET("/users/:id/followers", d.follows.ListFollowers)
	authed.GET("/users/:id/following", d.follows.ListFollowing)
	authed.GET("/users/:id/friends", d.friends.ListFriends)

	// Teams
	authed.GET("/teams", d.team.Browse)
	authed.POST("/teams", d.team.Create)
	authed.POST("/teams/:id/join-requests", d.team.RequestJoin)
	authed.GET("/teams/:id/join-requests", d.team.ListJoinRequests)
	authed.POST("/teams/join-requests/:req_id/:decision", d.team.DecideJoinRequest)
	authed.GET("/teams/me", d.team.ListMine)
	authed.GET("/teams/:id", d.team.Get)
	authed.GET("/teams/by-slug/:slug", d.team.GetBySlug)
	authed.GET("/teams/:id/members", d.team.ListMembers)
	authed.PATCH("/teams/:id", d.team.Update)
	authed.DELETE("/teams/:id", d.team.Disband)
	authed.POST("/teams/:id/invitations", d.team.Invite)
	authed.GET("/teams/invitations/me", d.team.ListMyInvitations)
	authed.POST("/teams/invitations/:id/accept", d.team.AcceptInvite)
	authed.POST("/teams/invitations/:id/decline", d.team.DeclineInvite)
	authed.POST("/teams/:id/leave", d.team.Leave)
	authed.POST("/teams/:id/kick/:user_id", d.team.Kick)
	authed.POST("/teams/:id/promote/:user_id", d.team.Promote)

	// Friends + blocks
	authed.POST("/friends/requests", d.friends.SendRequest)
	authed.GET("/friends/requests", d.friends.ListRequests)
	authed.POST("/friends/requests/:id/accept", d.friends.AcceptRequest)
	authed.POST("/friends/requests/:id/decline", d.friends.DeclineRequest)
	authed.POST("/friends/requests/:id/cancel", d.friends.CancelRequest)
	authed.DELETE("/friends/:user_id", d.friends.Unfriend)
	authed.POST("/users/:id/block", d.friends.Block)
	authed.DELETE("/users/:id/block", d.friends.Unblock)
	authed.GET("/blocked", d.friends.ListBlocked)

	// Follows
	authed.POST("/follows/:user_id", d.follows.Follow)
	authed.DELETE("/follows/:user_id", d.follows.Unfollow)

	// Country
	authed.GET("/countries/:code/count", d.search.CountByCountry)

	// GDPR
	authed.POST("/gdpr/export", d.gdpr.RequestExport)
	authed.GET("/gdpr/export/:id", d.gdpr.GetExport)
	authed.POST("/gdpr/delete", d.gdpr.RequestDeletion)
	authed.POST("/gdpr/delete/cancel", d.gdpr.CancelDeletion)
	authed.GET("/gdpr/delete/status", d.gdpr.DeletionStatus)
}

// =============================================================================
// Last-seen tracker (throttled writer)
// =============================================================================

type lastSeenTracker struct {
	repo    repository.ProfileRepository
	log     zerolog.Logger
	pending sync.Map // uuid.UUID -> int64 nanos
	stop    chan struct{}
	flushed atomic.Int64
}

func newLastSeenTracker(repo repository.ProfileRepository, log zerolog.Logger) *lastSeenTracker {
	t := &lastSeenTracker{repo: repo, log: log, stop: make(chan struct{})}
	go t.flusher()
	return t
}

// Track schedules an update for uid; rate-limited internally.
// We only persist at most once per minute per user.
const lastSeenThrottle = time.Minute

func (t *lastSeenTracker) Track(uid uuid.UUID) {
	now := time.Now().UnixNano()
	if v, ok := t.pending.Load(uid); ok {
		if now-v.(int64) < lastSeenThrottle.Nanoseconds() {
			return
		}
	}
	t.pending.Store(uid, now)
}

func (t *lastSeenTracker) flusher() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			t.flush()
		case <-t.stop:
			t.flush()
			return
		}
	}
}

func (t *lastSeenTracker) flush() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	count := 0
	t.pending.Range(func(k, _ any) bool {
		uid, ok := k.(uuid.UUID)
		if !ok {
			return true
		}
		if err := t.repo.UpdateLastSeen(ctx, uid); err != nil {
			t.log.Debug().Err(err).Str("user_id", uid.String()).Msg("last-seen update failed")
		} else {
			count++
		}
		t.pending.Delete(k)
		return true
	})
	if count > 0 {
		t.flushed.Add(int64(count))
		t.log.Debug().Int("count", count).Msg("flushed last-seen updates")
	}
}

func (t *lastSeenTracker) Stop() { close(t.stop) }

// =============================================================================
// Logging
// =============================================================================

func setupLogger(cfg *config.Config) zerolog.Logger {
	level, err := zerolog.ParseLevel(cfg.Log.Level)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix

	var l zerolog.Logger
	if cfg.Log.Format == "console" {
		l = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
			With().Timestamp().Str("svc", cfg.App.Name).Logger()
	} else {
		l = zerolog.New(os.Stderr).With().Timestamp().Str("svc", cfg.App.Name).Logger()
	}
	return l
}
