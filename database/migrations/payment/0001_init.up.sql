-- =============================================================================
-- Payment Schema — Initial Migration
-- =============================================================================
-- Customers, invoices, transactions, refunds across payment providers
-- =============================================================================

SET search_path = payment, public;

-- ---------------------------------------------------------------------------
-- Pricing Plans (catalog)
-- ---------------------------------------------------------------------------
CREATE TABLE payment.plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            CITEXT NOT NULL UNIQUE,                -- vip_monthly, vip_annual, vip_plus_monthly, etc
    name            TEXT NOT NULL,
    description     TEXT,
    tier            TEXT NOT NULL,                         -- free|vip|vip_plus|team|enterprise
    billing_cycle   TEXT NOT NULL,                         -- monthly|annual|lifetime|usage
    -- Pricing
    base_price_cents INT NOT NULL,                         -- Base price in cents (USD)
    currency        TEXT NOT NULL DEFAULT 'USD',
    -- Regional pricing (purchasing power parity)
    regional_pricing JSONB DEFAULT '{}'::JSONB,            -- {"PK": {"price_cents": 50000, "currency": "PKR"}, "IN": ...}
    -- Stripe linkage
    stripe_product_id TEXT,
    stripe_price_id   TEXT,
    -- Features (denormalized for marketing)
    features        JSONB DEFAULT '[]'::JSONB,             -- List of feature strings
    max_concurrent_instances INT DEFAULT 2,
    max_daily_spawns INT DEFAULT 10,
    -- Lifecycle
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_legacy       BOOLEAN NOT NULL DEFAULT FALSE,        -- Honored but not sold
    available_from  TIMESTAMPTZ,
    available_until TIMESTAMPTZ,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_plan_tier CHECK (tier IN ('free','vip','vip_plus','team','enterprise')),
    CONSTRAINT chk_plan_cycle CHECK (billing_cycle IN ('monthly','annual','lifetime','usage'))
);

CREATE INDEX idx_plans_active ON payment.plans (sort_order) WHERE is_active = TRUE;

CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON payment.plans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default plans
INSERT INTO payment.plans (code, name, tier, billing_cycle, base_price_cents, features, max_concurrent_instances, max_daily_spawns) VALUES
    ('free', 'Free', 'free', 'usage', 0,
     '["2 concurrent labs","10 spawns/day","Community machines","Forum access"]'::jsonb, 2, 10),
    ('vip_monthly', 'VIP (Monthly)', 'vip', 'monthly', 1400,
     '["Unlimited concurrent labs","Unlimited spawns","All retired content","Pwnbox","Priority support"]'::jsonb, 5, 999),
    ('vip_annual', 'VIP (Annual)', 'vip', 'annual', 13900,
     '["Everything in VIP","Save 17%"]'::jsonb, 5, 999),
    ('vip_plus_monthly', 'VIP+ (Monthly)', 'vip_plus', 'monthly', 2500,
     '["Everything in VIP","Pro Labs access","Priority queue","Advanced analytics"]'::jsonb, 10, 999),
    ('vip_plus_annual', 'VIP+ (Annual)', 'vip_plus', 'annual', 24900,
     '["Everything in VIP+","Save 17%"]'::jsonb, 10, 999);

-- ---------------------------------------------------------------------------
-- Customers (one per user; references payment provider customer IDs)
-- ---------------------------------------------------------------------------
CREATE TABLE payment.customers (
    user_id         UUID PRIMARY KEY,
    -- Provider IDs
    stripe_customer_id      TEXT UNIQUE,
    jazzcash_customer_id    TEXT,
    easypaisa_customer_id   TEXT,
    paypal_customer_id      TEXT UNIQUE,
    -- Billing address
    billing_email           CITEXT,
    billing_name            TEXT,
    billing_country         CHAR(2),
    billing_state           TEXT,
    billing_city            TEXT,
    billing_postal_code     TEXT,
    billing_address_line1   TEXT,
    billing_address_line2   TEXT,
    tax_id                  TEXT,
    -- Default payment method
    default_payment_method_id UUID,
    -- Metadata
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_stripe ON payment.customers (stripe_customer_id);
CREATE INDEX idx_customers_email ON payment.customers (billing_email);

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON payment.customers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Payment Methods (cards, mobile wallets)
-- ---------------------------------------------------------------------------
CREATE TABLE payment.payment_methods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    provider        TEXT NOT NULL,                         -- stripe|jazzcash|easypaisa|paypal|crypto
    provider_method_id TEXT,                               -- e.g. Stripe pm_xxx
    method_type     TEXT NOT NULL,                         -- card|bank|wallet|crypto
    -- Display (PCI-safe info only)
    last_four       CHAR(4),
    brand           TEXT,                                  -- visa|mc|amex|jazzcash|easypaisa|...
    expires_month   SMALLINT,
    expires_year    SMALLINT,
    holder_name     TEXT,
    -- State
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Metadata
    metadata        JSONB DEFAULT '{}'::JSONB,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ,
    removed_at      TIMESTAMPTZ,

    CONSTRAINT chk_pm_provider CHECK (provider IN ('stripe','jazzcash','easypaisa','paypal','crypto')),
    CONSTRAINT chk_pm_type CHECK (method_type IN ('card','bank','wallet','crypto'))
);

CREATE INDEX idx_pm_user ON payment.payment_methods (user_id) WHERE is_active = TRUE;
CREATE UNIQUE INDEX idx_pm_user_default ON payment.payment_methods (user_id) WHERE is_default = TRUE AND is_active = TRUE;

-- ---------------------------------------------------------------------------
-- Subscriptions (detailed; users.subscriptions has the user-facing summary)
-- ---------------------------------------------------------------------------
CREATE TABLE payment.subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    plan_id         UUID NOT NULL REFERENCES payment.plans(id),
    -- Provider IDs
    provider        TEXT NOT NULL,
    provider_subscription_id TEXT,
    -- State
    status          TEXT NOT NULL,                         -- trialing|active|past_due|canceled|unpaid|incomplete
    -- Periods
    trial_start_at  TIMESTAMPTZ,
    trial_end_at    TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end   TIMESTAMPTZ NOT NULL,
    -- Cancellation
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at     TIMESTAMPTZ,
    cancellation_reason TEXT,
    ended_at        TIMESTAMPTZ,
    -- Pricing snapshot (in case plan changes)
    price_cents_at_signup INT NOT NULL,
    currency_at_signup    TEXT NOT NULL,
    -- Coupon
    coupon_id       UUID,
    discount_cents  INT NOT NULL DEFAULT 0,
    -- Metadata
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_sub_provider CHECK (provider IN ('stripe','jazzcash','easypaisa','paypal','manual')),
    CONSTRAINT chk_subscription_status CHECK (status IN ('trialing','active','past_due','canceled','unpaid','incomplete'))
);

CREATE INDEX idx_payment_sub_user ON payment.subscriptions (user_id, status);
CREATE INDEX idx_payment_sub_status ON payment.subscriptions (status, current_period_end);
CREATE INDEX idx_payment_sub_provider ON payment.subscriptions (provider, provider_subscription_id);

CREATE TRIGGER trg_payment_subscriptions_updated_at
    BEFORE UPDATE ON payment.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
CREATE TABLE payment.invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number  TEXT NOT NULL UNIQUE,                  -- INV-2026-00001
    user_id         UUID NOT NULL,
    subscription_id UUID REFERENCES payment.subscriptions(id),
    -- Amounts (in cents, smallest currency unit)
    subtotal_cents  INT NOT NULL,
    discount_cents  INT NOT NULL DEFAULT 0,
    tax_cents       INT NOT NULL DEFAULT 0,
    total_cents     INT NOT NULL,
    amount_paid_cents INT NOT NULL DEFAULT 0,
    amount_due_cents INT NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'USD',
    -- Provider linkage
    provider        TEXT NOT NULL,
    provider_invoice_id TEXT,
    hosted_invoice_url TEXT,                               -- e.g. Stripe hosted page
    invoice_pdf_url TEXT,
    -- Period (for subscription invoices)
    period_start    TIMESTAMPTZ,
    period_end      TIMESTAMPTZ,
    -- State
    status          TEXT NOT NULL,                         -- draft|open|paid|void|uncollectible
    -- Timestamps
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_at          TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    voided_at       TIMESTAMPTZ,
    -- Line items
    line_items      JSONB NOT NULL DEFAULT '[]'::JSONB,
    -- Customer snapshot
    customer_email  CITEXT,
    customer_name   TEXT,
    billing_address JSONB,
    -- Metadata
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_invoice_status CHECK (status IN ('draft','open','paid','void','uncollectible'))
);

CREATE INDEX idx_invoices_user ON payment.invoices (user_id, issued_at DESC);
CREATE INDEX idx_invoices_status ON payment.invoices (status, due_at) WHERE status IN ('open','draft');
CREATE INDEX idx_invoices_subscription ON payment.invoices (subscription_id);
CREATE INDEX idx_invoices_provider ON payment.invoices (provider, provider_invoice_id);

CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON payment.invoices
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Transactions (every money movement)
-- ---------------------------------------------------------------------------
CREATE TABLE payment.transactions (
    id              UUID NOT NULL DEFAULT public.uuid_generate_v7(),
    user_id         UUID NOT NULL,
    invoice_id      UUID REFERENCES payment.invoices(id),
    subscription_id UUID REFERENCES payment.subscriptions(id),
    -- Transaction details
    transaction_type TEXT NOT NULL,                        -- charge|refund|adjustment|chargeback|payout
    amount_cents    INT NOT NULL,                          -- Positive for incoming, negative for outgoing
    currency        TEXT NOT NULL DEFAULT 'USD',
    fee_cents       INT NOT NULL DEFAULT 0,
    net_cents       INT NOT NULL,                          -- amount - fee
    -- Provider
    provider        TEXT NOT NULL,
    provider_txn_id TEXT,                                  -- e.g. Stripe ch_xxx, pi_xxx
    payment_method_id UUID REFERENCES payment.payment_methods(id),
    -- State
    status          TEXT NOT NULL,                         -- pending|succeeded|failed|refunded|disputed
    failure_code    TEXT,
    failure_message TEXT,
    -- Risk
    risk_score      NUMERIC(5,2),
    risk_level      TEXT,                                  -- low|medium|high|blocked
    -- Idempotency
    idempotency_key TEXT,
    -- Timestamps
    initiated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    -- Metadata
    description     TEXT,
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_txn_type CHECK (transaction_type IN ('charge','refund','adjustment','chargeback','payout')),
    CONSTRAINT chk_txn_status CHECK (status IN ('pending','succeeded','failed','refunded','disputed')),

    PRIMARY KEY (id, initiated_at)
) PARTITION BY RANGE (initiated_at);

CREATE TABLE payment.transactions_2026_05 PARTITION OF payment.transactions
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE payment.transactions_2026_06 PARTITION OF payment.transactions
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE payment.transactions_2026_07 PARTITION OF payment.transactions
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX idx_txn_user ON payment.transactions (user_id, initiated_at DESC);
CREATE INDEX idx_txn_invoice ON payment.transactions (invoice_id);
CREATE INDEX idx_txn_provider ON payment.transactions (provider, provider_txn_id);
CREATE INDEX idx_txn_status ON payment.transactions (status, initiated_at) WHERE status = 'pending';
-- NOTE: partitioned tables require the partition key in every UNIQUE index, so
-- this enforces idempotency per partition window rather than globally.
CREATE UNIQUE INDEX idx_txn_idempotency ON payment.transactions (idempotency_key, initiated_at) WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Coupons / Promo Codes
-- ---------------------------------------------------------------------------
CREATE TABLE payment.coupons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            CITEXT NOT NULL UNIQUE,
    description     TEXT,
    -- Discount
    discount_type   TEXT NOT NULL,                         -- percent|amount
    discount_value  NUMERIC(10,2) NOT NULL,                -- 20.00 = 20% or 2000 cents
    currency        TEXT,                                  -- For amount type
    -- Applicability
    applies_to_plans UUID[] DEFAULT '{}',                  -- NULL/empty = all plans
    applies_to_billing_cycles TEXT[] DEFAULT '{}',
    minimum_amount_cents INT DEFAULT 0,
    -- Usage limits
    max_redemptions INT,                                   -- NULL = unlimited
    redemption_count INT NOT NULL DEFAULT 0,
    max_per_user    INT NOT NULL DEFAULT 1,
    -- Validity
    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    -- State
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Creator
    created_by      UUID,
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_coupon_discount CHECK (discount_type IN ('percent','amount'))
);

CREATE INDEX idx_coupons_code ON payment.coupons (code) WHERE is_active = TRUE;
CREATE INDEX idx_coupons_valid ON payment.coupons (valid_until) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- Coupon Redemptions
-- ---------------------------------------------------------------------------
CREATE TABLE payment.coupon_redemptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id       UUID NOT NULL REFERENCES payment.coupons(id),
    user_id         UUID NOT NULL,
    subscription_id UUID REFERENCES payment.subscriptions(id),
    invoice_id      UUID REFERENCES payment.invoices(id),
    discount_applied_cents INT NOT NULL,
    redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_redemptions_coupon ON payment.coupon_redemptions (coupon_id);
CREATE INDEX idx_redemptions_user ON payment.coupon_redemptions (user_id);

-- ---------------------------------------------------------------------------
-- Webhook Events (raw from providers, for idempotency + replay)
-- ---------------------------------------------------------------------------
CREATE TABLE payment.webhook_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    signature_valid BOOLEAN NOT NULL,
    -- Processing
    processed       BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at    TIMESTAMPTZ,
    processing_error TEXT,
    retry_count     INT NOT NULL DEFAULT 0,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_webhook_event UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_webhooks_unprocessed ON payment.webhook_events (received_at) WHERE processed = FALSE;
CREATE INDEX idx_webhooks_event_type ON payment.webhook_events (event_type, received_at DESC);
