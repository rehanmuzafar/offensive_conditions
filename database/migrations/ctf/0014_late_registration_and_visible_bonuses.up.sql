-- =============================================================================
-- ctf — registration that can stay open, and bonuses that can be shown
-- =============================================================================
-- 1. Late registration
--
-- chk_ctf_timing required registration_ends_at <= starts_at, so the platform
-- forced every event to close its doors before it began. Real events do not
-- work that way: a team turns up an hour in, someone's payment clears late, an
-- organiser decides to keep taking entries for the first day of a weekend CTF.
--
-- The rule that actually matters is that you cannot join an event that is over,
-- so registration may now close any time up to the end. Ordering within the
-- registration window is still enforced, and starts_at < ends_at still holds.
--
-- 2. Visible bonuses
--
-- An organiser awarding points sometimes wants the board to say so — "+50,
-- reported a broken challenge" — and sometimes wants the number to move with no
-- announcement, which is the honest way to apply a quiet correction. Both are
-- legitimate, so it is a per-adjustment choice rather than a policy.
--
-- The points count either way. `visible` only decides whether the reason is
-- published beside the team's score.
-- =============================================================================

ALTER TABLE ctf.events DROP CONSTRAINT IF EXISTS chk_ctf_timing;
ALTER TABLE ctf.events ADD CONSTRAINT chk_ctf_timing
    CHECK (
        registration_starts_at < registration_ends_at
        AND registration_ends_at <= ends_at
        AND starts_at < ends_at
    );

ALTER TABLE ctf.score_adjustments
    ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT false;

-- The reason stops being mandatory: a quiet correction has nothing to announce,
-- and forcing a sentence nobody reads produces "asdf" rather than an audit
-- trail. It stays required for anything published — enforced in the service,
-- where the visibility is known.
ALTER TABLE ctf.score_adjustments ALTER COLUMN reason DROP NOT NULL;

COMMENT ON COLUMN ctf.score_adjustments.visible IS
    'Show this adjustment and its reason on the public scoreboard. Points count either way.';
