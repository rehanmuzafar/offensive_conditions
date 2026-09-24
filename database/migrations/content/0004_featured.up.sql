-- =============================================================================
-- content.featured — admin-curated "featured" lists for the marketing surfaces
-- =============================================================================
-- A row says: this item is featured on this surface, at this position. item_id
-- is a machine id (content) or a CTF event id (ctf) — stored opaque here, since
-- the admin UI only ever lets a real, existing item be picked. An empty surface
-- means the corresponding public page falls back to showing everything, so the
-- curation is an optional overlay rather than a gate.
CREATE TABLE IF NOT EXISTS content.featured (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    surface     text        NOT NULL,
    item_type   text        NOT NULL,
    item_id     uuid        NOT NULL,
    rank        integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (surface, item_id)
);
CREATE INDEX IF NOT EXISTS idx_featured_surface_rank ON content.featured (surface, rank);
