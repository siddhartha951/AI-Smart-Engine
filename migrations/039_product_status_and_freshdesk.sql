-- Migration 039: Product status for the assistant + Freshdesk helpdesk integration
--
-- Purely additive. Existing rows keep working: products stay active until the next
-- Catalog Sync records their Shopify status, and every store keeps the built-in ticket
-- inbox until its merchant connects Freshdesk.

-- 1. Draft / archived Shopify products are synced but never offered to shoppers
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 2. Where a store's support tickets go: the built-in inbox (default) or the store's Freshdesk
CREATE TABLE IF NOT EXISTS store_helpdesk_settings (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'built_in',   -- built_in | freshdesk
  freshdesk_domain VARCHAR(255),                       -- e.g. acme.freshdesk.com
  encrypted_api_key TEXT,                              -- AES-256-GCM (utils/crypto)
  api_key_last4 VARCHAR(8),
  status VARCHAR(20) NOT NULL DEFAULT 'not_connected', -- not_connected | connected | error
  last_error TEXT,
  last_tested_at TIMESTAMP WITH TIME ZONE,
  updated_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Each ticket remembers where it was delivered (the ticket itself is always kept here first)
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS external_provider VARCHAR(20);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS external_ticket_id VARCHAR(64);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS external_sync_status VARCHAR(20); -- pending | synced | failed
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS external_sync_error TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS external_sync_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS external_synced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_support_tickets_external_sync ON support_tickets (store_id, external_sync_status);

-- 4. Every plan includes Freshdesk (code: ALWAYS_INCLUDED_FEATURES), so stores already on a
--    plan get the switch on. Stores without a plan stay off until the admin turns it on.
INSERT INTO store_feature_entitlements (store_id, feature_key, enabled)
SELECT store_id, 'freshdesk', true FROM store_subscriptions
ON CONFLICT (store_id, feature_key) DO NOTHING;
