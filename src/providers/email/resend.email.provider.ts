import { Resend } from 'resend';
import {
  IEmailProvider,
  SendEmailParams,
  SendEmailResult,
  ProviderDomainResult,
  ProviderDnsRecord
} from './email.provider';
import { getEnvConfig } from '../../config/env';
import { logger } from '../../utils/logger';

export class ResendEmailProvider implements IEmailProvider {
  private resend: Resend | null = null;
  private apiKey: string;

  constructor(apiKey?: string) {
    const env = getEnvConfig();
    this.apiKey = apiKey || env.RESEND_API_KEY || env.EMAIL_API_KEY || '';
    if (this.apiKey) {
      this.resend = new Resend(this.apiKey);
    }
  }

  private getClient(): Resend {
    if (!this.resend) {
      const env = getEnvConfig();
      this.apiKey = this.apiKey || env.RESEND_API_KEY || env.EMAIL_API_KEY || '';
      if (!this.apiKey) {
        throw new Error('RESEND_API_KEY is not configured on platform');
      }
      this.resend = new Resend(this.apiKey);
    }
    return this.resend;
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    try {
      const client = this.getClient();
      const env = getEnvConfig();

      // Guardrail: never send real customer marketing emails during test or non-production
      let recipient = params.to;
      const isProduction = env.NODE_ENV === 'production';
      const isResendDevSink = recipient.endsWith('@resend.dev');

      if (!isProduction && !isResendDevSink) {
        logger.warn(
          `[ResendEmailProvider] Non-production environment detected (${env.NODE_ENV}). Diverting real recipient '${recipient}' to Resend test sink 'delivered@resend.dev'`
        );
        recipient = 'delivered@resend.dev';
      }

      const headers: Record<string, string> = { ...(params.headers || {}) };
      if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
      }
      if (params.replyTo) {
        headers['Reply-To'] = params.replyTo;
      }

      const tags = [
        ...(params.tags || []),
        { name: 'store_id', value: params.storeId },
        { name: 'campaign_type', value: params.campaignType }
      ];

      const fromAddress =
        params.from || `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`;

      const sendOptions: any = {
        from: fromAddress,
        to: [recipient],
        subject: params.subject,
        text: params.textBody,
        html: params.htmlBody,
        headers,
        tags
      };

      if (params.replyTo) {
        sendOptions.reply_to = params.replyTo;
      }

      const response = await client.emails.send(sendOptions);

      if (response.error) {
        logger.error('[ResendEmailProvider] Failed to send email:', response.error);
        return {
          success: false,
          error: response.error.message
        };
      }

      return {
        success: true,
        messageId: response.data?.id
      };
    } catch (err: any) {
      logger.error('[ResendEmailProvider] Unexpected error during sendEmail:', err);
      return {
        success: false,
        error: err.message || 'Unknown Resend error'
      };
    }
  }

  async createSenderDomain(domainName: string): Promise<ProviderDomainResult> {
    const client = this.getClient();
    const response = await client.domains.create({ name: domainName });

    if (response.error || !response.data) {
      throw new Error(`Resend domain creation failed: ${response.error?.message || 'Unknown error'}`);
    }

    const data = response.data as any;
    return this.mapDomainResult(data);
  }

  async getSenderDomain(domainId: string): Promise<ProviderDomainResult> {
    const client = this.getClient();
    const response = await client.domains.get(domainId);

    if (response.error || !response.data) {
      throw new Error(`Resend domain retrieval failed: ${response.error?.message || 'Unknown error'}`);
    }

    const data = response.data as any;
    return this.mapDomainResult(data);
  }

  async verifySenderDomain(domainId: string): Promise<ProviderDomainResult> {
    const client = this.getClient();
    const response = await client.domains.verify(domainId);

    if (response.error || !response.data) {
      throw new Error(`Resend domain verification request failed: ${response.error?.message || 'Unknown error'}`);
    }

    // After triggering verify, fetch the latest domain state
    return this.getSenderDomain(domainId);
  }

  private mapDomainResult(data: any): ProviderDomainResult {
    const records: ProviderDnsRecord[] = Array.isArray(data.records)
      ? data.records.map((r: any) => ({
          record: r.record || r.type,
          name: r.name,
          type: r.type,
          value: r.value,
          status: r.status || 'not_started',
          ttl: r.ttl,
          priority: r.priority
        }))
      : [];

    let status: 'pending' | 'verified' | 'failed' | 'temporary_failure' = 'pending';
    if (data.status === 'verified') {
      status = 'verified';
    } else if (data.status === 'failed' || data.status === 'temporary_failure') {
      status = data.status;
    }

    return {
      id: data.id,
      name: data.name,
      status,
      records,
      region: data.region
    };
  }
}
