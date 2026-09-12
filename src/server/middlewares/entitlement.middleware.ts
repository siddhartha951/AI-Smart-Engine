import { Request, Response, NextFunction } from 'express';
import { EntitlementRepository } from '../../modules/entitlements/entitlement.repository';
import { FeatureKey } from '../../modules/entitlements/entitlement.types';

export const enforceFeature = (featureKey: FeatureKey) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const storeId = (req.params.storeId || req.user?.store_id || (req as any).store?.id) as string;
      if (!storeId) {
        res.status(400).json({ success: false, error: 'Store ID is required for feature check' });
        return;
      }

      const repo = new EntitlementRepository();
      const isEnabled = await repo.isFeatureEnabled(storeId, featureKey);

      if (!isEnabled) {
        res.status(403).json({
          success: false,
          error: `Feature '${featureKey}' is not enabled for this store`,
          feature: featureKey,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};
