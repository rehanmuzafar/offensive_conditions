-- =============================================================================
-- ctf — show the local-currency figure by default
-- =============================================================================
-- 0019 defaulted this off, reasoning that the base price is what gets charged
-- so showing exactly that is never wrong. Testing against Safepay showed the
-- premise was false: the merchant account settles in PKR, so a fee quoted in
-- USD is converted by the gateway anyway — $15 arrived at the card as
-- PKR 4,157.31, at their rate, on a figure the payer never saw.
--
-- Pricing in PKR and showing the conversion is the honest arrangement. The
-- amount charged is the amount displayed, and a visitor from elsewhere still
-- gets a number in money they recognise, labelled as approximate because it is.
--
-- Existing rows are moved too. There is no event whose organiser deliberately
-- chose 'off' — the column is two days old and the value was a default.
-- =============================================================================

ALTER TABLE ctf.events ALTER COLUMN show_local_price SET DEFAULT true;
UPDATE ctf.events SET show_local_price = true;
