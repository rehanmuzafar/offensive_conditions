package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/offensive-conditions/auth/internal/crypto"
	autherrors "github.com/offensive-conditions/auth/internal/errors"
	"github.com/offensive-conditions/auth/internal/oauth"
	"github.com/offensive-conditions/auth/internal/repository"
)

// OAuthBegin creates a signed state and returns the provider auth URL.
func (s *AuthService) OAuthBegin(ctx context.Context, providerName, mode string, linkUserID *uuid.UUID) (authURL, state string, err error) {
	prov, ok := s.oauthRegistry.Get(providerName)
	if !ok {
		return "", "", autherrors.New(autherrors.CodeBadRequest, "unknown OAuth provider")
	}

	st := oauth.State{
		Provider: providerName,
		Mode:     mode,
	}
	if mode == "link" && linkUserID != nil {
		st.UserID = linkUserID.String()
	}

	signed, err := oauth.SignState(st, []byte(s.cfg.OAuth.StateSecret))
	if err != nil {
		return "", "", autherrors.Internal(err)
	}

	redirectURI := s.oauthRedirectURI(providerName)
	return prov.AuthURL(signed, redirectURI), signed, nil
}

// OAuthCallback completes the OAuth flow:
// 1. Verify state signature and age
// 2. Exchange code for tokens
// 3. Fetch user info
// 4. Either link to authenticated user (mode=link) or login/register (mode=login)
func (s *AuthService) OAuthCallback(ctx context.Context, providerName, code, rawState string, m RequestMeta) (*LoginOutput, error) {
	st, err := oauth.VerifyState(rawState, []byte(s.cfg.OAuth.StateSecret), s.cfg.OAuth.StateTTL)
	if err != nil {
		return nil, autherrors.New(autherrors.CodeOAuthStateMismatch, "Invalid or expired state")
	}
	if st.Provider != providerName {
		return nil, autherrors.New(autherrors.CodeOAuthStateMismatch, "Provider mismatch")
	}

	redirectURI := s.oauthRedirectURI(providerName)
	result, err := s.oauthRegistry.CompleteCallback(ctx, providerName, code, redirectURI, st)
	if err != nil {
		s.log.Error().Err(err).Str("provider", providerName).Msg("oauth callback failed")
		return nil, autherrors.New(autherrors.CodeOAuthProvider, "OAuth provider error")
	}

	info := result.UserInfo
	if info.Email == "" {
		return nil, autherrors.New(autherrors.CodeOAuthProvider, "Provider did not return an email")
	}

	// Encrypt provider tokens for at-rest storage
	encAccess := ""
	if result.AccessToken != "" {
		encAccess, _ = crypto.Encrypt([]byte(result.AccessToken), s.tfaEncKey)
	}
	encRefresh := ""
	if result.RefreshToken != "" {
		encRefresh, _ = crypto.Encrypt([]byte(result.RefreshToken), s.tfaEncKey)
	}

	// Existing link?
	existing, err := s.oauthLinks.GetByProviderID(ctx, providerName, info.ProviderUserID)
	if err == nil {
		// Login flow: tokens for existing linked user
		user, err := s.users.GetByID(ctx, existing.UserID)
		if err != nil {
			return nil, autherrors.Internal(err)
		}
		if !user.CanLogin() {
			return nil, autherrors.New(autherrors.CodeForbidden, "Account cannot log in")
		}
		// Refresh stored tokens
		existing.AccessTokenEncrypted = encAccess
		existing.RefreshTokenEncrypted = encRefresh
		_ = s.oauthLinks.Create(ctx, existing) // ON CONFLICT updates

		return s.issueTokens(ctx, user, m)
	}

	// No existing link. Two cases:
	if st.Mode == "link" {
		// Linking to an authenticated user
		userID, err := uuid.Parse(st.UserID)
		if err != nil {
			return nil, autherrors.New(autherrors.CodeBadRequest, "Invalid link state")
		}
		user, err := s.users.GetByID(ctx, userID)
		if err != nil {
			return nil, autherrors.Internal(err)
		}
		link := &repository.OAuthLink{
			UserID:                user.ID,
			Provider:              providerName,
			ProviderUserID:        info.ProviderUserID,
			ProviderEmail:         info.Email,
			AccessTokenEncrypted:  encAccess,
			RefreshTokenEncrypted: encRefresh,
			Metadata:              map[string]any{"username": info.Username, "display_name": info.DisplayName},
		}
		if err := s.oauthLinks.Create(ctx, link); err != nil {
			return nil, autherrors.Internal(err)
		}
		return s.issueTokens(ctx, user, m)
	}

	// Login mode, no link → try matching email; otherwise auto-register
	email := strings.ToLower(info.Email)
	user, err := s.users.GetByEmail(ctx, email)
	if err == nil {
		// Email matches existing user → link this OAuth identity
		link := &repository.OAuthLink{
			UserID: user.ID, Provider: providerName, ProviderUserID: info.ProviderUserID,
			ProviderEmail: info.Email, AccessTokenEncrypted: encAccess, RefreshTokenEncrypted: encRefresh,
			Metadata: map[string]any{"username": info.Username, "display_name": info.DisplayName},
		}
		_ = s.oauthLinks.Create(ctx, link)
		if !user.CanLogin() {
			return nil, autherrors.New(autherrors.CodeForbidden, "Account cannot log in")
		}
		return s.issueTokens(ctx, user, m)
	}

	// Brand new user: register
	username := s.uniqueUsername(ctx, info.Username, info.Email)
	created, err := s.users.Create(ctx, repository.CreateUserInput{
		Email:    email,
		Username: username,
		// No password — OAuth-only account
		PasswordHash: "",
		Status:       repository.UserStatusActive, // OAuth implies verified email (provider has done so)
		Role:         repository.RoleUser,
	})
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	// Mark email verified (provider did this)
	if info.EmailVerified {
		_ = s.users.UpdateEmailVerified(ctx, created.ID, true)
	}

	// Create link
	link := &repository.OAuthLink{
		UserID: created.ID, Provider: providerName, ProviderUserID: info.ProviderUserID,
		ProviderEmail: info.Email, AccessTokenEncrypted: encAccess, RefreshTokenEncrypted: encRefresh,
		Metadata: map[string]any{"username": info.Username, "display_name": info.DisplayName},
	}
	if err := s.oauthLinks.Create(ctx, link); err != nil {
		return nil, autherrors.Internal(err)
	}

	s.audit.UserRegistered(ctx, created.ID, m.IP, m.UserAgent, m.RequestID)
	return s.issueTokens(ctx, created, m)
}

// oauthRedirectURI returns the canonical callback URL for a provider.
func (s *AuthService) oauthRedirectURI(provider string) string {
	return fmt.Sprintf("%s/%s/callback", s.cfg.OAuth.CallbackBase, provider)
}

// uniqueUsername tries to derive a username from provider data, ensuring uniqueness.
func (s *AuthService) uniqueUsername(ctx context.Context, preferred, email string) string {
	base := preferred
	if base == "" {
		// Use email local-part
		if i := strings.Index(email, "@"); i > 0 {
			base = email[:i]
		} else {
			base = "user"
		}
	}
	// Sanitize
	base = strings.ToLower(base)
	base = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, base)
	if len(base) < 3 {
		base = base + "_user"
	}
	if len(base) > 24 {
		base = base[:24]
	}

	candidate := base
	for i := 0; i < 20; i++ {
		if _, err := s.users.GetByUsername(ctx, candidate); err != nil {
			return candidate
		}
		suffix, _ := crypto.RandomToken(3)
		candidate = base + "_" + suffix[:6]
	}
	// Final fallback
	suffix, _ := crypto.RandomToken(4)
	return base + "_" + suffix[:8]
}

// OAuthProviders returns the list of currently registered OAuth provider names.
func (s *AuthService) OAuthProviders() []string {
	return s.oauthRegistry.List()
}

// silence
var _ = strings.TrimSpace
