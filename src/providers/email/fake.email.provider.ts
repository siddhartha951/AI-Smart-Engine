import { IEmailProvider, SendEmailParams, SendEmailResult, ProviderDomainResult, ProviderDnsRecord } from './email.provider';

export class FakeEmailProvider implements IEmailProvider {
  // Expose sent emails for testing assertions
  public sentEmails: (SendEmailParams & { messageId?: string })[] = [];
  public mockDomains: Map<string, ProviderDomainResult> = new Map();

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    console.log(`[FakeEmailProvider] Sending ${params.campaignType} email to ${params.to}`);
    const messageId = `fake_msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.sentEmails.push({ ...params, messageId });
    return { success: true, messageId };
  }

  async createSenderDomain(domainName: string): Promise<ProviderDomainResult> {
    const domainId = `fake_domain_${domainName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const records: ProviderDnsRecord[] = [
      {
        record: 'DKIM',
        name: `resend._domainkey.${domainName}`,
        type: 'TXT',
        value: `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCfakeKeyFor_${domainName}`,
        status: 'not_started',
        ttl: 'Auto'
      },
      {
        record: 'SPF',
        name: `bounces.${domainName}`,
        type: 'MX',
        value: 'feedback-smtp.resend.com',
        status: 'not_started',
        priority: 10
      },
      {
        record: 'SPF',
        name: `bounces.${domainName}`,
        type: 'TXT',
        value: 'v=spf1 include:resend.com ~all',
        status: 'not_started',
        ttl: 'Auto'
      }
    ];

    const result: ProviderDomainResult = {
      id: domainId,
      name: domainName,
      status: 'pending',
      records,
      region: 'us-east-1'
    };

    this.mockDomains.set(domainId, result);
    return result;
  }

  async getSenderDomain(domainId: string): Promise<ProviderDomainResult> {
    const existing = this.mockDomains.get(domainId);
    if (existing) {
      return existing;
    }
    return {
      id: domainId,
      name: 'example.com',
      status: 'pending',
      records: []
    };
  }

  async verifySenderDomain(domainId: string): Promise<ProviderDomainResult> {
    const domain = this.mockDomains.get(domainId);
    if (domain) {
      domain.status = 'verified';
      domain.records = domain.records.map(r => ({ ...r, status: 'verified' }));
      this.mockDomains.set(domainId, domain);
      return domain;
    }
    const verified: ProviderDomainResult = {
      id: domainId,
      name: 'verified.example.com',
      status: 'verified',
      records: []
    };
    this.mockDomains.set(domainId, verified);
    return verified;
  }

  setDomainStatus(domainId: string, status: 'pending' | 'verified' | 'failed') {
    const domain = this.mockDomains.get(domainId);
    if (domain) {
      domain.status = status;
      domain.records = domain.records.map(r => ({ ...r, status: status === 'verified' ? 'verified' : 'not_started' }));
      this.mockDomains.set(domainId, domain);
    }
  }

  // Utility for tests to clear the inbox
  clearInbox() {
    this.sentEmails = [];
    this.mockDomains.clear();
  }
}
