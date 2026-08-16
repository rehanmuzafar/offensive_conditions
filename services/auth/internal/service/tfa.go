package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/offensive-conditions/auth/internal/crypto"
	autherrors "github.com/offensive-conditions/auth/internal/errors"
	"github.com/offensive-conditions/auth/internal/repository"
)

// decryptString is a helper used across service files.
func decryptString(encoded string, key []byte) (string, error) {
	b, err := crypto.Decrypt(encoded, key)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// =============================================================================
// 2FA Enrollment
// =============================================================================

type TFAEnrollOutput struct {
	Secret      string   // base32 (shown to user once for manual entry)
	OtpAuthURL  string   // for QR code generation client-side
	BackupCodes []string // 10 single-use codes shown once
}

// EnrollTFA begins TOTP enrollment. The user must call ConfirmTFA with a valid
// code to actually enable 2FA on their account.
func (s *AuthService) EnrollTFA(ctx context.Context, userID uuid.UUID, m RequestMeta) (*TFAEnrollOutput, error) {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, autherrors.New(autherrors.CodeNotFound, "user not found")
	}
	if user.TFAEnabled {
		return nil, autherrors.New(autherrors.CodeTFAAlreadyEnabled, "2FA is already enabled")
	}

	enrollment, err := s.totp.GenerateSecret(user.Email)
	if err != nil {
		return nil, autherrors.Internal(err)
	}

	// Generate backup codes
	backupCodes, err := crypto.BackupCodes(s.cfg.Security.BackupCodesCount)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	backupJSON, _ := json.Marshal(backupCodes)

	// Encrypt secret + backup codes
	encSecret, err := crypto.Encrypt([]byte(enrollment.Secret), s.tfaEncKey)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	encBackup, err := crypto.Encrypt(backupJSON, s.tfaEncKey)
	if err != nil {
		return nil, autherrors.Internal(err)
	}

	// Store (unconfirmed) — replaces any previous attempt
	if err := s.tfaSecrets.Create(ctx, &repository.TFASecret{
		UserID:               user.ID,
		SecretEncrypted:      encSecret,
		BackupCodesEncrypted: encBackup,
		Method:               "totp",
	}); err != nil {
		return nil, autherrors.Internal(err)
	}

	return &TFAEnrollOutput{
		Secret:      enrollment.Secret,
		OtpAuthURL:  enrollment.URI,
		BackupCodes: backupCodes,
	}, nil
}

// ConfirmTFA finalizes 2FA enrollment by verifying the user can produce a code.
func (s *AuthService) ConfirmTFA(ctx context.Context, userID uuid.UUID, code string, m RequestMeta) error {
	secret, err := s.tfaSecrets.GetByUserID(ctx, userID)
	if err != nil {
		return autherrors.New(autherrors.CodeBadRequest, "enrollment not started")
	}
	if secret.ConfirmedAt != nil {
		return autherrors.New(autherrors.CodeTFAAlreadyEnabled, "2FA already confirmed")
	}

	plainSecret, err := decryptString(secret.SecretEncrypted, s.tfaEncKey)
	if err != nil {
		return autherrors.Internal(err)
	}

	valid, err := s.totp.Validate(code, plainSecret)
	if err != nil || !valid {
		return autherrors.New(autherrors.CodeTFAInvalidCode, "Invalid code; please try again")
	}

	if err := s.tfaSecrets.Confirm(ctx, userID); err != nil {
		return autherrors.Internal(err)
	}
	if err := s.users.UpdateTFAEnabled(ctx, userID, true); err != nil {
		return autherrors.Internal(err)
	}

	s.audit.TFAEnabled(ctx, userID, m.IP, m.RequestID)
	return nil
}

// DisableTFA turns off 2FA. Requires current password and a valid code or backup code.
func (s *AuthService) DisableTFA(ctx context.Context, userID uuid.UUID, password, code string, m RequestMeta) error {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return autherrors.New(autherrors.CodeNotFound, "user not found")
	}
	if !user.TFAEnabled {
		return autherrors.New(autherrors.CodeTFANotEnabled, "2FA is not enabled")
	}

	valid, _, err := crypto.VerifyPassword(password, user.PasswordHash, crypto.Argon2idParams{
		Time: s.cfg.Argon2.Time, Memory: s.cfg.Argon2.Memory,
		Threads: s.cfg.Argon2.Threads, KeyLen: s.cfg.Argon2.KeyLen, SaltLen: s.cfg.Argon2.SaltLen,
	})
	if err != nil || !valid {
		return autherrors.InvalidCredentials()
	}

	// Verify code or backup
	secret, err := s.tfaSecrets.GetByUserID(ctx, userID)
	if err != nil {
		return autherrors.Internal(err)
	}
	plainSecret, _ := decryptString(secret.SecretEncrypted, s.tfaEncKey)
	if valid, _ := s.totp.Validate(code, plainSecret); !valid {
		// Try backup codes
		if !s.tryConsumeBackupCode(ctx, userID, secret, code) {
			return autherrors.New(autherrors.CodeTFAInvalidCode, "Invalid code")
		}
	}

	if err := s.tfaSecrets.Delete(ctx, userID); err != nil {
		return autherrors.Internal(err)
	}
	if err := s.users.UpdateTFAEnabled(ctx, userID, false); err != nil {
		return autherrors.Internal(err)
	}

	s.audit.TFADisabled(ctx, userID, m.IP, m.RequestID)
	return nil
}

// RegenerateBackupCodes issues a new set of backup codes, invalidating the old ones.
func (s *AuthService) RegenerateBackupCodes(ctx context.Context, userID uuid.UUID, m RequestMeta) ([]string, error) {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, autherrors.New(autherrors.CodeNotFound, "user not found")
	}
	if !user.TFAEnabled {
		return nil, autherrors.New(autherrors.CodeTFANotEnabled, "2FA is not enabled")
	}

	codes, err := crypto.BackupCodes(s.cfg.Security.BackupCodesCount)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	codesJSON, _ := json.Marshal(codes)
	encBackup, err := crypto.Encrypt(codesJSON, s.tfaEncKey)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	if err := s.tfaSecrets.UpdateBackupCodes(ctx, userID, encBackup); err != nil {
		return nil, autherrors.Internal(err)
	}
	return codes, nil
}

// tryConsumeBackupCode checks if code is a valid backup code and removes it on success.
func (s *AuthService) tryConsumeBackupCode(ctx context.Context, userID uuid.UUID, secret *repository.TFASecret, code string) bool {
	plainJSON, err := crypto.Decrypt(secret.BackupCodesEncrypted, s.tfaEncKey)
	if err != nil {
		return false
	}
	var codes []string
	if err := json.Unmarshal(plainJSON, &codes); err != nil {
		return false
	}

	code = strings.TrimSpace(code)
	idx := -1
	for i, c := range codes {
		if c == code {
			idx = i
			break
		}
	}
	if idx == -1 {
		return false
	}
	// Remove consumed code
	remaining := append(codes[:idx], codes[idx+1:]...)
	remainingJSON, _ := json.Marshal(remaining)
	encNew, err := crypto.Encrypt(remainingJSON, s.tfaEncKey)
	if err != nil {
		return false
	}
	_ = s.tfaSecrets.UpdateBackupCodes(ctx, userID, encNew)
	return true
}

// =============================================================================
// Sessions
// =============================================================================

func (s *AuthService) ListSessions(ctx context.Context, userID uuid.UUID) ([]*repository.Session, error) {
	return s.sessions.ListByUser(ctx, userID)
}

func (s *AuthService) RevokeSession(ctx context.Context, userID, sessionID uuid.UUID, m RequestMeta) error {
	sess, err := s.sessions.GetByID(ctx, sessionID)
	if err != nil {
		return autherrors.New(autherrors.CodeNotFound, "session not found")
	}
	if sess.UserID != userID {
		return autherrors.New(autherrors.CodeForbidden, "cannot revoke another user's session")
	}
	if err := s.sessions.Revoke(ctx, sessionID); err != nil {
		return autherrors.Internal(err)
	}
	if sess.RefreshTokenID != nil {
		_ = s.refreshes.Revoke(ctx, *sess.RefreshTokenID, "session_revoked")
	}
	s.audit.SessionRevoked(ctx, userID, sessionID, m.RequestID)
	return nil
}
