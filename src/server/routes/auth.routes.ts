import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getDatabaseClient } from '../../database/client';
import { AuthRepository } from '../../modules/auth/auth.repository';
import { verifyJwt } from '../middlewares/auth.middleware';

const router = Router();
const JWT_SECRET = process.env.ENCRYPTION_KEY || 'test-secret-key-123';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = LoginSchema.parse(req.body);
    const db = getDatabaseClient();
    const authRepo = new AuthRepository(db);

    const user = await authRepo.findUserByEmail(email);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        merchant_id: user.merchant_id,
        store_id: user.store_id,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: (err as any).issues || (err as any).errors });
    } else {
      console.error('Auth Login Error:', err);
      res.status(500).json({ error: 'Internal server error', msg: (err as any).message });
    }
  }
});

router.get('/me', verifyJwt, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

export default router;
