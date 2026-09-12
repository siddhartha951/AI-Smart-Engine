-- Migration 022: Multi-Touch Ad Intelligence & Attribution Engine (Phase 15)

-- 1. Marketing Touchpoints Table
CREATE TABLE IF NOT EXISTS marketing_touchpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    touchpoint_type VARCHAR(50) NOT NULL DEFAULT 'landing',
    source VARCHAR(100) DEFAULT 'direct',
    medium VARCHAR(100) DEFAULT 'none',
    campaign VARCHAR(255) DEFAULT 'none',
    content VARCHAR(255) DEFAULT '',
    term VARCHAR(255) DEFAULT '',
    fbclid VARCHAR(255) DEFAULT '',
    gclid VARCHAR(255) DEFAULT '',
    ttclid VARCHAR(255) DEFAULT '',
    landing_page_url TEXT DEFAULT '',
    referrer_url TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_touchpoints_store_visitor ON marketing_touchpoints (store_id, visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_touchpoints_store_campaign ON marketing_touchpoints (store_id, campaign);
CREATE INDEX IF NOT EXISTS idx_touchpoints_store_source ON marketing_touchpoints (store_id, source);
CREATE INDEX IF NOT EXISTS idx_touchpoints_store_created ON marketing_touchpoints (store_id, created_at DESC);

-- 2. Merchant Ad Spend Table
CREATE TABLE IF NOT EXISTS ad_spend (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    spend_date DATE NOT NULL,
    platform VARCHAR(50) NOT NULL,
    campaign VARCHAR(255) NOT NULL DEFAULT 'general',
    spend_amount NUMERIC(12, 2) NOT NULL CHECK (spend_amount >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'GBP',
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ad_spend_store_date_platform_camp UNIQUE (store_id, spend_date, platform, campaign)
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_store_date ON ad_spend (store_id, spend_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_spend_store_platform ON ad_spend (store_id, platform, campaign);

-- 3. Order Attributions Table (Deterministic conversion ledger)
CREATE TABLE IF NOT EXISTS order_attributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id VARCHAR(255) NOT NULL,
    order_number VARCHAR(100),
    visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
    customer_email VARCHAR(255),
    order_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'GBP',
    order_created_at TIMESTAMPTZ NOT NULL,
    first_touchpoint_id UUID REFERENCES marketing_touchpoints(id) ON DELETE SET NULL,
    first_touch_source VARCHAR(100) DEFAULT 'direct',
    first_touch_campaign VARCHAR(255) DEFAULT 'none',
    last_touchpoint_id UUID REFERENCES marketing_touchpoints(id) ON DELETE SET NULL,
    last_touch_source VARCHAR(100) DEFAULT 'direct',
    last_touch_campaign VARCHAR(255) DEFAULT 'none',
    touchpoint_count INT NOT NULL DEFAULT 0,
    is_ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
    ai_assisted_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ai_session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    matched_recommendation_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_order_attributions_store_order UNIQUE (store_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_order_attr_store_date ON order_attributions (store_id, order_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_attr_store_first ON order_attributions (store_id, first_touch_source);
CREATE INDEX IF NOT EXISTS idx_order_attr_store_last ON order_attributions (store_id, last_touch_source);

-- 4. Order Attribution Touchpoints Table (Linear Multi-Touch Share Ledger)
CREATE TABLE IF NOT EXISTS order_attribution_touchpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id VARCHAR(255) NOT NULL,
    touchpoint_id UUID NOT NULL REFERENCES marketing_touchpoints(id) ON DELETE CASCADE,
    weight NUMERIC(6, 4) NOT NULL,
    attributed_revenue NUMERIC(12, 2) NOT NULL,
    source VARCHAR(100) DEFAULT 'direct',
    campaign VARCHAR(255) DEFAULT 'none',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_order_attr_touchpoints UNIQUE (store_id, order_id, touchpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_order_attr_tp_touch ON order_attribution_touchpoints (store_id, touchpoint_id);
CREATE INDEX IF NOT EXISTS idx_order_attr_tp_camp ON order_attribution_touchpoints (store_id, campaign);
