-- Migration 018: WATI WhatsApp Provider Extension
-- Adds provider selection and WATI credential storage to whatsapp_configs table

ALTER TABLE whatsapp_configs 
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta',
    ADD COLUMN IF NOT EXISTS wati_api_endpoint TEXT,
    ADD COLUMN IF NOT EXISTS encrypted_wati_token TEXT;

CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_provider ON whatsapp_configs(provider);
