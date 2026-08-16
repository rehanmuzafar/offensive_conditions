-- =============================================================================
-- public — monthly partition maintenance
-- =============================================================================
-- Every RANGE-partitioned table was created with hand-written partitions for
-- 2026-05 .. 2026-07 only. Once the clock passed 2026-08-01 every INSERT failed
-- with `no partition of relation "..." found for row`, which silently broke the
-- audit trail, login-attempt throttling, points history and — critically —
-- scoring.submissions, so no flag could be recorded.
--
-- This installs a maintenance function that creates any missing monthly
-- partitions, and runs it to cover a rolling window. Call it from cron (or
-- adopt pg_partman) so the window keeps moving:
--     SELECT public.ensure_monthly_partitions(18);
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_monthly_partitions(months_ahead INT DEFAULT 18)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    parent      RECORD;
    m           INT;
    start_ts    DATE;
    end_ts      DATE;
    part_name   TEXT;
    created     INT := 0;
BEGIN
    FOR parent IN
        SELECT n.nspname AS schema_name, c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'p'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    LOOP
        -- start one month back so a late-arriving row still lands somewhere
        FOR m IN -1 .. months_ahead LOOP
            start_ts  := date_trunc('month', CURRENT_DATE + (m || ' month')::INTERVAL)::DATE;
            end_ts    := (start_ts + INTERVAL '1 month')::DATE;
            part_name := format('%s_%s', parent.table_name, to_char(start_ts, 'YYYY_MM'));

            IF NOT EXISTS (
                SELECT 1 FROM pg_class pc
                JOIN pg_namespace pn ON pn.oid = pc.relnamespace
                WHERE pc.relname = part_name AND pn.nspname = parent.schema_name
            ) THEN
                EXECUTE format(
                    'CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
                    parent.schema_name, part_name,
                    parent.schema_name, parent.table_name,
                    start_ts, end_ts);
                created := created + 1;
            END IF;
        END LOOP;
    END LOOP;
    RETURN created;
END;
$$;

SELECT public.ensure_monthly_partitions(18);
