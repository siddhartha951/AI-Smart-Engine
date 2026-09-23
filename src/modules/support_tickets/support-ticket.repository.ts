import { IDatabaseClient, getDatabaseClient } from '../../database/client';

export interface SupportTicket {
  id: string;
  store_id: string;
  session_id: string | null;
  customer_email: string;
  customer_name: string | null;
  subject: string;
  status: 'open' | 'replied' | 'resolved';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  sentiment: string;
  sla_due_at: Date | string | null;
  chat_transcript: Array<{ role: string; content: string; timestamp?: string }>;
  admin_reply: string | null;
  replied_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CreateTicketDto {
  storeId: string;
  sessionId?: string;
  customerEmail: string;
  customerName?: string;
  subject: string;
  chatTranscript?: Array<{ role: string; content: string }>;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  category?: string;
  sentiment?: string;
  slaDueAt?: Date;
}

export class SupportTicketRepository {
  private explicitDb?: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.explicitDb = db;
  }

  private get db(): IDatabaseClient {
    return this.explicitDb || getDatabaseClient();
  }

  async createTicket(dto: CreateTicketDto): Promise<SupportTicket> {
    const transcriptJson = JSON.stringify(dto.chatTranscript || []);
    const res = await this.db.query<SupportTicket>(
      `INSERT INTO support_tickets (
        store_id, session_id, customer_email, customer_name, subject,
        priority, status, chat_transcript, category, sentiment, sla_due_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, NOW(), NOW())
      RETURNING *`,
      [
        dto.storeId,
        dto.sessionId || null,
        dto.customerEmail.trim().toLowerCase(),
        dto.customerName ? dto.customerName.trim() : null,
        dto.subject.trim(),
        dto.priority || 'medium',
        transcriptJson,
        dto.category || 'general',
        dto.sentiment || 'neutral',
        dto.slaDueAt || null,
      ]
    );

    return this.mapRow(res.rows[0]);
  }

  async listTickets(storeId: string, statusFilter?: string, categoryFilter?: string): Promise<SupportTicket[]> {
    let sql = `SELECT * FROM support_tickets WHERE store_id = $1`;
    const params: any[] = [storeId];

    if (statusFilter && statusFilter !== 'all') {
      params.push(statusFilter);
      sql += ` AND status = $${params.length}`;
    }

    if (categoryFilter && categoryFilter !== 'all') {
      params.push(categoryFilter);
      sql += ` AND category = $${params.length}`;
    }

    // Unresolved urgent/high tickets first so angry customers are answered before routine questions
    sql += ` ORDER BY
      CASE WHEN status = 'resolved' THEN 1 ELSE 0 END ASC,
      CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
      created_at DESC
      LIMIT 100`;
    const res = await this.db.query<SupportTicket>(sql, params);
    return res.rows.map(r => this.mapRow(r));
  }

  async getTicketById(storeId: string, ticketId: string): Promise<SupportTicket | null> {
    const res = await this.db.query<SupportTicket>(
      `SELECT * FROM support_tickets WHERE store_id = $1 AND id = $2`,
      [storeId, ticketId]
    );
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async updateTicketReply(
    storeId: string,
    ticketId: string,
    replyText: string,
    newStatus: 'replied' | 'resolved' = 'replied'
  ): Promise<SupportTicket | null> {
    const res = await this.db.query<SupportTicket>(
      `UPDATE support_tickets
       SET admin_reply = $1, status = $2, replied_at = NOW(), updated_at = NOW()
       WHERE store_id = $3 AND id = $4
       RETURNING *`,
      [replyText.trim(), newStatus, storeId, ticketId]
    );

    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async getCategoryCounts(storeId: string): Promise<Record<string, number>> {
    const res = await this.db.query<{ category: string; count: string }>(
      `SELECT category, COUNT(*)::text as count
       FROM support_tickets
       WHERE store_id = $1 AND status <> 'resolved'
       GROUP BY category`,
      [storeId]
    );
    const counts: Record<string, number> = {};
    for (const row of res.rows) counts[row.category || 'general'] = parseInt(row.count, 10) || 0;
    return counts;
  }

  async getTicketStats(storeId: string): Promise<{ total: number; open: number; replied: number; resolved: number }> {
    const res = await this.db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text as count
       FROM support_tickets
       WHERE store_id = $1
       GROUP BY status`,
      [storeId]
    );

    let total = 0;
    let open = 0;
    let replied = 0;
    let resolved = 0;

    for (const row of res.rows) {
      const c = parseInt(row.count, 10) || 0;
      total += c;
      if (row.status === 'open') open += c;
      else if (row.status === 'replied') replied += c;
      else if (row.status === 'resolved') resolved += c;
    }

    return { total, open, replied, resolved };
  }

  private mapRow(row: any): SupportTicket {
    let transcript = [];
    if (row.chat_transcript) {
      if (typeof row.chat_transcript === 'string') {
        try {
          transcript = JSON.parse(row.chat_transcript);
        } catch (_) {
          transcript = [];
        }
      } else if (Array.isArray(row.chat_transcript)) {
        transcript = row.chat_transcript;
      }
    }

    return {
      ...row,
      chat_transcript: transcript,
    };
  }
}
