/**
 * Shopify Image & Product Utilities
 * Provides resilient image URL normalization and high-resolution category photography fallbacks.
 */

export const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  seeds: 'https://images.unsplash.com/photo-1509358271058-acd22cc93898?w=600&auto=format&fit=crop&q=80',
  audio: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80',
  headphones: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80',
  wearable: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
  shoes: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80',
  apparel: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600&auto=format&fit=crop&q=80',
  decor: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600&auto=format&fit=crop&q=80',
  bedding: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=600&auto=format&fit=crop&q=80',
  beauty: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&auto=format&fit=crop&q=80',
  default: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop&q=80'
};

/**
 * Normalizes a raw image URL from Shopify.
 * Handles protocol-relative links (e.g. "//cdn.shopify.com/...") and trims whitespace.
 */
export function normalizeShopifyImageUrl(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  return url;
}

/**
 * Returns a high-converting, high-resolution product photograph based on category and title keywords.
 */
export function getCategoryFallbackImage(category?: string, title?: string): string {
  const combined = `${category || ''} ${title || ''}`.toLowerCase();

  if (combined.includes('seed') || combined.includes('plant') || combined.includes('organic') || combined.includes('herb') || combined.includes('fusion')) {
    return CATEGORY_FALLBACK_IMAGES.seeds;
  }
  if (combined.includes('earbud') || combined.includes('audio') || combined.includes('speaker') || combined.includes('sound')) {
    return CATEGORY_FALLBACK_IMAGES.audio;
  }
  if (combined.includes('headphone')) {
    return CATEGORY_FALLBACK_IMAGES.headphones;
  }
  if (combined.includes('watch') || combined.includes('wearable') || combined.includes('band')) {
    return CATEGORY_FALLBACK_IMAGES.wearable;
  }
  if (combined.includes('shoe') || combined.includes('sneaker') || combined.includes('footwear') || combined.includes('boot')) {
    return CATEGORY_FALLBACK_IMAGES.shoes;
  }
  if (combined.includes('cloth') || combined.includes('shirt') || combined.includes('pant') || combined.includes('dress') || combined.includes('apparel') || combined.includes('fashion') || combined.includes('jacket')) {
    return CATEGORY_FALLBACK_IMAGES.apparel;
  }
  if (combined.includes('decor') || combined.includes('vase') || combined.includes('ceramic') || combined.includes('pot') || combined.includes('home')) {
    return CATEGORY_FALLBACK_IMAGES.decor;
  }
  if (combined.includes('bed') || combined.includes('blanket') || combined.includes('linen') || combined.includes('pillow')) {
    return CATEGORY_FALLBACK_IMAGES.bedding;
  }
  if (combined.includes('beauty') || combined.includes('skin') || combined.includes('serum') || combined.includes('cosmetic') || combined.includes('lotion')) {
    return CATEGORY_FALLBACK_IMAGES.beauty;
  }

  return CATEGORY_FALLBACK_IMAGES.default;
}

/**
 * Resolves a product image: normalizes the URL or falls back to a curated category photo.
 */
export function resolveProductImageUrl(url?: string, category?: string, title?: string): string {
  const normalized = normalizeShopifyImageUrl(url);
  if (!normalized || normalized.includes('example.com') || normalized === '') {
    return getCategoryFallbackImage(category, title);
  }
  return normalized;
}
