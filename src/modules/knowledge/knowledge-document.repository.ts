import { IDatabaseClient } from '../../database/client';

export interface KnowledgeDocument {
  id: string;
  store_id: string;
  file_name: string;
  document_type: string;
  content: string;
  char_count: number;
  truncated: boolean;
  created_at: Date;
}

export type KnowledgeDocumentSummary = Omit<KnowledgeDocument, 'content'> & { preview: string };

export const MAX_KNOWLEDGE_DOCUMENTS = 25;

export class KnowledgeDocumentRepository {
  constructor(private db: IDatabaseClient) {}

  async listDocuments(storeId: string): Promise<KnowledgeDocument[]> {
    const res = await this.db.query(
      `SELECT * FROM store_knowledge_documents WHERE store_id = $1 ORDER BY created_at ASC`,
      [storeId]
    );
    return res.rows;
  }

  async listSummaries(storeId: string): Promise<KnowledgeDocumentSummary[]> {
    const docs = await this.listDocuments(storeId);
    return docs.map(({ content, ...rest }) => ({
      ...rest,
      preview: content.slice(0, 240),
    }));
  }

  async countDocuments(storeId: string): Promise<number> {
    const res = await this.db.query(
      `SELECT COUNT(*) AS count FROM store_knowledge_documents WHERE store_id = $1`,
      [storeId]
    );
    return Number(res.rows[0]?.count || 0);
  }

  async createDocument(
    storeId: string,
    doc: { fileName: string; documentType: string; content: string; truncated: boolean }
  ): Promise<KnowledgeDocument> {
    const res = await this.db.query(
      `INSERT INTO store_knowledge_documents (store_id, file_name, document_type, content, char_count, truncated)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [storeId, doc.fileName, doc.documentType, doc.content, doc.content.length, doc.truncated]
    );
    return res.rows[0];
  }

  async deleteDocument(storeId: string, id: string): Promise<boolean> {
    const res = await this.db.query(
      `DELETE FROM store_knowledge_documents WHERE store_id = $1 AND id = $2 RETURNING id`,
      [storeId, id]
    );
    return res.rows.length > 0;
  }
}
