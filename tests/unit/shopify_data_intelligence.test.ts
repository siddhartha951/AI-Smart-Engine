import { describe, it, expect } from 'vitest';
import { mapShopifyOrder, hashEmail } from '../../src/modules/shopify_data/order-mapper';
import { parseNextPageInfo } from '../../src/providers/shopify/admin-client';
import { buildFeedViews } from '../../src/modules/shopify_data/data-status.service';
import { extractEmail, extractOrderRef, extractPhone, isOrderQuestion } from '../../src/modules/order_assist/order-intent';
import { buildOrderCard, contactMatches, orderContextText } from '../../src/modules/order_assist/order-lookup.service';
import { isUnsureAnswer, maskPersonalData, questionKey } from '../../src/modules/learning/learning.service';
import { prioritizeForGoal, storeOrderRules } from '../../src/modules/growth/growth-store-rules';
import { numericId, pixelPayload } from '../../src/modules/shopify_data/pixel';
import { customerInsights, discountPerformance, productPerformance, salesTotals } from '../../src/modules/shopify_data/order-analytics';
import { rowToOrder } from '../../src/modules/shopify_data/orders.repository';

const rawOrder = {
  id: 5001,
  name: '#1001',
  order_number: 1001,
  created_at: '2026-09-20T10:00:00+05:30',
  updated_at: '2026-09-21T10:00:00+05:30',
  financial_status: 'partially_refunded',
  fulfillment_status: 'fulfilled',
  currency: 'INR',
  total_price: '1500.00',
  subtotal_price: '1400.00',
  total_discounts: '100.00',
  total_tax: '0.00',
  total_shipping_price_set: { shop_money: { amount: '100.00' } },
  refunds: [{ transactions: [{ kind: 'refund', status: 'success', amount: '200.00' }, { kind: 'sale', amount: '999' }] }],
  line_items: [
    { product_id: 11, variant_id: 111, title: 'Dog Food', variant_title: '2kg', quantity: 2, price: '500.00', sku: 'DF2' },
    { product_id: 12, variant_id: 121, title: 'Chew Toy', quantity: 1, price: '400.00' },
  ],
  discount_codes: [{ code: 'WELCOME10', amount: '100.00', type: 'percentage' }],
  payment_gateway_names: ['Cash on Delivery (COD)'],
  customer: { id: 77, email: 'Buyer@Example.com', orders_count: 3 },
  email: 'Buyer@Example.com',
  shipping_address: { city: 'Pune', country: 'India', address1: '221B Secret Street', phone: '+91 98765 43210' },
  test: false,
};

describe('order mapper', () => {
  it('keeps totals, refunds, items and discounts but never raw email or address', () => {
    const row = mapShopifyOrder(rawOrder)!;
    expect(row.shopify_order_id).toBe('5001');
    expect(row.total_price).toBe(1500);
    expect(row.total_refunded).toBe(200);
    expect(row.total_shipping).toBe(100);
    expect(row.item_count).toBe(3);
    expect(row.discount_codes).toEqual([{ code: 'WELCOME10', amount: 100, type: 'percentage' }]);
    expect(row.customer_email_hash).toBe(hashEmail('buyer@example.com'));
    expect(row.shipping_city).toBe('Pune');
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/Buyer@Example\.com|Secret Street|98765/i);
  });

  it('ignores payloads without an id or a date', () => {
    expect(mapShopifyOrder({ name: '#1' })).toBeNull();
    expect(mapShopifyOrder({ id: 1 })).toBeNull();
  });

  it('net revenue = total minus refunds', () => {
    const stored = rowToOrder({ ...mapShopifyOrder(rawOrder)!, line_items: '[]', discount_codes: '[]', payment_gateways: '[]' });
    expect(stored.net_revenue).toBe(1300);
  });
});

describe('Shopify pagination', () => {
  it('reads the next page cursor from the Link header', () => {
    const link = '<https://s.myshopify.com/admin/api/2025-10/orders.json?limit=250&page_info=abc123>; rel="next", <https://s.myshopify.com/x?page_info=zzz>; rel="previous"';
    expect(parseNextPageInfo(link)).toBe('abc123');
    expect(parseNextPageInfo('<https://s/x?page_info=zzz>; rel="previous"')).toBeNull();
    expect(parseNextPageInfo(null)).toBeNull();
  });
});

describe('data feeds vs permissions', () => {
  const scope = (s: string, status: 'ok' | 'missing', level: 'required' | 'recommended' | 'optional' = 'required') =>
    ({ scope: s, status, level, tested_endpoint: 'oauth/access_scopes.json', unlocks: '' });

  it('marks exactly which data a missing scope stops', () => {
    const feeds = buildFeedViews([
      scope('read_orders', 'ok'), scope('read_products', 'ok'), scope('read_customers', 'missing'), scope('read_inventory', 'ok'),
      scope('read_fulfillments', 'missing', 'recommended'), scope('read_discounts', 'missing', 'recommended'),
      scope('read_price_rules', 'ok', 'recommended'), scope('read_locations', 'ok', 'recommended'), scope('read_all_orders', 'ok', 'optional'),
    ], null);
    const by = Object.fromEntries(feeds.map((f) => [f.key, f]));
    expect(by.orders.status).toBe('working');
    expect(by.order_tracking.status).toBe('limited');
    expect(by.order_tracking.missing_optional).toEqual(['read_fulfillments']);
    expect(by.customers.status).toBe('blocked');
    expect(by.customers.missing_required).toEqual(['read_customers']);
    expect(by.discounts.status).toBe('blocked');
  });

  it('an orders sync refused by Shopify blocks orders even if the scope list looked fine', () => {
    const feeds = buildFeedViews([scope('read_orders', 'ok')], { status: 'blocked', blocked_scope: 'read_orders' } as any);
    expect(feeds.find((f) => f.key === 'orders')!.status).toBe('blocked');
  });

  it('unknown before any check', () => {
    const feeds = buildFeedViews([{ scope: 'read_orders', status: 'unchecked', tested_endpoint: '', unlocks: '' }], null);
    expect(feeds.every((f) => f.status === 'unknown')).toBe(true);
  });
});

describe('order questions (English + Hinglish)', () => {
  it('recognises order questions', () => {
    for (const q of ['Where is my order?', 'track my order', 'Track My Order', 'mera order kab aayega', 'order abhi tak nahi aaya', '#1234 status?', 'When will my parcel arrive']) {
      expect(isOrderQuestion(q)).toBe(true);
    }
    for (const q of ['show me dog food', 'what are the ingredients', 'hi', 'do you have cat toys under 500']) {
      expect(isOrderQuestion(q)).toBe(false);
    }
  });

  it('extracts order number, email and phone without mixing them up', () => {
    expect(extractOrderRef('my order #1234')).toBe('1234');
    expect(extractOrderRef('order no. 5678 please')).toBe('5678');
    expect(extractOrderRef('#ANW1001')).toBe('ANW1001');
    expect(extractOrderRef('9876543210', true)).toBeNull(); // a phone is not an order number
    expect(extractOrderRef('1001', true)).toBe('1001');
    expect(extractOrderRef('1001')).toBeNull(); // bare number only when we asked for it
    expect(extractEmail('mail: Riya@Mail.com')).toBe('riya@mail.com');
    expect(extractPhone('+91 98765-43210')).toBe('919876543210');
    expect(extractPhone('#1234')).toBeNull();
  });
});

describe('order verification and card', () => {
  it('matches email case-insensitively or the last 10 phone digits', () => {
    expect(contactMatches(rawOrder, { email: 'buyer@example.com' })).toBe(true);
    expect(contactMatches(rawOrder, { phone: '9876543210' })).toBe(true);
    expect(contactMatches(rawOrder, { email: 'someone@else.com' })).toBe(false);
    expect(contactMatches(rawOrder, { phone: '9999999999' })).toBe(false);
    expect(contactMatches(rawOrder, {})).toBe(false);
  });

  it('builds a status card with tracking and no personal data', () => {
    const card = buildOrderCard({
      ...rawOrder,
      financial_status: 'paid',
      order_status_url: 'https://shop.example/orders/abc',
      fulfillments: [{ status: 'success', shipment_status: 'in_transit', tracking_company: 'Delhivery', tracking_numbers: ['DL123'], tracking_urls: ['https://track.example/DL123'], created_at: '2026-09-21T10:00:00Z' }],
    });
    expect(card.status).toBe('shipped');
    expect(card.tracking[0]).toMatchObject({ company: 'Delhivery', number: 'DL123', url: 'https://track.example/DL123' });
    expect(JSON.stringify(card)).not.toMatch(/Buyer@|Secret Street|98765/i);
    expect(orderContextText(card)).toMatch(/Order #1001/);
    expect(buildOrderCard({ ...rawOrder, cancelled_at: '2026-09-22T00:00:00Z' }).status).toBe('cancelled');
    expect(buildOrderCard({ ...rawOrder, fulfillment_status: null, financial_status: 'pending' }).status).toBe('payment_pending');
    expect(buildOrderCard({ ...rawOrder, fulfillment_status: 'fulfilled', fulfillments: [{ shipment_status: 'delivered' }] }).status).toBe('delivered');
  });

  it('drops unsafe tracking links', () => {
    const card = buildOrderCard({ ...rawOrder, fulfillments: [{ tracking_company: 'X', tracking_url: 'javascript:alert(1)' }] });
    expect(card.tracking[0].url).toBeNull();
  });
});

describe('learning helpers', () => {
  it('detects "not sure" answers in English and Hinglish', () => {
    expect(isUnsureAnswer("I'm not sure about that, please contact us.")).toBe(true);
    expect(isUnsureAnswer("I don't have that information right now.")).toBe(true);
    expect(isUnsureAnswer('Mujhe iske baare mein pakka nahi pata.')).toBe(true);
    expect(isUnsureAnswer('Our Dog Food has chicken and rice.')).toBe(false);
  });

  it('masks emails and phones and groups repeats', () => {
    expect(maskPersonalData('I am riya@mail.com, call 98765 43210')).toBe('I am [email], call [phone]');
    expect(questionKey('Do you ship to Dubai?')).toBe(questionKey('do u ship to dubai'.replace(' u ', ' you ')));
  });
});

describe('growth rules on real orders', () => {
  const base = {
    window_days: 30,
    totals: { orders: 40, revenue: 40000, average_order_value: 1000, discounts: 15000, discount_share_pct: 30, refunded: 4000, refund_rate_pct: 9, cancelled: 0, single_item_share_pct: 80 },
    last7: { orders: 5, revenue: 5000 } as any,
    prev7: { orders: 12, revenue: 12000 } as any,
    customers: { customers: 30, guest_orders: 0, returning_customers: 3, repeat_customer_share_pct: 10, revenue_per_customer: 1300, top_customers: [] },
    top_products: [],
    sold_out_bestsellers: [{ product_id: '11', title: 'Dog Food', units: 50, revenue: 25000, orders: 20 }],
    currency: 'INR',
  } as any;

  it('flags falling revenue, sold-out best sellers, low repeat rate, discounts, refunds and single-item orders', () => {
    const keys = storeOrderRules(base).map((o) => o.action_key);
    expect(keys).toEqual(expect.arrayContaining([
      'revenue_decline_week', 'bestseller_out_of_stock', 'repeat_rate_low', 'discount_dependence', 'refund_rate_high', 'bundle_opportunity',
    ]));
  });

  it('the Primary Goal changes what comes first (increase_revenue now has an effect)', () => {
    const opps = storeOrderRules(base);
    const revenue = prioritizeForGoal(opps, 'increase_revenue');
    const repeat = prioritizeForGoal(opps, 'increase_repeat_purchases');
    expect(revenue.find((o) => o.action_key === 'repeat_rate_low')!.priority).toBe('high');
    expect(repeat.find((o) => o.action_key === 'repeat_rate_low')!.priority).toBe('critical');
    expect(revenue.filter((o) => o.metadata?.matches_goal).length).toBeGreaterThan(0);
  });

  it('improve_ai_conversion no longer matches "campaign" or "email" keys by accident', () => {
    const out = prioritizeForGoal([
      { action_key: 'low_roas_campaign_x', title: '', priority: 'medium', reason: '', estimated_opportunity: 1, action_type: 'VIEW_CAMPAIGN', target_module: 'ad-intelligence' },
      { action_key: 'email_recovery_underperforming', title: '', priority: 'high', reason: '', estimated_opportunity: 1, action_type: 'OPEN_CART_RECOVERY', target_module: 'email-automation' },
    ], 'improve_ai_conversion');
    expect(out.map((o) => o.priority)).toEqual(['medium', 'high']);
  });

  it('action types that worked before rank one level higher', () => {
    const [o] = prioritizeForGoal([{ action_key: 'x', title: '', priority: 'medium', reason: '', estimated_opportunity: 1, action_type: 'OPEN_REORDER', target_module: 'reorder-reminders' }], 'improve_roas', new Set(['OPEN_REORDER']));
    expect(o.priority).toBe('high');
    expect(o.metadata!.proven_before).toBe(true);
  });
});

describe('order analytics', () => {
  const o = (extra: any) => rowToOrder({ ...mapShopifyOrder({ ...rawOrder, ...extra })!, line_items: JSON.stringify(mapShopifyOrder({ ...rawOrder, ...extra })!.line_items), discount_codes: JSON.stringify(mapShopifyOrder({ ...rawOrder, ...extra })!.discount_codes), payment_gateways: '[]' });

  it('totals skip cancelled and test orders', () => {
    const t = salesTotals([o({ id: 1 }), o({ id: 2, cancelled_at: '2026-09-21T00:00:00Z' }), o({ id: 3, test: true })]);
    expect(t.orders).toBe(1);
    expect(t.revenue).toBe(1300);
    expect(t.cancelled).toBe(1);
  });

  it('products, customers and coupons', () => {
    const orders = [o({ id: 1 }), o({ id: 2, customer: { id: 77 } }), o({ id: 3, customer: { id: 88 }, email: 'x@y.com' })];
    expect(productPerformance(orders)[0]).toMatchObject({ title: 'Dog Food', units: 6 });
    const c = customerInsights(orders);
    expect(c.customers).toBe(2);
    expect(c.top_customers[0].customer_ref).toMatch(/^C-/);
    expect(JSON.stringify(c)).not.toMatch(/@/);
    expect(discountPerformance(orders).codes[0]).toMatchObject({ code: 'WELCOME10', orders: 3 });
  });
});

describe('checkout pixel payloads', () => {
  it('keeps only product / order facts', () => {
    expect(numericId('gid://shopify/Order/123456')).toBe('123456');
    const p = pixelPayload('checkout_completed', {
      checkout: { order: { id: 'gid://shopify/Order/987654' }, totalPrice: { amount: '1200.50', currencyCode: 'INR' }, email: 'secret@buyer.com', lineItems: [{ title: 'Dog Food', quantity: 2, variant: { id: 'gid://shopify/ProductVariant/111', product: { id: 'gid://shopify/Product/11' }, price: { amount: '600.25' } } }] },
    });
    expect(p).toMatchObject({ source: 'shopify_pixel', order_id: '987654', total_price: 1200.5 });
    expect(JSON.stringify(p)).not.toMatch(/secret@buyer/);
  });
});
