import { z } from 'zod';

// =========================================================================
// 1. STORE DEEP AUDIT
// =========================================================================

export const PriorityActionSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  impact: z.enum(['high', 'medium', 'low']),
  priority: z.enum(['p1', 'p2', 'p3']),
  affected_area: z.string(),
  supporting_metric: z.string(),
  suggested_action: z.string(),
});

export const RevenueOpportunitySchema = z.object({
  title: z.string(),
  estimated_monthly_impact_usd: z.number(),
  rationale: z.string(),
  action: z.string(),
});

export const StoreAnalysisSchema = z.object({
  summary: z.string(),
  health_score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  problems: z.array(z.string()),
  opportunities: z.array(z.string()),
  priority_actions: z.array(PriorityActionSchema),
  catalogue_issues: z.array(z.string()),
  conversion_issues: z.array(z.string()),
  marketing_issues: z.array(z.string()),
  revenue_opportunities: z.array(RevenueOpportunitySchema),
});

export type StoreAnalysisResult = z.infer<typeof StoreAnalysisSchema>;

// =========================================================================
// 2. OVERVIEW AI INSIGHTS
// =========================================================================

export const InsightCardDetailSchema = z.object({
  title: z.string(),
  description: z.string(),
  action: z.string(),
  target_tab: z.string(),
});

export const OverviewInsightsSchema = z.object({
  what_is_happening: z.string(),
  why_it_is_happening: z.string(),
  what_to_do_next: z.string(),
  biggest_opportunity: InsightCardDetailSchema,
  biggest_problem: InsightCardDetailSchema,
  revenue_opportunity: z.string(),
  customer_opportunity: z.string(),
  catalogue_opportunity: z.string(),
  marketing_opportunity: z.string(),
});

export type OverviewInsightsResult = z.infer<typeof OverviewInsightsSchema>;

// =========================================================================
// 3. CATALOGUE AI AUDIT & IMPROVEMENT
// =========================================================================

export const FaqSuggestionSchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return { question: 'Product details?', answer: 'Check store product details.' };
  const obj = { ...val };
  if (!obj.question && obj.q) obj.question = obj.q;
  if (!obj.answer && obj.a) obj.answer = obj.a;
  return obj;
}, z.object({
  question: z.string().default('Product FAQ'),
  answer: z.string().default('Please check product specifications.'),
}).passthrough());

export const ProductSuggestionsSchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return {};
  const obj = { ...val };
  if (!obj.improved_title && obj.title) obj.improved_title = obj.title;
  if (!obj.improved_description && obj.description) obj.improved_description = obj.description;
  if (!obj.selling_points) obj.selling_points = obj.features || obj.points || [];
  if (!Array.isArray(obj.selling_points)) obj.selling_points = [];
  if (!obj.faq_suggestions) obj.faq_suggestions = obj.faqs || [];
  if (!Array.isArray(obj.faq_suggestions)) obj.faq_suggestions = [];
  if (!obj.recommendation_tags) obj.recommendation_tags = obj.tags || obj.tags_to_add || [];
  if (!Array.isArray(obj.recommendation_tags)) obj.recommendation_tags = [];
  return obj;
}, z.object({
  improved_title: z.string().default('Enhanced Product Title'),
  improved_description: z.string().default('Quality crafted product with authentic materials and dependable design.'),
  selling_points: z.array(z.string()).default([]),
  faq_suggestions: z.array(FaqSuggestionSchema).default([]),
  recommendation_tags: z.array(z.string()).default([]),
}).passthrough());

export type ProductSuggestions = z.infer<typeof ProductSuggestionsSchema>;

export const CatalogueProductAnalysisSchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return val;
  const obj = { ...val };
  if (typeof obj.listing_quality_score === 'string') {
    obj.listing_quality_score = parseFloat(obj.listing_quality_score) || 75;
  }
  if (typeof obj.recommendation_suitability === 'string') {
    const s = obj.recommendation_suitability.toLowerCase();
    obj.recommendation_suitability = ['high', 'medium', 'low'].includes(s) ? s : 'medium';
  }
  if (!obj.problems || !Array.isArray(obj.problems)) obj.problems = [];
  return obj;
}, z.object({
  product_id: z.string().default(''),
  title: z.string().default('Product'),
  listing_quality_score: z.number().default(75),
  problems: z.array(z.string()).default([]),
  suggestions: ProductSuggestionsSchema,
  recommendation_suitability: z.enum(['high', 'medium', 'low']).default('medium'),
  conversion_risk: z.string().default('Low conversion risk.'),
}).passthrough());

export const CatalogueAnalysisSchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return val;
  const obj = { ...val };
  if (typeof obj.average_listing_score === 'string') {
    obj.average_listing_score = parseFloat(obj.average_listing_score) || 75;
  }
  if (!obj.products || !Array.isArray(obj.products)) obj.products = [];
  return obj;
}, z.object({
  overview_summary: z.string().default('Catalog analysis complete with recommendations.'),
  average_listing_score: z.number().default(75),
  products: z.array(CatalogueProductAnalysisSchema).default([]),
}).passthrough());

export type CatalogueProductAnalysis = z.infer<typeof CatalogueProductAnalysisSchema>;
export type CatalogueAnalysisResult = z.infer<typeof CatalogueAnalysisSchema>;

// =========================================================================
// 4. FUNNEL DROP-OFF INTELLIGENCE
// =========================================================================

export const FunnelDropOffSchema = z.object({
  stage: z.string(),
  drop_off_rate_percent: z.number(),
  friction_points: z.array(z.string()),
  hypothesized_cause: z.string(),
  recommended_fix: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
});

export const FunnelAnalysisSchema = z.object({
  executive_summary: z.string(),
  top_bottlenecks: z.array(FunnelDropOffSchema),
  overall_health: z.enum(['healthy', 'concerning', 'critical']),
  suggested_actions: z.array(z.string()),
});

export type FunnelAnalysisResult = z.infer<typeof FunnelAnalysisSchema>;

export const FunnelAskSchema = z.object({
  answer: z.string(),
  supporting_metrics: z.record(z.string(), z.any()),
  suggested_actions: z.array(z.string()),
});

export type FunnelAskResult = z.infer<typeof FunnelAskSchema>;

// =========================================================================
// 5. EMAIL AUTOMATION GENERATION (PHASE E)
// =========================================================================

export type EmailType =
  | 'welcome'
  | 'abandoned_cart'
  | 'browse_abandonment'
  | 'product_recommendation'
  | 'post_purchase'
  | 'review_request'
  | 'reengagement'
  | 'winback'
  | 'new_product_launch'
  | 'sale_promotion'
  | 'back_in_stock'
  | 'reorder_reminder'
  | 'custom';

export type EmailGoal =
  | 'generate_sales'
  | 'recover_cart'
  | 'announce_product'
  | 'reengage_customer'
  | 'educate_customer'
  | 'promote_collection'
  | 'reorder_reminder';

export type EmailTone = 'friendly' | 'premium' | 'minimal' | 'urgent' | 'helpful' | 'brand_voice';
export type EmailLength = 'short' | 'medium' | 'long';

export interface EmailGenerationRequest {
  email_type: string;
  goal: string;
  tone: string;
  length: string;
  custom_instruction?: string;
  product_id?: string;
}

export const EmailGenerationResultSchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return val;
  const obj = { ...val };
  if (!obj.subject && obj.subject_line) obj.subject = obj.subject_line;
  if (!obj.subject && obj.title) obj.subject = obj.title;
  if (!obj.preview_text && obj.preheader) obj.preview_text = obj.preheader;
  if (!obj.preview_text && obj.preview) obj.preview_text = obj.preview;
  if (!obj.preview_text && obj.snippet) obj.preview_text = obj.snippet;
  if (!obj.cta && obj.call_to_action) {
    obj.cta = typeof obj.call_to_action === 'string' ? obj.call_to_action : (obj.call_to_action.text || 'Shop Now');
  }
  if (!obj.cta && obj.button_text) obj.cta = obj.button_text;
  if (!obj.cta && obj.action) obj.cta = obj.action;
  if (!obj.alternative_subjects) {
    if (Array.isArray(obj.alternatives)) obj.alternative_subjects = obj.alternatives;
    else if (Array.isArray(obj.other_subjects)) obj.alternative_subjects = obj.other_subjects;
    else if (typeof obj.alternative_subjects === 'string') obj.alternative_subjects = [obj.alternative_subjects];
    else obj.alternative_subjects = [];
  }
  return obj;
}, z.object({
  subject: z.string().default('Special update from our store'),
  preview_text: z.string().default('Discover new arrivals and exclusive offers.'),
  body: z.string().default('Thank you for visiting our store. We look forward to serving you.'),
  cta: z.string().default('Shop Now'),
  alternative_subjects: z.array(z.string()).default([]),
}).passthrough());

export type EmailGenerationResult = z.infer<typeof EmailGenerationResultSchema>;

// =========================================================================
// 6. SMART REORDER AI RECOMMENDATIONS
// =========================================================================

export const ReorderRecommendationSchema = z.object({
  product_id: z.string(),
  title: z.string(),
  suggested_cycle_days: z.number().int().positive(),
  rationale: z.string(),
  estimated_repeat_rate_increase: z.string(),
});

export const ReorderRecommendationsListSchema = z.object({
  recommendations: z.array(ReorderRecommendationSchema),
});

export type ReorderRecommendation = z.infer<typeof ReorderRecommendationSchema>;

// =========================================================================
// 7. AD PERFORMANCE INTELLIGENCE
// =========================================================================

export const AdPerformanceRecommendationSchema = z.object({
  campaign_or_channel: z.string(),
  suggestion: z.string(),
  impact: z.enum(['scale', 'reduce', 'reallocate', 'creative_refresh']),
});

export const AdAnalysisSchema = z.object({
  has_ad_data: z.boolean(),
  overview_summary: z.string(),
  what_is_working: z.array(z.string()),
  what_is_not: z.array(z.string()),
  why_it_happens: z.array(z.string()),
  what_to_test_next: z.array(z.string()),
  recommendations: z.array(AdPerformanceRecommendationSchema),
});

export type AdAnalysisResult = z.infer<typeof AdAnalysisSchema>;

export const AdAskSchema = z.object({
  answer: z.string(),
  supporting_metrics: z.record(z.string(), z.any()),
  suggested_actions: z.array(z.string()),
});

export type AdAskResult = z.infer<typeof AdAskSchema>;

// =========================================================================
// 8. GROWTH COPILOT Q&A
// =========================================================================

export const CopilotActionSchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return val;
  const obj = { ...val };
  if (!obj.title && obj.name) obj.title = obj.name;
  if (!obj.title && obj.action) obj.title = obj.action;
  if (!obj.action_type && obj.type) obj.action_type = obj.type;
  if (!obj.target_module) {
    obj.target_module = obj.module || obj.channel || 'growth';
  }
  return obj;
}, z.object({
  title: z.string().default('Review Store Recommendations'),
  action_type: z.string().default('explore'),
  target_module: z.string().default('growth'),
}).passthrough());

export const CopilotAskSchema = z.preprocess((val: any) => {
  if (!val || typeof val !== 'object') return val;
  const obj = { ...val };
  if (!obj.answer && obj.response) obj.answer = obj.response;
  if (!obj.answer && obj.explanation) obj.answer = obj.explanation;
  if (!obj.metrics || typeof obj.metrics !== 'object') {
    obj.metrics = obj.supporting_metrics || obj.data || {};
  }
  if (!obj.suggested_actions || !Array.isArray(obj.suggested_actions)) {
    obj.suggested_actions = obj.actions || obj.recommendations || [];
  }
  return obj;
}, z.object({
  answer: z.string().default('Telemetry indicates active shopper activity across catalog categories.'),
  metrics: z.record(z.string(), z.any()).default({}),
  suggested_actions: z.array(CopilotActionSchema).default([]),
}).passthrough());

export type CopilotAskResult = z.infer<typeof CopilotAskSchema>;
