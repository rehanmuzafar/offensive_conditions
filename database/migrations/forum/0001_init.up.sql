-- =============================================================================
-- Forum Schema — Initial Migration
-- =============================================================================
-- Discussion threads, posts, votes, reputation
-- =============================================================================

SET search_path = forum, public;

-- ---------------------------------------------------------------------------
-- Forum Categories
-- ---------------------------------------------------------------------------
CREATE TABLE forum.categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    icon            TEXT,
    parent_id       UUID REFERENCES forum.categories(id),
    sort_order      INT NOT NULL DEFAULT 0,
    -- Permissions
    required_tier   TEXT NOT NULL DEFAULT 'free',
    is_locked       BOOLEAN NOT NULL DEFAULT FALSE,        -- Read-only for non-admins
    is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
    -- Stats
    thread_count    INT NOT NULL DEFAULT 0,
    post_count      INT NOT NULL DEFAULT 0,
    last_post_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forum_categories_parent ON forum.categories (parent_id);
CREATE INDEX idx_forum_categories_visible ON forum.categories (sort_order) WHERE is_hidden = FALSE;

-- Seed default categories
INSERT INTO forum.categories (slug, name, description, sort_order) VALUES
    ('announcements', 'Announcements', 'Official platform announcements', 1),
    ('general', 'General Discussion', 'Anything cybersecurity', 2),
    ('machines', 'Machines', 'Machine discussion (post-retirement only)', 3),
    ('challenges', 'Challenges', 'Challenge discussion', 4),
    ('learning', 'Learning Paths', 'Study group, tips, recommendations', 5),
    ('ctf', 'CTF Discussion', 'Event discussion and team finding', 6),
    ('career', 'Career & Certs', 'Job, certification, career advice', 7),
    ('feedback', 'Feedback & Bugs', 'Platform feedback', 8),
    ('introductions', 'Introductions', 'Say hello!', 9);

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------
CREATE TABLE forum.threads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id     UUID NOT NULL REFERENCES forum.categories(id),
    author_id       UUID NOT NULL,
    title           TEXT NOT NULL,
    slug            TEXT NOT NULL,
    -- Content stored in first post
    -- State
    status          TEXT NOT NULL DEFAULT 'open',          -- open|closed|locked|archived|deleted
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    is_announcement BOOLEAN NOT NULL DEFAULT FALSE,
    is_solved       BOOLEAN NOT NULL DEFAULT FALSE,
    solved_post_id  UUID,                                  -- Post marked as answer
    -- Stats
    view_count      INT NOT NULL DEFAULT 0,
    reply_count     INT NOT NULL DEFAULT 0,
    unique_posters  INT NOT NULL DEFAULT 1,
    last_post_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_post_user_id UUID,
    -- Linked content (optional)
    related_machine_id UUID,
    related_challenge_id UUID,
    -- Metadata
    metadata        JSONB DEFAULT '{}'::JSONB,
    tags            TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT chk_thread_status CHECK (status IN ('open','closed','locked','archived','deleted'))
);

CREATE INDEX idx_threads_category ON forum.threads (category_id, last_post_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_threads_author ON forum.threads (author_id, created_at DESC);
CREATE INDEX idx_threads_pinned ON forum.threads (category_id, is_pinned DESC, last_post_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_threads_machine ON forum.threads (related_machine_id) WHERE related_machine_id IS NOT NULL;
CREATE INDEX idx_threads_title_trgm ON forum.threads USING GIN (title gin_trgm_ops);
CREATE INDEX idx_threads_tags ON forum.threads USING GIN (tags);

CREATE TRIGGER trg_threads_updated_at
    BEFORE UPDATE ON forum.threads
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------
CREATE TABLE forum.posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id       UUID NOT NULL REFERENCES forum.threads(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL,
    parent_post_id  UUID REFERENCES forum.posts(id),       -- For threaded replies
    -- Content
    content_markdown TEXT NOT NULL,
    content_html    TEXT,                                  -- Pre-rendered cache
    -- Status
    is_first_post   BOOLEAN NOT NULL DEFAULT FALSE,        -- The OP
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    is_edited       BOOLEAN NOT NULL DEFAULT FALSE,
    edit_count      INT NOT NULL DEFAULT 0,
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    -- Voting
    upvote_count    INT NOT NULL DEFAULT 0,
    downvote_count  INT NOT NULL DEFAULT 0,
    score           INT NOT NULL DEFAULT 0,                -- upvote_count - downvote_count
    -- Mentions
    mentioned_users UUID[] DEFAULT '{}',
    -- Spoilers
    contains_spoilers BOOLEAN NOT NULL DEFAULT FALSE,
    -- Metadata
    ip_address      INET,
    user_agent      TEXT,
    edited_at       TIMESTAMPTZ,
    edited_by       UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      UUID
);

CREATE INDEX idx_posts_thread ON forum.posts (thread_id, created_at) WHERE is_deleted = FALSE;
CREATE INDEX idx_posts_author ON forum.posts (author_id, created_at DESC) WHERE is_deleted = FALSE;
CREATE INDEX idx_posts_parent ON forum.posts (parent_post_id) WHERE parent_post_id IS NOT NULL;
CREATE INDEX idx_posts_score ON forum.posts (thread_id, score DESC) WHERE is_deleted = FALSE;

-- ---------------------------------------------------------------------------
-- Post Votes
-- ---------------------------------------------------------------------------
CREATE TABLE forum.post_votes (
    user_id         UUID NOT NULL,
    post_id         UUID NOT NULL REFERENCES forum.posts(id) ON DELETE CASCADE,
    vote_type       SMALLINT NOT NULL,                     -- 1 (up) or -1 (down)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, post_id),
    CONSTRAINT chk_vote_type CHECK (vote_type IN (1, -1))
);

CREATE INDEX idx_post_votes_post ON forum.post_votes (post_id);

-- ---------------------------------------------------------------------------
-- Thread Subscriptions (notifications)
-- ---------------------------------------------------------------------------
CREATE TABLE forum.thread_subscriptions (
    user_id         UUID NOT NULL,
    thread_id       UUID NOT NULL REFERENCES forum.threads(id) ON DELETE CASCADE,
    notification_level TEXT NOT NULL DEFAULT 'all',        -- all|mentions|none
    subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, thread_id),
    CONSTRAINT chk_notif_level CHECK (notification_level IN ('all','mentions','none'))
);

CREATE INDEX idx_subscriptions_user ON forum.thread_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- User Reputation (forum-specific)
-- ---------------------------------------------------------------------------
CREATE TABLE forum.user_reputation (
    user_id         UUID PRIMARY KEY,
    total_reputation INT NOT NULL DEFAULT 0,
    upvotes_received INT NOT NULL DEFAULT 0,
    downvotes_received INT NOT NULL DEFAULT 0,
    posts_count     INT NOT NULL DEFAULT 0,
    threads_count   INT NOT NULL DEFAULT 0,
    accepted_answers INT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reputation_total ON forum.user_reputation (total_reputation DESC);

CREATE TRIGGER trg_user_reputation_updated_at
    BEFORE UPDATE ON forum.user_reputation
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Reports (user-flagged content)
-- ---------------------------------------------------------------------------
CREATE TABLE forum.reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID NOT NULL,
    -- Reported entity
    entity_type     TEXT NOT NULL,                         -- post|thread|user
    entity_id       UUID NOT NULL,
    -- Reason
    reason          TEXT NOT NULL,                         -- spam|abuse|spoiler|off_topic|other
    description     TEXT,
    -- Resolution
    status          TEXT NOT NULL DEFAULT 'pending',       -- pending|reviewing|resolved|dismissed
    handler_id      UUID,
    resolution      TEXT,
    handled_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_report_entity CHECK (entity_type IN ('post','thread','user')),
    CONSTRAINT chk_report_status CHECK (status IN ('pending','reviewing','resolved','dismissed'))
);

CREATE INDEX idx_reports_status ON forum.reports (status, created_at) WHERE status IN ('pending','reviewing');
CREATE INDEX idx_reports_entity ON forum.reports (entity_type, entity_id);
