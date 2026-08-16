-- =============================================================================
-- ctf — per-team challenge progress and assignment
-- =============================================================================
-- Without this a team has no way to coordinate: five people burn hours on the
-- same challenge because nobody can see who picked up what. One row per
-- (challenge, participant) — the participant is the team on a team event and
-- the individual on a solo one, so the same table serves both.
--
-- `status` is what teammates see; `assigned_to_user_id` is who owns it.
-- `updated_by_user_id` records who last changed it so the UI can say
-- "marked in progress by alice".
-- =============================================================================

CREATE TABLE IF NOT EXISTS ctf.challenge_progress (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v7(),
    event_id            UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
    challenge_id        UUID NOT NULL REFERENCES ctf.event_challenges(id) ON DELETE CASCADE,
    participant_id      UUID NOT NULL REFERENCES ctf.event_participants(id) ON DELETE CASCADE,

    status              TEXT NOT NULL DEFAULT 'untouched',
    note                TEXT,

    assigned_to_user_id UUID,
    assigned_by_user_id UUID,
    assigned_at         TIMESTAMPTZ,

    updated_by_user_id  UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_progress_status
        CHECK (status IN ('untouched','in_progress','need_help','done')),
    -- One state per challenge per team; upserts key on this.
    CONSTRAINT uq_progress_challenge_participant UNIQUE (challenge_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_participant
    ON ctf.challenge_progress (participant_id, status);
CREATE INDEX IF NOT EXISTS idx_progress_event
    ON ctf.challenge_progress (event_id);
CREATE INDEX IF NOT EXISTS idx_progress_assignee
    ON ctf.challenge_progress (assigned_to_user_id)
    WHERE assigned_to_user_id IS NOT NULL;
