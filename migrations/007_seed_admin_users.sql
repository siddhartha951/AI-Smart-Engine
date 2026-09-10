-- Migration 007: Seed Admin Users and Platform Config

-- 1. Update existing platform_admin to super_admin
UPDATE users SET role = 'super_admin' WHERE email = 'admin@platform.com';

-- 2. Seed Operations Admin
INSERT INTO users (email, password_hash, role)
VALUES (
    'ops_admin@platform.com',
    '$2b$10$vtBpjJ0t4.cpwJl4QPHB1uAbHmxoDcbCfATIRgDmPcKGGSeSY3T1a',
    'ops_admin'
)
ON CONFLICT (email) DO NOTHING;

-- 3. Seed default platform config
INSERT INTO platform_config (
    monthly_ai_budget_usd,
    ai_warn_threshold_usd,
    ai_stop_threshold_usd,
    default_chat_limit_per_store,
    default_token_limit_per_store,
    default_email_recovery_enabled,
    default_email_max_recovery,
    default_email_interval_minutes,
    default_widget_position,
    default_widget_primary_colour,
    global_pause
) VALUES (
    15.00,
    10.00,
    14.00,
    500,
    100000,
    TRUE,
    3,
    60,
    'bottom-right',
    '#1a1a1a',
    FALSE
)
ON CONFLICT DO NOTHING;

-- 4. Set existing merchants to active status
UPDATE merchants SET status = 'active' WHERE status = 'active' OR status IS NULL;
