import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { ChatSession, ChatMessage, Recommendation } from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

export class ChatRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  async createSession(storeId: string, visitorId: string): Promise<ChatSession> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    // Ensure visitor belongs to store
    const checkVisitor = await this.db.query(
      `SELECT id FROM visitors WHERE store_id = $1 AND id = $2`,
      [storeId, visitorId]
    );
    if (checkVisitor.rows.length === 0) {
      throw new TenantIsolationError(`Visitor ${visitorId} does not exist in store ${storeId}`);
    }

    const res = await this.db.query<ChatSession>(
      `INSERT INTO chat_sessions (store_id, visitor_id, started_at, status)
       VALUES ($1, $2, NOW(), 'active')
       RETURNING *`,
      [storeId, visitorId]
    );
    return res.rows[0];
  }

  async getSessionById(storeId: string, sessionId: string): Promise<ChatSession | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<ChatSession>(
      `SELECT * FROM chat_sessions WHERE store_id = $1 AND id = $2`,
      [storeId, sessionId]
    );
    return res.rows[0] || null;
  }

  async addMessage(
    storeId: string,
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    inputTokens = 0,
    outputTokens = 0,
    estimatedCostUsd = 0
  ): Promise<ChatMessage> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    // Validate session ownership
    const session = await this.getSessionById(storeId, sessionId);
    if (!session) {
      throw new TenantIsolationError(`Session ${sessionId} does not belong to store ${storeId}`);
    }

    const res = await this.db.query<ChatMessage>(
      `INSERT INTO chat_messages (store_id, session_id, role, content, ai_input_tokens, ai_output_tokens, estimated_cost_usd, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [storeId, sessionId, role, content, inputTokens, outputTokens, estimatedCostUsd]
    );
    return res.rows[0];
  }

  async getSessionMessages(storeId: string, sessionId: string): Promise<ChatMessage[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const session = await this.getSessionById(storeId, sessionId);
    if (!session) {
      throw new TenantIsolationError(`Session ${sessionId} does not belong to store ${storeId}`);
    }

    const res = await this.db.query<ChatMessage>(
      `SELECT * FROM chat_messages
       WHERE store_id = $1 AND session_id = $2
       ORDER BY created_at ASC`,
      [storeId, sessionId]
    );
    return res.rows;
  }

  async addRecommendation(
    storeId: string,
    sessionId: string,
    rec: {
      productId: string;
      variantId: string;
      title: string;
      price: number;
      currency?: string;
      reason: string;
    }
  ): Promise<Recommendation> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const session = await this.getSessionById(storeId, sessionId);
    if (!session) {
      throw new TenantIsolationError(`Session ${sessionId} does not belong to store ${storeId}`);
    }

    const res = await this.db.query<Recommendation>(
      `INSERT INTO recommendations (store_id, session_id, product_id, variant_id, title, price, currency, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *`,
      [
        storeId,
        sessionId,
        rec.productId,
        rec.variantId,
        rec.title,
        rec.price,
        rec.currency || 'GBP',
        rec.reason,
      ]
    );
    return res.rows[0];
  }

  async getSessionRecommendations(
    storeId: string,
    sessionId: string
  ): Promise<Recommendation[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const session = await this.getSessionById(storeId, sessionId);
    if (!session) {
      throw new TenantIsolationError(`Session ${sessionId} does not belong to store ${storeId}`);
    }

    const res = await this.db.query<Recommendation>(
      `SELECT * FROM recommendations
       WHERE store_id = $1 AND session_id = $2
       ORDER BY created_at ASC`,
      [storeId, sessionId]
    );
    return res.rows;
  }
}
