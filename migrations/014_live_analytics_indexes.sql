-- Migration 014: Live Analytics & Performance Indexes
CREATE INDEX IF NOT EXISTS idx_events_store_type_created ON events(store_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_store_created ON events(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_visitor_store ON events(store_id, visitor_id, created_at DESC);
