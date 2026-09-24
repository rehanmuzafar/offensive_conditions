-- =============================================================================
-- ctf — showing the fee in a viewer's own currency is a per-event choice
-- =============================================================================
-- 0018's price endpoint converted for everyone, which is right for an event
-- priced in PKR for a Pakistani audience and wrong for one priced in USD for
-- an international one. Telling a player in Karachi that a $15 entry is "about
-- Rs 4,150" helps. Telling everyone at an international event that the price is
-- "about" something in their own currency, while charging dollars, is noise
-- around a number that was already clear.
--
-- Default false: the base price is what the organiser set and what will be
-- charged, so showing exactly that is the answer that is never wrong. An
-- organiser pricing locally turns it on deliberately.
-- =============================================================================

ALTER TABLE ctf.events
    ADD COLUMN IF NOT EXISTS show_local_price BOOLEAN NOT NULL DEFAULT false;
