-- Migration 036: Human-support escalation modes + admin-gated support tickets
--
-- 1. Merchant setting for how the assistant hands shoppers to humans:
--    contact_only (never create tickets, show contact details),
--    smart (AI first, offer a ticket only when the shopper is stuck/frustrated),
--    instant (legacy behaviour: ticket button always available).
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS escalation_mode VARCHAR(20) NOT NULL DEFAULT 'smart';
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS escalation_sensitivity VARCHAR(20) NOT NULL DEFAULT 'balanced';

-- 2. Support tickets become an admin-enabled feature for NEW stores (default off in code).
--    Every store that exists today keeps tickets enabled, so live merchants see no change.
INSERT INTO store_feature_entitlements (store_id, feature_key, enabled)
SELECT s.id, 'support_tickets', true
FROM stores s
ON CONFLICT (store_id, feature_key) DO NOTHING;
