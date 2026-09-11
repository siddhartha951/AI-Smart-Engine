-- Migration 016: AI Ad Creative Studio Table
CREATE TABLE IF NOT EXISTS ad_creatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id VARCHAR(255) NOT NULL,
    product_title VARCHAR(500) NOT NULL,
    platform VARCHAR(50) NOT NULL, -- 'facebook' | 'instagram'
    objective VARCHAR(50) NOT NULL, -- 'product_sales' | 'traffic' | 'retargeting' | 'product_launch'
    hook TEXT NOT NULL,
    primary_text TEXT NOT NULL,
    headline VARCHAR(500) NOT NULL,
    cta VARCHAR(100) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_store_created ON ad_creatives (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_store_product ON ad_creatives (store_id, product_id);
