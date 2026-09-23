-- Migration 030: Add individual feature entitlement keys for Meta Ads, Ads Explorer, AI Agent Chat
-- These were previously sharing keys with ad_intelligence and growth_copilot.
-- This seeds the new keys (enabled=true) for ALL existing stores that don't have them yet.

INSERT INTO store_feature_entitlements (store_id, feature_key, enabled)
SELECT s.id, 'meta_ads', true
FROM stores s
ON CONFLICT (store_id, feature_key) DO NOTHING;

INSERT INTO store_feature_entitlements (store_id, feature_key, enabled)
SELECT s.id, 'ads_explorer', true
FROM stores s
ON CONFLICT (store_id, feature_key) DO NOTHING;

INSERT INTO store_feature_entitlements (store_id, feature_key, enabled)
SELECT s.id, 'ai_agent_chat', true
FROM stores s
ON CONFLICT (store_id, feature_key) DO NOTHING;

