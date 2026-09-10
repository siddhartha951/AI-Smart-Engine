import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../utils/errors';

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
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-store-id, x-widget-key');
      return next();
    }
  }

  // If store context is present, check origin against store.shop_domain
  if (store && store.shop_domain) {
    const originHostname = new URL(origin).hostname;
    if (
      originHostname === store.shop_domain ||
      originHostname.endsWith(`.${store.shop_domain}`)
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-store-id, x-widget-key');
      return next();
    }
  }

  throw new ForbiddenError(`Origin '${origin}' is not authorized for this store`);
}
