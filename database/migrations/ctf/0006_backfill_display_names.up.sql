-- =============================================================================
-- ctf — backfill participant display names
-- =============================================================================
-- display_name is captured at registration from the JWT, but tokens only began
-- carrying `username` once auth was updated. Rows created before that have no
-- name and fall back to "player-<8 hex>" on the scoreboard.
--
-- As with the profile trigger, this reads auth directly because both schemas
-- live in one database here. It is a one-off repair, not an ongoing coupling.
-- =============================================================================

UPDATE ctf.event_participants p
   SET display_name = u.username
  FROM auth.users u
 WHERE p.user_id = u.id
   AND p.display_name IS NULL
   AND p.participant_type = 'user';
