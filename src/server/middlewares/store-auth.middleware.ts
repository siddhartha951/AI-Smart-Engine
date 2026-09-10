import { Request, Response, NextFunction } from 'express';
import { MerchantRepository } from '../../modules/merchant/merchant.repository';
import { Store } from '../../database/types';
import { ValidationError, NotFoundError } from '../../utils/errors';

// Augment Express Request interface
declare global {
  namespace Express {
    interface Request {
      store?: Store;
      storeId?: string;
    }
  }
}

export function createStoreAuthMiddleware(merchantRepo?: MerchantRepository) {
  const repo = merchantRepo || new MerchantRepository();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const widgetKey =
        (req.headers['x-widget-key'] as string) ||
        (req.headers['x-store-id'] as string) ||
        (req.query.widget_key as string) ||
        (req.body && req.body.widget_key);

      if (!widgetKey || typeof widgetKey !== 'string') {
        throw new ValidationError('Missing required widget_key in headers, query, or body');
      }

      let store = await repo.getStoreByWidgetKey(widgetKey.trim());
      if (!store) {
        store = await repo.getStoreById(widgetKey.trim());
      }
      if (!store) {
        if (req.path.includes('/config')) {
          throw new NotFoundError(`Store with widget_key '${widgetKey}' was not found`);
        }
        res.status(401).json({ error: 'Unauthorized store or disabled assistant' });
        return;
      }

      if (store.status !== 'active') {
        throw new ValidationError(`Store '${store.brand_name}' is currently ${store.status}`);
      }

      const assistant = await repo.getAssistantSettings(store.id);
      if (assistant && assistant.is_active === false) {
        if (!req.path.includes('/config')) {
          throw new ValidationError('Unauthorized store or disabled assistant');
        }
      }

      req.store = store;
      req.storeId = store.id;
      next();
    } catch (err) {
      if (err instanceof ValidationError && err.message === 'Unauthorized store or disabled assistant') {
        res.status(401).json({ error: 'Unauthorized store or disabled assistant' });
        return;
      }
      next(err);
    }
  };
}
