-- Migration 009: Resend Integration - Sender Domains, Webhook Events, and Dispatch Idempotency

-- 1. Merchant Sender Domains Table
CREATE TABLE IF NOT EXISTS merchant_sender_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    domain_name VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'resend',
    provider_domain_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    dns_records JSONB NOT NULL DEFAULT '[]'::jsonb,
    sender_name VARCHAR(255),
    sender_email VARCHAR(255),
    is_default BOOLEAN NOT NULL DEFAULT true,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_store_sender_domain UNIQUE (store_id, domain_name)
);

CREATE INDEX IF NOT EXISTS idx_sender_domains_store ON merchant_sender_domains (store_id);
CREATE INDEX IF NOT EXISTS idx_sender_domains_status ON merchant_sender_domains (store_id, status);
CREATE INDEX IF NOT EXISTS idx_sender_domains_provider_id ON merchant_sender_domains (provider_domain_id);

-- 2. Email Webhook Events Table (Delivery, Bounce, Complaint, Suppression)
CREATE TABLE IF NOT EXISTS email_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    provider_message_id VARCHAR(255),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_store ON email_webhook_events (store_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_recipient ON email_webhook_events (store_id, recipient);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON email_webhook_events (store_id, event_type);

-- 3. Idempotency and Provider Tracking for Email Campaign Events
ALTER TABLE email_campaign_events ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255);
ALTER TABLE email_campaign_events ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_email_jobs_idempotency ON email_campaign_events (store_id, idempotency_key);

-- 4. Seed Verified Default Domains for Store A and Store B
INSERT INTO merchant_sender_domains (
    id,
    store_id,
    domain_name,
    provider,
    provider_domain_id,
    status,
    dns_records,
    sender_name,
    sender_email,
    is_default,
    verified_at
) VALUES
(
    'a5a5a5a5-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'london-eco.co.uk',
    'resend',
    'mock_resend_domain_store_a',
    'verified',
    '[{"record":"DKIM","name":"resend._domainkey.london-eco.co.uk","type":"TXT","value":"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC0...","status":"verified"}]'::jsonb,
    'London Eco Apparel',
    'notifications@london-eco.co.uk',
    true,
    NOW()
),
(
    'b6b6b6b6-2222-2222-2222-222222222222',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'highlandpeak.co.uk',
    'resend',
    'mock_resend_domain_store_b',
    'verified',
    '[{"record":"DKIM","name":"resend._domainkey.highlandpeak.co.uk","type":"TXT","value":"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD1...","status":"verified"}]'::jsonb,
    'Highland Peak Gear',
    'notifications@highlandpeak.co.uk',
    true,
    NOW()
)
ON CONFLICT (store_id, domain_name) DO NOTHING;
