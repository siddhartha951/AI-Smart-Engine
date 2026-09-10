-- 013_widget_ui_and_currency.sql
-- Add avatar_url, header_title, and custom_css to widget_settings table
ALTER TABLE widget_settings ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE widget_settings ADD COLUMN IF NOT EXISTS header_title VARCHAR(100);
ALTER TABLE widget_settings ADD COLUMN IF NOT EXISTS custom_css TEXT;
