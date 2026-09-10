-- Migration 015: Feature flags for per-store live tracking and telemetry
ALTER TABLE stores ADD COLUMN IF NOT EXISTS live_tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS default_live_tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE;
