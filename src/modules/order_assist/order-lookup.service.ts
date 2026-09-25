/**
 * Finds a shopper's order in Shopify and proves it is theirs: the email or phone they
 * typed must match the order. Only then is anything about the order shown.
 *
 * The card and the AI context never contain the email, phone or street address.
 */
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { AdminCredentials, adminGet, getAdminCredentials } from '../../providers/shopify/admin-client';
import { ShopifyOrdersRepository } from '../shopify_data/orders.repository';
import { normalizeEmail, normalizePhone, refDigits } from './order-intent';

export interface OrderCard {
  name: string;
  placed_at: string | null;
  status: 'cancelled' | 'refunded' | 'delivered' | 'shipped' | 'partly_shipped' | 'processing' | 'payment_pending';
  status_label: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  total: number;
  currency: string;
  items: Array<{ title: string; variant: string | null; quantity: number }>;
  tracking: Array<{ company: string | null; number: string | null; url: string | null; status: string | null; shipped_at: string | null }>;
  order_status_url: string | null;
  ship_to_city: string | null;
  cancelled_reason: string | null;
}

export type LookupOutcome =
  | { status: 'verified'; card: OrderCard; shopifyOrderId: string }
  | { status: 'not_found' | 'mismatch' | 'unverifiable' | 'blocked' | 'not_connected' | 'error' };

const LOOKUP_FIELDS = [
  'id', 'name', 'order_number', 'email', 'contact_email', 'phone', 'created_at', 'cancelled_at', 'cancel_reason',
  'financial_status', 'fulfillment_status', 'total_price', 'currency', 'line_items', 'fulfillments',
  'shipping_address', 'billing_address', 'customer', 'order_status_url',
].join(',');

const STATUS_LABEL: Record<OrderCard['status'], string> = {
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  delivered: 'Delivered',
  shipped: 'Shipped',
  partly_shipped: 'Partly shipped',
  processing: 'Confirmed, being prepared',
  payment_pending: 'Payment pending',
};

export function buildOrderCard(o: any): OrderCard {
  const fulfillments: any[] = Array.isArray(o.fulfillments) ? o.fulfillments.filter((f: any) => f?.status !== 'cancelled') : [];
  const delivered = fulfillments.length > 0 && fulfillments.every((f) => f?.shipment_status === 'delivered');
  let status: OrderCard['status'];
  if (o.cancelled_at) status = 'cancelled';
  else if (o.financial_status === 'refunded') status = 'refunded';
  else if (o.fulfillment_status === 'fulfilled') status = delivered ? 'delivered' : 'shipped';
  else if (o.fulfillment_status === 'partial') status = 'partly_shipped';
  else if (o.financial_status === 'pending' || o.financial_status === 'authorized') status = 'payment_pending';
  else status = 'processing';

  const tracking: OrderCard['tracking'] = [];
  for (const f of fulfillments) {
    const numbers: string[] = Array.isArray(f.tracking_numbers) && f.tracking_numbers.length ? f.tracking_numbers : [f.tracking_number].filter(Boolean);
    const urls: string[] = Array.isArray(f.tracking_urls) && f.tracking_urls.length ? f.tracking_urls : [f.tracking_url].filter(Boolean);
    const count = Math.max(numbers.length, urls.length, 1);
    for (let i = 0; i < count; i++) {
      const url = urls[i] || urls[0] || null;
      tracking.push({
        company: f.tracking_company || null,
        number: numbers[i] || null,
        url: url && /^https?:\/\//i.test(url) ? url : null,
        status: f.shipment_status || f.status || null,
        shipped_at: f.created_at || null,
      });
    }
  }

  return {
    name: String(o.name || `#${o.order_number || ''}`),
    placed_at: o.created_at || null,
    status,
    status_label: STATUS_LABEL[status],
    financial_status: o.financial_status || null,
    fulfillment_status: o.fulfillment_status || null,
    total: Math.round((parseFloat(o.total_price) || 0) * 100) / 100,
    currency: String(o.currency || ''),
    items: (Array.isArray(o.line_items) ? o.line_items : []).slice(0, 20).map((li: any) => ({
      title: String(li?.title || li?.name || 'Item').slice(0, 200),
      variant: li?.variant_title ? String(li.variant_title).slice(0, 120) : null,
      quantity: parseInt(String(li?.quantity || 1), 10) || 1,
    })),
    tracking: tracking.filter((t) => t.number || t.url || t.company),
    order_status_url: typeof o.order_status_url === 'string' && /^https:\/\//.test(o.order_status_url) ? o.order_status_url : null,
    ship_to_city: o.shipping_address?.city ? String(o.shipping_address.city).slice(0, 120) : null,
    cancelled_reason: o.cancel_reason || null,
  };
}

/** Does the email / phone the shopper typed belong to this order? */
export function contactMatches(order: any, contact: { email?: string | null; phone?: string | null }): boolean {
  const email = normalizeEmail(contact.email);
  if (email) {
    const emails = [order.email, order.contact_email, order.customer?.email].map(normalizeEmail).filter(Boolean);
    if (emails.includes(email)) return true;
  }
  const phone = normalizePhone(contact.phone);
  if (phone) {
    const phones = [order.phone, order.shipping_address?.phone, order.billing_address?.phone, order.customer?.phone]
      .map(normalizePhone)
      .filter(Boolean);
    if (phones.includes(phone)) return true;
  }
  return false;
}

/** Text the storefront AI gets about a verified order (no personal data). */
export function orderContextText(card: OrderCard): string {
  const lines = [
    `VERIFIED ORDER (the shopper proved it is theirs; answer their question using ONLY these facts):`,
    `Order ${card.name}, placed ${card.placed_at ? new Date(card.placed_at).toDateString() : 'unknown date'}.`,
    `Status: ${card.status_label}. Payment: ${card.financial_status || 'unknown'}. Fulfilment: ${card.fulfillment_status || 'not shipped yet'}.`,
    `Total: ${card.currency} ${card.total.toFixed(2)}.`,
    `Items: ${card.items.map((i) => `${i.quantity} x ${i.title}${i.variant ? ` (${i.variant})` : ''}`).join('; ') || 'none listed'}.`,
  ];
  if (card.tracking.length) {
    lines.push(`Tracking: ${card.tracking.map((t) => [t.company, t.number, t.status, t.shipped_at ? `shipped ${new Date(t.shipped_at).toDateString()}` : null].filter(Boolean).join(', ')).join(' | ')}.`);
  } else {
    lines.push('Tracking: no tracking number yet.');
  }
  if (card.cancelled_reason) lines.push(`Cancelled reason: ${card.cancelled_reason}.`);
  if (card.ship_to_city) lines.push(`Shipping to: ${card.ship_to_city}.`);
  lines.push('Never invent a delivery date. If the shopper asks about delivery time, use the tracking status and the store delivery policy only. The order card with the tracking link is already shown to the shopper.');
  return lines.join('\n');
}

type Getter = typeof adminGet;

async function fetchCandidates(creds: AdminCredentials, db: IDatabaseClient, storeId: string, ref: string, get: Getter): Promise<{ orders: any[]; status: number | null }> {
  // 1. The mirrored order tells us Shopify's id directly
  const mirrored = await new ShopifyOrdersRepository(db).findByReference(storeId, ref).catch(() => null);
  if (mirrored) {
    const res = await get(creds, `orders/${encodeURIComponent(mirrored.shopify_order_id)}.json`, { fields: LOOKUP_FIELDS });
    if (res.ok && res.body?.order) return { orders: [res.body.order], status: res.status };
    if (res.status === 403 || res.status === 401) return { orders: [], status: res.status };
  }
  // 2. Search by order name ("#1234" or a custom prefix)
  const clean = ref.replace(/^#/, '');
  const names = [...new Set([`#${clean}`, clean])];
  for (const name of names) {
    const res = await get(creds, 'orders.json', { name, status: 'any', limit: '5', fields: LOOKUP_FIELDS });
    if (res.status === 403 || res.status === 401) return { orders: [], status: res.status };
    const orders: any[] = res.ok && Array.isArray(res.body?.orders) ? res.body.orders : [];
    const digits = refDigits(clean);
    const exact = orders.filter((o) => String(o.name || '').replace(/^#/, '').toUpperCase() === clean.toUpperCase()
      || (digits && (String(o.order_number) === digits || refDigits(o.name) === digits)));
    if (exact.length) return { orders: exact, status: res.status };
  }
  return { orders: [], status: 200 };
}

export async function lookupOrderForShopper(
  storeId: string,
  ref: string,
  contact: { email?: string | null; phone?: string | null },
  opts: { db?: IDatabaseClient; get?: Getter } = {}
): Promise<LookupOutcome> {
  const db = opts.db || getDatabaseClient();
  const get = opts.get || adminGet;
  const creds = await getAdminCredentials(storeId, db);
  if (!creds) return { status: 'not_connected' };

  let found: { orders: any[]; status: number | null };
  try {
    found = await fetchCandidates(creds, db, storeId, ref, get);
  } catch {
    return { status: 'error' };
  }
  if (found.status === 403) return { status: 'blocked' };
  if (found.status === 401) return { status: 'not_connected' };
  if (found.status === null) return { status: 'error' };
  if (!found.orders.length) return { status: 'not_found' };

  const match = found.orders.find((o) => contactMatches(o, contact));
  if (!match) {
    // Shopify hid every contact field (protected customer data): we cannot prove ownership
    const hasContact = found.orders.some((o) =>
      [o.email, o.contact_email, o.phone, o.customer?.email, o.customer?.phone, o.shipping_address?.phone, o.billing_address?.phone].some(Boolean));
    return { status: hasContact ? 'mismatch' : 'unverifiable' };
  }
  return { status: 'verified', card: buildOrderCard(match), shopifyOrderId: String(match.id) };
}

/** Fresh card for an order the shopper already verified in this chat (status may have changed). */
export async function fetchOrderCardById(
  storeId: string,
  shopifyOrderId: string,
  opts: { db?: IDatabaseClient; get?: Getter } = {}
): Promise<OrderCard | null> {
  const db = opts.db || getDatabaseClient();
  const get = opts.get || adminGet;
  const creds = await getAdminCredentials(storeId, db);
  if (!creds || !/^\d+$/.test(shopifyOrderId)) return null;
  const res = await get(creds, `orders/${shopifyOrderId}.json`, { fields: LOOKUP_FIELDS });
  return res.ok && res.body?.order ? buildOrderCard(res.body.order) : null;
}
