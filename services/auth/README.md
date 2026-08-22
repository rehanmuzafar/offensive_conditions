# Auth Service

The authentication service for Offense Conditions. Handles registration, login, JWT issuance, refresh token rotation, 2FA, OAuth, email verification, and password reset.

## Stack
- **Language:** Go 1.22
- **HTTP Framework:** Gin
- **Database:** PostgreSQL 16 (via pgx)
- **Cache/RateLimit:** Redis 7
- **Tokens:** JWT RS256 (golang-jwt/jwt)
- **Password Hash:** Argon2id (golang.org/x/crypto)
- **2FA:** TOTP RFC 6238 (pquerna/otp)
- **Logging:** zerolog (structured JSON)
- **Config:** viper (env + file)

## Endpoints

### Public (no auth)
```
POST   /v1/auth/register             Create account
POST   /v1/auth/login                Email/password login → tokens
POST   /v1/auth/refresh              Refresh access token
POST   /v1/auth/verify-email         Confirm email verification token
POST   /v1/auth/forgot-password      Initiate password reset
POST   /v1/auth/reset-password       Complete password reset
POST   /v1/auth/login/2fa            Submit TOTP after password OK
GET    /v1/auth/oauth/{provider}     Begin OAuth flow
GET    /v1/auth/oauth/{provider}/callback  OAuth callback
```

### Authenticated
```
POST   /v1/auth/logout               Revoke current session
POST   /v1/auth/logout-all           Revoke all user sessions
GET    /v1/auth/sessions             List active sessions
DELETE /v1/auth/sessions/{id}        Revoke specific session
POST   /v1/auth/2fa/enroll           Begin TOTP enrollment
POST   /v1/auth/2fa/confirm          Confirm enrollment with first code
POST   /v1/auth/2fa/disable          Disable 2FA (requires password + code)
POST   /v1/auth/2fa/backup-codes     Regenerate backup codes
POST   /v1/auth/password/change      Change password (requires current)
GET    /v1/auth/me                   Current user info (lightweight)
```

### Admin
```
GET    /v1/auth/users/{id}           View user auth metadata
POST   /v1/auth/users/{id}/lock      Lock account
POST   /v1/auth/users/{id}/unlock    Unlock account
POST   /v1/auth/users/{id}/reset-2fa Disable 2FA (admin override)
```

### Internal (gRPC, mTLS)
```
ValidateToken(token) → {user_id, claims}
GetUser(user_id) → user metadata
RevokeUserSessions(user_id) → ok
```

## Quick Start

```bash
# From repo root, with database stack running:
cd services/auth
make dev        # Start service with hot reload
make test       # Run all tests
make build      # Build binary
make docker     # Build container image
```

## Configuration

All config via environment variables (see `internal/config/config.go`):

```
APP_ENV=development           # development|staging|production
HTTP_PORT=8001
GRPC_PORT=9001

DB_HOST=localhost
DB_PORT=5432
DB_NAME=offcon
DB_USER=svc_auth
DB_PASSWORD=<from-vault>
DB_MAX_CONNS=25

REDIS_ADDR=localhost:6379
REDIS_PASSWORD=

JWT_PRIVATE_KEY_PATH=/secrets/jwt-private.pem
JWT_PUBLIC_KEY_PATH=/secrets/jwt-public.pem
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=168h          # 7 days
JWT_ISSUER=https://auth.offensiveconditions.org
JWT_AUDIENCE=offcon-api

ARGON2_TIME=2
ARGON2_MEMORY=65536           # KB → 64 MB
ARGON2_THREADS=1
ARGON2_KEY_LEN=32

OAUTH_GOOGLE_CLIENT_ID=<id>
OAUTH_GOOGLE_CLIENT_SECRET=<secret>
OAUTH_GITHUB_CLIENT_ID=<id>
OAUTH_GITHUB_CLIENT_SECRET=<secret>

SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<key>
SMTP_FROM=no-reply@offensiveconditions.org

RATE_LIMIT_LOGIN_PER_MINUTE=10
RATE_LIMIT_REGISTER_PER_HOUR=5

LOG_LEVEL=info
LOG_FORMAT=json
```

## Project Layout

```
auth/
├── cmd/server/main.go              Entry point
├── internal/
│   ├── config/                     Configuration loading
│   ├── handlers/                   HTTP handlers (controllers)
│   ├── middleware/                 Auth, logging, rate limit
│   ├── service/                    Business logic
│   ├── repository/                 PostgreSQL data access
│   ├── crypto/                     Argon2id, HMAC, encryption helpers
│   ├── tokens/                     JWT, refresh token rotation, TOTP
│   ├── validators/                 Input validation rules
│   ├── ratelimit/                  Redis-backed rate limiting
│   ├── email/                      Transactional email sender
│   ├── audit/                      Audit log emitter
│   └── errors/                     Typed error definitions
├── pkg/client/                     Public Go client for other services
├── api/                            OpenAPI spec, proto files
├── tests/                          Unit + integration tests
└── deployments/                    Dockerfile, K8s manifests
```

## Security Notes

- Passwords hashed with Argon2id (t=2, m=64MB, p=1, salt=16B, key=32B)
- JWT signed with RS256 (asymmetric so other services verify with public key)
- Refresh tokens stored as SHA-256 hash, rotated on every refresh
- Token theft detection via family rotation chain
- TOTP secret AES-256-GCM encrypted at rest
- All endpoints rate-limited (Redis sliding window)
- Failed login counter triggers account lock at 5 attempts (15 min)
- Email verification mandatory before login (configurable)
- 2FA optional for users, required for admins
