-- =============================================================================
-- ctf — team chat
-- =============================================================================
-- Scoped by participant, which is the team on a team event and the individual
-- on a solo one — the same key progress uses, so a message can never reach a
-- team it does not belong to.
--
-- `username` is denormalised: the chat pane renders hundreds of rows and must
-- not fan out a user lookup per message. It records the name as it was when the
-- message was sent, which is also what you want in a transcript.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ctf.chat_messages (
    id             UUID PRIMARY KEY DEFAULT public.uuid_generate_v7(),
    event_id       UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES ctf.event_participants(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL,
    username       TEXT NOT NULL DEFAULT '',

    body           TEXT NOT NULL,
    edited_at      TIMESTAMPTZ,
    -- Soft delete: a removed message leaves a tombstone so the thread does not
    -- silently reshuffle for everyone else mid-conversation.
    deleted_at     TIMESTAMPTZ,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_chat_body_len CHECK (char_length(body) BETWEEN 1 AND 2000)
);

-- The only read pattern: newest-first within one team.
CREATE INDEX IF NOT EXISTS idx_chat_participant_time
    ON ctf.chat_messages (participant_id, created_at DESC);
