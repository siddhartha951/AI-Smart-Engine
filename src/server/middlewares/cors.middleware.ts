import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../utils/errors';

function allowOrigin(origin: string, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-store-id, x-widget-key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return next();
}

export function validateStoreOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const store = req.store;

  // If no origin header (e.g. direct server-to-server or test agent without origin), allow
  if (!origin) {
    return next();
  }

  // Always allow localhost during development or test
  if (process.env.NODE_ENV !== 'production') {
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return allowOrigin(origin, res, next);
    }
  }

  // If store context is present, check origin against store.shop_domain and brand_name
  if (store) {
    let originHostname = '';
    try {
      originHostname = new URL(origin).hostname.toLowerCase();
    } catch {
      throw new ForbiddenError(`Invalid Origin format: '${origin}'`);
    }

    // 1. Direct match with shop_domain (e.g. seedoffusion.myshopify.com)
    if (store.shop_domain) {
      const cleanShopDomain = store.shop_domain.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      if (originHostname === cleanShopDomain || originHostname.endsWith(`.${cleanShopDomain}`)) {
        return allowOrigin(origin, res, next);
      }

      // Match base shop slug (e.g. 'seedoffusion' in 'seedoffusion.myshopify.com')
      const baseShopSlug = cleanShopDomain.replace('.myshopify.com', '').replace(/[^a-z0-9]/g, '');
      const originSlug = originHostname.replace(/[^a-z0-9]/g, '');
      if (baseShopSlug.length >= 4 && (originSlug.includes(baseShopSlug) || baseShopSlug.includes(originSlug))) {
        return allowOrigin(origin, res, next);
      }
    }

    // 2. Match with brand_name (e.g. "Seeds Of Fusion" -> "seedsoffusion" matches "seedsoffusion.in")
    if (store.brand_name) {
      const brandSlug = store.brand_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const originSlug = originHostname.replace(/[^a-z0-9]/g, '');
      if (brandSlug.length >= 4 && (originSlug.includes(brandSlug) || brandSlug.includes(originSlug))) {
        return allowOrigin(origin, res, next);
      }
    }

    // 3. Match any Shopify-related domain (live stores, preview links, admin, dev tunnels)
    const shopifyDomains = [
      '.myshopify.com',          // Live store: store-name.myshopify.com
      '.shopifypreview.com',     // Theme preview: *.shopifypreview.com
      '.shopify.com',            // Admin preview & embeds: admin.shopify.com
      '.trycloudflare.com',      // Shopify dev tunnel proxy
    ];
    if (shopifyDomains.some(d => originHostname.endsWith(d))) {
      return allowOrigin(origin, res, next);
    }
  }

  throw new ForbiddenError(`Origin '${origin}' is not authorized for this store`);
}
