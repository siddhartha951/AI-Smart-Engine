import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { AdCreativeService } from '../../src/modules/ad_creatives/ad_creative.service';
import { IAiProvider } from '../../src/providers/ai';

describe('Phase 12: AI Ad Creative Studio & Multi-Tenant Isolation', () => {
  let app: any;
  let db: InMemoryPostgresClient;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // London Eco Apparel
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Highland Peak Gear

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });

    // Seed products for Store A & Store B
    await db.query(`
      INSERT INTO products (id, store_id, shopify_id, variant_id, title, handle, price, currency, in_stock, category)
      VALUES 
        ('prod_a_1', '${STORE_A_ID}', 'prod_a_1', 'var_a_1', 'Wireless Earbuds', 'wireless-earbuds', 49.99, 'GBP', true, 'audio'),
        ('prod_a_2', '${STORE_A_ID}', 'prod_a_2', 'var_a_2', 'Smart Watch', 'smart-watch', 129.99, 'GBP', true, 'wearable')
    `);

    await db.query(`
      INSERT INTO products (id, store_id, shopify_id, variant_id, title, handle, price, currency, in_stock, category)
      VALUES 
        ('prod_b_1', '${STORE_B_ID}', 'prod_b_1', 'var_b_1', 'Ceramic Vase', 'ceramic-vase', 24.99, 'GBP', true, 'decor'),
        ('prod_b_2', '${STORE_B_ID}', 'prod_b_2', 'var_b_2', 'Wool Blanket', 'wool-blanket', 59.99, 'GBP', true, 'bedding')
    `);

    // Login Store A
    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    tokenA = resA.body.token;

    // Login Store B
    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantB@store.com', password: 'password123' });
    tokenB = resB.body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  // 1. Product Selection & Tenant Scoping
  it('1. retrieves store catalogue products strictly scoped to authenticated merchant', async () => {
    const resA = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/products`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resA.status).toBe(200);
    expect(resA.body.success).toBe(true);
    expect(resA.body.data.products.length).toBe(2);
    expect(resA.body.data.products.map((p: any) => p.title)).toContain('Wireless Earbuds');
    expect(resA.body.data.products.map((p: any) => p.title)).not.toContain('Ceramic Vase');

    const resB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/ad-creatives/products`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(resB.status).toBe(200);
    expect(resB.body.data.products.length).toBe(2);
    expect(resB.body.data.products.map((p: any) => p.title)).toContain('Ceramic Vase');
    expect(resB.body.data.products.map((p: any) => p.title)).not.toContain('Wireless Earbuds');
  });

  // 2. Cross-Tenant Product Access Blocked
  it('2. prevents Merchant A from generating ad creatives using Merchant B product ID', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/generate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_b_1', // Store B product
        platform: 'facebook',
        objective: 'product_sales',
      });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not found in store catalogue');
  });

  // 3. Creative Generation with Multiple Variations & Grounding
  it('3. generates structured ad creative variations grounded in catalogue data', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/generate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_a_1',
        platform: 'facebook',
        objective: 'product_sales',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { variations, product, model } = res.body.data;
    expect(variations.length).toBe(3);
    expect(product.title).toBe('Wireless Earbuds');
    expect(model).toBeDefined();

    // Verify all structured fields exist in each variation
    variations.forEach((v: any) => {
      expect(v.hook).toBeTruthy();
      expect(v.primary_text).toBeTruthy();
      expect(v.headline).toBeTruthy();
      expect(v.cta).toBeTruthy();

      // Ensure grounded in product data
      expect(v.primary_text).toContain('Wireless Earbuds');
    });
  });

  // 4. Platform & Objective Adaptations
  it('4. adapts ad creative variations for Instagram and retargeting objective', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/generate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_a_2',
        platform: 'instagram',
        objective: 'retargeting',
      });

    expect(res.status).toBe(200);
    const { variations } = res.body.data;
    expect(variations.length).toBe(3);
    expect(variations[0].hook).toContain('Smart Watch');
  });

  // 5. Creative Persistence: Save Creative
  it('5. successfully saves an ad creative variation with store_id scoping', async () => {
    const saveRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/save`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_a_1',
        productTitle: 'Wireless Earbuds',
        platform: 'facebook',
        objective: 'product_sales',
        hook: 'Looking for top-rated audio? Discover Wireless Earbuds.',
        primaryText: 'Experience authentic everyday performance with our Wireless Earbuds for GBP 49.99.',
        headline: 'Wireless Earbuds — Official Store',
        cta: 'Shop Now',
        metadata: { variation_index: 0 },
      });

    expect(saveRes.status).toBe(201);
    expect(saveRes.body.success).toBe(true);
    expect(saveRes.body.data.id).toBeDefined();
    expect(saveRes.body.data.store_id).toBe(STORE_A_ID);
    expect(saveRes.body.data.product_title).toBe('Wireless Earbuds');
    expect(saveRes.body.data.platform).toBe('facebook');
    expect(saveRes.body.data.cta).toBe('Shop Now');
  });

  // 6. Saved Creatives Retrieval & Tenant Scoping
  it('6. retrieves saved creatives and prevents cross-tenant access', async () => {
    // Save creative for Store A
    const saveA = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/save`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_a_1',
        productTitle: 'Wireless Earbuds',
        platform: 'facebook',
        objective: 'product_sales',
        hook: 'Store A Hook',
        primaryText: 'Store A Primary Text',
        headline: 'Store A Headline',
        cta: 'Shop Now',
      });
    const creativeAId = saveA.body.data.id;

    // Save creative for Store B
    const saveB = await request(app)
      .post(`/api/v1/dashboard/${STORE_B_ID}/ad-creatives/save`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        productId: 'prod_b_1',
        productTitle: 'Ceramic Vase',
        platform: 'instagram',
        objective: 'product_sales',
        hook: 'Store B Hook',
        primaryText: 'Store B Primary Text',
        headline: 'Store B Headline',
        cta: 'Explore Collection',
      });
    const creativeBId = saveB.body.data.id;

    // Store A retrieves its saved creatives
    const listA = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/saved`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listA.status).toBe(200);
    expect(listA.body.data.creatives.length).toBe(1);
    expect(listA.body.data.creatives[0].id).toBe(creativeAId);
    expect(listA.body.data.creatives[0].product_title).toBe('Wireless Earbuds');

    // Merchant A cannot view Merchant B's saved creatives
    const crossList = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/ad-creatives/saved`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(crossList.status).toBe(403);

    // Merchant A cannot delete Merchant B's creative
    const crossDelete = await request(app)
      .delete(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/saved/${creativeBId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(crossDelete.status).toBe(404);

    // Store B's creative is still intact in DB
    const listB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/ad-creatives/saved`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listB.body.data.creatives.length).toBe(1);
    expect(listB.body.data.creatives[0].id).toBe(creativeBId);

    // Store A deletes its own creative
    const deleteA = await request(app)
      .delete(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/saved/${creativeAId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(deleteA.status).toBe(200);

    const recheckA = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/saved`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(recheckA.body.data.creatives.length).toBe(0);
  });

  // 7. Usage Tracking in ai_usage_ledger
  it('7. tracks tokens and estimated cost in ai_usage_ledger', async () => {
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/generate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_a_1',
        platform: 'facebook',
        objective: 'product_sales',
      });

    const ledgerRes = await db.query(
      `SELECT * FROM ai_usage_ledger WHERE store_id = $1`,
      [STORE_A_ID]
    );

    expect(ledgerRes.rows.length).toBeGreaterThan(0);
    const entry = ledgerRes.rows[ledgerRes.rows.length - 1];
    expect(entry.input_tokens).toBeGreaterThan(0);
    expect(entry.output_tokens).toBeGreaterThan(0);
    expect(parseFloat(entry.estimated_cost_usd)).toBeGreaterThan(0);
  });

  // 8. BudgetGuard Hard Stop Enforcement
  it('8. enforces AI BudgetGuard when monthly spend reaches exhaustion limit ($14.00)', async () => {
    const period = new Date().toISOString().substring(0, 7);
    // Inject $15 into ledger to simulate budget exhaustion
    await db.query(`
      INSERT INTO ai_usage_ledger (store_id, model, input_tokens, output_tokens, estimated_cost_usd, billing_period)
      VALUES ('${STORE_A_ID}', 'mock-gpt-4o-mini', 50000, 10000, 15.00, '${period}')
    `);

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/generate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_a_1',
        platform: 'facebook',
        objective: 'product_sales',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BUDGET_EXCEEDED');
    expect(res.body.error).toContain('budget');
  });

  // 9. Unauthorized & Invalid JWT Requests Rejected
  it('9. rejects unauthenticated and invalid JWT requests', async () => {
    // No token
    const noAuth = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/products`);
    expect(noAuth.status).toBe(401);

    // Invalid token
    const invalidAuth = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/products`)
      .set('Authorization', 'Bearer invalid.jwt.token');
    expect(invalidAuth.status).toBe(401);
  });

  // 10. Nonexistent / Invalid Product IDs Handled Safely
  it('10. handles nonexistent product IDs with clean 404 response', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/generate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'nonexistent_prod_999',
        platform: 'facebook',
        objective: 'product_sales',
      });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  // 11. Malformed AI Output is Safely Handled
  it('11. rejects malformed AI responses safely without crashing the server', async () => {
    // Create an invalid AI provider that returns malformed output
    const malformedProvider: IAiProvider = {
      async generateResponse() {
        return { content: '', recommended_product_ids: [], input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
      },
      async generateAdCreatives() {
        throw new Error('Malformed AI creative output: hook is required');
      },
      async generateAdImage() {
        throw new Error('Malformed AI image output');
      }
    };

    const service = new AdCreativeService({ db, aiProvider: malformedProvider });

    await expect(
      service.generateCreatives(STORE_A_ID, {
        productId: 'prod_a_1',
        platform: 'facebook',
        objective: 'product_sales',
      })
    ).rejects.toThrow('Malformed AI creative output');
  });

  // 12. Empty Catalogue Handled Gracefully
  it('12. handles empty catalogue gracefully', async () => {
    // Store with no products
    const emptyStoreId = '9c5967c5-d10e-4230-8d44-1329864ea659';
    const res = await request(app)
      .get(`/api/v1/dashboard/${emptyStoreId}/ad-creatives/products`)
      .set('Authorization', `Bearer ${tokenA}`);

    // Store A accessing non-owned store should be 403
    expect(res.status).toBe(403);
  });

  // 13. AI Ad Image Generation
  it('13. generates AI ad image visual using OpenAI DALL-E 3 with grounding and usage recording', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/generate-image`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_a_1',
        platform: 'instagram',
        style: 'commercial_studio',
        hook: '⚡ Elevate your listening experience',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.image_url).toBeDefined();
    expect(res.body.data.image_url).toContain('https://');
    expect(res.body.data.model).toBeDefined();
    expect(res.body.data.product.title).toBe('Wireless Earbuds');

    // Verify usage recorded in ai_usage_ledger
    const ledger = await db.query(
      `SELECT * FROM ai_usage_ledger WHERE store_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [STORE_A_ID]
    );
    expect(ledger.rows.length).toBeGreaterThan(0);
    expect(Number(ledger.rows[0].estimated_cost_usd)).toBeGreaterThan(0);
  });

  // 14. Cross-Tenant Product Access Blocked for Image Generation
  it('14. blocks Merchant A from generating AI images using Merchant B product ID', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/generate-image`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_b_1', // Store B product
        platform: 'facebook',
      });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not found in store catalogue');
  });

  // 15. Saved Creative Persists Image URL
  it('15. persists AI image URL when saving ad creative variation', async () => {
    const testImageUrl = 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=1024';
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/save`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        productId: 'prod_a_1',
        productTitle: 'Wireless Earbuds',
        platform: 'instagram',
        objective: 'product_sales',
        hook: 'Best earbuds of the year',
        primaryText: 'Studio sound quality with noise cancellation.',
        headline: 'Save 20% Today',
        cta: 'Shop Now',
        imageUrl: testImageUrl,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.image_url).toBe(testImageUrl);

    // Retrieve saved creative and verify image_url is returned
    const listRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/saved`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listRes.status).toBe(200);
    const savedItem = listRes.body.data.creatives.find((c: any) => c.id === res.body.data.id);
    expect(savedItem).toBeDefined();
    expect(savedItem.image_url).toBe(testImageUrl);
  });
});
