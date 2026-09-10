-- 012_recommendations_media_and_utm.sql
-- Add media and storefront URL columns to recommendations
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS product_url TEXT;

-- Optimization indexes for events attribution
CREATE INDEX IF NOT EXISTS idx_events_store_type ON events (store_id, type);
CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id);
