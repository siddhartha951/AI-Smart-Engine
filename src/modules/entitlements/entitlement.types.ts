export const FeatureKey = {
  OVERVIEW: 'overview',
  LIVE_PULSE: 'live_pulse',
  FUNNEL: 'funnel',
  LEADS: 'leads',
  WIDGET: 'widget',
  CATALOGUE: 'catalogue',
  AD_CREATIVE: 'ad_creative',
  WHATSAPP: 'whatsapp',
  EMAIL_AUTOMATION: 'email_automation',
  SMART_REORDER: 'smart_reorder',
  AD_INTELLIGENCE: 'ad_intelligence',
  META_ADS: 'meta_ads',
  ADS_EXPLORER: 'ads_explorer',
  GROWTH_COPILOT: 'growth_copilot',
  AI_AGENT_CHAT: 'ai_agent_chat',
  AI_STORE_ANALYSIS: 'ai_store_analysis',
} as const;

export type FeatureKey = (typeof FeatureKey)[keyof typeof FeatureKey];

export interface FeatureMetadata {
  key: FeatureKey;
  name: string;
  category: 'core' | 'growth' | 'marketing' | 'intelligence';
  description: string;
  defaultEnabled: boolean;
}

export const ALL_FEATURE_KEYS: FeatureKey[] = [
  'overview',
  'live_pulse',
  'funnel',
  'leads',
  'widget',
  'catalogue',
  'ad_creative',
  'whatsapp',
  'email_automation',
  'smart_reorder',
  'ad_intelligence',
  'meta_ads',
  'ads_explorer',
  'growth_copilot',
  'ai_agent_chat',
  'ai_store_analysis',
];

export const FEATURE_CATALOG: Record<FeatureKey, FeatureMetadata> = {
  overview: {
    key: 'overview',
    name: 'Overview Dashboard',
    category: 'core',
    description: 'High-level executive metrics, KPIs, and store insights.',
    defaultEnabled: true,
  },
  live_pulse: {
    key: 'live_pulse',
    name: 'Live Pulse',
    category: 'core',
    description: 'Real-time active shopper monitoring and storefront telemetry.',
    defaultEnabled: true,
  },
  funnel: {
    key: 'funnel',
    name: 'Conversion Funnel',
    category: 'growth',
    description: 'Step-by-step visitor funnel and drop-off analytics.',
    defaultEnabled: true,
  },
  leads: {
    key: 'leads',
    name: 'Leads & Opt-ins',
    category: 'marketing',
    description: 'Captured shopper emails, phone numbers, and consent ledgers.',
    defaultEnabled: true,
  },
  widget: {
    key: 'widget',
    name: 'Storefront Assistant Widget',
    category: 'core',
    description: 'AI Shopping Assistant embed snippet and launcher settings.',
    defaultEnabled: true,
  },
  catalogue: {
    key: 'catalogue',
    name: 'Products & Catalogue',
    category: 'core',
    description: 'Shopify product catalog, synchronization, and AI audit.',
    defaultEnabled: true,
  },
  ad_creative: {
    key: 'ad_creative',
    name: 'AI Ad Creative Studio',
    category: 'marketing',
    description: 'Direct-response Meta ad copy and creative image generation.',
    defaultEnabled: true,
  },
  whatsapp: {
    key: 'whatsapp',
    name: 'WhatsApp Growth Engine',
    category: 'marketing',
    description: 'Meta WhatsApp Cloud API & WATI conversational automation.',
    defaultEnabled: true,
  },
  email_automation: {
    key: 'email_automation',
    name: 'Email Recovery Automation',
    category: 'marketing',
    description: 'Resend abandoned cart recovery sequences and AI email generator.',
    defaultEnabled: true,
  },
  smart_reorder: {
    key: 'smart_reorder',
    name: 'Smart Reorder & Replenishment',
    category: 'growth',
    description: 'Consumable product lifecycle tracking and 1-click cart permalinks.',
    defaultEnabled: true,
  },
  ad_intelligence: {
    key: 'ad_intelligence',
    name: 'Ad Intelligence & Attribution',
    category: 'intelligence',
    description: 'Multi-touch attribution models, ROAS calculation, and ad insights.',
    defaultEnabled: true,
  },
  meta_ads: {
    key: 'meta_ads',
    name: 'Meta Ads Manager',
    category: 'intelligence',
    description: 'Live Meta Marketing API campaign performance, spend tracking, and ROAS dashboards.',
    defaultEnabled: true,
  },
  ads_explorer: {
    key: 'ads_explorer',
    name: 'Ads Explorer',
    category: 'intelligence',
    description: 'Visual creative explorer for Meta ad campaigns with filtering and cached previews.',
    defaultEnabled: true,
  },
  growth_copilot: {
    key: 'growth_copilot',
    name: 'AI Merchant Growth Copilot',
    category: 'intelligence',
    description: 'Data-grounded AI advisor with actionable growth recommendations.',
    defaultEnabled: true,
  },
  ai_agent_chat: {
    key: 'ai_agent_chat',
    name: 'AI Agent Chat',
    category: 'intelligence',
    description: 'In-dashboard AI chat assistant for merchants with document upload and store-grounded answers.',
    defaultEnabled: true,
  },
  ai_store_analysis: {
    key: 'ai_store_analysis',
    name: 'AI Store Deep Audit',
    category: 'intelligence',
    description: 'Comprehensive store health score and revenue growth audit.',
    defaultEnabled: true,
  },
};
