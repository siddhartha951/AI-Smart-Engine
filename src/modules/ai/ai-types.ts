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

export const FaqSuggestionSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

export const ProductSuggestionsSchema = z.object({
  improved_title: z.string(),
  improved_description: z.string(),
  selling_points: z.array(z.string()),
  faq_suggestions: z.array(FaqSuggestionSchema),
  recommendation_tags: z.array(z.string()),
});

export type ProductSuggestions = z.infer<typeof ProductSuggestionsSchema>;

export const CatalogueProductAnalysisSchema = z.object({
  product_id: z.string(),
  title: z.string(),
  listing_quality_score: z.number().min(0).max(100),
  problems: z.array(z.string()),
  suggestions: ProductSuggestionsSchema,
  recommendation_suitability: z.enum(['high', 'medium', 'low']),
  conversion_risk: z.string(),
});

export const CatalogueAnalysisSchema = z.object({
  overview_summary: z.string(),
  average_listing_score: z.number(),
  products: z.array(CatalogueProductAnalysisSchema),
});

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
// 5. EMAIL AUTOMATION AI
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
  email_type: EmailType;
  goal: EmailGoal;
  tone: EmailTone;
  length: EmailLength;
  custom_instruction?: string;
  product_id?: string;
}

export const EmailGenerationResultSchema = z.object({
  subject: z.string(),
  preview_text: z.string(),
  body: z.string(),
  cta: z.string(),
  alternative_subjects: z.array(z.string()),
});

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
// 7. AD INTELLIGENCE AI
// =========================================================================

export const AdRecommendationItemSchema = z.object({
  campaign_or_channel: z.string(),
  suggestion: z.string(),
  impact: z.enum(['scale', 'reduce', 'test', 'maintain']),
});

export const AdAnalysisSchema = z.object({
  has_ad_data: z.boolean(),
  overview_summary: z.string(),
  what_is_working: z.array(z.string()),
  what_is_not: z.array(z.string()),
  why_it_happens: z.array(z.string()),
  what_to_test_next: z.array(z.string()),
  recommendations: z.array(AdRecommendationItemSchema),
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

export const CopilotActionSchema = z.object({
  title: z.string(),
  action_type: z.string(),
  target_module: z.string(),
});

export const CopilotAskSchema = z.object({
  answer: z.string(),
  metrics: z.record(z.string(), z.any()),
  suggested_actions: z.array(CopilotActionSchema),
});

export type CopilotAskResult = z.infer<typeof CopilotAskSchema>;
