-- Migration 011: Synced Products Catalog Table
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(255) PRIMARY KEY,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    shopify_id VARCHAR(255) NOT NULL,
    variant_id VARCHAR(255) DEFAULT '',
    title VARCHAR(500) NOT NULL,
    handle VARCHAR(255) DEFAULT '',
    price NUMERIC(10,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'INR',
    in_stock BOOLEAN DEFAULT TRUE,
    category VARCHAR(255) DEFAULT '',
    image_url TEXT DEFAULT '',
    product_url TEXT DEFAULT '',
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_store_stock ON products (store_id, in_stock);
CREATE INDEX IF NOT EXISTS idx_products_store_title ON products (store_id, title);
CREATE INDEX IF NOT EXISTS idx_products_store_category ON products (store_id, category);
