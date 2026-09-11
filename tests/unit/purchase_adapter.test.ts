import { describe, it, expect, beforeEach } from 'vitest';
import { getPurchaseAdapter, setPurchaseAdapter, RealPurchaseAdapter, FakePurchaseAdapter } from '../../src/providers/purchase';
import { InMemoryPostgresClient } from '../../src/database/client';
import { resetEnvConfig } from '../../src/config/env';

describe('Purchase Adapter Factory & Real/Fake Adapters', () => {
  let db: InMemoryPostgresClient;

  beforeEach(() => {
    setPurchaseAdapter(null);
    resetEnvConfig();
    db = new InMemoryPostgresClient();
  });

  it('returns RealPurchaseAdapter without throwing when SHOPIFY_ADAPTER_MODE is real', () => {
    process.env.SHOPIFY_ADAPTER_MODE = 'real';
    resetEnvConfig();

    const adapter = getPurchaseAdapter();
    expect(adapter).toBeDefined();
    expect(adapter instanceof RealPurchaseAdapter).toBe(true);

    // Reset back to fake
    process.env.SHOPIFY_ADAPTER_MODE = 'fake';
    resetEnvConfig();
  });

  it('RealPurchaseAdapter returns false when no purchase exists in database', async () => {
    const realAdapter = new RealPurchaseAdapter(db);
    const hasBought = await realAdapter.hasPurchasedSince('store_1', 'customer@example.com', new Date());
    expect(hasBought).toBe(false);
  });

  it('RealPurchaseAdapter returns true when purchase_completed event exists in database', async () => {
    // Setup schema
    await db.query(`
      CREATE TABLE IF NOT EXISTS visitors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id TEXT,
        email TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id TEXT,
        visitor_id UUID,
        type TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const visRes = await db.query(`
      INSERT INTO visitors (store_id, email) VALUES ('store_1', 'customer@example.com') RETURNING id
    `);
    const visitorId = visRes.rows[0].id;

    await db.query(`
      INSERT INTO events (store_id, visitor_id, type, created_at)
      VALUES ('store_1', '${visitorId}', 'purchase_completed', NOW())
    `);

    const realAdapter = new RealPurchaseAdapter(db);
    const tenMinutesAgo = new Date(Date.now() - 600000);
    const hasBought = await realAdapter.hasPurchasedSince('store_1', 'customer@example.com', tenMinutesAgo);
    expect(hasBought).toBe(true);

    // Visitor ID check
    const hasVisitorBought = await realAdapter.hasVisitorPurchased('store_1', visitorId, 3600000);
    expect(hasVisitorBought).toBe(true);
  });
});
