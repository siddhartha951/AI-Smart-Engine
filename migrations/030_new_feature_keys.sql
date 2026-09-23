-- Migration 030: Add individual feature entitlement keys for Meta Ads, Ads Explorer, AI Agent Chat
-- These were previously sharing keys with ad_intelligence and growth_copilot.
-- This seeds the new keys (enabled=true) for ALL existing stores that don't have them yet.

INSERT INTO store_feature_entitlements (store_id, feature_key, enabled)
SELECT s.id, key, true
FROM stores s
CROSS JOIN (VALUES ('meta_ads'), ('ads_explorer'), ('ai_agent_chat')) AS keys(key)
ON CONFLICT (store_id, feature_key) DO NOTHING;
