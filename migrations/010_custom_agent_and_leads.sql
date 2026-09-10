-- Migration 010: Custom Agent Training & Leads Enhancements

-- 1. Add custom_prompt and knowledge_base columns to assistant_settings
ALTER TABLE assistant_settings
ADD COLUMN IF NOT EXISTS custom_prompt TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS knowledge_base TEXT DEFAULT '';

-- 2. Add index to marketing_consents for efficient leads reporting
CREATE INDEX IF NOT EXISTS idx_marketing_consents_store_date 
ON marketing_consents (store_id, captured_at DESC);

-- 3. Ensure events table index for purchase tracking
CREATE INDEX IF NOT EXISTS idx_events_store_type_created 
ON events (store_id, type, created_at DESC);
