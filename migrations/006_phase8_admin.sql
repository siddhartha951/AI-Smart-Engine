-- Migration 006: Phase 8 Admin Dashboard Schema

-- 1. Add status to merchants table
ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active';

ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS onboarding_token UUID;

ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS onboarding_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants (status);
CREATE INDEX IF NOT EXISTS idx_merchants_onboarding_token ON merchants (onboarding_token);

-- 2. Platform Configuration table
CREATE TABLE IF NOT EXISTS platform_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monthly_ai_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 15.00,
    ai_warn_threshold_usd NUMERIC(10, 2) NOT NULL DEFAULT 10.00,
    ai_stop_threshold_usd NUMERIC(10, 2) NOT NULL DEFAULT 14.00,
    default_chat_limit_per_store INT NOT NULL DEFAULT 500,
    default_token_limit_per_store INT NOT NULL DEFAULT 100000,
    default_email_recovery_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    default_email_max_recovery INT NOT NULL DEFAULT 3,
    default_email_interval_minutes INT NOT NULL DEFAULT 60,
    default_widget_position VARCHAR(20) NOT NULL DEFAULT 'bottom-right',
    default_widget_primary_colour VARCHAR(30) NOT NULL DEFAULT '#1a1a1a',
    global_pause BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Admin Alerts table
CREATE TABLE IF NOT EXISTS admin_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_active ON admin_alerts (acknowledged, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_type ON admin_alerts (type);
