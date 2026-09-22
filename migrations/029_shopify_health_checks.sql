-- Migration 029: Shopify connection health checks (per-store scope/token diagnostics)
--
-- Stores the latest Shopify health-check result per store so the dashboard can
-- render a health badge + scope details instantly without hitting the Shopify
-- API on every page load. Refreshed on demand via POST /shopify/health/check
-- and automatically right after a successful Shopify connect.
--
-- Additive only: one new table. Safe for Railway auto-migration.

CREATE TABLE IF NOT EXISTS shopify_health_checks (
    store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    overall_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
    reason VARCHAR(40),
    token_valid BOOLEAN,
    store_match BOOLEAN,
    shop_name TEXT,
    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    rate_limit TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_health_checks_status
    ON shopify_health_checks (overall_status);
