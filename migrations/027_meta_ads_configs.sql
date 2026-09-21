-- Migration 027: Meta Ads Integration (per-store encrypted credentials)
-- Stores each store's Meta Marketing API credentials for the Meta Ads dashboard module.
-- Access tokens are encrypted at rest (AES-256-GCM via app crypto utils); the raw
-- token is NEVER returned by the API, only connection status metadata.

CREATE TABLE IF NOT EXISTS meta_ads_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    encrypted_access_token TEXT,
    ad_account_id TEXT,
    ad_account_name TEXT,
    account_currency VARCHAR(10),
    token_connected_at TIMESTAMPTZ,
    token_expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_error TEXT,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_configs_store ON meta_ads_configs(store_id);
