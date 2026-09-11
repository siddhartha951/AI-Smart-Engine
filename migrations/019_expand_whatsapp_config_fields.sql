-- Migration 019: Expand WhatsApp config column lengths to TEXT to prevent truncation errors on JWT bearer tokens
ALTER TABLE whatsapp_configs 
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta',
    ADD COLUMN IF NOT EXISTS wati_api_endpoint TEXT,
    ADD COLUMN IF NOT EXISTS encrypted_wati_token TEXT;

ALTER TABLE whatsapp_configs 
    ALTER COLUMN webhook_verify_token TYPE TEXT,
    ALTER COLUMN app_secret TYPE TEXT,
    ALTER COLUMN display_phone_number TYPE VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_provider ON whatsapp_configs(provider);
