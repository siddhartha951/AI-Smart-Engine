/**
 * Shopify order JSON (REST or webhook payload) -> one shopify_orders row.
 * Keeps what the dashboard and the merchant AI need; never keeps the raw email, phone
 * or address (customers are matched by a hash of the email).
 */
import crypto from 'crypto';

export interface OrderLineItem {
  product_id: string | null;
  variant_id: string | null;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  price: number;
}

export interface ShopifyOrderRow {
  shopify_order_id: string;
  order_number: string | null;
  name: string | null;
  created_at_shop: string;
  updated_at_shop: string | null;
  processed_at: string | null;
  cancelled_at: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  currency: string | null;
  total_price: number;
  subtotal_price: number;
  total_discounts: number;
  total_tax: number;
  total_shipping: number;
  total_refunded: number;
  item_count: number;
  line_items: OrderLineItem[];
  discount_codes: Array<{ code: string; amount: number; type: string | null }>;
  payment_gateways: string[];
  customer_id: string | null;
  customer_email_hash: string | null;
  customer_orders_count: number | null;
  source_name: string | null;
  landing_site: string | null;
  referring_site: string | null;
  shipping_city: string | null;
  shipping_country: string | null;
  tags: string | null;
  is_test: boolean;
}

/** Fields requested from orders.json: exactly what mapShopifyOrder reads. */
export const ORDER_SYNC_FIELDS = [
  'id', 'name', 'order_number', 'created_at', 'updated_at', 'processed_at', 'cancelled_at',
  'financial_status', 'fulfillment_status', 'currency', 'total_price', 'subtotal_price',
  'total_discounts', 'total_tax', 'total_shipping_price_set', 'refunds', 'line_items',
  'discount_codes', 'payment_gateway_names', 'customer', 'email', 'contact_email', 'source_name',
  'landing_site', 'referring_site', 'shipping_address', 'tags', 'test',
].join(',');

function num(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function str(value: unknown, max = 255): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value).slice(0, max);
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function hashEmail(email: unknown): string | null {
  const clean = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!clean || !clean.includes('@')) return null;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

function refundedAmount(refunds: unknown): number {
  if (!Array.isArray(refunds)) return 0;
  let total = 0;
  for (const refund of refunds) {
    const txs = Array.isArray(refund?.transactions) ? refund.transactions : [];
    for (const tx of txs) {
      if (tx?.kind === 'refund' && (tx?.status === 'success' || !tx?.status)) total += num(tx.amount);
    }
  }
  return Math.round(total * 100) / 100;
}

export function mapShopifyOrder(raw: any): ShopifyOrderRow | null {
  if (!raw || raw.id === undefined || raw.id === null) return null;
  const createdAt = iso(raw.created_at) || iso(raw.processed_at);
  if (!createdAt) return null;

  const items: OrderLineItem[] = (Array.isArray(raw.line_items) ? raw.line_items : []).slice(0, 100).map((li: any) => ({
    product_id: str(li?.product_id, 40),
    variant_id: str(li?.variant_id, 40),
    title: String(li?.title || li?.name || 'Item').slice(0, 255),
    variant_title: str(li?.variant_title),
    sku: str(li?.sku, 100),
    quantity: Math.max(0, parseInt(String(li?.quantity ?? 0), 10) || 0),
    price: num(li?.price),
  }));

  const shippingSet = raw.total_shipping_price_set?.shop_money?.amount ?? raw.total_shipping_price_set?.presentment_money?.amount;
  const customer = raw.customer || {};

  return {
    shopify_order_id: String(raw.id),
    order_number: str(raw.order_number, 40),
    name: str(raw.name, 80),
    created_at_shop: createdAt,
    updated_at_shop: iso(raw.updated_at),
    processed_at: iso(raw.processed_at),
    cancelled_at: iso(raw.cancelled_at),
    financial_status: str(raw.financial_status, 40),
    fulfillment_status: str(raw.fulfillment_status, 40),
    currency: str(raw.currency, 10),
    total_price: num(raw.total_price),
    subtotal_price: num(raw.subtotal_price),
    total_discounts: num(raw.total_discounts),
    total_tax: num(raw.total_tax),
    total_shipping: num(shippingSet),
    total_refunded: refundedAmount(raw.refunds),
    item_count: items.reduce((s, li) => s + li.quantity, 0),
    line_items: items,
    discount_codes: (Array.isArray(raw.discount_codes) ? raw.discount_codes : []).slice(0, 20).map((d: any) => ({
      code: String(d?.code || '').slice(0, 100),
      amount: num(d?.amount),
      type: str(d?.type, 40),
    })).filter((d: { code: string }) => d.code),
    payment_gateways: (Array.isArray(raw.payment_gateway_names) ? raw.payment_gateway_names : [])
      .map((g: unknown) => String(g).slice(0, 80)).slice(0, 10),
    customer_id: str(customer.id, 40),
    customer_email_hash: hashEmail(raw.email || raw.contact_email || customer.email),
    customer_orders_count: customer.orders_count !== undefined && customer.orders_count !== null
      ? parseInt(String(customer.orders_count), 10) || null
      : null,
    source_name: str(raw.source_name, 80),
    landing_site: str(raw.landing_site, 2000),
    referring_site: str(raw.referring_site, 2000),
    shipping_city: str(raw.shipping_address?.city, 120),
    shipping_country: str(raw.shipping_address?.country, 80),
    tags: str(raw.tags, 1000),
    is_test: raw.test === true,
  };
}
