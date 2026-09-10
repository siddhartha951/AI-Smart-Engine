-- Migration 001: Initial Multi-Tenant Schema with strict store_id scoping

-- Enable UUID extension if supported
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Merchants Table
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Stores Table
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    shop_domain VARCHAR(255) NOT NULL UNIQUE,
    brand_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stores_domain ON stores (shop_domain);
CREATE INDEX IF NOT EXISTS idx_stores_merchant ON stores (merchant_id);

-- 3. Store Credentials (Encrypted, server-side only)
CREATE TABLE IF NOT EXISTS store_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    encrypted_admin_token TEXT,
    encrypted_storefront_token TEXT,
    encryption_iv VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_credentials_store ON store_credentials (store_id);

-- 4. Widget Settings (Public branding and widget behavior)
CREATE TABLE IF NOT EXISTS widget_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    button_text VARCHAR(100) NOT NULL DEFAULT 'Ask our shopping assistant',
    position VARCHAR(20) NOT NULL DEFAULT 'bottom-right',
    primary_colour VARCHAR(30) NOT NULL DEFAULT '#1a1a1a',
    secondary_colour VARCHAR(30) NOT NULL DEFAULT '#ffffff',
    greeting TEXT NOT NULL DEFAULT 'Hi there! Looking for recommendations today?',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_widget_settings_store ON widget_settings (store_id);

-- 5. Assistant Settings (Personality and boundaries)
CREATE TABLE IF NOT EXISTS assistant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    assistant_name VARCHAR(100) NOT NULL DEFAULT 'Shopping Assistant',
    allowed_topics TEXT[] DEFAULT ARRAY['product_recommendation', 'size_guide', 'stock_check'],
    support_contact VARCHAR(255) NOT NULL DEFAULT 'support@store.com',
    privacy_policy_url TEXT NOT NULL DEFAULT 'https://store.com/policies/privacy',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistant_settings_store ON assistant_settings (store_id);

-- 6. Store Policies (Trusted grounding content for assistant)
CREATE TABLE IF NOT EXISTS store_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    delivery_policy TEXT NOT NULL,
    returns_policy TEXT NOT NULL,
    faq_content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_policies_store ON store_policies (store_id);

-- 7. Visitors Table (Identified by store + anonymous token)
CREATE TABLE IF NOT EXISTS visitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    anonymous_id VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_visitors_store_anonymous UNIQUE (store_id, anonymous_id)
);
CREATE INDEX IF NOT EXISTS idx_visitors_store_email ON visitors (store_id, email);
CREATE INDEX IF NOT EXISTS idx_visitors_store_anonymous ON visitors (store_id, anonymous_id);

-- 8. Marketing Consents Table (UK PECR / GDPR compliance audit trail)
CREATE TABLE IF NOT EXISTS marketing_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    opted_in BOOLEAN NOT NULL DEFAULT FALSE,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(100) NOT NULL DEFAULT 'widget_chat_v1',
    version VARCHAR(50) NOT NULL DEFAULT '1.0',
    wording TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_consents_store_visitor ON marketing_consents (store_id, visitor_id);

-- 9. Chat Sessions Table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_store_visitor ON chat_sessions (store_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_store_status ON chat_sessions (store_id, status);

-- 10. Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    ai_input_tokens INT DEFAULT 0,
    ai_output_tokens INT DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 6) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (store_id, session_id);

-- 11. Recommendations Table (Products suggested during conversation)
CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    product_id VARCHAR(100) NOT NULL,
    variant_id VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'GBP',
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recommendations_store_session ON recommendations (store_id, session_id);

-- 12. Events Table (Tracking interactions: open, clicks, add-to-cart, purchase)
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_store_visitor_type ON events (store_id, visitor_id, type);
CREATE INDEX IF NOT EXISTS idx_events_store_type ON events (store_id, type);

-- 13. Email Campaign Events & Jobs Table (Scheduled recovery sequence)
CREATE TABLE IF NOT EXISTS email_campaign_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    campaign_type VARCHAR(50) NOT NULL DEFAULT 'abandoned_chat_recovery',
    stage INT NOT NULL DEFAULT 1,
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    cancel_reason VARCHAR(100),
    retry_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_email_campaign_stage UNIQUE (store_id, session_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_email_jobs_dispatch ON email_campaign_events (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_email_jobs_store_visitor ON email_campaign_events (store_id, visitor_id);

-- 14. Suppression List Table (Unsubscribed, bounced, or manually suppressed emails)
CREATE TABLE IF NOT EXISTS suppression_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    reason VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_suppression_store_email UNIQUE (store_id, email)
);
CREATE INDEX IF NOT EXISTS idx_suppression_store_email ON suppression_list (store_id, email);

-- 15. AI Usage Ledger Table (Budget monitoring & hard stop tracking)
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    model VARCHAR(100) NOT NULL,
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    estimated_cost_usd NUMERIC(10, 6) NOT NULL,
    billing_period VARCHAR(7) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_period ON ai_usage_ledger (billing_period);
CREATE INDEX IF NOT EXISTS idx_ai_usage_store ON ai_usage_ledger (store_id);
