export interface Merchant {
  id: string;
  name: string;
  contact_email: string;
  created_at: Date;
  updated_at: Date;
}

export interface Store {
  id: string;
  merchant_id: string;
  shop_domain: string;
  brand_name: string;
  currency?: string;
  timezone?: string;
  status: 'active' | 'paused' | 'disabled';
  live_tracking_enabled?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface StoreCredentials {
  id: string;
  store_id: string;
  encrypted_admin_token: string | null;
  encrypted_storefront_token: string | null;
  encryption_iv: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WidgetSettings {
  id: string;
  store_id: string;
  button_text: string;
  position: 'bottom-right' | 'bottom-left';
  primary_colour: string;
  secondary_colour: string;
  greeting: string;
  avatar_url?: string;
  header_title?: string;
  custom_css?: string;
  country_code?: string;
  avatar_persona?: string;
  offer_code?: string;
  offer_discount_percent?: number;
  offer_text?: string;
  proactive_nudge_enabled?: boolean;
  proactive_nudge_interval_seconds?: number;
  created_at: Date;
  updated_at: Date;
}

export interface AssistantSettings {
  id: string;
  store_id: string;
  assistant_name: string;
  is_active?: boolean;
  tone?: string;
  welcome_message?: string;
  custom_prompt?: string;
  knowledge_base?: string;
  allowed_topics: string[];
  support_contact: string;
  privacy_policy_url: string;
  created_at: Date;
  updated_at: Date;
}

export interface StorePolicy {
  id: string;
  store_id: string;
  delivery_policy: string;
  returns_policy: string;
  faq_content: string;
  created_at: Date;
  updated_at: Date;
}

export interface Visitor {
  id: string;
  store_id: string;
  anonymous_id: string;
  email: string | null;
  phone: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MarketingConsent {
  id: string;
  store_id: string;
  visitor_id: string;
  opted_in: boolean;
  captured_at: Date;
  source: string;
  version: string;
  wording: string;
  created_at: Date;
}

export interface ChatSession {
  id: string;
  store_id: string;
  visitor_id: string;
  started_at: Date;
  ended_at: Date | null;
  status: 'active' | 'completed' | 'abandoned';
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ChatMessage {
  id: string;
  store_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ai_input_tokens: number;
  ai_output_tokens: number;
  estimated_cost_usd: number;
  created_at: Date;
}

export interface Recommendation {
  id: string;
  store_id: string;
  session_id: string;
  product_id: string;
  variant_id: string;
  title: string;
  price: number;
  compare_at_price?: number;
  currency: string;
  reason: string;
  image_url?: string;
  product_url?: string;
  created_at: Date;
}

export interface EventRecord {
  id: string;
  store_id: string;
  visitor_id: string;
  session_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

export interface EmailCampaignEvent {
  id: string;
  store_id: string;
  visitor_id: string;
  session_id: string | null;
  campaign_type: string;
  stage: number;
  scheduled_for: Date;
  sent_at: Date | null;
  status: 'pending' | 'processing' | 'sent' | 'cancelled' | 'failed';
  cancel_reason: string | null;
  retry_count: number;
  last_error: string | null;
  provider_message_id?: string | null;
  idempotency_key?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SuppressionEntry {
  id: string;
  store_id: string;
  email: string;
  reason: string;
  created_at: Date;
}

export interface AiUsageLedger {
  id: string;
  store_id: string;
  session_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  billing_period: string;
  created_at: Date;
}

export interface MerchantSenderDomain {
  id: string;
  store_id: string;
  domain_name: string;
  provider: string;
  provider_domain_id: string;
  status: 'pending' | 'verified' | 'failed' | 'temporary_failure';
  dns_records: Array<{
    record?: string;
    name?: string;
    type?: string;
    value?: string;
    status?: string;
    ttl?: string;
    priority?: number;
  }>;
  sender_name: string | null;
  sender_email: string | null;
  is_default: boolean;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface EmailWebhookEvent {
  id: string;
  store_id: string;
  event_type: 'delivered' | 'bounced' | 'complained' | 'suppressed' | 'opened' | 'clicked' | string;
  recipient: string;
  provider_message_id?: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

export type AdPlatform = 'facebook' | 'instagram';
export type AdObjective = 'product_sales' | 'traffic' | 'retargeting' | 'product_launch';

export interface AdCreative {
  id: string;
  store_id: string;
  product_id: string;
  product_title: string;
  platform: AdPlatform;
  objective: AdObjective;
  hook: string;
  primary_text: string;
  headline: string;
  cta: string;
  image_url?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export type WhatsAppConfigStatus = 'disconnected' | 'connected' | 'error';
export type WhatsAppProviderType = 'meta' | 'wati' | 'mock';

export interface WhatsAppConfig {
  id: string;
  store_id: string;
  provider: WhatsAppProviderType;
  phone_number_id: string | null;
  waba_id: string | null;
  encrypted_access_token: string | null;
  webhook_verify_token: string | null;
  app_secret: string | null;
  display_phone_number: string | null;
  wati_api_endpoint?: string | null;
  encrypted_wati_token?: string | null;
  status: WhatsAppConfigStatus;
  quality_rating: string | null;
  created_at: Date;
  updated_at: Date;
}

export type MetaAdsConfigStatus = 'disconnected' | 'connected' | 'error';

export interface MetaAdsConfig {
  id: string;
  store_id: string;
  encrypted_access_token: string | null;
  ad_account_id: string | null;
  ad_account_name: string | null;
  account_currency: string | null;
  token_connected_at: Date | null;
  token_expires_at: Date | null;
  status: MetaAdsConfigStatus;
  last_error: string | null;
  last_sync_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface WhatsAppConsent {
  id: string;
  store_id: string;
  phone_number: string;
  visitor_id: string | null;
  opted_in: boolean;
  wording: string;
  source: string;
  captured_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export interface WhatsAppConversation {
  id: string;
  store_id: string;
  phone_number: string;
  customer_name: string | null;
  visitor_id: string | null;
  status: 'active' | 'closed';
  last_message_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface WhatsAppMessage {
  id: string;
  store_id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  message_type: 'text' | 'template' | 'interactive';
  content: string;
  wamid: string | null;
  status: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
  ai_generated: boolean;
  tokens_used: number;
  cost_usd: number;
  error_message: string | null;
  created_at: Date;
}

export interface WhatsAppRecoveryJob {
  id: string;
  store_id: string;
  phone_number: string;
  visitor_id: string | null;
  cart_token: string | null;
  product_id: string | null;
  product_title: string | null;
  price: number | null;
  currency: string | null;
  checkout_url: string | null;
  idempotency_key: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  cancel_reason: string | null;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface WhatsAppWebhookEvent {
  id: string;
  store_id: string | null;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

export interface ReplenishmentProductSettings {
  id: string;
  store_id: string;
  product_id: string;
  variant_id: string;
  replenishable: boolean;
  cycle_days: number;
  reminder_days_before: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ReplenishmentSchedule {
  id: string;
  store_id: string;
  visitor_id: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  order_id: string;
  order_number: string | null;
  product_id: string;
  variant_id: string;
  product_title: string;
  product_image_url: string;
  product_price: number;
  currency: string;
  purchased_at: Date;
  cycle_days: number;
  expected_reorder_at: Date;
  reminder_at: Date;
  status: 'pending' | 'sent' | 'suppressed' | 'repurchased' | 'cancelled';
  channel: 'email' | 'whatsapp' | 'both';
  sent_at: Date | null;
  sent_channel: string | null;
  reorder_checkout_url: string | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReplenishmentChannelSettings {
  id: string;
  store_id: string;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  discount_code: string;
  discount_percentage: number;
  created_at: Date;
  updated_at: Date;
}

// ==========================================
// Phase 15: Multi-Touch Ad Intelligence & Attribution
// ==========================================

export type AttributionModel = 'first_touch' | 'last_touch' | 'linear';

export interface MarketingTouchpoint {
  id: string;
  store_id: string;
  visitor_id: string;
  session_id: string | null;
  touchpoint_type: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
  fbclid: string;
  gclid: string;
  ttclid: string;
  landing_page_url: string;
  referrer_url: string;
  created_at: Date;
}

export interface AdSpend {
  id: string;
  store_id: string;
  spend_date: string;
  platform: string;
  campaign: string;
  spend_amount: number;
  currency: string;
  notes: string;
  created_at: Date;
  updated_at: Date;
}

export interface OrderAttribution {
  id: string;
  store_id: string;
  order_id: string;
  order_number: string | null;
  visitor_id: string | null;
  customer_email: string | null;
  order_revenue: number;
  currency: string;
  order_created_at: Date;
  first_touchpoint_id: string | null;
  first_touch_source: string;
  first_touch_campaign: string;
  last_touchpoint_id: string | null;
  last_touch_source: string;
  last_touch_campaign: string;
  touchpoint_count: number;
  is_ai_assisted: boolean;
  ai_assisted_revenue: number;
  ai_session_id: string | null;
  matched_recommendation_ids: string[];
  created_at: Date;
  updated_at: Date;
}

export interface OrderAttributionTouchpoint {
  id: string;
  store_id: string;
  order_id: string;
  touchpoint_id: string;
  weight: number;
  attributed_revenue: number;
  source: string;
  campaign: string;
  created_at: Date;
}

export interface AttributionOverview {
  model: AttributionModel;
  total_spend: number;
  attributed_revenue: number;
  total_orders: number;
  roas: number;
  ai_assisted_revenue: number;
  currency: string;
}

export interface ChannelPerformance {
  channel: string;
  spend: number;
  orders: number;
  attributed_revenue: number;
  roas: number;
  currency: string;
}

export interface CampaignPerformance {
  campaign: string;
  source: string;
  spend: number;
  orders: number;
  attributed_revenue: number;
  roas: number;
  currency: string;
}

export interface CustomerJourneyTouchpoint {
  id: string;
  type: 'touchpoint' | 'ai_session' | 'cart_add' | 'order';
  title: string;
  subtitle: string;
  timestamp: Date;
  metadata: Record<string, any>;
}

export interface CustomerJourneyTimeline {
  order_id: string;
  order_number: string | null;
  order_revenue: number;
  currency: string;
  visitor_id: string | null;
  customer_email: string | null;
  first_touch: { source: string; campaign: string };
  last_touch: { source: string; campaign: string };
  is_ai_assisted: boolean;
  ai_assisted_revenue: number;
  timeline: CustomerJourneyTouchpoint[];
}

// ============================================================
// Phase 16: AI Merchant Growth Copilot & Action Center Types
// ============================================================

export type MerchantGoalType =
  | 'increase_revenue'
  | 'improve_roas'
  | 'improve_conversion'
  | 'increase_repeat_purchases'
  | 'recover_abandoned_carts'
  | 'improve_ai_conversion';

export type GrowthActionType =
  | 'VIEW_CAMPAIGN'
  | 'REVIEW_PRODUCT'
  | 'OPEN_CART_RECOVERY'
  | 'OPEN_REORDER'
  | 'VIEW_AI_ANALYTICS'
  | 'VIEW_ATTRIBUTION'
  | 'VIEW_CUSTOMER_JOURNEY';

export type GrowthActionPriority = 'critical' | 'high' | 'medium' | 'low';
export type GrowthActionStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';

export interface GrowthGoal {
  id: string;
  store_id: string;
  primary_goal: MerchantGoalType;
  target_metric?: string | null;
  target_value?: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface GrowthAction {
  id: string;
  store_id: string;
  action_key: string;
  title: string;
  priority: GrowthActionPriority;
  reason: string;
  estimated_opportunity: number;
  action_type: GrowthActionType;
  target_module: string;
  target_id: string;
  status: GrowthActionStatus;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface GrowthActionHistory {
  id: string;
  store_id: string;
  action_id?: string | null;
  action_key: string;
  action_type: GrowthActionType;
  status: GrowthActionStatus;
  user_id?: string | null;
  notes?: string | null;
  created_at: Date;
}

export interface GrowthOverview {
  total_revenue: number;
  total_orders: number;
  average_order_value: number;
  conversion_rate: number;
  total_ad_spend: number;
  blended_roas: number;
  ai_assisted_revenue: number;
  abandoned_carts_count: number;
  reorder_schedules_due: number;
  estimated_growth_opportunity: number;
  currency: string;
  email_recovery: {
    jobs_total: number;
    jobs_sent: number;
    jobs_failed: number;
    jobs_cancelled: number;
    recovered_shoppers: number;
    recovered_revenue: number;
  };
  whatsapp: {
    messages_sent: number;
    conversations: number;
    recovery_jobs_total: number;
    recovery_jobs_sent: number;
  };
}

export interface WeeklyGrowthSummary {
  period_start: string;
  period_end: string;
  metrics: {
    revenue: number;
    orders: number;
    conversion_rate: number;
    ad_spend: number;
    roas: number;
    ai_assisted_revenue: number;
    recovered_revenue: number;
    reorder_revenue: number;
    currency: string;
  };
  what_changed: string[];
  top_actions: GrowthAction[];
}
