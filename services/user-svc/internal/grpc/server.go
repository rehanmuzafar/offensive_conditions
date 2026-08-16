// Package grpcserver implements the internal gRPC surface.
// The wire format is hand-rolled JSON-over-grpc for simplicity in this iteration;
// in production the .proto file is the source of truth and protoc-gen-go is used.
package grpcserver

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/offensive-conditions/user-svc/internal/follows"
	"github.com/offensive-conditions/user-svc/internal/friends"
	"github.com/offensive-conditions/user-svc/internal/profiles"
	"github.com/offensive-conditions/user-svc/internal/repository"
	"github.com/offensive-conditions/user-svc/internal/teams"
)

// =============================================================================
// Wire types (mirror the proto definitions)
// =============================================================================

type UserMetadata struct {
	UserID            string     `json:"user_id"`
	Username          string     `json:"username"`
	DisplayName       string     `json:"display_name"`
	CountryCode       string     `json:"country_code"`
	Tier              string     `json:"tier"`
	IsStaff           bool       `json:"is_staff"`
	AvatarURL         string     `json:"avatar_url"`
	Timezone          string     `json:"timezone"`
	LastSeenAt        *time.Time `json:"last_seen_at,omitempty"`
	ShowCountry       bool       `json:"show_country"`
	ShowOnLeaderboard bool       `json:"show_on_leaderboard"`
}

type Team struct {
	TeamID string `json:"team_id"`
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Role   string `json:"role"`
}

type GetUserMetadataRequest struct {
	UserID string `json:"user_id"`
}

type BatchGetUserMetadataRequest struct {
	UserIDs []string `json:"user_ids"`
}

type BatchGetUserMetadataResponse struct {
	Users map[string]UserMetadata `json:"users"`
}

type ResolveUsernamesRequest struct {
	UserIDs []string `json:"user_ids"`
}

type ResolveUsernamesResponse struct {
	Usernames map[string]string `json:"usernames"`
}

type GetTeamMembershipsRequest struct {
	UserID string `json:"user_id"`
}

type GetTeamMembershipsResponse struct {
	Teams []Team `json:"teams"`
}

type CheckBlockRequest struct {
	UserA string `json:"user_a"`
	UserB string `json:"user_b"`
}

type CheckBlockResponse struct {
	Blocked bool `json:"blocked"`
}

// =============================================================================
// Server
// =============================================================================

type Server struct {
	profiles *profiles.Service
	teams    *teams.Service
	friends  *friends.Service
	follows  *follows.Service
	log      zerolog.Logger
}

type Deps struct {
	Profiles *profiles.Service
	Teams    *teams.Service
	Friends  *friends.Service
	Follows  *follows.Service
	Log      zerolog.Logger
}

func New(d Deps) *Server {
	return &Server{
		profiles: d.Profiles,
		teams:    d.Teams,
		friends:  d.Friends,
		follows:  d.Follows,
		log:      d.Log,
	}
}

// =============================================================================
// gRPC method handlers
// =============================================================================

func (s *Server) GetUserMetadata(ctx context.Context, req *GetUserMetadataRequest) (*UserMetadata, error) {
	uid, err := uuid.Parse(req.UserID)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid user_id: %v", err)
	}
	p, err := s.profiles.Get(ctx, uid)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "user not found")
	}
	return profileToMetadata(p), nil
}

func (s *Server) BatchGetUserMetadata(ctx context.Context, req *BatchGetUserMetadataRequest) (*BatchGetUserMetadataResponse, error) {
	if len(req.UserIDs) == 0 {
		return &BatchGetUserMetadataResponse{Users: map[string]UserMetadata{}}, nil
	}
	if len(req.UserIDs) > 500 {
		return nil, status.Errorf(codes.InvalidArgument, "batch exceeds 500 ids")
	}
	ids := make([]uuid.UUID, 0, len(req.UserIDs))
	for _, s := range req.UserIDs {
		id, err := uuid.Parse(s)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}
	profiles, err := s.profiles.BatchGet(ctx, ids)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "lookup failed: %v", err)
	}
	out := &BatchGetUserMetadataResponse{Users: make(map[string]UserMetadata, len(profiles))}
	for id, p := range profiles {
		md := profileToMetadata(p)
		out.Users[id.String()] = *md
	}
	return out, nil
}

func (s *Server) ResolveUsernames(ctx context.Context, req *ResolveUsernamesRequest) (*ResolveUsernamesResponse, error) {
	if len(req.UserIDs) == 0 {
		return &ResolveUsernamesResponse{Usernames: map[string]string{}}, nil
	}
	if len(req.UserIDs) > 500 {
		return nil, status.Errorf(codes.InvalidArgument, "batch exceeds 500 ids")
	}
	ids := make([]uuid.UUID, 0, len(req.UserIDs))
	for _, s := range req.UserIDs {
		id, err := uuid.Parse(s)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}
	profiles, err := s.profiles.BatchGet(ctx, ids)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "lookup failed: %v", err)
	}
	out := &ResolveUsernamesResponse{Usernames: make(map[string]string, len(profiles))}
	for id, p := range profiles {
		out.Usernames[id.String()] = p.Username
	}
	return out, nil
}

func (s *Server) GetTeamMemberships(ctx context.Context, req *GetTeamMembershipsRequest) (*GetTeamMembershipsResponse, error) {
	uid, err := uuid.Parse(req.UserID)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid user_id: %v", err)
	}
	teamsList, err := s.teams.ListMyTeams(ctx, uid)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list teams failed: %v", err)
	}
	out := &GetTeamMembershipsResponse{Teams: make([]Team, 0, len(teamsList))}
	for _, t := range teamsList {
		role := "member"
		if t.OwnerID == uid {
			role = "owner"
		}
		out.Teams = append(out.Teams, Team{
			TeamID: t.ID.String(), Name: t.Name, Slug: t.Slug, Role: role,
		})
	}
	return out, nil
}

func (s *Server) CheckBlock(ctx context.Context, req *CheckBlockRequest) (*CheckBlockResponse, error) {
	a, err := uuid.Parse(req.UserA)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid user_a: %v", err)
	}
	b, err := uuid.Parse(req.UserB)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid user_b: %v", err)
	}
	blocked, err := s.friends.IsBlockedEither(ctx, a, b)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "lookup failed: %v", err)
	}
	return &CheckBlockResponse{Blocked: blocked}, nil
}

// =============================================================================
// gRPC registration (hand-rolled - in prod, protoc-gen-go generates this)
// =============================================================================

// Register attaches the server to a grpc.Server using JSON codec.
// IMPORTANT: clients must use the same JSON codec.
// In production this is replaced by the protoc-gen-go generated registration.
func Register(grpcServer *grpc.Server, s *Server) {
	grpcServer.RegisterService(&ServiceDesc, s)
}

// ServiceDesc describes the UserService RPCs via hand-rolled JSON marshaling.
var ServiceDesc = grpc.ServiceDesc{
	ServiceName: "offcon.user.v1.UserService",
	HandlerType: (*any)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "GetUserMetadata",
			Handler:    handleGetUserMetadata,
		},
		{
			MethodName: "BatchGetUserMetadata",
			Handler:    handleBatchGetUserMetadata,
		},
		{
			MethodName: "ResolveUsernames",
			Handler:    handleResolveUsernames,
		},
		{
			MethodName: "GetTeamMemberships",
			Handler:    handleGetTeamMemberships,
		},
		{
			MethodName: "CheckBlock",
			Handler:    handleCheckBlock,
		},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "user.proto",
}

func handleGetUserMetadata(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	in := new(GetUserMetadataRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(*Server).GetUserMetadata(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/offcon.user.v1.UserService/GetUserMetadata"}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(*Server).GetUserMetadata(ctx, req.(*GetUserMetadataRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func handleBatchGetUserMetadata(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	in := new(BatchGetUserMetadataRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(*Server).BatchGetUserMetadata(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/offcon.user.v1.UserService/BatchGetUserMetadata"}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(*Server).BatchGetUserMetadata(ctx, req.(*BatchGetUserMetadataRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func handleResolveUsernames(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	in := new(ResolveUsernamesRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(*Server).ResolveUsernames(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/offcon.user.v1.UserService/ResolveUsernames"}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(*Server).ResolveUsernames(ctx, req.(*ResolveUsernamesRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func handleGetTeamMemberships(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	in := new(GetTeamMembershipsRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(*Server).GetTeamMemberships(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/offcon.user.v1.UserService/GetTeamMemberships"}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(*Server).GetTeamMemberships(ctx, req.(*GetTeamMembershipsRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func handleCheckBlock(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	in := new(CheckBlockRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(*Server).CheckBlock(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/offcon.user.v1.UserService/CheckBlock"}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(*Server).CheckBlock(ctx, req.(*CheckBlockRequest))
	}
	return interceptor(ctx, in, info, handler)
}

// =============================================================================
// Helpers
// =============================================================================

func profileToMetadata(p *repository.Profile) *UserMetadata {
	md := &UserMetadata{
		UserID:            p.UserID.String(),
		Username:          p.Username,
		DisplayName:       p.DisplayName,
		Tier:              p.Tier,
		IsStaff:           p.IsStaff,
		AvatarURL:         p.AvatarURL,
		Timezone:          p.Timezone,
		ShowCountry:       p.Privacy.ShowCountry,
		ShowOnLeaderboard: p.Privacy.ShowOnLeaderboard,
	}
	if p.Privacy.ShowCountry {
		md.CountryCode = p.CountryCode
	}
	if p.LastSeenAt != nil {
		md.LastSeenAt = p.LastSeenAt
	}
	return md
}

// Ensure JSON encoder is referenced so it isn't tree-shaken (in case the codec is wired via init).
var _ = json.Marshal
