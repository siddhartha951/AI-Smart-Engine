-- Migration 031: Product Knowledge, Tags and Best-Seller Intelligence
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS is_bestseller BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS sales_rank INT DEFAULT 999;

CREATE INDEX IF NOT EXISTS idx_products_bestseller ON products (store_id, is_bestseller, sales_rank);
CREATE INDEX IF NOT EXISTS idx_products_sales_rank ON products (store_id, sales_rank);
