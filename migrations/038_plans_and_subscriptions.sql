-- Migration 038: Sellable plans + per-store subscriptions
--
-- 1. `plans` is the catalogue the platform admin edits (price, limits, included features).
-- 2. `store_subscriptions` records which plan a store is on, the price actually charged,
--    billing status and dates, plus optional per-store limit overrides for custom deals.
--
-- Purely additive: no existing table or row is changed. A store without a subscription row
-- keeps working exactly as before (its current feature switches and the platform-wide
-- AI budget stay in force) until an admin assigns it a plan.

CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  tagline TEXT,
  price_inr_monthly INTEGER,             -- NULL = custom / quoted per client
  price_usd_monthly INTEGER,
  ai_budget_usd NUMERIC(10, 2),          -- monthly AI cost hard stop for the store
  knowledge_doc_limit INTEGER,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_subscriptions (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  plan_id VARCHAR(40) NOT NULL REFERENCES plans(id),
  billing_cycle VARCHAR(10) NOT NULL DEFAULT 'monthly',
  price_amount NUMERIC(12, 2),           -- NULL = plan list price
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  started_at DATE,
  renews_at DATE,
  trial_ends_at DATE,
  ai_budget_usd NUMERIC(10, 2),          -- NULL = plan value
  knowledge_doc_limit INTEGER,           -- NULL = plan value
  notes TEXT,
  updated_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_subscriptions_plan ON store_subscriptions(plan_id);

INSERT INTO plans (id, name, tagline, price_inr_monthly, price_usd_monthly, ai_budget_usd, knowledge_doc_limit, features, sort_order) VALUES
  ('starter', 'Starter', 'AI shopping assistant for stores getting started.', 2999, 39, 15, 5,
   '["overview","live_pulse","widget","catalogue","leads"]'::jsonb, 1),
  ('growth', 'Growth', 'Support, email recovery and reorders on top of the assistant.', 7999, 99, 40, 15,
   '["overview","live_pulse","widget","catalogue","leads","funnel","growth_copilot","support_tickets","email_automation","smart_reorder","ai_agent_chat"]'::jsonb, 2),
  ('pro', 'Pro', 'Everything, including WhatsApp and the full ads suite.', 14999, 199, 100, 25,
   '["overview","live_pulse","widget","catalogue","leads","funnel","growth_copilot","support_tickets","email_automation","smart_reorder","ai_agent_chat","whatsapp","meta_ads","ads_explorer","ad_creative","ad_intelligence","ai_store_analysis"]'::jsonb, 3),
  ('enterprise', 'Enterprise', 'Custom limits, several stores and priority support.', NULL, NULL, 250, 50,
   '["overview","live_pulse","widget","catalogue","leads","funnel","growth_copilot","support_tickets","email_automation","smart_reorder","ai_agent_chat","whatsapp","meta_ads","ads_explorer","ad_creative","ad_intelligence","ai_store_analysis"]'::jsonb, 4)
ON CONFLICT (id) DO NOTHING;
