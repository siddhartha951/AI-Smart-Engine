import { describe, it, expect } from 'vitest';
import { InMemoryPostgresClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';

describe('Database Migrations & Seed Verification', () => {
  it('runs initial schema migration and seed migration cleanly', async () => {
    const db = new InMemoryPostgresClient();
    const migrator = new Migrator(db);

    const result = await migrator.runMigrations();
    expect(result.applied).toContain('001_initial_schema.sql');
    expect(result.applied).toContain('002_seed_two_stores.sql');
    expect(result.applied).toContain('016_ad_creative_studio.sql');

    // Verify stores were seeded
    const storesRes = await db.query('SELECT * FROM stores ORDER BY brand_name ASC');
    expect(storesRes.rows.length).toBe(2);
    expect(storesRes.rows[0].brand_name).toBe('Highland Peak Gear');
    expect(storesRes.rows[1].brand_name).toBe('London Eco Apparel');

    // Verify policies
    const policiesRes = await db.query('SELECT * FROM store_policies');
    expect(policiesRes.rows.length).toBe(2);

    // Verify widget settings
    const widgetRes = await db.query('SELECT * FROM widget_settings');
    expect(widgetRes.rows.length).toBe(2);

    // Verify ad_creatives table exists
    const adCreativesRes = await db.query('SELECT * FROM ad_creatives');
    expect(adCreativesRes.rows.length).toBe(0);

    await db.close();
  });
});
