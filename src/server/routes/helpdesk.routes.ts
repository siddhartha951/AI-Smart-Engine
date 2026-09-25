import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabaseClient } from '../../database/client';
import { AuditRepository } from '../../modules/merchant/audit.repository';
import { EntitlementRepository } from '../../modules/entitlements/entitlement.repository';
import { FeatureKey } from '../../modules/entitlements/entitlement.types';
import { HelpdeskRepository } from '../../modules/helpdesk/helpdesk.repository';
import { isFreshdeskActive, retryUnsyncedTickets } from '../../modules/helpdesk/freshdesk-sync.service';
import {
  FreshdeskError,
  normalizeFreshdeskDomain,
  testFreshdeskConnection,
} from '../../providers/helpdesk/freshdesk.client';

// Mounted at /api/v1/dashboard/:storeId/helpdesk (store access + FRESHDESK feature enforced by the parent)
export const helpdeskRouter = Router({ mergeParams: true });

const apiKeySchema = z.string().trim().min(10, 'Paste the full Freshdesk API key').max(200);

const saveSchema = z
  .object({
    provider: z.enum(['built_in', 'freshdesk']),
    domain: z.string().trim().max(255).optional(),
    api_key: apiKeySchema.optional(),
  })
  .strict();

const testSchema = z
  .object({
    domain: z.string().trim().max(255).optional(),
    api_key: apiKeySchema.optional(),
  })
  .strict();

function badRequest(res: Response, message: string): void {
  res.status(400).json({ success: false, error: message });
}

function zodMessage(err: z.ZodError): string {
  const first = err.issues[0];
  return first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request';
}

async function view(storeId: string) {
  const db = getDatabaseClient();
  const repo = new HelpdeskRepository(db);
  const [settings, stats, ticketsEnabled, active] = await Promise.all([
    repo.getSettings(storeId),
    repo.syncStats(storeId),
    new EntitlementRepository(db).isFeatureEnabled(storeId, FeatureKey.SUPPORT_TICKETS),
    isFreshdeskActive(db, storeId),
  ]);
  return { ...settings, active, tickets_enabled: ticketsEnabled, sync: stats };
}

/** Uses the typed domain/key when given, otherwise what is stored. */
async function resolveCredentials(storeId: string, domainInput?: string, keyInput?: string) {
  const stored = await new HelpdeskRepository(getDatabaseClient()).getCredentials(storeId);
  const domain = domainInput !== undefined ? normalizeFreshdeskDomain(domainInput) : stored?.domain ?? null;
  const apiKey = keyInput ?? stored?.apiKey ?? null;
  return { domain, apiKey, usingStored: domainInput === undefined && keyInput === undefined };
}

helpdeskRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await view(req.params.storeId as string) });
  } catch (err) {
    next(err);
  }
});

helpdeskRouter.post('/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const parsed = testSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, zodMessage(parsed.error));
    const { domain, apiKey, usingStored } = await resolveCredentials(storeId, parsed.data.domain, parsed.data.api_key);
    if (!domain) return badRequest(res, 'Enter your Freshdesk domain, like yourcompany.freshdesk.com');
    if (!apiKey) return badRequest(res, 'Enter your Freshdesk API key');

    const repo = new HelpdeskRepository(getDatabaseClient());
    try {
      const agent = await testFreshdeskConnection({ domain, apiKey });
      if (usingStored) await repo.setStatus(storeId, 'connected', null);
      res.json({ success: true, data: { ok: true, domain, agent_name: agent.agentName, agent_email: agent.agentEmail } });
    } catch (err) {
      const message = err instanceof FreshdeskError ? err.message : 'Could not reach Freshdesk';
      if (usingStored) await repo.setStatus(storeId, 'error', message);
      res.status(400).json({ success: false, error: message });
    }
  } catch (err) {
    next(err);
  }
});

helpdeskRouter.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const parsed = saveSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, zodMessage(parsed.error));
    const db = getDatabaseClient();
    const repo = new HelpdeskRepository(db);
    const before = await repo.getSettings(storeId);
    const audit = new AuditRepository(db);

    if (parsed.data.provider === 'built_in') {
      // Keep the saved Freshdesk details so switching back needs no re-entry
      await repo.save(storeId, { provider: 'built_in', status: before.status === 'not_connected' ? 'not_connected' : before.status }, req.user!.id);
      await audit.logAction(req.user!.id, storeId, 'UPDATE_HELPDESK', 'store_helpdesk_settings', { provider: before.provider }, { provider: 'built_in' });
      res.json({ success: true, message: 'Tickets will stay in your AI Smart Engine inbox.', data: await view(storeId) });
      return;
    }

    const { domain, apiKey } = await resolveCredentials(storeId, parsed.data.domain, parsed.data.api_key);
    if (!domain) return badRequest(res, 'Enter your Freshdesk domain, like yourcompany.freshdesk.com');
    if (!apiKey) return badRequest(res, 'Enter your Freshdesk API key');

    // Only a key that works can switch tickets to Freshdesk
    try {
      await testFreshdeskConnection({ domain, apiKey });
    } catch (err) {
      const message = err instanceof FreshdeskError ? err.message : 'Could not reach Freshdesk';
      return badRequest(res, message);
    }

    await repo.save(
      storeId,
      { provider: 'freshdesk', domain, apiKey: parsed.data.api_key, status: 'connected', lastError: null, tested: true },
      req.user!.id
    );
    await audit.logAction(
      req.user!.id, storeId, 'UPDATE_HELPDESK', 'store_helpdesk_settings',
      { provider: before.provider, domain: before.freshdesk_domain },
      { provider: 'freshdesk', domain, api_key_changed: parsed.data.api_key !== undefined }
    );
    res.json({ success: true, message: 'Freshdesk connected. New tickets will be created there.', data: await view(storeId) });
  } catch (err) {
    next(err);
  }
});

helpdeskRouter.post('/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    if (!(await isFreshdeskActive(getDatabaseClient(), storeId))) {
      return badRequest(res, 'Connect Freshdesk first.');
    }
    const result = await retryUnsyncedTickets(storeId);
    res.json({ success: true, data: { ...result, ...(await view(storeId)) } });
  } catch (err) {
    next(err);
  }
});

helpdeskRouter.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const repo = new HelpdeskRepository(db);
    const before = await repo.getSettings(storeId);
    await repo.save(storeId, { provider: 'built_in', domain: null, apiKey: null, status: 'not_connected', lastError: null }, req.user!.id);
    await new AuditRepository(db).logAction(
      req.user!.id, storeId, 'DISCONNECT_HELPDESK', 'store_helpdesk_settings',
      { provider: before.provider, domain: before.freshdesk_domain }, { provider: 'built_in' }
    );
    res.json({ success: true, message: 'Freshdesk disconnected.', data: await view(storeId) });
  } catch (err) {
    next(err);
  }
});
