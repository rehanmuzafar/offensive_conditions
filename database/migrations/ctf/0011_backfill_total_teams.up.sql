-- =============================================================================
-- ctf — repair events.total_teams
-- =============================================================================
-- The counter was maintained by hand and the two sides disagreed. Only the
-- legacy whole-team registration incremented it, while unregistering
-- decremented it for *any* team-linked participant — including the per-player
-- rows that never added to it. Since per-player registration is the path the
-- product actually uses, the number drifted down and events showed 0 teams (or
-- fewer than zero over time) while teams were plainly entered.
--
-- The service now derives it from a DISTINCT count on every change. This puts
-- existing rows back in step; without it the stale value would sit there until
-- somebody happened to register or withdraw.
-- =============================================================================

UPDATE ctf.events e
SET total_teams = COALESCE(sub.n, 0)
FROM (
    SELECT ev.id AS event_id,
           COUNT(DISTINCT p.team_id) AS n
    FROM ctf.events ev
    LEFT JOIN ctf.event_participants p
           ON p.event_id = ev.id AND p.team_id IS NOT NULL
    GROUP BY ev.id
) AS sub
WHERE e.id = sub.event_id
  AND e.total_teams IS DISTINCT FROM COALESCE(sub.n, 0);
