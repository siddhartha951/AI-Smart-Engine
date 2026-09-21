export {
  MetaAdsClient,
  MetaAdsApiError,
  getMetaAdsClient,
  parseInsightRow,
  summarizeInsights,
  META_GRAPH_API_VERSION,
  META_REQUEST_TIMEOUT_MS,
  META_TOKEN_EXPIRY_WARNING_DAYS,
} from './meta_ads.client';
export type {
  MetaAdAccount,
  MetaInsightLevel,
  MetaInsightOptions,
  MetaInsightRow,
  MetaInsightsResult,
  MetaDatePreset,
  MetaTokenInfo,
} from './meta_ads.client';
