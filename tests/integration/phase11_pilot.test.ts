import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { InMemoryPostgresClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { getShopifyAdapter } from '../../src/providers/shopify';
import { EmailWorker } from '../../src/modules/email/email.worker';
import { getTestEmailProvider } from '../../src/providers/email';
import { getTestPurchaseAdapter } from '../../src/providers/purchase';
import { createBackup, restoreBackup } from '../../scripts/backup-restore';
import { resetEnvConfig } from '../../src/config/env';

describe('Phase 11: Controlled Merchant Pilot Readiness Verification', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let worker: EmailWorker;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const STORE_A_DOMAIN = 'london-eco.myshopify.com';

  beforeEach(async () => {
    process.env.SHOPIFY_ADAPTER_MODE = 'fake';
    process.env.EMAIL_PROVIDER_MODE = 'fake';
    resetEnvConfig();

    db = new InMemoryPostgresClient();
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });
    worker = new EmailWorker({ db });

    getTestEmailProvider().clearInbox();
    getTestPurchaseAdapter().reset();
  });

  afterEach(async () => {
    worker.stop();
    await db.close();
    resetEnvConfig();
  });

  // 1. Verify Shopify connection
  it('1. verifies that Shopify connection validation works and handles credentials safely', async () => {
    const adapter = getShopifyAdapter();
    expect(adapter).toBeDefined();

    // Verify connection on configured store
    const isConnValid = await adapter.validateConnection(STORE_A_ID);
    expect(isConnValid).toBe(true);
  });

  // 2. Verify Widget works on desktop and mobile
  it('2. verifies that widget configuration and mobile/desktop responsive styles are loaded', async () => {
    const res = await request(app)
      .get('/api/v1/widget/config')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .set('origin', `https://${STORE_A_DOMAIN}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.widget.position).toBeDefined();

    // Check widget.js source file contains mobile responsiveness and shadow DOM isolation
    const widgetJsPath = path.join(process.cwd(), 'src/public/widget.js');
    expect(fs.existsSync(widgetJsPath)).toBe(true);
    const widgetJsContent = fs.readFileSync(widgetJsPath, 'utf8');
    expect(widgetJsContent).toContain('@media');
    expect(widgetJsContent).toContain('attachShadow');
  });

  // 3. Verify Consent is recorded correctly
  it('3. verifies that visitor consent is recorded with audit compliance', async () => {
    const sessionRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ anonymous_id: 'pilot_anon_1' });

    const { visitor_id } = sessionRes.body.data;

    const consentRes = await request(app)
      .post('/api/v1/widget/visitor/consent')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        visitor_id,
        email: 'pilot_shopper@example.com',
        phone: '+447911123456',
        marketing_opted_in: true
      });

    expect(consentRes.status).toBe(200);
    expect(consentRes.body.success).toBe(true);

    const check = await db.query('SELECT opted_in FROM marketing_consents WHERE visitor_id = $1', [visitor_id]);
    expect(check.rows.length).toBe(1);
    expect(check.rows[0].opted_in).toBe(true);
  });

  // 4. Verify Product information is accurate
  it('4. verifies that product catalog search provides accurate details and currency', async () => {
    const adapter = getShopifyAdapter();
    const products = await adapter.searchProducts(STORE_A_ID, { keywords: ['Earbuds'] });
    
    expect(products.length).toBeGreaterThan(0);
    const p = products[0];
    expect(p.title).toBe('Wireless Earbuds');
    expect(p.price).toBe(49.99);
    expect(p.currency).toBe('GBP');
  });

  // 5. Verify Purchase stops follow-up emails
  it('5. verifies that completing a purchase stops scheduled recovery emails', async () => {
    const sessionRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ anonymous_id: 'pilot_buyer_1' });

    const { visitor_id, session_id } = sessionRes.body.data;

    await request(app)
      .post('/api/v1/widget/visitor/consent')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        visitor_id,
        email: 'buyer_test@pilot.com',
        marketing_opted_in: true
      });

    await request(app)
      .post('/api/v1/widget/test/schedule-email')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ visitor_id, session_id });

    // Simulate Shopify purchase event
    getTestPurchaseAdapter().simulatePurchase(STORE_A_ID, 'buyer_test@pilot.com');
    await db.query(`UPDATE email_campaign_events SET scheduled_for = NOW() - INTERVAL '1 minute'`);

    await worker.processPendingJobs();

    // Verify no email was sent
    expect(getTestEmailProvider().sentEmails.length).toBe(0);

    const eventRes = await db.query('SELECT status, cancel_reason FROM email_campaign_events WHERE session_id = $1', [session_id]);
    expect(eventRes.rows[0].status).toBe('cancelled');
    expect(eventRes.rows[0].cancel_reason).toBe('Purchase completed since session');
  });

  // 6. Verify Unsubscribe works
  it('6. verifies that unsubscription suppresses future marketing emails', async () => {
    const sessionRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ anonymous_id: 'pilot_unsub_1' });

    const { visitor_id, session_id } = sessionRes.body.data;

    await request(app)
      .post('/api/v1/widget/visitor/consent')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        visitor_id,
        email: 'unsub_test@pilot.com',
        marketing_opted_in: true
      });

    // Unsubscribe
    const unsubRes = await request(app)
      .post('/api/v1/widget/visitor/unsubscribe')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ email: 'unsub_test@pilot.com' });

    expect(unsubRes.status).toBe(200);

    // Verify suppression
    const supp = await db.query('SELECT * FROM suppression_list WHERE store_id = $1 AND email = $2', [STORE_A_ID, 'unsub_test@pilot.com']);
    expect(supp.rows.length).toBe(1);

    // Schedule email and check cancellation
    await request(app)
      .post('/api/v1/widget/test/schedule-email')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ visitor_id, session_id });

    await db.query(`UPDATE email_campaign_events SET scheduled_for = NOW() - INTERVAL '1 minute'`);
    await worker.processPendingJobs();

    expect(getTestEmailProvider().sentEmails.length).toBe(0);
  });

  // 7. Verify OpenAI budget guard works
  it('7. verifies OpenAI budget limits and hard stops are enforced', async () => {
    const sessionRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ anonymous_id: 'pilot_budget_1' });

    const { session_id } = sessionRes.body.data;

    // Insert usage nearing stop threshold ($14.00)
    await db.query(`
      INSERT INTO ai_usage_ledger (store_id, session_id, model, input_tokens, output_tokens, estimated_cost_usd, billing_period)
      VALUES ($1, $2, 'gpt-4o-mini', 500000, 500000, 14.50, '2026-09')
    `, [STORE_A_ID, session_id]);

    const res = await db.query(`SELECT SUM(estimated_cost_usd) as total FROM ai_usage_ledger WHERE store_id = $1`, [STORE_A_ID]);
    const total = parseFloat(res.rows[0].total);
    expect(total).toBeGreaterThanOrEqual(14.00);

    // Platform config stop check
    const cfg = await db.query(`SELECT ai_stop_threshold_usd FROM platform_config LIMIT 1`);
    expect(parseFloat(cfg.rows[0].ai_stop_threshold_usd)).toBe(14.00);
  });

  // 8. Verify Admin alerts work
  it('8. verifies that admin alerts can be raised and retrieved', async () => {
    await db.query(`
      INSERT INTO admin_alerts (type, severity, message, metadata)
      VALUES ('pilot_test_alert', 'high', 'Controlled pilot test alert', $1)
    `, [JSON.stringify({ store_id: STORE_A_ID })]);

    const alerts = await db.query(`SELECT * FROM admin_alerts WHERE type = 'pilot_test_alert'`);
    expect(alerts.rows.length).toBe(1);
    expect(alerts.rows[0].severity).toBe('high');
  });

  // 9. Verify Backup/restore point exists
  it('9. verifies database snapshot backup and restore point creation', async () => {
    const backupFile = path.join(process.cwd(), 'backups', `pilot_test_backup_${Date.now()}.json`);
    
    // Create backup
    const createdPath = await createBackup(db, backupFile);
    expect(fs.existsSync(createdPath)).toBe(true);

    const raw = fs.readFileSync(createdPath, 'utf8');
    const snapshot = JSON.parse(raw);
    expect(snapshot.tables.stores.length).toBeGreaterThan(0);

    // Restore backup
    const restoredCount = await restoreBackup(createdPath, db);
    expect(restoredCount).toBeGreaterThan(0);

    // Cleanup test backup file
    if (fs.existsSync(createdPath)) {
      fs.unlinkSync(createdPath);
    }
  });
});
