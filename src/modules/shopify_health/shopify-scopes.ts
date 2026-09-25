/**
 * The Shopify custom-app permissions AI Smart Engine asks merchants for.
 * Everything is read-only: the engine never edits products, orders or customers.
 * Shown in onboarding + the Shopify tab, and checked against the token's granted
 * scopes (GET /admin/oauth/access_scopes.json) by the health check.
 */

export type ScopeLevel = 'required' | 'recommended' | 'optional';

export interface ScopeRequirement {
  scope: string;
  level: ScopeLevel;
  unlocks: string;
}

export const ADMIN_SCOPES: ScopeRequirement[] = [
  { scope: 'read_products', level: 'required', unlocks: 'Catalog sync, variants, prices and images for recommendations' },
  { scope: 'read_orders', level: 'required', unlocks: 'Revenue timeline, AI Agent sales answers ("How much did I sell today?"), attribution and reorder reminders' },
  { scope: 'read_customers', level: 'required', unlocks: 'Matching chat leads to buyers and repeat-customer insights' },
  { scope: 'read_inventory', level: 'required', unlocks: 'Accurate in-stock and sold-out variants in the chat' },
  { scope: 'read_fulfillments', level: 'recommended', unlocks: 'Order tracking answers ("Where is my order?")' },
  { scope: 'read_checkouts', level: 'recommended', unlocks: 'Abandoned checkout recovery' },
  { scope: 'read_discounts', level: 'recommended', unlocks: 'Valid discount codes in chat and ticket replies' },
  { scope: 'read_price_rules', level: 'recommended', unlocks: 'Older-style discount rules' },
  { scope: 'read_shipping', level: 'recommended', unlocks: 'Delivery zones and rates in answers' },
  { scope: 'read_locations', level: 'recommended', unlocks: 'Stock per warehouse or store location' },
  { scope: 'read_content', level: 'recommended', unlocks: 'Pages and blog posts for the assistant\'s knowledge' },
  { scope: 'read_online_store_pages', level: 'recommended', unlocks: 'Policy and FAQ pages for the assistant\'s knowledge' },
  { scope: 'read_marketing_events', level: 'recommended', unlocks: 'Linking marketing activity to revenue' },
  { scope: 'read_reports', level: 'recommended', unlocks: 'Sales reports for the dashboard and AI Agent' },
  { scope: 'read_analytics', level: 'recommended', unlocks: 'Store analytics for trends and the Growth Copilot' },
  { scope: 'read_returns', level: 'recommended', unlocks: 'Return status answers' },
  { scope: 'read_all_orders', level: 'optional', unlocks: 'Order history older than 60 days for long-term trends' },
];

export const STOREFRONT_SCOPES: string[] = [
  'unauthenticated_read_product_listings',
  'unauthenticated_read_product_inventory',
  'unauthenticated_read_product_tags',
  'unauthenticated_read_content',
];

/**
 * What each piece of store data needs. Settings uses this to say exactly which data is
 * stopped by which missing permission ("Orders & revenue: blocked, needs read_orders").
 * `needs` must all be granted; `improves` only makes the data more complete.
 */
export interface DataFeedRequirement {
  key: string;
  label: string;
  used_by: string;
  needs: string[];
  improves: string[];
}

export const DATA_FEEDS: DataFeedRequirement[] = [
  { key: 'orders', label: 'Orders & revenue', used_by: 'Home, Growth Copilot, Live Pulse, Ask AI', needs: ['read_orders'], improves: ['read_all_orders'] },
  { key: 'order_tracking', label: 'Order tracking in chat', used_by: 'Storefront assistant ("Where is my order?")', needs: ['read_orders'], improves: ['read_fulfillments'] },
  { key: 'products', label: 'Products & catalog', used_by: 'Assistant recommendations, catalog sync', needs: ['read_products'], improves: ['read_inventory'] },
  { key: 'customers', label: 'Customers', used_by: 'Ask AI customer insights, repeat buyers', needs: ['read_customers'], improves: [] },
  { key: 'discounts', label: 'Coupons & discounts', used_by: 'Ask AI coupon performance', needs: ['read_discounts'], improves: ['read_price_rules'] },
  { key: 'inventory', label: 'Inventory', used_by: 'Stock answers, low-stock alerts', needs: ['read_inventory'], improves: ['read_locations'] },
  { key: 'history', label: 'Order history older than 60 days', used_by: 'Long-term trends', needs: ['read_all_orders'], improves: [] },
];

/** A write scope implies its read scope (e.g. write_orders grants read_orders). */
export function isScopeGranted(scope: string, granted: Set<string>): boolean {
  if (granted.has(scope)) return true;
  return scope.startsWith('read_') && granted.has(`write_${scope.slice(5)}`);
}

export function requiredScopeList(): string[] {
  return ADMIN_SCOPES.filter(s => s.level === 'required').map(s => s.scope);
}
