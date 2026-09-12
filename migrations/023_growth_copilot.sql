-- Migration 023: AI Merchant Growth Copilot & Action Center
-- Phase 16 Database Schema

CREATE TABLE IF NOT EXISTS growth_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  primary_goal VARCHAR(60) NOT NULL DEFAULT 'increase_revenue',
  target_metric VARCHAR(60),
  target_value NUMERIC(12, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_growth_goals_store UNIQUE (store_id)
);

CREATE TABLE IF NOT EXISTS growth_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  action_key VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  reason TEXT NOT NULL,
  estimated_opportunity NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  action_type VARCHAR(60) NOT NULL,
  target_module VARCHAR(60) NOT NULL,
  target_id VARCHAR(255) DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_growth_actions_store_key_target UNIQUE (store_id, action_key, target_id)
);

CREATE TABLE IF NOT EXISTS growth_action_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  action_id UUID REFERENCES growth_actions(id) ON DELETE SET NULL,
  action_key VARCHAR(100) NOT NULL,
  action_type VARCHAR(60) NOT NULL,
  status VARCHAR(30) NOT NULL,
  user_id UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_goals_store ON growth_goals(store_id);
CREATE INDEX IF NOT EXISTS idx_growth_actions_store_status ON growth_actions(store_id, status);
CREATE INDEX IF NOT EXISTS idx_growth_actions_store_priority ON growth_actions(store_id, priority);
CREATE INDEX IF NOT EXISTS idx_growth_action_history_store ON growth_action_history(store_id, created_at DESC);
