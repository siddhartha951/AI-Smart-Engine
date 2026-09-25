-- Migration 040: Real Shopify data for the dashboard, order tracking in chat, and a learning loop
--
-- Purely additive. Nothing existing changes meaning:
--   * shopify_orders is filled by the orders sync (worker, every few minutes) and by webhooks.
--     Home / Growth Copilot / Ask AI read it when it has rows; stores without it keep the old sources.
--   * shopify_sync_state tells the merchant which data is flowing and which scope blocks it.
--   * chat_order_lookups keeps the order a shopper verified in one chat session (no email/phone stored).
--   * ai_learning_items / ai_feedback hold what the assistants should learn, approved by the merchant.

-- 1. Orders mirrored from Shopify. No raw email or phone: customer matching uses a hash.
CREATE TABLE IF NOT EXISTS shopify_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_order_id VARCHAR(40) NOT NULL,
  order_number VARCHAR(40),
  name VARCHAR(80),
  created_at_shop TIMESTAMPTZ NOT NULL,
  updated_at_shop TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  financial_status VARCHAR(40),
  fulfillment_status VARCHAR(40),
  currency VARCHAR(10),
  total_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  subtotal_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_discounts NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_tax NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_shipping NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_refunded NUMERIC(14, 2) NOT NULL DEFAULT 0,
  item_count INT NOT NULL DEFAULT 0,
  line_items JSONB NOT NULL DEFAULT '[]',
  discount_codes JSONB NOT NULL DEFAULT '[]',
  payment_gateways JSONB NOT NULL DEFAULT '[]',
  customer_id VARCHAR(40),
  customer_email_hash VARCHAR(64),
  customer_orders_count INT,
  source_name VARCHAR(80),
  landing_site TEXT,
  referring_site TEXT,
  shipping_city VARCHAR(120),
  shipping_country VARCHAR(80),
  tags TEXT,
  is_test BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_shopify_orders_store_order UNIQUE (store_id, shopify_order_id)
);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_store_created ON shopify_orders (store_id, created_at_shop DESC);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_store_number ON shopify_orders (store_id, order_number);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_store_customer ON shopify_orders (store_id, customer_id);

-- 2. Per-store health of every data feed (orders sync, webhooks, Meta spend, checkout pixel)
CREATE TABLE IF NOT EXISTS shopify_sync_state (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  resource VARCHAR(30) NOT NULL,           -- orders | webhooks | meta_spend | pixel
  status VARCHAR(20) NOT NULL DEFAULT 'never', -- never | ok | blocked | error | running
  blocked_scope VARCHAR(60),               -- e.g. read_orders when Shopify answered 403
  last_error TEXT,
  cursor_updated_at TIMESTAMPTZ,           -- orders: newest updated_at already mirrored
  backfill_done BOOLEAN NOT NULL DEFAULT false,
  records_synced INT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (store_id, resource)
);

-- 3. Each store's custom app signs its webhooks with its own API secret key
ALTER TABLE store_credentials ADD COLUMN IF NOT EXISTS encrypted_webhook_secret TEXT;

-- 4. The order a shopper verified in a chat (order number + matching email/phone)
CREATE TABLE IF NOT EXISTS chat_order_lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'awaiting', -- awaiting | verified | failed
  order_ref VARCHAR(60),
  shopify_order_id VARCHAR(40),
  snapshot JSONB,
  failed_attempts INT NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_order_lookups_session ON chat_order_lookups (store_id, session_id, updated_at DESC);

-- 5. What the assistants should learn. Nothing reaches shoppers until the merchant approves it.
CREATE TABLE IF NOT EXISTS ai_learning_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  surface VARCHAR(20) NOT NULL,            -- shopper (storefront chat) | merchant (Ask AI)
  source VARCHAR(30) NOT NULL,             -- unanswered | thumbs_down | merchant_note
  question TEXT NOT NULL,
  question_key VARCHAR(200) NOT NULL,      -- normalised question, groups repeats
  bot_answer TEXT,
  correct_answer TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open', -- open | approved | dismissed
  occurrences INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_learning_store_status ON ai_learning_items (store_id, surface, status);
CREATE INDEX IF NOT EXISTS idx_ai_learning_store_key ON ai_learning_items (store_id, surface, question_key);

-- 6. Thumbs up / down on assistant answers
CREATE TABLE IF NOT EXISTS ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  surface VARCHAR(20) NOT NULL,
  session_id VARCHAR(64),
  rating SMALLINT NOT NULL,                -- 1 = helpful, -1 = not helpful
  question TEXT,
  answer TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_store ON ai_feedback (store_id, surface, created_at DESC);

-- 7. Growth Copilot measures whether a completed action actually moved the numbers
ALTER TABLE growth_actions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE growth_actions ADD COLUMN IF NOT EXISTS baseline_metrics JSONB;
ALTER TABLE growth_actions ADD COLUMN IF NOT EXISTS outcome JSONB;
ALTER TABLE growth_actions ADD COLUMN IF NOT EXISTS last_detected_at TIMESTAMPTZ;
