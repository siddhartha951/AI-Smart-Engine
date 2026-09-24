import { Request, Response, NextFunction } from 'express';
import { EntitlementRepository } from '../../modules/entitlements/entitlement.repository';
import { FeatureKey } from '../../modules/entitlements/entitlement.types';

export const FEATURE_DISABLED_CODE = 'FEATURE_DISABLED';
export const FEATURE_DISABLED_MESSAGE =
  'This feature is currently not enabled for your store. Please contact your administrator to activate it.';

/** Standard 403 body for a disabled feature. `error` keeps its legacy string form for existing clients. */
export function featureDisabledBody(featureKey: FeatureKey) {
  return {
    success: false,
    code: FEATURE_DISABLED_CODE,
    error: `Feature '${featureKey}' is not enabled for this store`,
    message: FEATURE_DISABLED_MESSAGE,
    feature: featureKey,
  };
}

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
        res.status(403).json(featureDisabledBody(featureKey));
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};
