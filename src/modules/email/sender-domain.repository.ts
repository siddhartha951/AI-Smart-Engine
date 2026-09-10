import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { MerchantSenderDomain } from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

export class SenderDomainRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  async createDomain(
    storeId: string,
    domainName: string,
    providerDomainId: string,
    dnsRecords: any[],
    senderName?: string,
    senderEmail?: string,
    status: 'pending' | 'verified' | 'failed' | 'temporary_failure' = 'pending'
  ): Promise<MerchantSenderDomain> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const cleanDomain = domainName.toLowerCase().trim();
    const recordsJson = JSON.stringify(dnsRecords);

    const res = await this.db.query<MerchantSenderDomain>(
      `INSERT INTO merchant_sender_domains (
        store_id, domain_name, provider, provider_domain_id, status, dns_records, sender_name, sender_email, is_default
      ) VALUES ($1, $2, 'resend', $3, $4, $5, $6, $7, true)
      ON CONFLICT (store_id, domain_name) DO UPDATE SET
        provider_domain_id = EXCLUDED.provider_domain_id,
        status = EXCLUDED.status,
        dns_records = EXCLUDED.dns_records,
        sender_name = COALESCE(EXCLUDED.sender_name, merchant_sender_domains.sender_name),
        sender_email = COALESCE(EXCLUDED.sender_email, merchant_sender_domains.sender_email),
        updated_at = NOW()
      RETURNING *`,
      [storeId, cleanDomain, providerDomainId, status, recordsJson, senderName || null, senderEmail || null]
    );

    return res.rows[0];
  }

  async getDomainsByStore(storeId: string): Promise<MerchantSenderDomain[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<MerchantSenderDomain>(
      `SELECT * FROM merchant_sender_domains WHERE store_id = $1 ORDER BY created_at DESC`,
      [storeId]
    );
    return res.rows;
  }

  async getDomainById(storeId: string, domainId: string): Promise<MerchantSenderDomain | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<MerchantSenderDomain>(
      `SELECT * FROM merchant_sender_domains WHERE store_id = $1 AND id = $2`,
      [storeId, domainId]
    );
    return res.rows[0] || null;
  }

  async getVerifiedDomain(storeId: string): Promise<MerchantSenderDomain | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    // Prefer default verified domain, otherwise first verified domain
    const res = await this.db.query<MerchantSenderDomain>(
      `SELECT * FROM merchant_sender_domains 
       WHERE store_id = $1 AND status = 'verified' 
       ORDER BY is_default DESC, created_at ASC 
       LIMIT 1`,
      [storeId]
    );
    return res.rows[0] || null;
  }

  async updateDomainStatus(
    storeId: string,
    domainId: string,
    status: 'pending' | 'verified' | 'failed' | 'temporary_failure',
    dnsRecords?: any[],
    verifiedAt?: Date
  ): Promise<MerchantSenderDomain | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const params: any[] = [status, storeId, domainId];
    let sql = `UPDATE merchant_sender_domains SET status = $1, updated_at = NOW()`;

    if (dnsRecords !== undefined) {
      params.push(JSON.stringify(dnsRecords));
      sql += `, dns_records = $${params.length}`;
    }

    if (verifiedAt !== undefined) {
      params.push(verifiedAt);
      sql += `, verified_at = $${params.length}`;
    } else if (status === 'verified') {
      sql += `, verified_at = NOW()`;
    }

    sql += ` WHERE store_id = $2 AND id = $3 RETURNING *`;

    const res = await this.db.query<MerchantSenderDomain>(sql, params);
    return res.rows[0] || null;
  }

  async deleteDomain(storeId: string, domainId: string): Promise<boolean> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query(
      `DELETE FROM merchant_sender_domains WHERE store_id = $1 AND id = $2`,
      [storeId, domainId]
    );
    return (res.rowCount || 0) > 0;
  }

  async findByProviderDomainId(providerDomainId: string): Promise<MerchantSenderDomain | null> {
    const res = await this.db.query<MerchantSenderDomain>(
      `SELECT * FROM merchant_sender_domains WHERE provider_domain_id = $1 LIMIT 1`,
      [providerDomainId]
    );
    return res.rows[0] || null;
  }

  async findByDomainName(domainName: string): Promise<MerchantSenderDomain | null> {
    const clean = domainName.toLowerCase().trim();
    const res = await this.db.query<MerchantSenderDomain>(
      `SELECT * FROM merchant_sender_domains WHERE domain_name = $1 LIMIT 1`,
      [clean]
    );
    return res.rows[0] || null;
  }
}
