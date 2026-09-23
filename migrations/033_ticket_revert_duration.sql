-- Migration 033: Add ticket_revert_duration to assistant_settings
-- Allows merchants to configure their support SLA (e.g. "within 2 hours", "within 24 hours")
-- which the AI and confirmation receipts will quote to customers.

ALTER TABLE assistant_settings 
ADD COLUMN IF NOT EXISTS ticket_revert_duration VARCHAR(100) DEFAULT 'within 24 hours';
