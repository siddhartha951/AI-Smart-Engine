-- Migration 021: Auto Replenishment & Reorder Engine ("Smart Reorder" / "Reorder Reminders")

-- 1. Product Replenishment Settings Table
CREATE TABLE IF NOT EXISTS replenishment_product_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id VARCHAR(255) NOT NULL,
    variant_id VARCHAR(255) DEFAULT '',
    replenishable BOOLEAN NOT NULL DEFAULT FALSE,
    cycle_days INT NOT NULL DEFAULT 30,
    reminder_days_before INT NOT NULL DEFAULT 5,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_replenish_prod_setting UNIQUE (store_id, product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_replenish_settings_store ON replenishment_product_settings (store_id);
CREATE INDEX IF NOT EXISTS idx_replenish_settings_store_prod ON replenishment_product_settings (store_id, product_id);

-- 2. Customer Replenishment Schedules Table
CREATE TABLE IF NOT EXISTS replenishment_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    order_id VARCHAR(255) NOT NULL,
    order_number VARCHAR(100),
    product_id VARCHAR(255) NOT NULL,
    variant_id VARCHAR(255) DEFAULT '',
    product_title VARCHAR(500) NOT NULL,
    product_image_url TEXT DEFAULT '',
    product_price NUMERIC(10,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'GBP',
    purchased_at TIMESTAMPTZ NOT NULL,
    cycle_days INT NOT NULL,
    expected_reorder_at TIMESTAMPTZ NOT NULL,
    reminder_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'suppressed' | 'repurchased' | 'cancelled'
    channel VARCHAR(50) DEFAULT 'email',
    sent_at TIMESTAMPTZ,
    sent_channel VARCHAR(50),
    reorder_checkout_url TEXT,
    cancel_reason VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_replenish_sched_order_line UNIQUE (store_id, order_id, product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_replenish_sched_due ON replenishment_schedules (status, reminder_at);
CREATE INDEX IF NOT EXISTS idx_replenish_sched_store ON replenishment_schedules (store_id, status);
CREATE INDEX IF NOT EXISTS idx_replenish_sched_cust ON replenishment_schedules (store_id, customer_email, customer_phone);

-- 3. Store Replenishment Channel Configuration Table
CREATE TABLE IF NOT EXISTS replenishment_channel_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    discount_code VARCHAR(50) DEFAULT '',
    discount_percentage NUMERIC(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replenish_channel_store ON replenishment_channel_settings (store_id);
