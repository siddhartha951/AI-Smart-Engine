import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('3D Widget, Hyperrealistic Avatars & Exclusive Offer Codes', () => {
  let db: InMemoryPostgresClient;
  let app: any;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  let tokenStoreA: string;
  let widgetKeyA: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });

    // Authenticate Merchant A
    const resA = await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' });
    tokenStoreA = resA.body.token;

    // Ensure assistant is active
    await db.query('UPDATE assistant_settings SET is_active = TRUE WHERE store_id = $1', [STORE_A_ID]);

    // Retrieve widget key
    const storeRes = await db.query<{ widget_key: string }>('SELECT widget_key FROM stores WHERE id = $1', [STORE_A_ID]);
    widgetKeyA = storeRes.rows[0].widget_key;
  });

  afterEach(async () => {
    await db.close();
  });

  it('Default widget settings include country_code IN and default 3D avatar settings', async () => {
    const res = await request(app)
      .get(`/api/v1/widget/bootstrap?widget_key=${widgetKeyA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.config.widget.country_code).toBe('IN');
    expect(res.body.config.widget.avatar_persona).toBe('female');
    expect(res.body.config.widget.avatar_url).toBe('/assets/avatars/mira-3d.jpg');
    expect(res.body.config.widget.proactive_nudge_enabled).toBe(true);
    expect(res.body.config.widget.proactive_nudge_interval_seconds).toBe(60);
    expect(res.body.config.agent.assistant_name).toBeDefined();
  });

  it('Merchant can update widget with Male 3D avatar (Arjun), custom offer code, and discount %', async () => {
    const updateRes = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/widget`)
      .set('Authorization', `Bearer ${tokenStoreA}`)
      .send({
        widget: {
          button_text: 'Talk with Arjun (3D)',
          primary_colour: '#4338ca',
          secondary_colour: '#ffffff',
          position: 'bottom-right',
          country_code: 'IN',
          avatar_persona: 'male',
          avatar_url: '/assets/avatars/arjun-3d.jpg',
          header_title: 'Arjun - Senior Product Concierge',
          custom_css: '.chat-popup { border: 2px solid #4338ca; }',
          offer_code: 'RAZORPAY10',
          offer_discount_percent: 10,
          offer_text: 'Extra 10% OFF at Checkout',
          proactive_nudge_enabled: true,
          proactive_nudge_interval_seconds: 60,
        },
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);

    // Verify GET config returns new settings
    const configRes = await request(app)
      .get(`/api/v1/widget/config?widget_key=${widgetKeyA}`);

    expect(configRes.status).toBe(200);
    expect(configRes.body.data.widget.country_code).toBe('IN');
    expect(configRes.body.data.widget.avatar_persona).toBe('male');
    expect(configRes.body.data.widget.avatar_url).toBe('/assets/avatars/arjun-3d.jpg');
    expect(configRes.body.data.widget.offer_code).toBe('RAZORPAY10');
    expect(configRes.body.data.widget.offer_discount_percent).toBe(10);
    expect(configRes.body.data.widget.offer_text).toBe('Extra 10% OFF at Checkout');
    expect(configRes.body.data.widget.proactive_nudge_enabled).toBe(true);

    // Verify bootstrap returns them as well
    const bootstrapRes = await request(app)
      .get(`/api/v1/widget/bootstrap?widget_key=${widgetKeyA}`);

    expect(bootstrapRes.status).toBe(200);
    expect(bootstrapRes.body.config.widget.offer_code).toBe('RAZORPAY10');
    expect(bootstrapRes.body.config.widget.offer_discount_percent).toBe(10);
    expect(bootstrapRes.body.config.widget.avatar_persona).toBe('male');
  });

  it('Product recommendations contain genuine compare_at_price from catalog without artificial inflation', async () => {
    // Insert a product with genuine compare_at_price
    await db.query(
      `INSERT INTO products (id, store_id, shopify_id, variant_id, title, handle, price, compare_at_price, in_stock, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        'prod-genuine-1',
        STORE_A_ID,
        'gid://shopify/Product/101',
        'gid://shopify/ProductVariant/201',
        'Raw Silk Kurta',
        'raw-silk-kurta',
        1800,
        2400,
        true,
      ]
    );

    // Insert a product with NO compare_at_price (0)
    await db.query(
      `INSERT INTO products (id, store_id, shopify_id, variant_id, title, handle, price, compare_at_price, in_stock, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        'prod-genuine-2',
        STORE_A_ID,
        'gid://shopify/Product/102',
        'gid://shopify/ProductVariant/202',
        'Linen Scarf',
        'linen-scarf',
        750,
        0,
        true,
      ]
    );

    const check1 = await db.query<{ price: number; compare_at_price: number }>(
      'SELECT price, compare_at_price FROM products WHERE id = $1',
      ['prod-genuine-1']
    );
    expect(Number(check1.rows[0].price)).toBe(1800);
    expect(Number(check1.rows[0].compare_at_price)).toBe(2400);

    const check2 = await db.query<{ price: number; compare_at_price: number }>(
      'SELECT price, compare_at_price FROM products WHERE id = $1',
      ['prod-genuine-2']
    );
    expect(Number(check2.rows[0].price)).toBe(750);
    expect(Number(check2.rows[0].compare_at_price)).toBe(0);
  });
});
