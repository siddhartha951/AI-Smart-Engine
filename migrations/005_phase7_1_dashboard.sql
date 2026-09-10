-- Migration 005: Phase 7.1 Dashboard Updates

-- 1. Assistant Settings Additions
ALTER TABLE assistant_settings
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS tone VARCHAR(50) NOT NULL DEFAULT 'friendly and helpful',
ADD COLUMN IF NOT EXISTS welcome_message TEXT NOT NULL DEFAULT 'Hi there! Looking for recommendations today?';

-- 2. Stores Table Addition (for Widget Script Snippet isolation)
ALTER TABLE stores
ADD COLUMN IF NOT EXISTS widget_key UUID DEFAULT gen_random_uuid();

-- Add widget key to existing stores safely
UPDATE stores SET widget_key = gen_random_uuid() WHERE widget_key IS NULL;

-- Set deterministic widget_keys for seed stores to allow integration tests to pass
UPDATE stores SET widget_key = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE stores SET widget_key = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb' WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

ALTER TABLE stores ALTER COLUMN widget_key SET NOT NULL;
ALTER TABLE stores ADD CONSTRAINT uq_stores_widget_key UNIQUE (widget_key);

-- 3. Email Settings Table
CREATE TABLE IF NOT EXISTS email_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    follow_up_interval_minutes INT NOT NULL DEFAULT 60,
    max_recovery_emails INT NOT NULL DEFAULT 1,
    consent_wording TEXT NOT NULL DEFAULT 'I agree to receive personalized product recommendations and shopping cart reminders.',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_settings_store ON email_settings (store_id);

-- Insert default email settings for existing stores
INSERT INTO email_settings (store_id)
SELECT id FROM stores
ON CONFLICT DO NOTHING;
