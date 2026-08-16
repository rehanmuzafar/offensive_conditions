-- =============================================================================
-- Writeup Schema — Initial Migration
-- =============================================================================
-- User-submitted machine/challenge solutions (post-retirement only)
-- =============================================================================

SET search_path = writeup, public;

-- ---------------------------------------------------------------------------
-- Writeups
-- ---------------------------------------------------------------------------
CREATE TABLE writeup.writeups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL,
    -- What it documents
    content_type    TEXT NOT NULL,                         -- machine|challenge|dojo_level|pro_lab
    content_id      UUID NOT NULL,
    -- Content
    title           TEXT NOT NULL,
    slug            TEXT NOT NULL,
    summary         TEXT,
    content_markdown TEXT NOT NULL,
    content_html    TEXT,                                  -- Pre-rendered cache
    language        TEXT NOT NULL DEFAULT 'en',            -- en|ur|ar|...
    -- Format
    word_count      INT,
    read_time_minutes INT,
    has_video       BOOLEAN NOT NULL DEFAULT FALSE,
    video_url       TEXT,
    cover_image_url TEXT,
    -- Tags
    tags            TEXT[] DEFAULT '{}',
    techniques_used TEXT[] DEFAULT '{}',                   -- e.g. ['sql_injection', 'privilege_escalation']
    tools_used      TEXT[] DEFAULT '{}',                   -- e.g. ['nmap', 'burpsuite', 'metasploit']
    -- Moderation
    status          TEXT NOT NULL DEFAULT 'pending',       -- pending|approved|rejected|archived
    moderator_id    UUID,
    rejection_reason TEXT,
    moderated_at    TIMESTAMPTZ,
    is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
    featured_at     TIMESTAMPTZ,
    featured_by     UUID,
    -- Stats
    view_count      INT NOT NULL DEFAULT 0,
    unique_view_count INT NOT NULL DEFAULT 0,
    upvote_count    INT NOT NULL DEFAULT 0,
    downvote_count  INT NOT NULL DEFAULT 0,
    score           INT NOT NULL DEFAULT 0,
    bookmark_count  INT NOT NULL DEFAULT 0,
    comment_count   INT NOT NULL DEFAULT 0,
    rating_avg      NUMERIC(3,2),
    rating_count    INT NOT NULL DEFAULT 0,
    -- Anti-spoiler
    contains_full_solution BOOLEAN NOT NULL DEFAULT TRUE,
    spoiler_warning_shown  BOOLEAN NOT NULL DEFAULT TRUE,
    -- Metadata
    published_at    TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT chk_writeup_content_type CHECK (content_type IN ('machine','challenge','dojo_level','pro_lab')),
    CONSTRAINT chk_writeup_status CHECK (status IN ('pending','approved','rejected','archived'))
);

CREATE INDEX idx_writeups_content ON writeup.writeups (content_type, content_id, score DESC)
    WHERE status = 'approved' AND deleted_at IS NULL;
CREATE INDEX idx_writeups_author ON writeup.writeups (author_id, published_at DESC);
CREATE INDEX idx_writeups_status ON writeup.writeups (status, created_at) WHERE status = 'pending';
CREATE INDEX idx_writeups_featured ON writeup.writeups (featured_at DESC NULLS LAST) WHERE is_featured = TRUE;
CREATE INDEX idx_writeups_published ON writeup.writeups (published_at DESC) WHERE status = 'approved';
CREATE INDEX idx_writeups_tags ON writeup.writeups USING GIN (tags) WHERE status = 'approved';
CREATE INDEX idx_writeups_title_trgm ON writeup.writeups USING GIN (title gin_trgm_ops) WHERE status = 'approved';

CREATE TRIGGER trg_writeups_updated_at
    BEFORE UPDATE ON writeup.writeups
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Writeup Votes
-- ---------------------------------------------------------------------------
CREATE TABLE writeup.votes (
    user_id         UUID NOT NULL,
    writeup_id      UUID NOT NULL REFERENCES writeup.writeups(id) ON DELETE CASCADE,
    vote_type       SMALLINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, writeup_id),
    CONSTRAINT chk_writeup_vote CHECK (vote_type IN (1, -1))
);

CREATE INDEX idx_writeup_votes_writeup ON writeup.votes (writeup_id);

-- ---------------------------------------------------------------------------
-- Writeup Bookmarks
-- ---------------------------------------------------------------------------
CREATE TABLE writeup.bookmarks (
    user_id         UUID NOT NULL,
    writeup_id      UUID NOT NULL REFERENCES writeup.writeups(id) ON DELETE CASCADE,
    collection_name TEXT DEFAULT 'default',
    note            TEXT,
    bookmarked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, writeup_id)
);

CREATE INDEX idx_bookmarks_user_collection ON writeup.bookmarks (user_id, collection_name);

-- ---------------------------------------------------------------------------
-- Writeup Comments (lightweight, no nested forum)
-- ---------------------------------------------------------------------------
CREATE TABLE writeup.comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    writeup_id      UUID NOT NULL REFERENCES writeup.writeups(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL,
    parent_comment_id UUID REFERENCES writeup.comments(id),
    content_markdown TEXT NOT NULL,
    is_edited       BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    upvote_count    INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_writeup_comments_writeup ON writeup.comments (writeup_id, created_at) WHERE is_deleted = FALSE;
CREATE INDEX idx_writeup_comments_parent ON writeup.comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;

CREATE TRIGGER trg_writeup_comments_updated_at
    BEFORE UPDATE ON writeup.comments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
