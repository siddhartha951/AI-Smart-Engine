-- Migration 008: Phase 9 Onboarding
-- Add missing fields to stores table for business details
ALTER TABLE stores ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'GBP';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Europe/London';
