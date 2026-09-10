import { IDatabaseClient } from '../../database/client';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: 'super_admin' | 'ops_admin' | 'platform_admin' | 'merchant_owner';
  merchant_id: string | null;
  store_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class AuthRepository {
  constructor(private db: IDatabaseClient) {}

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0] || null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] || null;
  }
}
