-- =============================================================================
-- Content Schema — Initial Migration
-- =============================================================================
-- Handles: machines, challenges, learning paths, dojo modules/levels, tags
-- =============================================================================

SET search_path = content, public;

-- ---------------------------------------------------------------------------
-- Categories (taxonomy)
-- ---------------------------------------------------------------------------
CREATE TABLE content.categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    icon            TEXT,
    color_hex       CHAR(7),
    parent_id       UUID REFERENCES content.categories(id),
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_categories_parent ON content.categories (parent_id);

-- Seed core categories
INSERT INTO content.categories (slug, name, sort_order) VALUES
    ('web', 'Web Exploitation', 1),
    ('pwn', 'Binary Exploitation', 2),
    ('crypto', 'Cryptography', 3),
    ('reverse', 'Reverse Engineering', 4),
    ('forensics', 'Forensics', 5),
    ('osint', 'OSINT', 6),
    ('misc', 'Miscellaneous', 7),
    ('network', 'Network', 8),
    ('mobile', 'Mobile', 9),
    ('cloud', 'Cloud Security', 10),
    ('ad', 'Active Directory', 11),
    ('hardware', 'Hardware', 12);

-- ---------------------------------------------------------------------------
-- Tags (free-form labels)
-- ---------------------------------------------------------------------------
CREATE TABLE content.tags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    usage_count     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tags_slug ON content.tags (slug);
CREATE INDEX idx_tags_usage ON content.tags (usage_count DESC);

-- ---------------------------------------------------------------------------
-- Machines (HTB-style boxes)
-- ---------------------------------------------------------------------------
CREATE TABLE content.machines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    -- Classification
    os              TEXT NOT NULL,                         -- linux|windows|other
    difficulty      TEXT NOT NULL,                         -- very_easy|easy|medium|hard|insane
    category_id     UUID REFERENCES content.categories(id),
    -- Lab specs
    backend         TEXT NOT NULL,                         -- container|vm
    image_ref       TEXT NOT NULL,                         -- harbor.offensiveconditions.org/machines/<name>:<version>
    image_version   TEXT NOT NULL,
    cpu_request     TEXT NOT NULL DEFAULT '500m',          -- K8s notation
    memory_request  TEXT NOT NULL DEFAULT '512Mi',
    cpu_limit       TEXT NOT NULL DEFAULT '1000m',
    memory_limit    TEXT NOT NULL DEFAULT '1Gi',
    disk_gb         INT NOT NULL DEFAULT 10,
    expected_ports  INT[] DEFAULT '{}',                    -- e.g. {22,80,443}
    -- Scoring
    base_user_points INT NOT NULL DEFAULT 0,               -- Points for user flag
    base_root_points INT NOT NULL DEFAULT 0,               -- Points for root flag
    base_challenge_points INT NOT NULL DEFAULT 0,          -- Sum if single-flag
    -- Stats (denormalized; updated by background jobs)
    total_user_owns  INT NOT NULL DEFAULT 0,
    total_root_owns  INT NOT NULL DEFAULT 0,
    avg_user_solve_minutes INT,
    avg_root_solve_minutes INT,
    rating_avg       NUMERIC(3,2),
    rating_count     INT NOT NULL DEFAULT 0,
    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'draft',         -- draft|review|active|retired|archived
    creator_id      UUID,                                  -- references auth.users.id
    reviewer_id     UUID,
    released_at     TIMESTAMPTZ,
    retired_at      TIMESTAMPTZ,
    -- Tier gating
    required_tier   TEXT NOT NULL DEFAULT 'free',          -- free|vip|vip_plus
    -- Content
    cover_image_url TEXT,
    intro_markdown  TEXT,                                  -- Visible to all
    walkthrough_markdown TEXT,                             -- Only visible after retired
    has_user_flag   BOOLEAN NOT NULL DEFAULT TRUE,
    has_root_flag   BOOLEAN NOT NULL DEFAULT TRUE,
    -- Metadata
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_machine_os CHECK (os IN ('linux','windows','other','bsd','macos')),
    CONSTRAINT chk_machine_difficulty CHECK (difficulty IN ('very_easy','easy','medium','hard','insane')),
    CONSTRAINT chk_machine_backend CHECK (backend IN ('container','vm')),
    CONSTRAINT chk_machine_status CHECK (status IN ('draft','review','active','retired','archived')),
    CONSTRAINT chk_machine_tier CHECK (required_tier IN ('free','vip','vip_plus')),
    CONSTRAINT chk_machine_slug CHECK (slug ~ '^[a-z0-9-]{2,64}$')
);

CREATE INDEX idx_machines_status ON content.machines (status);
CREATE INDEX idx_machines_difficulty ON content.machines (difficulty) WHERE status = 'active';
CREATE INDEX idx_machines_os ON content.machines (os) WHERE status = 'active';
CREATE INDEX idx_machines_category ON content.machines (category_id);
CREATE INDEX idx_machines_released ON content.machines (released_at DESC) WHERE status = 'active';
CREATE INDEX idx_machines_creator ON content.machines (creator_id);
CREATE INDEX idx_machines_name_trgm ON content.machines USING GIN (name gin_trgm_ops);

CREATE TRIGGER trg_machines_updated_at
    BEFORE UPDATE ON content.machines
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Machine Tags (M:N)
-- ---------------------------------------------------------------------------
CREATE TABLE content.machine_tags (
    machine_id      UUID NOT NULL REFERENCES content.machines(id) ON DELETE CASCADE,
    tag_id          UUID NOT NULL REFERENCES content.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (machine_id, tag_id)
);

CREATE INDEX idx_machine_tags_tag ON content.machine_tags (tag_id);

-- ---------------------------------------------------------------------------
-- Machine Hints (progressive, point-deducting)
-- ---------------------------------------------------------------------------
CREATE TABLE content.machine_hints (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id      UUID NOT NULL REFERENCES content.machines(id) ON DELETE CASCADE,
    sequence        INT NOT NULL,
    title           TEXT,
    content_markdown TEXT NOT NULL,
    point_deduction INT NOT NULL DEFAULT 0,
    required_tier   TEXT NOT NULL DEFAULT 'free',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (machine_id, sequence)
);

CREATE INDEX idx_hints_machine ON content.machine_hints (machine_id, sequence);

-- ---------------------------------------------------------------------------
-- Machine Ratings (per user)
-- ---------------------------------------------------------------------------
CREATE TABLE content.machine_ratings (
    user_id         UUID NOT NULL,
    machine_id      UUID NOT NULL REFERENCES content.machines(id) ON DELETE CASCADE,
    rating          SMALLINT NOT NULL,                     -- 1-5
    difficulty_vote TEXT,                                  -- User's perceived difficulty
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, machine_id),
    CONSTRAINT chk_rating_range CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT chk_difficulty_vote CHECK (difficulty_vote IS NULL OR difficulty_vote IN ('very_easy','easy','medium','hard','insane'))
);

CREATE INDEX idx_ratings_machine ON content.machine_ratings (machine_id);

CREATE TRIGGER trg_ratings_updated_at
    BEFORE UPDATE ON content.machine_ratings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Challenges (Jeopardy-style, standalone)
-- ---------------------------------------------------------------------------
CREATE TABLE content.challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    category_id     UUID REFERENCES content.categories(id),
    difficulty      TEXT NOT NULL,
    points          INT NOT NULL,
    -- Instance config (if dynamic)
    requires_instance BOOLEAN NOT NULL DEFAULT FALSE,
    image_ref       TEXT,                                  -- If instance-based
    expected_ports  INT[] DEFAULT '{}',
    cpu_request     TEXT DEFAULT '250m',
    memory_request  TEXT DEFAULT '256Mi',
    -- Downloadable artifacts (S3 paths)
    files           JSONB DEFAULT '[]'::JSONB,             -- [{name, url, size_bytes, sha256}]
    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'draft',
    creator_id      UUID,
    released_at     TIMESTAMPTZ,
    retired_at      TIMESTAMPTZ,
    required_tier   TEXT NOT NULL DEFAULT 'free',
    -- Stats
    total_solves    INT NOT NULL DEFAULT 0,
    avg_solve_minutes INT,
    rating_avg      NUMERIC(3,2),
    rating_count    INT NOT NULL DEFAULT 0,
    -- Content
    cover_image_url TEXT,
    intro_markdown  TEXT,
    -- Static flag (only if requires_instance = FALSE; otherwise generated per-instance)
    static_flag_hash TEXT,                                 -- SHA-256(flag) for verification
    -- Metadata
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_challenge_difficulty CHECK (difficulty IN ('very_easy','easy','medium','hard','insane')),
    CONSTRAINT chk_challenge_status CHECK (status IN ('draft','review','active','retired','archived')),
    CONSTRAINT chk_challenge_tier CHECK (required_tier IN ('free','vip','vip_plus')),
    CONSTRAINT chk_challenge_flag_logic CHECK (
        (requires_instance = TRUE AND image_ref IS NOT NULL) OR
        (requires_instance = FALSE AND static_flag_hash IS NOT NULL)
    )
);

CREATE INDEX idx_challenges_status ON content.challenges (status);
CREATE INDEX idx_challenges_category ON content.challenges (category_id) WHERE status = 'active';
CREATE INDEX idx_challenges_difficulty ON content.challenges (difficulty) WHERE status = 'active';
CREATE INDEX idx_challenges_released ON content.challenges (released_at DESC) WHERE status = 'active';

CREATE TRIGGER trg_challenges_updated_at
    BEFORE UPDATE ON content.challenges
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Challenge tags
CREATE TABLE content.challenge_tags (
    challenge_id    UUID NOT NULL REFERENCES content.challenges(id) ON DELETE CASCADE,
    tag_id          UUID NOT NULL REFERENCES content.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (challenge_id, tag_id)
);

CREATE INDEX idx_challenge_tags_tag ON content.challenge_tags (tag_id);

-- ---------------------------------------------------------------------------
-- Learning Paths (THM-style guided curriculum)
-- ---------------------------------------------------------------------------
CREATE TABLE content.learning_paths (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    overview_markdown TEXT,
    -- Classification
    difficulty      TEXT NOT NULL,                         -- beginner|intermediate|advanced|expert
    category_id     UUID REFERENCES content.categories(id),
    estimated_hours INT,
    -- Progression
    module_count    INT NOT NULL DEFAULT 0,
    machine_count   INT NOT NULL DEFAULT 0,
    challenge_count INT NOT NULL DEFAULT 0,
    -- Stats
    total_completions INT NOT NULL DEFAULT 0,
    total_enrollments INT NOT NULL DEFAULT 0,
    rating_avg      NUMERIC(3,2),
    rating_count    INT NOT NULL DEFAULT 0,
    -- Tier gating
    required_tier   TEXT NOT NULL DEFAULT 'free',
    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'draft',
    creator_id      UUID,
    released_at     TIMESTAMPTZ,
    cover_image_url TEXT,
    -- Rewards
    completion_certificate BOOLEAN NOT NULL DEFAULT FALSE,
    completion_points  INT NOT NULL DEFAULT 0,
    completion_badge_id UUID,                              -- Achievement awarded on completion
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_path_difficulty CHECK (difficulty IN ('beginner','intermediate','advanced','expert')),
    CONSTRAINT chk_path_status CHECK (status IN ('draft','review','active','archived')),
    CONSTRAINT chk_path_tier CHECK (required_tier IN ('free','vip','vip_plus'))
);

CREATE INDEX idx_paths_status ON content.learning_paths (status);
CREATE INDEX idx_paths_difficulty ON content.learning_paths (difficulty) WHERE status = 'active';
CREATE INDEX idx_paths_category ON content.learning_paths (category_id);

CREATE TRIGGER trg_paths_updated_at
    BEFORE UPDATE ON content.learning_paths
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Path Modules (lessons within a path)
-- ---------------------------------------------------------------------------
CREATE TABLE content.path_modules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path_id         UUID NOT NULL REFERENCES content.learning_paths(id) ON DELETE CASCADE,
    sequence        INT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    content_markdown TEXT NOT NULL,                        -- Lesson content
    estimated_minutes INT,
    -- Optional linked content
    machine_id      UUID REFERENCES content.machines(id),
    challenge_id    UUID REFERENCES content.challenges(id),
    -- Module-specific exercises
    questions       JSONB DEFAULT '[]'::JSONB,             -- [{id, question, type, answer_hash, hint, points}]
    -- Gating
    is_optional     BOOLEAN NOT NULL DEFAULT FALSE,
    requires_previous BOOLEAN NOT NULL DEFAULT TRUE,
    completion_points INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (path_id, sequence)
);

CREATE INDEX idx_path_modules_path ON content.path_modules (path_id, sequence);

CREATE TRIGGER trg_path_modules_updated_at
    BEFORE UPDATE ON content.path_modules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Path Enrollments (user progress)
-- ---------------------------------------------------------------------------
CREATE TABLE content.path_enrollments (
    user_id         UUID NOT NULL,
    path_id         UUID NOT NULL REFERENCES content.learning_paths(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'in_progress',   -- enrolled|in_progress|completed|abandoned
    modules_completed INT NOT NULL DEFAULT 0,
    current_module_id UUID REFERENCES content.path_modules(id),
    enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, path_id),
    CONSTRAINT chk_enrollment_status CHECK (status IN ('enrolled','in_progress','completed','abandoned'))
);

CREATE INDEX idx_enrollments_user ON content.path_enrollments (user_id);
CREATE INDEX idx_enrollments_status ON content.path_enrollments (status) WHERE status IN ('in_progress','enrolled');

-- ---------------------------------------------------------------------------
-- Module Progress (per-module per-user)
-- ---------------------------------------------------------------------------
CREATE TABLE content.module_progress (
    user_id         UUID NOT NULL,
    module_id       UUID NOT NULL REFERENCES content.path_modules(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'started',       -- started|completed
    questions_answered JSONB DEFAULT '[]'::JSONB,          -- [{question_id, correct, answered_at}]
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,

    PRIMARY KEY (user_id, module_id),
    CONSTRAINT chk_module_progress CHECK (status IN ('started','completed'))
);

CREATE INDEX idx_module_progress_user ON content.module_progress (user_id);

-- ---------------------------------------------------------------------------
-- Dojos (pwn.college-style structured challenges)
-- ---------------------------------------------------------------------------
CREATE TABLE content.dojos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    overview_markdown TEXT,
    award_emoji     TEXT,                                  -- Belt color emoji 🟡🟠🟢
    cover_image_url TEXT,
    difficulty      TEXT,
    module_count    INT NOT NULL DEFAULT 0,
    level_count     INT NOT NULL DEFAULT 0,
    total_enrollments INT NOT NULL DEFAULT 0,
    required_tier   TEXT NOT NULL DEFAULT 'free',
    sort_order      INT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'draft',
    creator_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_dojo_status CHECK (status IN ('draft','active','archived'))
);

CREATE INDEX idx_dojos_status ON content.dojos (status) WHERE status = 'active';

CREATE TRIGGER trg_dojos_updated_at
    BEFORE UPDATE ON content.dojos
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Dojo Modules
-- ---------------------------------------------------------------------------
CREATE TABLE content.dojo_modules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dojo_id         UUID NOT NULL REFERENCES content.dojos(id) ON DELETE CASCADE,
    slug            CITEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    content_markdown TEXT,                                 -- Lecture content
    video_url       TEXT,                                  -- Optional video
    sequence        INT NOT NULL,
    level_count     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (dojo_id, slug),
    UNIQUE (dojo_id, sequence)
);

CREATE INDEX idx_dojo_modules_dojo ON content.dojo_modules (dojo_id, sequence);

-- ---------------------------------------------------------------------------
-- Dojo Levels (individual challenges within a module)
-- ---------------------------------------------------------------------------
CREATE TABLE content.dojo_levels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id       UUID NOT NULL REFERENCES content.dojo_modules(id) ON DELETE CASCADE,
    slug            CITEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    sequence        INT NOT NULL,
    -- Instance config
    image_ref       TEXT NOT NULL,                         -- One container per level (pwn.college style)
    cpu_request     TEXT DEFAULT '250m',
    memory_request  TEXT DEFAULT '256Mi',
    -- Scoring
    points          INT NOT NULL DEFAULT 100,
    -- Stats
    total_solves    INT NOT NULL DEFAULT 0,
    avg_solve_minutes INT,
    -- Hints
    hint_markdown   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (module_id, slug),
    UNIQUE (module_id, sequence)
);

CREATE INDEX idx_dojo_levels_module ON content.dojo_levels (module_id, sequence);

-- ---------------------------------------------------------------------------
-- Pro Labs (multi-machine AD environments)
-- ---------------------------------------------------------------------------
CREATE TABLE content.pro_labs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    overview_markdown TEXT,
    difficulty      TEXT NOT NULL,
    -- Topology
    machine_count   INT NOT NULL,
    network_topology JSONB NOT NULL,                       -- {subnets, vlans, hosts, ad_domain}
    -- Scoring
    total_flags     INT NOT NULL,
    base_points     INT NOT NULL,
    flag_points_json JSONB,                                -- {flag_id: points}
    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'draft',
    required_tier   TEXT NOT NULL DEFAULT 'vip_plus',
    cover_image_url TEXT,
    estimated_hours INT,
    -- Stats
    total_completions INT NOT NULL DEFAULT 0,
    avg_completion_hours NUMERIC(8,2),
    rating_avg      NUMERIC(3,2),
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_prolab_difficulty CHECK (difficulty IN ('beginner','intermediate','advanced','expert')),
    CONSTRAINT chk_prolab_status CHECK (status IN ('draft','active','retired'))
);

CREATE INDEX idx_prolabs_status ON content.pro_labs (status) WHERE status = 'active';

CREATE TRIGGER trg_prolabs_updated_at
    BEFORE UPDATE ON content.pro_labs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pro Lab Machines (individual VMs within a Pro Lab)
-- ---------------------------------------------------------------------------
CREATE TABLE content.pro_lab_machines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pro_lab_id      UUID NOT NULL REFERENCES content.pro_labs(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                         -- Hostname: DC01, WEB01, etc.
    role            TEXT,                                  -- domain_controller|web_server|workstation|...
    os              TEXT NOT NULL,
    image_ref       TEXT NOT NULL,
    cpu_limit       TEXT NOT NULL DEFAULT '2000m',
    memory_limit    TEXT NOT NULL DEFAULT '4Gi',
    disk_gb         INT NOT NULL DEFAULT 30,
    subnet_index    INT,                                   -- Position in topology
    ip_offset       INT,                                   -- e.g. .10 for DC01
    flags_count     INT NOT NULL DEFAULT 0,
    is_entry_point  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pro_lab_machines_lab ON content.pro_lab_machines (pro_lab_id);
