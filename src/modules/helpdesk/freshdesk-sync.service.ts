import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { EntitlementRepository } from '../entitlements/entitlement.repository';
import { FeatureKey } from '../entitlements/entitlement.types';
import { SupportTicket, SupportTicketRepository } from '../support_tickets/support-ticket.repository';
import {
  FreshdeskError,
  buildTicketDescription,
  createFreshdeskTicket,
  freshdeskPriority,
  freshdeskTicketUrl,
} from '../../providers/helpdesk/freshdesk.client';
import { HelpdeskRepository } from './helpdesk.repository';
import { logger } from '../../utils/logger';

/** Tests swap the HTTP layer; production uses global fetch. */
type FetchLike = Parameters<typeof createFreshdeskTicket>[2];

export interface FreshdeskSyncResult {
  ok: boolean;
  externalId?: string;
  url?: string;
  error?: string;
}

/**
 * A store sends tickets to Freshdesk only when the admin has the feature on for it AND its
 * merchant connected Freshdesk (provider = freshdesk with a tested key).
 */
export async function isFreshdeskActive(db: IDatabaseClient, storeId: string): Promise<boolean> {
  const [featureOn, settings] = await Promise.all([
    new EntitlementRepository(db).isFeatureEnabled(storeId, FeatureKey.FRESHDESK).catch(() => false),
    new HelpdeskRepository(db).getSettings(storeId).catch(() => null),
  ]);
  return Boolean(
    featureOn &&
      settings &&
      settings.provider === 'freshdesk' &&
      settings.has_api_key &&
      settings.freshdesk_domain &&
      settings.status !== 'not_connected'
  );
}

/** Creates the Freshdesk ticket for one of our tickets and records the outcome on it. */
export async function syncTicketToFreshdesk(
  db: IDatabaseClient,
  storeId: string,
  ticket: SupportTicket,
  fetchImpl?: FetchLike
): Promise<FreshdeskSyncResult> {
  const helpdesk = new HelpdeskRepository(db);
  const creds = await helpdesk.getCredentials(storeId);
  if (!creds) {
    const error = 'Freshdesk is not connected';
    await helpdesk.markTicketFailed(storeId, ticket.id, error);
    return { ok: false, error };
  }

  await helpdesk.markTicketPending(storeId, ticket.id);
  try {
    const storeRes = await db.query('SELECT brand_name FROM stores WHERE id = $1', [storeId]);
    const created = await createFreshdeskTicket(
      creds,
      {
        email: ticket.customer_email,
        name: ticket.customer_name,
        subject: ticket.subject,
        descriptionHtml: buildTicketDescription({
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
          sentiment: ticket.sentiment,
          storeName: storeRes.rows[0]?.brand_name || undefined,
          transcript: ticket.chat_transcript || [],
        }),
        priority: freshdeskPriority(ticket.priority),
        tags: ['ai-smart-engine', ticket.category || 'general'],
      },
      fetchImpl
    );
    const url = freshdeskTicketUrl(creds.domain, created.id);
    await helpdesk.markTicketSynced(storeId, ticket.id, created.id, url);
    return { ok: true, externalId: created.id, url };
  } catch (err: any) {
    const message = err instanceof FreshdeskError ? err.message : 'Unexpected error while creating the Freshdesk ticket';
    await helpdesk.markTicketFailed(storeId, ticket.id, message);
    // A revoked key or a deleted account needs the merchant; show it on the settings page
    if (err instanceof FreshdeskError && (err.code === 'auth' || err.code === 'not_found')) {
      await helpdesk.setStatus(storeId, 'error', message);
    }
    logger.warn('Freshdesk ticket sync failed', { storeId, ticketId: ticket.id, reason: message });
    return { ok: false, error: message };
  }
}

export interface TicketNotifier {
  sendTicketReceiptEmail(storeId: string, ticket: SupportTicket): Promise<void>;
  sendMerchantTicketAlert(storeId: string, ticket: SupportTicket): Promise<void>;
}

/**
 * Delivers a newly created ticket. With Freshdesk active and the sync working, Freshdesk
 * acknowledges the shopper and notifies agents itself, so our own emails are skipped. If
 * Freshdesk is off or the sync fails, the built-in receipt and merchant alert go out as before:
 * the shopper is never left without an answer, and the ticket stays here for a retry.
 */
export async function deliverSupportTicket(
  storeId: string,
  ticket: SupportTicket,
  notifier: TicketNotifier,
  opts: { db?: IDatabaseClient; fetchImpl?: FetchLike } = {}
): Promise<{ channel: 'freshdesk' | 'built_in'; synced: boolean }> {
  const db = opts.db || getDatabaseClient();
  if (await isFreshdeskActive(db, storeId)) {
    const result = await syncTicketToFreshdesk(db, storeId, ticket, opts.fetchImpl);
    if (result.ok) return { channel: 'freshdesk', synced: true };
  }
  await Promise.all([
    notifier.sendTicketReceiptEmail(storeId, ticket),
    notifier.sendMerchantTicketAlert(storeId, ticket),
  ]);
  return { channel: 'built_in', synced: false };
}

/** Sends tickets that never reached Freshdesk (oldest first). Stops early on a bad key. */
export async function retryUnsyncedTickets(
  storeId: string,
  opts: { db?: IDatabaseClient; fetchImpl?: FetchLike; limit?: number } = {}
): Promise<{ attempted: number; synced: number; failed: number }> {
  const db = opts.db || getDatabaseClient();
  const ids = await new HelpdeskRepository(db).listUnsyncedTicketIds(storeId, opts.limit ?? 20);
  const tickets = new SupportTicketRepository(db);
  let synced = 0;
  let failed = 0;
  for (const id of ids) {
    const ticket = await tickets.getTicketById(storeId, id);
    if (!ticket) continue;
    const result = await syncTicketToFreshdesk(db, storeId, ticket, opts.fetchImpl);
    if (result.ok) {
      synced += 1;
    } else {
      failed += 1;
      if (/API key|not found|not connected/i.test(result.error || '')) break;
    }
  }
  return { attempted: synced + failed, synced, failed };
}
