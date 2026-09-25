/**
 * Copies each connected store's daily Meta ad spend into ad_spend, so Home and the Growth
 * Copilot can compute ROAS without the merchant typing spend in by hand.
 *
 * Rows use platform 'meta_ads_sync' and are replaced for the synced window on every run,
 * so a renamed or deleted campaign never leaves stale spend behind. Hand-entered spend
 * (other platform names) is never touched.
 */
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { decryptString } from '../../utils/crypto';
import { logger } from '../../utils/logger';
import { MetaAdsClient, MetaInsightRow, getMetaAdsClient } from '../../providers/meta/meta_ads.client';
import { SyncStateRepository } from './sync-state.repository';

export const META_SPEND_PLATFORM = 'meta_ads_sync';
const WINDOW_DAYS = 30;
const INSIGHT_ROW_LIMIT = 500;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function syncStoreMetaSpend(
  storeId: string,
  opts: { db?: IDatabaseClient; client?: MetaAdsClient; now?: Date } = {}
): Promise<{ status: 'ok' | 'error' | 'not_connected'; days: number; spend: number; message?: string }> {
  const db = opts.db || getDatabaseClient();
  const client = opts.client || getMetaAdsClient();
  const state = new SyncStateRepository(db);
  const now = opts.now || new Date();

  const cfgRes = await db.query(
    `SELECT encrypted_access_token, ad_account_id, account_currency, status FROM meta_ads_configs WHERE store_id = $1`,
    [storeId]
  );
  const cfg = cfgRes.rows[0];
  if (!cfg || !cfg.encrypted_access_token || cfg.status !== 'connected' || !cfg.ad_account_id) {
    return { status: 'not_connected', days: 0, spend: 0 };
  }

  let token = '';
  try {
    token = decryptString(cfg.encrypted_access_token);
  } catch {
    await state.save(storeId, 'meta_spend', { status: 'error', last_error: 'Saved Meta token could not be read. Reconnect Meta Ads.', last_run_at: now.toISOString() });
    return { status: 'error', days: 0, spend: 0, message: 'token unreadable' };
  }

  const since = ymd(new Date(now.getTime() - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000));
  const until = ymd(now);
  let rows: MetaInsightRow[] = [];
  let level: 'campaign' | 'account' = 'campaign';
  try {
    const result = await client.getInsights(token, cfg.ad_account_id, { level: 'campaign', since, until, timeIncrement: 1, limit: INSIGHT_ROW_LIMIT });
    rows = result.rows;
    if (rows.length >= INSIGHT_ROW_LIMIT) {
      // Too many campaign-days for one page: account level keeps the totals exact
      level = 'account';
      rows = (await client.getInsights(token, cfg.ad_account_id, { level: 'account', since, until, timeIncrement: 1, limit: 100 })).rows;
    }
  } catch (err) {
    const message = (err as any)?.toUserMessage?.() || (err as Error)?.message || 'Meta insights request failed';
    await state.save(storeId, 'meta_spend', { status: 'error', last_error: String(message).slice(0, 500), last_run_at: now.toISOString() });
    return { status: 'error', days: 0, spend: 0, message };
  }

  await db.query(
    `DELETE FROM ad_spend WHERE store_id = $1 AND platform = $2 AND spend_date >= $3::date AND spend_date <= $4::date`,
    [storeId, META_SPEND_PLATFORM, since, until]
  );

  const byKey = new Map<string, { date: string; campaign: string; spend: number }>();
  for (const r of rows) {
    const date = r.dateStart || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(r.spend > 0)) continue;
    const campaign = (level === 'campaign' ? r.campaignName : null) || 'All Meta campaigns';
    const key = `${date}|${campaign}`;
    const entry = byKey.get(key) || { date, campaign: campaign.slice(0, 255), spend: 0 };
    entry.spend += r.spend;
    byKey.set(key, entry);
  }

  let total = 0;
  const days = new Set<string>();
  for (const e of byKey.values()) {
    total += e.spend;
    days.add(e.date);
    await db.query(
      `INSERT INTO ad_spend (store_id, spend_date, platform, campaign, spend_amount, currency, notes)
       VALUES ($1, $2::date, $3, $4, $5, $6, 'Synced from Meta Ads')
       ON CONFLICT (store_id, spend_date, platform, campaign) DO UPDATE SET spend_amount = EXCLUDED.spend_amount, updated_at = NOW()`,
      [storeId, e.date, META_SPEND_PLATFORM, e.campaign, Math.round(e.spend * 100) / 100, cfg.account_currency || 'INR']
    );
  }

  await state.save(storeId, 'meta_spend', {
    status: 'ok',
    last_error: null,
    last_run_at: now.toISOString(),
    last_success_at: now.toISOString(),
    records_synced: byKey.size,
    details: { window: { since, until }, level, total_spend: Math.round(total * 100) / 100 },
  });
  return { status: 'ok', days: days.size, spend: total };
}

export async function syncAllStoresMetaSpend(db: IDatabaseClient = getDatabaseClient()): Promise<void> {
  const res = await db.query(`SELECT store_id FROM meta_ads_configs WHERE status = 'connected' AND encrypted_access_token IS NOT NULL`);
  for (const row of res.rows) {
    try {
      await syncStoreMetaSpend(row.store_id, { db });
    } catch (err) {
      logger.warn(`Meta spend sync failed for store ${row.store_id}: ${(err as Error)?.message || err}`);
    }
  }
}
