-- Migration 017: WhatsApp Growth Engine

-- 1. WhatsApp Merchant Configurations Table
CREATE TABLE IF NOT EXISTS whatsapp_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    phone_number_id VARCHAR(100),
    waba_id VARCHAR(100),
    encrypted_access_token TEXT,
    webhook_verify_token TEXT,
    app_secret TEXT,
    display_phone_number VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'disconnected', -- 'disconnected' | 'connected' | 'error'
    quality_rating VARCHAR(50) DEFAULT 'UNKNOWN',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_store ON whatsapp_configs (store_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_phone_id ON whatsapp_configs (phone_number_id);

-- 2. WhatsApp Customer Consents Table (Distinct from Email Marketing)
CREATE TABLE IF NOT EXISTS whatsapp_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,
    visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
    opted_in BOOLEAN NOT NULL DEFAULT FALSE,
    wording TEXT NOT NULL,
    source VARCHAR(100) NOT NULL DEFAULT 'storefront',
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_consents_store_phone ON whatsapp_consents (store_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_consents_store_opted ON whatsapp_consents (store_id, phone_number, opted_in);

-- 3. WhatsApp Conversations Table
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,
    customer_name VARCHAR(255),
    visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active' | 'closed'
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_whatsapp_conv_store_phone UNIQUE (store_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_store_last_msg ON whatsapp_conversations (store_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_store_phone ON whatsapp_conversations (store_id, phone_number);

-- 4. WhatsApp Messages Ledger
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    direction VARCHAR(20) NOT NULL, -- 'inbound' | 'outbound'
    message_type VARCHAR(50) NOT NULL DEFAULT 'text', -- 'text' | 'template' | 'interactive'
    content TEXT NOT NULL,
    wamid VARCHAR(255),
    status VARCHAR(50) DEFAULT 'sent', -- 'received' | 'sent' | 'delivered' | 'read' | 'failed'
    ai_generated BOOLEAN DEFAULT FALSE,
    tokens_used INT DEFAULT 0,
    cost_usd NUMERIC(10, 6) DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_store_conv ON whatsapp_messages (store_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_wamid ON whatsapp_messages (store_id, wamid);

-- 5. WhatsApp Abandoned Cart Recovery Jobs
CREATE TABLE IF NOT EXISTS whatsapp_recovery_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,
    visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
    cart_token VARCHAR(255),
    product_id VARCHAR(100),
    product_title VARCHAR(255),
    price NUMERIC(10, 2),
    currency VARCHAR(10) DEFAULT 'GBP',
    checkout_url TEXT,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'cancelled' | 'failed'
    cancel_reason VARCHAR(100),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_recovery_store_status ON whatsapp_recovery_jobs (store_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_recovery_phone ON whatsapp_recovery_jobs (store_id, phone_number);

-- 6. WhatsApp Webhook Events (Idempotency & Deduplication)
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_event_type ON whatsapp_webhook_events (store_id, event_type);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_event_id ON whatsapp_webhook_events (event_id);
