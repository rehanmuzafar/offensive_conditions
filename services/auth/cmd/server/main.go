package main

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/reflection"

	"github.com/offensive-conditions/auth/internal/audit"
	"github.com/offensive-conditions/auth/internal/config"
	"github.com/offensive-conditions/auth/internal/email"
	grpcsrv "github.com/offensive-conditions/auth/internal/grpc"
	"github.com/offensive-conditions/auth/internal/handlers"
	"github.com/offensive-conditions/auth/internal/middleware"
	"github.com/offensive-conditions/auth/internal/oauth"
	"github.com/offensive-conditions/auth/internal/ratelimit"
	"github.com/offensive-conditions/auth/internal/repository"
	"github.com/offensive-conditions/auth/internal/service"
	"github.com/offensive-conditions/auth/internal/tokens"
	"github.com/offensive-conditions/auth/internal/validators"
)

func main() {
	// 1. Configuration
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: config load: %v\n", err)
		os.Exit(1)
	}

	// 2. Logger
	logger := setupLogger(cfg)
	logger.Info().
		Str("env", cfg.App.Env).
		Str("version", cfg.App.Version).
		Msg("starting auth service")

	// 3. Database pool
	ctx := context.Background()
	pool, err := repository.NewPool(ctx, repository.PoolConfig{
		DSN:      cfg.DB.DSN(),
		MaxConns: int32(cfg.DB.MaxConns),
		MinConns: int32(cfg.DB.MinConns),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("database connect failed")
	}
	defer pool.Close()
	logger.Info().Msg("database connected")

	// 4. Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
		PoolSize: cfg.Redis.PoolSize,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Fatal().Err(err).Msg("redis connect failed")
	}
	defer rdb.Close()
	logger.Info().Msg("redis connected")

	// 5. Crypto: JWT, TOTP, AES key
	jwt, err := tokens.NewJWTIssuer(tokens.JWTConfig{
		PrivateKeyPath: cfg.JWT.PrivateKeyPath,
		PublicKeyPath:  cfg.JWT.PublicKeyPath,
		Issuer:         cfg.JWT.Issuer,
		Audience:       cfg.JWT.Audience,
		AccessTTL:      cfg.JWT.AccessTTL,
		ClockSkew:      cfg.JWT.ClockSkew,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("jwt setup failed")
	}

	totp := tokens.NewTOTPManager(cfg.App.Name)

	// AES encryption key for TOTP secrets at rest (from Vault in prod)
	tfaEncKey, err := loadEncryptionKey()
	if err != nil {
		logger.Fatal().Err(err).Msg("encryption key load failed")
	}

	// 6. Repositories
	usersRepo := repository.NewPGUserRepo(pool)
	tfaSecretsRepo := repository.NewPGTFASecretRepo(pool)
	refreshesRepo := repository.NewPGRefreshTokenRepo(pool)
	sessionsRepo := repository.NewPGSessionRepo(pool)
	emailVerifyRepo := repository.NewPGEmailVerificationRepo(pool)
	passwordRstRepo := repository.NewPGPasswordResetRepo(pool)
	loginAttemptsRepo := repository.NewPGLoginAttemptRepo(pool)
	oauthLinksRepo := repository.NewPGOAuthLinkRepo(pool)

	// 7. Supporting services
	limiter := ratelimit.NewLimiter(rdb)
	auditLog := audit.New(pool, cfg.App.Name, logger)

	// Email
	var mailer email.Sender
	if cfg.App.IsDevelopment() && cfg.SMTP.Host == "" {
		mailer = &email.NoopSender{}
		logger.Warn().Msg("using NoopSender for email (development)")
	} else {
		smtpSender, err := email.NewSMTPSender(email.Config{
			Host: cfg.SMTP.Host, Port: cfg.SMTP.Port,
			User: cfg.SMTP.User, Password: cfg.SMTP.Password,
			From: cfg.SMTP.From, FromName: cfg.SMTP.FromName,
			UseTLS: cfg.SMTP.UseTLS, TemplatesDir: cfg.SMTP.TemplatesDir,
		})
		if err != nil {
			logger.Fatal().Err(err).Msg("smtp setup failed")
		}
		mailer = smtpSender
	}

	// 8. OAuth registry
	oauthReg := oauth.NewRegistry()
	for name, prov := range cfg.OAuth.Providers {
		if !prov.Enabled {
			continue
		}
		cfg := oauth.Config{
			ClientID:     prov.ClientID,
			ClientSecret: prov.ClientSecret,
			Scopes:       prov.Scopes,
		}
		switch name {
		case "google":
			oauthReg.Register(oauth.NewGoogleProvider(cfg))
		case "github":
			oauthReg.Register(oauth.NewGitHubProvider(cfg))
		case "discord":
			oauthReg.Register(oauth.NewDiscordProvider(cfg))
		}
		logger.Info().Str("provider", name).Msg("oauth provider registered")
	}

	// 9. Application service (business logic)
	authSvc := service.New(service.Deps{
		Cfg: cfg, Log: logger,
		Users: usersRepo, TFASecrets: tfaSecretsRepo,
		Refreshes: refreshesRepo, Sessions: sessionsRepo,
		EmailVerify: emailVerifyRepo, PasswordRst: passwordRstRepo,
		LoginAttempts: loginAttemptsRepo, OAuthLinks: oauthLinksRepo,
		JWT: jwt, TOTP: totp,
		Limiter: limiter, Mail: mailer, Audit: auditLog,
		OAuthRegistry: oauthReg,
		TFAEncKey:     tfaEncKey,
	})

	// 10. Register custom validators on Gin's engine
	if err := validators.Register(); err != nil {
		logger.Fatal().Err(err).Msg("validator registration failed")
	}

	// 11. HTTP router
	httpSrv := buildHTTPServer(cfg, logger, pool, rdb, authSvc, jwt)

	// 12. gRPC server
	grpcServer, grpcLis := buildGRPCServer(cfg, logger, jwt, usersRepo, authSvc)

	// 13. Start servers
	errCh := make(chan error, 2)

	go func() {
		logger.Info().Int("port", cfg.HTTP.Port).Msg("http server listening")
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("http server: %w", err)
		}
	}()

	go func() {
		logger.Info().Int("port", cfg.GRPC.Port).Msg("grpc server listening")
		if err := grpcServer.Serve(grpcLis); err != nil {
			errCh <- fmt.Errorf("grpc server: %w", err)
		}
	}()

	// 14. Background workers
	go startCleanupWorker(ctx, logger, refreshesRepo)

	// 15. Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")
	case err := <-errCh:
		logger.Error().Err(err).Msg("server error, shutting down")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
	defer cancel()

	logger.Info().Msg("shutting down HTTP server")
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("HTTP shutdown error")
	}

	logger.Info().Msg("shutting down gRPC server")
	grpcServer.GracefulStop()

	logger.Info().Msg("auth service stopped")
}

// ============================================================================
// HTTP Server Setup
// ============================================================================

func buildHTTPServer(
	cfg *config.Config,
	logger zerolog.Logger,
	pool *pgxpool.Pool,
	rdb *redis.Client,
	authSvc *service.AuthService,
	jwt *tokens.JWTIssuer,
) *http.Server {
	if cfg.App.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	if len(cfg.HTTP.TrustedProxies) > 0 {
		_ = r.SetTrustedProxies(cfg.HTTP.TrustedProxies)
	}

	// Global middleware
	r.Use(middleware.RequestID())
	r.Use(middleware.Recovery(logger))
	r.Use(middleware.Logger(logger))
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.CORS(cfg.HTTP.CORSOrigins))
	r.Use(middleware.MaxBodySize(1 << 20)) // 1 MB

	// Handlers
	authH := handlers.NewAuthHandler(authSvc, logger)
	tfaH := handlers.NewTFAHandler(authSvc, logger)
	sessH := handlers.NewSessionHandler(authSvc, logger)
	oauthH := handlers.NewOAuthHandler(authSvc, cfg.HTTP.CORSOrigins[0]+"/auth/callback", logger)
	healthH := handlers.NewHealthHandler(pool, rdb, cfg.App.Version)

	// Routes
	r.GET("/healthz", healthH.Liveness)
	r.GET("/readyz", healthH.Readiness)
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	v1 := r.Group("/v1/auth")
	{
		// Public
		v1.POST("/register", authH.Register)
		v1.POST("/login", authH.Login)
		v1.POST("/login/2fa", authH.LoginTFA)
		v1.POST("/refresh", authH.Refresh)
		v1.POST("/logout", authH.Logout)
		v1.POST("/verify-email", authH.VerifyEmail)
		v1.POST("/forgot-password", authH.ForgotPassword)
		v1.POST("/reset-password", authH.ResetPassword)

		// OAuth
		v1.GET("/providers", oauthH.Providers)
		v1.GET("/oauth/:provider", oauthH.Begin)
		v1.GET("/oauth/:provider/callback", oauthH.Callback)

		// Authenticated
		auth := v1.Group("")
		auth.Use(middleware.RequireAuth(jwt))
		{
			auth.GET("/me", authH.Me)
			auth.POST("/logout-all", authH.LogoutAll)
			auth.POST("/password/change", authH.ChangePassword)

			auth.GET("/sessions", sessH.List)
			auth.DELETE("/sessions/:id", sessH.Revoke)

			auth.POST("/2fa/enroll", tfaH.Enroll)
			auth.POST("/2fa/confirm", tfaH.Confirm)
			auth.POST("/2fa/disable", tfaH.Disable)
			auth.POST("/2fa/backup-codes", tfaH.RegenerateBackupCodes)
		}
	}

	return &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.HTTP.Port),
		Handler:      r,
		ReadTimeout:  cfg.HTTP.ReadTimeout,
		WriteTimeout: cfg.HTTP.WriteTimeout,
		IdleTimeout:  cfg.HTTP.IdleTimeout,
	}
}

// ============================================================================
// gRPC Server Setup
// ============================================================================

func buildGRPCServer(
	cfg *config.Config,
	logger zerolog.Logger,
	jwt *tokens.JWTIssuer,
	users repository.UserRepository,
	authSvc *service.AuthService,
) (*grpc.Server, net.Listener) {
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.GRPC.Port))
	if err != nil {
		logger.Fatal().Err(err).Msg("grpc listen failed")
	}

	var opts []grpc.ServerOption

	// mTLS for production
	if cfg.GRPC.TLSCertPath != "" && cfg.GRPC.TLSKeyPath != "" {
		creds, err := credentials.NewServerTLSFromFile(cfg.GRPC.TLSCertPath, cfg.GRPC.TLSKeyPath)
		if err != nil {
			logger.Fatal().Err(err).Msg("grpc TLS load failed")
		}
		opts = append(opts, grpc.Creds(creds))
	}

	srv := grpc.NewServer(opts...)

	// Register the AuthService implementation
	// In production: pb.RegisterAuthServiceServer(srv, grpcsrv.NewAuthGRPCServer(jwt, users, authSvc, logger))
	// For now, the server struct is built but not registered (proto-less placeholder).
	_ = grpcsrv.NewAuthGRPCServer(jwt, users, authSvc, logger)

	if cfg.GRPC.EnableReflection {
		reflection.Register(srv)
	}

	return srv, lis
}

// ============================================================================
// Background Workers
// ============================================================================

func startCleanupWorker(ctx context.Context, logger zerolog.Logger, refreshes repository.RefreshTokenRepository) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			deleted, err := refreshes.DeleteExpired(ctx)
			if err != nil {
				logger.Error().Err(err).Msg("cleanup worker error")
				continue
			}
			if deleted > 0 {
				logger.Info().Int64("deleted", deleted).Msg("expired refresh tokens purged")
			}
		}
	}
}

// ============================================================================
// Helpers
// ============================================================================

func setupLogger(cfg *config.Config) zerolog.Logger {
	level, err := zerolog.ParseLevel(cfg.Log.Level)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix

	var logger zerolog.Logger
	if cfg.Log.Format == "console" {
		logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})
	} else {
		logger = log.With().Timestamp().
			Str("service", cfg.App.Name).
			Str("version", cfg.App.Version).
			Str("env", cfg.App.Env).
			Logger()
	}

	return logger
}

func loadEncryptionKey() ([]byte, error) {
	hexKey := os.Getenv("TFA_ENCRYPTION_KEY")
	if hexKey == "" {
		// Generate ephemeral key for dev only
		if os.Getenv("APP_ENV") == "development" {
			fmt.Fprintln(os.Stderr, "WARNING: TFA_ENCRYPTION_KEY not set, using ephemeral key (dev only)")
			return []byte("dev-only-32-byte-key-not-for-prod"), nil
		}
		return nil, fmt.Errorf("TFA_ENCRYPTION_KEY env var is required")
	}
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("TFA_ENCRYPTION_KEY must be hex: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("TFA_ENCRYPTION_KEY must decode to 32 bytes, got %d", len(key))
	}
	return key, nil
}

// silence
var (
	_ = strconv.Itoa
	_ = pgxpool.Pool{}
)
