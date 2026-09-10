import { IDatabaseClient } from '../../database/client';

export interface AuditLogRow {
  id: string;
  user_id: string;
  store_id: string | null;
  action: string;
  target_table: string;
  previous_state: any;
  new_state: any;
  created_at: Date;
}

export class AuditRepository {
  constructor(private db: IDatabaseClient) {}

  async logAction(
    userId: string,
    storeId: string | null,
    action: string,
    targetTable: string,
    previousState: any,
    newState: any
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (user_id, store_id, action, target_table, previous_state, new_state) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        storeId,
        action,
        targetTable,
        previousState ? JSON.stringify(previousState) : null,
        newState ? JSON.stringify(newState) : null,
      ]
    );
  }
}
