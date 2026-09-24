-- =============================================================================
-- content — how a player actually reaches a machine
-- =============================================================================
-- Every machine was assumed to be something the orchestrator spins up: the
-- table requires an image_ref and a backend, and the detail page offers a
-- Spawn button. That only covers one of the three ways this platform needs to
-- ship a box.
--
--   spawn        the orchestrator brings up a container or VM per player.
--                Needs image_ref; this is what already existed.
--
--   static_host  one always-on host — a VPS with a public IP — that everyone
--                attacks. Nothing to spawn, and no per-player instance: the
--                address is the machine.
--
--   download     a boot2root image the player runs on their own hardware, the
--                way VulnHub ships. Nothing to spawn and nothing to connect to
--                on our side; what we host is the file.
--
-- `backend` is deliberately left alone. It answers "container or VM?", which is
-- a provisioning question and only means anything for `spawn`. Overloading it
-- with delivery would make every orchestrator query care about rows it can
-- never provision.
--
-- image_ref and image_version become nullable, because two of the three kinds
-- have no image at all. The CHECK below keeps each kind honest about what it
-- does need.
-- =============================================================================

ALTER TABLE content.machines
    ADD COLUMN IF NOT EXISTS delivery            text NOT NULL DEFAULT 'spawn',
    -- static_host: what a player points their tools at.
    ADD COLUMN IF NOT EXISTS static_host         text,
    -- download: the artefact and enough metadata to verify it.
    ADD COLUMN IF NOT EXISTS download_url        text,
    ADD COLUMN IF NOT EXISTS download_sha256     text,
    ADD COLUMN IF NOT EXISTS download_size_bytes bigint,
    ADD COLUMN IF NOT EXISTS download_format     text;

ALTER TABLE content.machines ALTER COLUMN image_ref     DROP NOT NULL;
ALTER TABLE content.machines ALTER COLUMN image_version DROP NOT NULL;

ALTER TABLE content.machines DROP CONSTRAINT IF EXISTS chk_machine_delivery;
ALTER TABLE content.machines ADD CONSTRAINT chk_machine_delivery
    CHECK (delivery IN ('spawn', 'static_host', 'download'));

-- Each kind must carry the one thing it cannot work without. Without this a
-- machine can be saved as a download with no file, and the only place that
-- surfaces is a player clicking a dead button.
ALTER TABLE content.machines DROP CONSTRAINT IF EXISTS chk_machine_delivery_fields;
ALTER TABLE content.machines ADD CONSTRAINT chk_machine_delivery_fields
    CHECK (
        (delivery = 'spawn'       AND image_ref IS NOT NULL)
     OR (delivery = 'static_host' AND static_host IS NOT NULL)
     OR (delivery = 'download'    AND download_url IS NOT NULL)
    );

COMMENT ON COLUMN content.machines.delivery IS
    'spawn = orchestrator provisions per player; static_host = one shared always-on host; download = boot2root image the player runs themselves.';
COMMENT ON COLUMN content.machines.static_host IS
    'Host or IP players attack directly. Only for delivery = static_host.';
COMMENT ON COLUMN content.machines.download_sha256 IS
    'So a player can verify the image they downloaded is the one we published.';
