import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';

describe('Merchant product recommendation settings', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let token: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
    token = (await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' })).body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  async function chat(message: string, anonymousId = 'rec_visitor') {
    const session = (await request(app).post('/api/v1/widget/session').set('x-widget-key', STORE_A_WIDGET_KEY).send({ anonymous_id: anonymousId })).body.data;
    const res = await request(app).post('/api/v1/widget/chat/message').set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ session_id: session.session_id || session.id, message });
    return res;
  }

  const saveSettings = (assistant: Record<string, unknown>) =>
    request(app).put(`/api/v1/dashboard/${STORE_A_ID}/agent`).set('Authorization', `Bearer ${token}`).send({ assistant });

  it('ask first (default): a described need gets an offer, not product cards', async () => {
    const res = await chat('I am looking for some audio gear');
    expect(res.status).toBe(200);
    expect(res.body.data.recommendations).toHaveLength(0);
    expect(res.body.data.product_offer).toBe(true);
    expect(res.body.data.message).toMatch(/Would you like me to show a few options/);
  });

  it('ask first: an explicit "show me" request gets the products', async () => {
    const res = await chat('Show me your audio options', 'rec_visitor_2');
    expect(res.body.data.recommendations.length).toBeGreaterThan(0);
    expect(res.body.data.product_offer).toBe(false);
  });

  it('saves every option and exposes it to the widget config', async () => {
    const save = await saveSettings({
      product_suggestion_mode: 'direct', product_display_style: 'links', max_recommendations: 1,
      show_product_variants: false, show_product_reason: false,
    });
    expect(save.status).toBe(200);

    const config = await request(app).get('/api/v1/widget/config').set('x-widget-key', STORE_A_WIDGET_KEY);
    expect(config.body.data.recommendations).toEqual({ suggestion_mode: 'direct', display_style: 'links', max: 1, show_variants: false, show_reason: false });

    const res = await chat('I am looking for some audio gear', 'rec_visitor_3');
    expect(res.body.data.display_style).toBe('links');
    expect(res.body.data.recommendations).toHaveLength(1);
    expect(res.body.data.recommendations[0].variants).toBeUndefined();
  });

  it('includes variant picker data when "Show variants" is on', async () => {
    await saveSettings({ product_suggestion_mode: 'direct', show_product_variants: true });
    const res = await chat('I am looking for some audio gear', 'rec_visitor_4');
    const earbuds = res.body.data.recommendations.find((r: any) => r.title === 'Wireless Earbuds');
    expect(earbuds.options).toEqual([{ name: 'Color', values: ['Black', 'White'] }]);
    expect(earbuds.variants.map((v: any) => [v.title, v.available])).toEqual([['Black', true], ['White', false]]);
  });

  it('invalid settings are stored as safe defaults', async () => {
    await saveSettings({ product_suggestion_mode: 'always', product_display_style: 'grid', max_recommendations: 12 });
    const row = await db.query('SELECT product_suggestion_mode, product_display_style, max_recommendations FROM assistant_settings WHERE store_id = $1', [STORE_A_ID]);
    expect(row.rows[0]).toEqual({ product_suggestion_mode: 'ask_first', product_display_style: 'cards', max_recommendations: 3 });
  });
});
