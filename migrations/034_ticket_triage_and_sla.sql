-- Migration 034: Support ticket triage (category, sentiment), SLA due time and apology macro settings
-- Purely additive: existing tickets default to 'general' / 'neutral' and keep their priority.

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'general';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20) NOT NULL DEFAULT 'neutral';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_support_tickets_store_category ON support_tickets (store_id, category);

-- Discount offered by the "Apology + Discount" reply macro (merchant-configured; the engine never invents codes)
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS ticket_apology_discount_code VARCHAR(100);
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS ticket_apology_discount_percent INT DEFAULT 10;
