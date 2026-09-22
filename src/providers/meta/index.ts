export {
  MetaAdsClient,
  MetaAdsApiError,
  getMetaAdsClient,
  parseInsightRow,
  parseExplorerAd,
  summarizeInsights,
  META_GRAPH_API_VERSION,
  META_REQUEST_TIMEOUT_MS,
  META_TOKEN_EXPIRY_WARNING_DAYS,
  META_EXPLORER_MAX_PAGES,
} from './meta_ads.client';
export type {
  MetaAdAccount,
  MetaInsightLevel,
  MetaInsightOptions,
  MetaInsightRow,
  MetaInsightsResult,
  MetaExplorerAd,
  MetaDatePreset,
  MetaTokenInfo,
} from './meta_ads.client';
