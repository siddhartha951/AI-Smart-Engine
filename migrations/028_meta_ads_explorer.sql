-- Migration 028: Meta Ads Explorer cache (per-store ad creative snapshot)
--
-- Caches the ad list + creative thumbnails fetched from the Meta Marketing API
-- so the Ads Explorer dashboard section can render instantly without hitting
-- Meta on every page load. Refreshed on demand via POST /meta-ads/explorer/sync
-- (one paginated pass per sync, well within Meta rate limits).
--
-- Additive only: new table + indexes. Safe for Railway auto-migration.

CREATE TABLE IF NOT EXISTS meta_ads_explorer_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    ad_account_id TEXT NOT NULL,
    ad_id TEXT NOT NULL,
    name TEXT,
    status TEXT,
    campaign_name TEXT,
    adset_name TEXT,
    thumbnail_url TEXT,
    creative_url TEXT,
    destination_url TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, ad_account_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_explorer_store_account
    ON meta_ads_explorer_cache(store_id, ad_account_id);

CREATE INDEX IF NOT EXISTS idx_meta_ads_explorer_store
    ON meta_ads_explorer_cache(store_id);
