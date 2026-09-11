-- Migration 020: Add image_url to ad_creatives table for AI visual assets
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
