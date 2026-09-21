import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MetaAdsClient,
  MetaAdsApiError,
  parseInsightRow,
  summarizeInsights,
} from '../../src/providers/meta/meta_ads.client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('MetaAdsClient', () => {
  const client = new MetaAdsClient({ timeoutMs: 1000 });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates a token via /me and returns the user identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'user_1', name: 'Sid Merchant' }));
    vi.stubGlobal('fetch', fetchMock);

    const info = await client.validateToken('EAAB_valid_token');
    expect(info).toEqual({ userId: 'user_1', userName: 'Sid Merchant' });
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('https://graph.facebook.com/v21.0/me');
    expect(calledUrl).toContain('access_token=EAAB_valid_token');
  });

  it('lists ad accounts with normalized fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            { id: 'act_111', name: 'Main Store Ads', account_status: 1, currency: 'INR', timezone_name: 'Asia/Kolkata' },
            { id: 'act_222', name: 'Paused Account', account_status: 2, currency: 'USD' },
          ],
        })
      )
    );

    const accounts = await client.listAdAccounts('EAAB_valid_token');
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ id: 'act_111', accountId: '111', name: 'Main Store Ads', accountStatus: 1, currency: 'INR' });
  });

  it('fetches insights and parses spend/clicks/CTR/CPC', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              campaign_id: 'c1',
              campaign_name: 'Diwali Sale',
              spend: '100.00',
              impressions: '10000',
              clicks: '500',
              ctr: '5.0',
              cpc: '0.20',
              actions: [{ action_type: 'purchase', value: '10' }],
              action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '5000' }],
            },
          ],
        })
      )
    );

    const result = await client.getInsights('EAAB_valid_token', '111', { level: 'campaign', datePreset: 'last_30d' });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.campaignName).toBe('Diwali Sale');
    expect(row.spend).toBe(100);
    expect(row.conversions).toBe(10);
    expect(row.conversionValue).toBe(5000);
    expect(row.roas).toBe(50);
    expect(result.totals.spend).toBe(100);
    expect(result.totals.roas).toBe(50);

    // account id is prefixed with act_ automatically
    const fetchMock = (globalThis.fetch as any).mock;
    expect(String(fetchMock.calls[0][0])).toContain('/act_111/insights');
  });

  it('derives CTR/CPC when Meta omits them', () => {
    const row = parseInsightRow({ spend: '50', impressions: '2000', clicks: '100', actions: [], action_values: [] });
    expect(row.ctr).toBe(5);
    expect(row.cpc).toBe(0.5);
  });

  it('summarizes totals across rows', () => {
    const totals = summarizeInsights([
      parseInsightRow({ spend: '100', impressions: '1000', clicks: '50', actions: [{ action_type: 'purchase', value: '2' }], action_values: [{ action_type: 'purchase', value: '200' }] }),
      parseInsightRow({ spend: '100', impressions: '3000', clicks: '150', actions: [], action_values: [] }),
    ]);
    expect(totals.spend).toBe(200);
    expect(totals.impressions).toBe(4000);
    expect(totals.clicks).toBe(200);
    expect(totals.ctr).toBe(5);
    expect(totals.cpc).toBe(1);
    expect(totals.conversions).toBe(2);
    expect(totals.roas).toBe(1);
  });

  it('throws a token error with a merchant-safe message on OAuthException 190', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } },
          400
        )
      )
    );

    try {
      await client.validateToken('EAAB_expired');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MetaAdsApiError);
      const apiErr = err as MetaAdsApiError;
      expect(apiErr.isTokenError).toBe(true);
      expect(apiErr.toUserMessage()).toContain('expired');
      // Raw Meta message must not leak internal wording beyond the safe message
      expect(apiErr.toUserMessage()).not.toContain('EAAB_expired');
    }
  });

  it('throws a permission error message when ads_read is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { message: '(#200) Requires ads_read permission', type: 'OAuthException', code: 200 } },
          403
        )
      )
    );

    try {
      await client.listAdAccounts('EAAB_no_perms');
      expect.unreachable();
    } catch (err) {
      expect((err as MetaAdsApiError).toUserMessage()).toContain('ads_read');
    }
  });

  it('rejects invalid ad account ids before calling Meta', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(client.getInsights('EAAB_valid_token', 'not-a-number')).rejects.toThrow('Invalid Meta ad account id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a token', async () => {
    await expect(client.validateToken('')).rejects.toThrow('access token is required');
  });
});
