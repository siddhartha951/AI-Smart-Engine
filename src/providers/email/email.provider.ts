export interface SendEmailParams {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  storeId: string;
  campaignType: string;
  from?: string;
  replyTo?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface ProviderDnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  status: string;
  ttl?: string;
  priority?: number;
}

export interface ProviderDomainResult {
  id: string;
  name: string;
  status: 'pending' | 'verified' | 'failed' | 'temporary_failure';
  records: ProviderDnsRecord[];
  region?: string;
}

export interface IEmailProvider {
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;
  createSenderDomain(domainName: string): Promise<ProviderDomainResult>;
  getSenderDomain(domainId: string): Promise<ProviderDomainResult>;
  verifySenderDomain(domainId: string): Promise<ProviderDomainResult>;
}
