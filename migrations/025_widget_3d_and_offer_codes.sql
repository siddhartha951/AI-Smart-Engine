-- Migration 025: Widget 3D Persona, India Localization, and Special Offer Engine

-- 1. Add 3D, Localization, and Offer Code settings to widget_settings
ALTER TABLE widget_settings
ADD COLUMN IF NOT EXISTS country_code VARCHAR(10) DEFAULT 'IN',
ADD COLUMN IF NOT EXISTS avatar_persona VARCHAR(50) DEFAULT 'female',
ADD COLUMN IF NOT EXISTS offer_code VARCHAR(50) DEFAULT '',
ADD COLUMN IF NOT EXISTS offer_discount_percent NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS offer_text VARCHAR(255) DEFAULT '',
ADD COLUMN IF NOT EXISTS proactive_nudge_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS proactive_nudge_interval_seconds INTEGER DEFAULT 60;

-- 2. Add compare_at_price to products catalog
ALTER TABLE products
ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(10,2) DEFAULT 0;

-- 3. Backfill defaults for existing stores
UPDATE widget_settings
SET country_code = COALESCE(country_code, 'IN'),
    avatar_persona = COALESCE(avatar_persona, 'female'),
    offer_code = COALESCE(offer_code, ''),
    offer_discount_percent = COALESCE(offer_discount_percent, 0),
    offer_text = COALESCE(offer_text, ''),
    proactive_nudge_enabled = COALESCE(proactive_nudge_enabled, true),
    proactive_nudge_interval_seconds = COALESCE(proactive_nudge_interval_seconds, 60);

UPDATE products
SET compare_at_price = COALESCE(compare_at_price, 0);

