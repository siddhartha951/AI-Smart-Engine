/**
 * Merchant AI Agent tool definitions + executors.
 *
 * Every tool is tenant-scoped: the storeId comes from the authenticated JWT
 * and is passed down to the existing services — data fetching is NEVER
 * reimplemented here. Tool results are either real data or an honest note
 * explaining what is missing; they never contain fabricated metrics.
 */
import { MetaAdsService } from '../meta_ads/meta_ads.service';
import { fetchShopifyOrders } from './shopify_orders.service';
import { ShopifyHealthService } from '../shopify_health/shopify_health.service';
import { AgentToolName, AgentToolResult } from './ai_agent.types';
import { TenantIsolationError } from '../../utils/errors';
import { EntitlementRepository } from '../entitlements/entitlement.repository';
import { FeatureKey } from '../entitlements/entitlement.types';
import { logger } from '../../utils/logger';
import { STORE_EXECUTORS, STORE_TOOLS } from './ai_agent.store-tools';

export interface ToolDefinition {
  name: AgentToolName;
  description: string;
  parameters: Record<string, unknown>;
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_today_overview',
    description:
      "Get today's business overview for the store: today's Shopify orders count and revenue, plus today's Meta ad spend. Use when the merchant asks about today / aaj.",
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_meta_performance',
    description:
      'Get Meta Ads performance KPIs (spend, impressions, clicks, CTR, CPC, conversions, ROAS) broken down by account, campaign, ad set, or ad for a date range. Use for any question about ad spend or campaign performance.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['account', 'campaign', 'adset', 'ad'], description: 'Breakdown level' },
        date_preset: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d'],
          description: 'Relative date range',
        },
        since: { type: 'string', description: 'Start date YYYY-MM-DD (use with until instead of date_preset)' },
        until: { type: 'string', description: 'End date YYYY-MM-DD (use with since instead of date_preset)' },
        limit: { type: 'integer', description: 'Max rows (default 20, max 50)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_shopify_summary',
    description:
      'Get a Shopify sales summary for a date range: order count, total revenue, average order value, and top-selling products. Use for questions about sales, orders, revenue, or best sellers.',
    parameters: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Start date YYYY-MM-DD (defaults to 30 days ago)' },
        until: { type: 'string', description: 'End date YYYY-MM-DD (defaults to today)' },
        limit: { type: 'integer', description: 'Max orders to scan (default 100, max 250)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_ad_creatives',
    description:
      'List the ads and their creatives currently synced in the Ads Explorer cache (name, status, campaign, ad set, creative URLs). Use when the merchant asks about their ads, creatives, or which ads are running/paused.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max ads to return (default 30, max 100)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_attribution_summary',
    description:
      'Get store-side attributed revenue per Meta campaign from the on-site multi-touch attribution ledger. Use when the merchant asks which campaigns actually drove store revenue (not just Meta-reported conversions).',
    parameters: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Start date YYYY-MM-DD (defaults to 30 days ago)' },
        until: { type: 'string', description: 'End date YYYY-MM-DD (defaults to today)' },
      },
      additionalProperties: false,
    },
  },
  // Whole-store tools over the synced Shopify orders (sales, orders, products, customers, coupons, payments...)
  ...STORE_TOOLS,
];

type ToolArgs = Record<string, unknown>;

function requireStore(storeId: string): void {
  if (!storeId) {
    throw new TenantIsolationError('store_id is required');
  }
}

function defaultRange(daysBack = 30): { since: string; until: string } {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(until) };
}

async function getTodayOverview(storeId: string, _args: ToolArgs): Promise<AgentToolResult> {
  requireStore(storeId);
  const today = new Date().toISOString().slice(0, 10);

  const metaAllowed = await new EntitlementRepository().isFeatureEnabled(storeId, FeatureKey.META_ADS).catch(() => false);
  const [shopify, meta] = await Promise.all([
    fetchShopifyOrders(storeId, {
      createdAtMin: `${today}T00:00:00Z`,
      createdAtMax: `${today}T23:59:59Z`,
      limit: 250,
      financialStatus: 'paid',
    }),
    (async () => {
      if (!metaAllowed) return null;
      try {
        const svc = new MetaAdsService();
        return await svc.getInsights(storeId, { level: 'account', datePreset: 'today', limit: 5 });
      } catch {
        logger.warn('AI agent get_today_overview: Meta insights unavailable', { storeId });
        return null;
      }
    })(),
  ]);

  return {
    ok: true,
    data: {
      date: today,
      shopify: shopify.connected
        ? {
            connected: true,
            orders_today: shopify.orders.length,
            revenue_today: round2(shopify.orders.reduce((s, o) => s + o.total_price, 0)),
            currency: shopify.currency,
          }
        : { connected: false, note: await withScopeGuidance('Shopify is not connected for this store.', storeId) },
      meta_ads: meta
        ? {
            connected: true,
            spend_today: meta.totals.spend,
            impressions_today: meta.totals.impressions,
            clicks_today: meta.totals.clicks,
            currency: meta.accountCurrency,
          }
        : metaAllowed
          ? { connected: false, note: 'Meta Ads is not connected for this store.' }
          : { enabled: false, note: 'Meta Ads is not enabled for this store.' },
    },
  };
}

async function getMetaPerformance(storeId: string, args: ToolArgs): Promise<AgentToolResult> {
  requireStore(storeId);
  const svc = new MetaAdsService();
  const level = ['account', 'campaign', 'adset', 'ad'].includes(String(args.level))
    ? (args.level as 'account' | 'campaign' | 'adset' | 'ad')
    : 'campaign';
  const limit = Math.min(Math.max(parseInt(String(args.limit || '20'), 10) || 20, 1), 50);
  try {
    const result = await svc.getInsights(storeId, {
      level,
      datePreset: args.since && args.until ? undefined : (['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d'].includes(String(args.date_preset)) ? (args.date_preset as 'today') : 'last_30d'),
      since: args.since ? String(args.since) : undefined,
      until: args.until ? String(args.until) : undefined,
      limit,
    });
    // Compact rows so the LLM context stays small but every number stays real.
    const rows = result.rows.slice(0, limit).map((r) => ({
      campaign: r.campaignName,
      adset: r.adsetName,
      ad: r.adName,
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      cpc: r.cpc,
      conversions: r.conversions,
      roas: r.roas,
    }));
    return { ok: true, data: { level, totals: result.totals, currency: result.accountCurrency, rows } };
  } catch {
    return {
      ok: false,
      note: 'Meta Ads is not connected for this store, or the request failed. Ask the merchant to connect Meta Ads first.',
    };
  }
}

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

/**
 * Appends the cached Shopify health summary (scope/token guidance) to an
 * honest "data unavailable" note, so the agent can suggest the exact fix.
 * Reads the stored check only — never live-probes Shopify from a tool call.
 */
async function withScopeGuidance(note: string, storeId: string): Promise<string> {
  try {
    const summary = await new ShopifyHealthService().getShopifyHealthSummary(storeId);
    return summary ? `${note}\n\n${summary}` : note;
  } catch {
    return note;
  }
}

async function getShopifySummary(storeId: string, args: ToolArgs): Promise<AgentToolResult> {
  requireStore(storeId);
  const range = defaultRange(30);
  const since = args.since ? String(args.since) : range.since;
  const until = args.until ? String(args.until) : range.until;
  const limit = Math.min(Math.max(parseInt(String(args.limit || '100'), 10) || 100, 1), 250);

  const { connected, orders, currency } = await fetchShopifyOrders(storeId, {
    createdAtMin: `${since}T00:00:00Z`,
    createdAtMax: `${until}T23:59:59Z`,
    limit,
    financialStatus: 'paid',
  });
  if (!connected) {
    return {
      ok: false,
      note: await withScopeGuidance('Shopify is not connected for this store.', storeId),
    };
  }
  const revenue = round2(orders.reduce((s, o) => s + o.total_price, 0));
  const productSales = new Map<string, { title: string; quantity: number; revenue: number }>();
  for (const o of orders) {
    for (const item of o.top_items) {
      const entry = productSales.get(item.title) || { title: item.title, quantity: 0, revenue: 0 };
      entry.quantity += item.quantity;
      entry.revenue = round2(entry.revenue + item.quantity * item.price);
      productSales.set(item.title, entry);
    }
  }
  const topProducts = [...productSales.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
  return {
    ok: true,
    data: {
      since,
      until,
      orders: orders.length,
      revenue,
      currency,
      average_order_value: orders.length > 0 ? round2(revenue / orders.length) : 0,
      top_products: topProducts,
    },
  };
}

async function getAdCreatives(storeId: string, args: ToolArgs): Promise<AgentToolResult> {
  requireStore(storeId);
  const limit = Math.min(Math.max(parseInt(String(args.limit || '30'), 10) || 30, 1), 100);
  const svc = new MetaAdsService();
  try {
    const result = await svc.getExplorerAds(storeId);
    if (!result.synced) {
      return { ok: false, note: 'No ads have been synced to the Ads Explorer cache yet. Ask the merchant to press "Sync Ads" in Ads Explorer first.' };
    }
    const ads = result.ads.slice(0, limit).map((a) => ({
      name: a.name,
      status: a.status,
      campaign: a.campaign_name,
      ad_set: a.adset_name,
      has_creative: Boolean(a.thumbnail_url || a.creative_url),
      destination_url: a.destination_url || null,
    }));
    return {
      ok: true,
      data: {
        total_synced: result.count,
        ad_account: result.adAccountName,
        last_sync_at: result.lastSyncAt,
        ads,
      },
    };
  } catch {
    return { ok: false, note: 'Meta Ads is not connected for this store.' };
  }
}

async function getAttributionSummary(storeId: string, args: ToolArgs): Promise<AgentToolResult> {
  requireStore(storeId);
  const range = defaultRange(30);
  const since = args.since ? String(args.since) : range.since;
  const until = args.until ? String(args.until) : range.until;
  const svc = new MetaAdsService();
  try {
    const rows = await svc.getCampaignAttribution(storeId, since, until);
    if (rows.length === 0) {
      return { ok: false, note: 'No store-side attribution data exists for this period yet.' };
    }
    return {
      ok: true,
      data: {
        since,
        until,
        campaigns: rows.slice(0, 20).map((r) => ({
          campaign: r.campaignName,
          store_attributed_revenue: r.storeAttributedRevenue,
          store_attributed_orders: r.storeAttributedOrders,
        })),
      },
    };
  } catch {
    logger.warn('AI agent get_attribution_summary failed', { storeId });
    return { ok: false, note: 'Attribution data is unavailable right now.' };
  }
}

const EXECUTORS: Record<AgentToolName, (storeId: string, args: ToolArgs) => Promise<AgentToolResult>> = {
  get_today_overview: getTodayOverview,
  get_meta_performance: getMetaPerformance,
  get_shopify_summary: getShopifySummary,
  get_ad_creatives: getAdCreatives,
  get_attribution_summary: getAttributionSummary,
  ...STORE_EXECUTORS,
};

/** Feature each tool reads from; tools without an entry use core Shopify data only. */
export const TOOL_FEATURES: Partial<Record<AgentToolName, FeatureKey>> = {
  get_meta_performance: FeatureKey.META_ADS,
  get_ad_creatives: FeatureKey.ADS_EXPLORER,
  get_attribution_summary: FeatureKey.AD_INTELLIGENCE,
  get_funnel_summary: FeatureKey.FUNNEL,
  get_growth_actions: FeatureKey.GROWTH_COPILOT,
};

const FEATURE_DISABLED_NOTE =
  'This feature is not enabled for this store. Tell the merchant plainly that it is not enabled and that their administrator can activate it. Do not guess any numbers for it.';

/** Tools the store is entitled to; the LLM is never offered tools for disabled modules. */
export async function getAllowedAgentTools(storeId: string): Promise<ToolDefinition[]> {
  const entitlements = await new EntitlementRepository().getStoreEntitlements(storeId);
  return AGENT_TOOLS.filter((t) => {
    const feature = TOOL_FEATURES[t.name];
    return !feature || entitlements[feature] !== false;
  });
}

async function isToolAllowed(storeId: string, toolName: AgentToolName): Promise<boolean> {
  const feature = TOOL_FEATURES[toolName];
  if (!feature || !storeId) return true; // empty storeId is rejected by the executor itself
  return new EntitlementRepository().isFeatureEnabled(storeId, feature);
}

/** Executes a single tool call. Always tenant-scoped; never throws raw errors to the LLM. */
export async function executeAgentTool(
  storeId: string,
  toolName: string,
  args: ToolArgs = {}
): Promise<AgentToolResult> {
  const executor = EXECUTORS[toolName as AgentToolName];
  if (!executor) {
    return { ok: false, note: `Unknown tool: ${toolName}` };
  }
  try {
    if (!(await isToolAllowed(storeId, toolName as AgentToolName))) {
      return { ok: false, note: FEATURE_DISABLED_NOTE };
    }
  } catch {
    // Fail closed: if access cannot be verified, do not read the data
    return { ok: false, note: 'Access to this data could not be verified right now. Tell the merchant to try again shortly.' };
  }
  try {
    return await executor(storeId, args);
  } catch {
    logger.warn('AI agent tool execution failed', { storeId, toolName });
    return { ok: false, note: 'This data is temporarily unavailable. Tell the merchant plainly instead of guessing.' };
  }
}

export function getToolDefinition(name: AgentToolName): ToolDefinition | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}
