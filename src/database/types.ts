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
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

