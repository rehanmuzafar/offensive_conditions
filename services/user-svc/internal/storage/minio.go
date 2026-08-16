package storage

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/rs/zerolog"
)

// Client wraps MinIO for avatar + GDPR export storage.
type Client struct {
	mc           *minio.Client
	avatarBucket string
	exportBucket string
	cdnBaseURL   string
	log          zerolog.Logger
}

type Config struct {
	Endpoint     string
	AccessKey    string
	SecretKey    string
	UseSSL       bool
	Region       string
	AvatarBucket string
	ExportBucket string
	CDNBaseURL   string // optional; if set, GetAvatarURL prefixes this
}

func New(cfg Config, log zerolog.Logger) (*Client, error) {
	mc, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}
	return &Client{
		mc:           mc,
		avatarBucket: cfg.AvatarBucket,
		exportBucket: cfg.ExportBucket,
		cdnBaseURL:   strings.TrimRight(cfg.CDNBaseURL, "/"),
		log:          log,
	}, nil
}

// EnsureBuckets creates buckets if they don't exist.
func (c *Client) EnsureBuckets(ctx context.Context) error {
	for _, b := range []string{c.avatarBucket, c.exportBucket} {
		exists, err := c.mc.BucketExists(ctx, b)
		if err != nil {
			return fmt.Errorf("check bucket %s: %w", b, err)
		}
		if !exists {
			if err := c.mc.MakeBucket(ctx, b, minio.MakeBucketOptions{}); err != nil {
				return fmt.Errorf("create bucket %s: %w", b, err)
			}
			c.log.Info().Str("bucket", b).Msg("created bucket")
		}
	}
	return nil
}

// =============================================================================
// Avatar uploads
// =============================================================================

// UploadAvatar uploads bytes to MinIO and returns (url, storage_key).
// Caller is responsible for validating size and content type.
func (c *Client) UploadAvatar(ctx context.Context, userID uuid.UUID, data []byte, contentType string) (string, string, error) {
	ext := extFromContentType(contentType)
	// Cache-busting key: prefix with user_id so we can delete by listing, but include random suffix
	// so the URL changes when the avatar changes (no need to bust CDN).
	suffix, err := randomHex(8)
	if err != nil {
		return "", "", err
	}
	key := fmt.Sprintf("avatars/%s/%s%s", userID.String(), suffix, ext)
	reader := bytes.NewReader(data)
	_, err = c.mc.PutObject(ctx, c.avatarBucket, key, reader, int64(len(data)), minio.PutObjectOptions{
		ContentType:  contentType,
		CacheControl: "public, max-age=31536000, immutable",
	})
	if err != nil {
		return "", "", fmt.Errorf("upload avatar: %w", err)
	}
	publicURL := c.avatarURL(key)
	return publicURL, key, nil
}

func (c *Client) avatarURL(key string) string {
	if c.cdnBaseURL != "" {
		return c.cdnBaseURL + "/" + key
	}
	// Fallback: object URL via the configured endpoint
	scheme := "https"
	if !c.mc.IsOnline() {
		// best-effort; we still build a URL
	}
	return fmt.Sprintf("%s://%s/%s/%s", scheme, c.mc.EndpointURL().Host, c.avatarBucket, key)
}

func (c *Client) DeleteAvatar(ctx context.Context, storageKey string) error {
	if storageKey == "" {
		return nil
	}
	return c.mc.RemoveObject(ctx, c.avatarBucket, storageKey, minio.RemoveObjectOptions{})
}

func extFromContentType(ct string) string {
	switch strings.ToLower(strings.TrimSpace(ct)) {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}

// =============================================================================
// GDPR exports
// =============================================================================

// UploadExport stores a ZIP for a data export job and returns the storage key.
func (c *Client) UploadExport(ctx context.Context, exportID uuid.UUID, body io.Reader, size int64) (string, error) {
	key := fmt.Sprintf("exports/%s.zip", exportID.String())
	_, err := c.mc.PutObject(ctx, c.exportBucket, key, body, size, minio.PutObjectOptions{
		ContentType: "application/zip",
	})
	if err != nil {
		return "", fmt.Errorf("upload export: %w", err)
	}
	return key, nil
}

// GetSignedExportURL returns a presigned URL valid for ttl.
func (c *Client) GetSignedExportURL(ctx context.Context, storageKey string, ttl time.Duration) (string, error) {
	if storageKey == "" {
		return "", fmt.Errorf("empty storage key")
	}
	// Suggest a download filename to the browser
	headers := url.Values{}
	headers.Set("response-content-disposition",
		fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(storageKey)))
	u, err := c.mc.PresignedGetObject(ctx, c.exportBucket, storageKey, ttl, headers)
	if err != nil {
		return "", fmt.Errorf("presign: %w", err)
	}
	return u.String(), nil
}

func (c *Client) DeleteExport(ctx context.Context, storageKey string) error {
	if storageKey == "" {
		return nil
	}
	return c.mc.RemoveObject(ctx, c.exportBucket, storageKey, minio.RemoveObjectOptions{})
}

func randomHex(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
