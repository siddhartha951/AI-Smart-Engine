-- Migration 037: product variants for in-chat pickers + merchant recommendation settings

-- Variants (pack size / colour / size) and option lists synced from Shopify.
-- Filled on the next catalog sync; existing rows keep working with empty lists.
ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_options JSONB NOT NULL DEFAULT '[]'::jsonb;

-- How the assistant recommends products (My Agent -> Product recommendations)
--   product_suggestion_mode: ask_first (ask before showing products) | direct
--   product_display_style:   cards | compact | links (links = text links only, no Add to cart)
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS product_suggestion_mode VARCHAR(20) NOT NULL DEFAULT 'ask_first';
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS product_display_style VARCHAR(20) NOT NULL DEFAULT 'cards';
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS max_recommendations INT NOT NULL DEFAULT 3;
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS show_product_variants BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS show_product_reason BOOLEAN NOT NULL DEFAULT true;
