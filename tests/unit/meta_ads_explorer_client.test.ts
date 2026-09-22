import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MetaAdsClient,
  MetaAdsApiError,
  parseExplorerAd,
  META_EXPLORER_MAX_PAGES,
} from '../../src/providers/meta/meta_ads.client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('parseExplorerAd', () => {
  it('parses a full image ad with campaign, adset, creative and destination URL', () => {
    const ad = parseExplorerAd({
      id: '123',
      name: 'Diwali Sale - Video 1',
      effective_status: 'ACTIVE',
      campaign: { name: 'Diwali Sale' },
      adset: { name: 'Broad - IN' },
      adcreatives: {
        data: [
          {
            thumbnail_url: 'https://cdn.example.com/thumb.jpg',
            image_url: 'https://cdn.example.com/full.jpg',
            object_story_spec: { link_data: { link: 'https://store.example.com/p/1' } },
          },
        ],
      },
    });
    expect(ad).toEqual({
      adId: '123',
      name: 'Diwali Sale - Video 1',
      status: 'ACTIVE',
      campaignName: 'Diwali Sale',
      adsetName: 'Broad - IN',
      thumbnailUrl: 'https://cdn.example.com/full.jpg',
      creativeUrl: 'https://cdn.example.com/full.jpg',
      destinationUrl: 'https://store.example.com/p/1',
    });
  });

  it('falls back to thumbnail_url when image_url is missing (video creatives)', () => {
    const ad = parseExplorerAd({
      id: '124',
      name: 'Video Ad',
      effective_status: 'PAUSED',
      campaign: { name: 'C1' },
      adset: { name: 'S1' },
      adcreatives: {
        data: [{ thumbnail_url: 'https://cdn.example.com/video-thumb.jpg', video_id: '999' }],
      },
    });
    expect(ad.thumbnailUrl).toBe('https://cdn.example.com/video-thumb.jpg');
    expect(ad.creativeUrl).toBeNull();
    expect(ad.destinationUrl).toBeNull();
  });

  it('handles ads with no creatives gracefully (missing creative)', () => {
    const ad = parseExplorerAd({
      id: '125',
      name: 'No Creative Ad',
      effective_status: 'ACTIVE',
      campaign: {},
      adset: null,
    });
    expect(ad.thumbnailUrl).toBeNull();
    expect(ad.creativeUrl).toBeNull();
    expect(ad.destinationUrl).toBeNull();
    expect(ad.campaignName).toBeNull();
    expect(ad.adsetName).toBeNull();
    expect(ad.status).toBe('ACTIVE');
  });

  it('defaults status to UNKNOWN when effective_status is missing', () => {
    const ad = parseExplorerAd({ id: '126' });
    expect(ad.status).toBe('UNKNOWN');
    expect(ad.name).toBe('');
  });
});

describe('MetaAdsClient.listAdsWithCreatives', () => {
  const client = new MetaAdsClient({ timeoutMs: 1000 });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches ads and follows pagination cursors', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe('/v21.0/act_111/ads');
      if (!u.searchParams.get('after')) {
        // First page carries the field selection; cursor pages only carry `after`.
        expect(u.searchParams.get('fields')).toContain('adcreatives');
        return jsonResponse({
          data: [{ id: '1', name: 'Ad One', effective_status: 'ACTIVE', campaign: { name: 'C1' }, adset: { name: 'S1' } }],
          paging: { next: 'https://graph.facebook.com/v21.0/act_111/ads?after=CURSOR1&access_token=TOK' },
        });
      }
      return jsonResponse({
        data: [{ id: '2', name: 'Ad Two', effective_status: 'PAUSED', campaign: { name: 'C1' }, adset: { name: 'S2' } }],
        paging: {},
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const ads = await client.listAdsWithCreatives('TOK', '111');
    expect(ads).toHaveLength(2);
    expect(ads[0].adId).toBe('1');
    expect(ads[1].adId).toBe('2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts act_-prefixed account ids', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const ads = await client.listAdsWithCreatives('TOK', 'act_111');
    expect(ads).toEqual([]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/act_111/ads');
  });

  it('rejects invalid account ids without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(client.listAdsWithCreatives('TOK', 'not-a-number')).rejects.toThrow('Invalid Meta ad account id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing token without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(client.listAdsWithCreatives('', '111')).rejects.toThrow('Meta access token is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates Meta API errors as MetaAdsApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { message: 'Missing permission', type: 'OAuthException', code: 200 } }, 400)
      )
    );
    await expect(client.listAdsWithCreatives('TOK', '111')).rejects.toBeInstanceOf(MetaAdsApiError);
  });

  it('caps pagination at META_EXPLORER_MAX_PAGES', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      const after = u.searchParams.get('after') || '0';
      return jsonResponse({
        data: [{ id: `ad-${after}`, name: `Ad ${after}`, effective_status: 'ACTIVE' }],
        paging: { next: `https://graph.facebook.com/v21.0/act_111/ads?after=${Number(after) + 1}&access_token=TOK` },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const ads = await client.listAdsWithCreatives('TOK', '111');
    expect(fetchMock).toHaveBeenCalledTimes(META_EXPLORER_MAX_PAGES);
    expect(ads).toHaveLength(META_EXPLORER_MAX_PAGES);
  });
});
