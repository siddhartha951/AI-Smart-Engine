import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDatabaseClient } from '../../database/client';
import { AuthRepository } from '../../modules/auth/auth.repository';

const JWT_SECRET = process.env.ENCRYPTION_KEY || 'test-secret-key-123';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'super_admin' | 'ops_admin' | 'platform_admin' | 'merchant_owner';
  merchant_id: string | null;
  store_id: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const verifyJwt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const db = getDatabaseClient();
    const authRepo = new AuthRepository(db);
    const user = await authRepo.findUserById(decoded.userId);

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      merchant_id: user.merchant_id,
      store_id: user.store_id,
    };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
};

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient role permissions' });
      return;
    }
    next();
  };
};

export const enforceStoreAccess = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const requestedStoreId = req.params.storeId;

  // Admin can access any store
  if (req.user.role === 'platform_admin' || req.user.role === 'super_admin' || req.user.role === 'ops_admin') {
    next();
    return;
  }

  // Merchant can only access their own store
  if (req.user.role === 'merchant_owner') {
    if (req.user.store_id !== requestedStoreId) {
      res.status(403).json({ error: 'Forbidden: you cannot access this store' });
      return;
    }
    next();
    return;
  }

  res.status(403).json({ error: 'Forbidden' });
};

export const requireAdminOnly = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const adminRoles = ['super_admin', 'ops_admin', 'platform_admin'];
  if (!adminRoles.includes(req.user.role)) {
    res.status(403).json({ error: 'Forbidden: admin access required' });
    return;
  }
  next();
};

export const requireSuperAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') {
    res.status(403).json({ error: 'Forbidden: super admin access required' });
    return;
  }
  next();
};
