import { promises as dns } from 'dns';
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { SenderDomainRepository } from './sender-domain.repository';
import { getEnvConfig } from '../../config/env';
import { MerchantSenderDomain } from '../../database/types';

export type SendingMode = 'verified_domain' | 'platform_default';

export interface StoreSenderIdentity {
  mode: SendingMode;
  from_name: string;
  from_email: string;
  from_address: string;
  reply_to: string | null;
  domain: MerchantSenderDomain | null;
}

export interface DmarcStatus {
  record: 'DMARC';
  name: string;
  type: 'TXT';
  value: string;
  status: 'verified' | 'not_found' | 'unknown';
  recommended: true;
}

const PLACEHOLDER_SUPPORT_CONTACT = 'support@store.com';

type TxtResolver = (hostname: string) => Promise<string[][]>;
let txtResolver: TxtResolver = (hostname) => dns.resolveTxt(hostname);

/** Test hook: replaces the live DNS TXT lookup used for DMARC checks. */
export function setDnsTxtResolver(resolver: TxtResolver | null): void {
  txtResolver = resolver || ((hostname) => dns.resolveTxt(hostname));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;

export function normalizeDomain(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

/** Sender emails must live on the domain being verified (or a subdomain of it), otherwise DKIM/SPF won't align. */
export function senderEmailMatchesDomain(email: string, domain: string): boolean {
  if (!EMAIL_RE.test(email)) return false;
  const host = email.split('@')[1].toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export function validSupportContact(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!EMAIL_RE.test(v) || v.toLowerCase() === PLACEHOLDER_SUPPORT_CONTACT) return null;
  return v;
}

function quoteName(name: string): string {
  // Strip characters that would break the RFC 5322 display-name
  return name.replace(/["<>\r\n]/g, '').trim() || 'Store Support';
}

/**
 * Resolves who a store's emails come from.
 * - verified_domain: the merchant's own verified domain (fully white-labelled)
 * - platform_default: "<Store Name> <platform notifications address>" with Reply-To the merchant's support inbox
 */
export async function resolveStoreSender(storeId: string, db: IDatabaseClient = getDatabaseClient()): Promise<StoreSenderIdentity> {
  const env = getEnvConfig();
  const [storeRes, assistantRes] = await Promise.all([
    db.query(`SELECT brand_name FROM stores WHERE id = $1`, [storeId]),
    db.query(`SELECT support_contact FROM assistant_settings WHERE store_id = $1`, [storeId]),
  ]);
  const brandName = storeRes.rows[0]?.brand_name || 'Store Support';
  const replyTo = validSupportContact(assistantRes.rows[0]?.support_contact);

  const verified = await new SenderDomainRepository(db).getVerifiedDomain(storeId);
  if (verified) {
    const fromName = quoteName(verified.sender_name || brandName);
    const fromEmail = verified.sender_email || `support@${verified.domain_name}`;
    return {
      mode: 'verified_domain',
      from_name: fromName,
      from_email: fromEmail,
      from_address: `${fromName} <${fromEmail}>`,
      reply_to: replyTo,
      domain: verified,
    };
  }

  const fromName = quoteName(brandName);
  return {
    mode: 'platform_default',
    from_name: fromName,
    from_email: env.EMAIL_FROM_ADDRESS,
    from_address: `${fromName} <${env.EMAIL_FROM_ADDRESS}>`,
    reply_to: replyTo,
    domain: null,
  };
}

/** Recommended DMARC starting policy: monitor-only, so it can never block a merchant's existing mail. */
export function buildDmarcRecommendation(domain: string, reportEmail?: string | null): string {
  const rua = reportEmail && EMAIL_RE.test(reportEmail) ? `; rua=mailto:${reportEmail}` : '';
  return `v=DMARC1; p=none${rua}`;
}

/** Live DNS lookup for an existing DMARC record. Never throws; network failures report "unknown". */
export async function checkDmarc(domain: string, reportEmail?: string | null, timeoutMs = 3000): Promise<DmarcStatus> {
  const base = {
    record: 'DMARC' as const,
    name: `_dmarc.${domain}`,
    type: 'TXT' as const,
    value: buildDmarcRecommendation(domain, reportEmail),
    recommended: true as const,
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    const txt = await Promise.race([
      txtResolver(`_dmarc.${domain}`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), timeoutMs);
      }),
    ]);
    const existing = txt.map(parts => parts.join('')).find(v => v.toLowerCase().startsWith('v=dmarc1'));
    // If the merchant already has a DMARC policy, show theirs rather than asking them to replace it
    return existing ? { ...base, value: existing, status: 'verified' } : { ...base, status: 'not_found' };
  } catch (err: any) {
    const code = err?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return { ...base, status: 'not_found' };
    return { ...base, status: 'unknown' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
