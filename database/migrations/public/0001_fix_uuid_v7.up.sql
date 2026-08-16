-- =============================================================================
-- public — fix uuid_generate_v7()
-- =============================================================================
-- The original built a full 16-byte buffer, wrote the 6 timestamp bytes into
-- it, and then CONCATENATED 10 more random bytes — producing a 26-byte value
-- that Postgres rejects as a UUID. Every INSERT into a table defaulting to this
-- function failed, including scoring.submissions, ctf.event_solves and
-- audit.log, so flag submissions and the audit trail could not be written.
--
-- The timestamp prefix must be 6 bytes, not 16, so that 6 + 10 = 16.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.uuid_generate_v7()
RETURNS UUID AS $$
DECLARE
    unix_ts_ms BIGINT;
    uuid_bytes BYTEA;
BEGIN
    unix_ts_ms := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
    uuid_bytes := gen_random_bytes(10);

    -- version 7 in the high nibble of byte 6 of the final UUID
    uuid_bytes := SET_BYTE(uuid_bytes, 0, (GET_BYTE(uuid_bytes, 0) & 15) | 112);
    -- RFC 4122 variant in byte 8 of the final UUID
    uuid_bytes := SET_BYTE(uuid_bytes, 2, (GET_BYTE(uuid_bytes, 2) & 63) | 128);

    RETURN ENCODE(
        SET_BYTE(SET_BYTE(SET_BYTE(SET_BYTE(SET_BYTE(SET_BYTE(
            '\x000000000000'::BYTEA,          -- 6 bytes of timestamp
            0, ((unix_ts_ms >> 40) & 255)::INT),
            1, ((unix_ts_ms >> 32) & 255)::INT),
            2, ((unix_ts_ms >> 24) & 255)::INT),
            3, ((unix_ts_ms >> 16) & 255)::INT),
            4, ((unix_ts_ms >>  8) & 255)::INT),
            5, ( unix_ts_ms        & 255)::INT)
        || uuid_bytes,                        -- + 10 random = 16 bytes
        'hex'
    )::UUID;
END;
$$ LANGUAGE plpgsql VOLATILE;
