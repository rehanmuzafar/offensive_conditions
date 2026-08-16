// Package search implements user search by username + country.
package search

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	uerrors "github.com/offensive-conditions/user-svc/internal/errors"
	"github.com/offensive-conditions/user-svc/internal/repository"
)

type Service struct {
	profileRepo repository.ProfileRepository
	rdb         *redis.Client
	log         zerolog.Logger

	countryCacheTTL time.Duration
}

type Deps struct {
	ProfileRepo repository.ProfileRepository
	Redis       *redis.Client
	Log         zerolog.Logger
}

func New(d Deps) *Service {
	return &Service{
		profileRepo:     d.ProfileRepo,
		rdb:             d.Redis,
		log:             d.Log,
		countryCacheTTL: time.Hour,
	}
}

// SearchUsers returns profiles matching prefix (case-insensitive) and country filter.
// Limit defaults to 25, max 100.
func (s *Service) SearchUsers(ctx context.Context, prefix, country string, limit int) ([]*repository.Profile, error) {
	prefix = strings.TrimSpace(prefix)
	if len(prefix) < 2 {
		return nil, uerrors.New(uerrors.CodeValidation, "search query must be at least 2 characters")
	}
	if len(prefix) > 32 {
		return nil, uerrors.New(uerrors.CodeValidation, "search query too long")
	}
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	results, err := s.profileRepo.SearchByUsername(ctx, prefix, country, limit)
	if err != nil {
		return nil, uerrors.Internal(err)
	}
	return results, nil
}

// CountByCountry returns total profiles by country code (cached 1h).
func (s *Service) CountByCountry(ctx context.Context, code string) (int, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) != 2 {
		return 0, uerrors.New(uerrors.CodeValidation, "country_code must be ISO alpha-2")
	}

	key := "country_count:" + code
	if s.rdb != nil {
		val, err := s.rdb.Get(ctx, key).Result()
		if err == nil {
			n, _ := strconv.Atoi(val)
			return n, nil
		}
	}

	n, err := s.profileRepo.CountByCountry(ctx, code)
	if err != nil {
		return 0, uerrors.Internal(err)
	}

	if s.rdb != nil {
		_ = s.rdb.Set(ctx, key, fmt.Sprintf("%d", n), s.countryCacheTTL).Err()
	}
	return n, nil
}
