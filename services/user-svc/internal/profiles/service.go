// Package profiles implements profile read/write business logic.
package profiles

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/user-svc/internal/config"
	uerrors "github.com/offensive-conditions/user-svc/internal/errors"
	"github.com/offensive-conditions/user-svc/internal/producers"
	"github.com/offensive-conditions/user-svc/internal/repository"
	"github.com/offensive-conditions/user-svc/internal/storage"
)

// Service handles all profile operations.
type Service struct {
	repo      repository.ProfileRepository
	storage   *storage.Client
	publisher *producers.Publisher
	rdb       *redis.Client
	cfg       *config.Config
	log       zerolog.Logger
}

type Deps struct {
	Repo      repository.ProfileRepository
	Storage   *storage.Client
	Publisher *producers.Publisher
	Redis     *redis.Client
	Cfg       *config.Config
	Log       zerolog.Logger
}

func New(d Deps) *Service {
	return &Service{
		repo: d.Repo, storage: d.Storage, publisher: d.Publisher,
		rdb: d.Redis, cfg: d.Cfg, log: d.Log,
	}
}

// =============================================================================
// Read
// =============================================================================

// Get returns the full profile for userID. Callers decide what to expose
// based on viewer-vs-target privacy.
func (s *Service) Get(ctx context.Context, userID uuid.UUID) (*repository.Profile, error) {
	p, err := s.repo.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, uerrors.New(uerrors.CodeUserNotFound, "user not found")
		}
		return nil, uerrors.Internal(err)
	}
	return p, nil
}

// GetByUsername resolves a username to a profile.
func (s *Service) GetByUsername(ctx context.Context, username string) (*repository.Profile, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, uerrors.New(uerrors.CodeBadRequest, "username required")
	}
	p, err := s.repo.GetByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, uerrors.New(uerrors.CodeUserNotFound, "user not found")
		}
		return nil, uerrors.Internal(err)
	}
	return p, nil
}

// BatchGet returns profiles for many user IDs at once. Missing IDs are silently omitted.
func (s *Service) BatchGet(ctx context.Context, userIDs []uuid.UUID) (map[uuid.UUID]*repository.Profile, error) {
	if len(userIDs) == 0 {
		return map[uuid.UUID]*repository.Profile{}, nil
	}
	if len(userIDs) > 500 {
		return nil, uerrors.New(uerrors.CodeValidation, "batch size exceeds 500")
	}
	m, err := s.repo.BatchGet(ctx, userIDs)
	if err != nil {
		return nil, uerrors.Internal(err)
	}
	return m, nil
}

// =============================================================================
// Update
// =============================================================================

// UpdateRequest is the wire-level update payload from the HTTP layer.
type UpdateRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	Bio         *string `json:"bio,omitempty"`
	CountryCode *string `json:"country_code,omitempty"`
	Timezone    *string `json:"timezone,omitempty"`

	Twitter   *string `json:"twitter_handle,omitempty"`
	GitHub    *string `json:"github_handle,omitempty"`
	LinkedIn  *string `json:"linkedin_url,omitempty"`
	Website   *string `json:"website_url,omitempty"`
}

var (
	displayNameRe = regexp.MustCompile(`^[\p{L}\p{N} _'.-]{1,50}$`)
	countryCodeRe = regexp.MustCompile(`^[A-Z]{2}$`)
	twitterRe     = regexp.MustCompile(`^[A-Za-z0-9_]{1,15}$`)
	githubRe      = regexp.MustCompile(`^[A-Za-z0-9-]{1,39}$`)
	urlRe         = regexp.MustCompile(`^https?://[^\s]{1,500}$`)
)

// Update applies fields from req that are non-nil. Returns the new profile.
func (s *Service) Update(ctx context.Context, userID uuid.UUID, req *UpdateRequest, requestID string) (*repository.Profile, error) {
	if req == nil {
		return s.Get(ctx, userID)
	}
	changedFields := []string{}
	newValues := map[string]string{}

	if req.DisplayName != nil {
		dn := strings.TrimSpace(*req.DisplayName)
		if dn != "" && !displayNameRe.MatchString(dn) {
			return nil, uerrors.New(uerrors.CodeValidation, "invalid display name")
		}
		if err := s.repo.UpdateDisplayName(ctx, userID, dn); err != nil {
			return nil, uerrors.Internal(err)
		}
		changedFields = append(changedFields, "display_name")
		newValues["display_name"] = dn
	}

	if req.Bio != nil {
		bio := strings.TrimSpace(*req.Bio)
		if len(bio) > s.cfg.Limits.BioMaxLength {
			return nil, uerrors.New(uerrors.CodeValidation, "bio too long")
		}
		if err := s.repo.UpdateBio(ctx, userID, bio); err != nil {
			return nil, uerrors.Internal(err)
		}
		changedFields = append(changedFields, "bio")
	}

	if req.CountryCode != nil {
		code := strings.ToUpper(strings.TrimSpace(*req.CountryCode))
		if code != "" && !countryCodeRe.MatchString(code) {
			return nil, uerrors.New(uerrors.CodeValidation, "country_code must be ISO-3166-1 alpha-2")
		}
		if err := s.repo.UpdateCountry(ctx, userID, code); err != nil {
			return nil, uerrors.Internal(err)
		}
		changedFields = append(changedFields, "country_code")
		newValues["country_code"] = code
		// Invalidate any cached "country count" for both old + new country
		if s.rdb != nil {
			s.rdb.Del(ctx, "country_count:"+code)
		}
	}

	if req.Timezone != nil {
		tz := strings.TrimSpace(*req.Timezone)
		if tz != "" {
			if _, err := time.LoadLocation(tz); err != nil {
				return nil, uerrors.New(uerrors.CodeValidation, "invalid timezone")
			}
		}
		if err := s.repo.UpdateTimezone(ctx, userID, tz); err != nil {
			return nil, uerrors.Internal(err)
		}
		changedFields = append(changedFields, "timezone")
	}

	// Social links: write all four together
	if req.Twitter != nil || req.GitHub != nil || req.LinkedIn != nil || req.Website != nil {
		current, err := s.repo.Get(ctx, userID)
		if err != nil {
			return nil, uerrors.Internal(err)
		}
		t := current.TwitterHandle
		g := current.GitHubHandle
		l := current.LinkedInURL
		w := current.PersonalSiteURL
		if req.Twitter != nil {
			t = strings.TrimSpace(strings.TrimPrefix(*req.Twitter, "@"))
			if t != "" && !twitterRe.MatchString(t) {
				return nil, uerrors.New(uerrors.CodeValidation, "invalid twitter handle")
			}
		}
		if req.GitHub != nil {
			g = strings.TrimSpace(*req.GitHub)
			if g != "" && !githubRe.MatchString(g) {
				return nil, uerrors.New(uerrors.CodeValidation, "invalid github handle")
			}
		}
		if req.LinkedIn != nil {
			l = strings.TrimSpace(*req.LinkedIn)
			if l != "" && !urlRe.MatchString(l) {
				return nil, uerrors.New(uerrors.CodeValidation, "linkedin must be a valid URL")
			}
		}
		if req.Website != nil {
			w = strings.TrimSpace(*req.Website)
			if w != "" && !urlRe.MatchString(w) {
				return nil, uerrors.New(uerrors.CodeValidation, "website must be a valid URL")
			}
		}
		if err := s.repo.UpdateSocialLinks(ctx, userID, t, g, l, w); err != nil {
			return nil, uerrors.Internal(err)
		}
		changedFields = append(changedFields, "social_links")
	}

	if len(changedFields) > 0 && s.publisher != nil {
		// Best-effort; don't fail the request if Kafka is down.
		if err := s.publisher.PublishProfileUpdated(ctx, userID, changedFields, newValues, requestID); err != nil {
			s.log.Warn().Err(err).Msg("publish profile.updated failed")
		}
	}

	return s.Get(ctx, userID)
}

// SetAccountType writes the hacker/company answer, once.
//
// The "already set" check lives here rather than in the handler so the rule
// holds for any caller, and it reads the profile through the same cache path
// everything else does.
func (s *Service) SetAccountType(
	ctx context.Context, userID uuid.UUID, kind, companyName, companyWebsite string,
) error {
	existing, err := s.Get(ctx, userID)
	if err != nil {
		return err
	}
	if existing.AccountType != "" {
		return uerrors.New(uerrors.CodeValidation, "account type is already set")
	}
	if err := s.repo.SetAccountType(ctx, userID, kind, companyName, companyWebsite); err != nil {
		return uerrors.Internal(err)
	}
	return nil
}

// UpdatePrivacy updates only the privacy block.
func (s *Service) UpdatePrivacy(ctx context.Context, userID uuid.UUID, p repository.PrivacySettings, requestID string) error {
	validVis := map[string]bool{"public": true, "friends_only": true, "private": true}
	validMsg := map[string]bool{"anyone": true, "friends_only": true, "nobody": true}
	if !validVis[p.ProfileVisibility] {
		return uerrors.New(uerrors.CodeValidation, "profile_visibility must be public|friends_only|private")
	}
	if !validMsg[p.AllowMessages] {
		return uerrors.New(uerrors.CodeValidation, "allow_messages must be anyone|friends_only|nobody")
	}
	if err := s.repo.UpdatePrivacy(ctx, userID, p); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishProfileUpdated(ctx, userID, []string{"privacy"}, nil, requestID)
	}
	return nil
}

// =============================================================================
// Avatar
// =============================================================================

// UploadAvatar validates, stores, and updates the avatar URL.
func (s *Service) UploadAvatar(ctx context.Context, userID uuid.UUID, body io.Reader, contentType string, requestID string) (string, error) {
	// Read up to MaxAvatarBytes+1 so we can detect oversize without buffering everything
	max := s.cfg.HTTP.MaxAvatarBytes
	limited := io.LimitReader(body, max+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return "", uerrors.Internal(err)
	}
	if int64(len(data)) > max {
		return "", uerrors.New(uerrors.CodeAvatarTooLarge, "avatar exceeds size limit")
	}

	// Sniff content type if not provided or untrustworthy
	detected := http.DetectContentType(data)
	if !validImageType(detected) {
		return "", uerrors.New(uerrors.CodeAvatarBadFormat, "avatar must be png, jpeg, gif, or webp")
	}
	// If caller-provided contentType is also valid, prefer that (browsers sometimes send better hints)
	finalType := detected
	if validImageType(contentType) {
		finalType = contentType
	}

	// Decode to validate dimensions (refuse images that aren't actually images)
	_, _, err = image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", uerrors.New(uerrors.CodeAvatarBadFormat, "could not decode image")
	}

	// Fetch existing to delete old key after successful upload
	existing, _ := s.repo.Get(ctx, userID)
	oldKey := ""
	if existing != nil {
		oldKey = existing.AvatarStorageKey
	}

	url, key, err := s.storage.UploadAvatar(ctx, userID, data, finalType)
	if err != nil {
		return "", uerrors.Internal(err)
	}
	if err := s.repo.UpdateAvatar(ctx, userID, url, key); err != nil {
		// Best-effort cleanup of orphaned object
		_ = s.storage.DeleteAvatar(ctx, key)
		return "", uerrors.Internal(err)
	}
	if oldKey != "" && oldKey != key {
		if err := s.storage.DeleteAvatar(ctx, oldKey); err != nil {
			s.log.Warn().Err(err).Str("key", oldKey).Msg("failed to delete old avatar")
		}
	}
	if s.publisher != nil {
		_ = s.publisher.PublishAvatarUpdated(ctx, userID, url, false, requestID)
	}
	return url, nil
}

// DeleteAvatar removes the avatar URL and the underlying object.
func (s *Service) DeleteAvatar(ctx context.Context, userID uuid.UUID, requestID string) error {
	existing, err := s.repo.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeUserNotFound, "user not found")
		}
		return uerrors.Internal(err)
	}
	if err := s.repo.UpdateAvatar(ctx, userID, "", ""); err != nil {
		return uerrors.Internal(err)
	}
	if existing.AvatarStorageKey != "" {
		if err := s.storage.DeleteAvatar(ctx, existing.AvatarStorageKey); err != nil {
			s.log.Warn().Err(err).Str("key", existing.AvatarStorageKey).Msg("storage delete failed")
		}
	}
	if s.publisher != nil {
		_ = s.publisher.PublishAvatarUpdated(ctx, userID, "", true, requestID)
	}
	return nil
}

func validImageType(ct string) bool {
	ct = strings.ToLower(strings.TrimSpace(ct))
	return ct == "image/png" || ct == "image/jpeg" || ct == "image/jpg" ||
		ct == "image/gif" || ct == "image/webp"
}
