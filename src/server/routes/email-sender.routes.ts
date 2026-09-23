import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabaseClient } from '../../database/client';
import { SenderDomainRepository } from '../../modules/email/sender-domain.repository';
import { AuditRepository } from '../../modules/merchant/audit.repository';
import {
  resolveStoreSender,
  checkDmarc,
  normalizeDomain,
  isValidDomain,
  senderEmailMatchesDomain,
} from '../../modules/email/sender-identity';
import { getEmailProvider } from '../../providers/email';
import { getEnvConfig } from '../../config/env';
import { MerchantSenderDomain } from '../../database/types';

// Mounted at /api/v1/dashboard/:storeId/email (store access is enforced by the parent router)
export const emailSenderRouter = Router({ mergeParams: true });

const senderSchema = z.object({
  sender_name: z.string().trim().max(120).optional().nullable(),
  sender_email: z.string().trim().max(255).optional().nullable(),
});

function badRequest(res: Response, message: string) {
  res.status(400).json({ success: false, message, error: message });
}

async function withDmarc(domain: MerchantSenderDomain, reportEmail: string | null) {
  const dmarc = await checkDmarc(domain.domain_name, reportEmail);
  return { ...domain, dmarc };
}

// Everything the Email Automation "Sending identity" panel needs in one call
emailSenderRouter.get('/sender-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const [identity, domains] = await Promise.all([
      resolveStoreSender(storeId, db),
      new SenderDomainRepository(db).getDomainsByStore(storeId),
    ]);
    const env = getEnvConfig();

    res.json({
      success: true,
      data: {
        identity: {
          mode: identity.mode,
          from_name: identity.from_name,
          from_email: identity.from_email,
          from_address: identity.from_address,
          reply_to: identity.reply_to,
          domain_name: identity.domain?.domain_name || null,
        },
        domains: await Promise.all(domains.map(d => withDmarc(d, identity.reply_to))),
        provider: env.EMAIL_PROVIDER_MODE,
        // Abandoned-cart recovery still requires a verified domain (see EmailWorker); tickets work in either mode
        recovery_requires_verified_domain: true,
      },
    });
  } catch (err) {
    next(err);
  }
});

emailSenderRouter.get('/domains', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const domains = await new SenderDomainRepository(getDatabaseClient()).getDomainsByStore(storeId);
    res.json({ success: true, data: domains });
  } catch (err) {
    next(err);
  }
});

emailSenderRouter.post('/domains', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const domainName = normalizeDomain(req.body?.domain_name);
    if (!domainName || !isValidDomain(domainName)) {
      return badRequest(res, 'Please enter a valid domain, for example getaniwell.com');
    }

    const parsed = senderSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Invalid sender details');
    const senderEmail = parsed.data.sender_email?.toLowerCase() || null;
    if (senderEmail && !senderEmailMatchesDomain(senderEmail, domainName)) {
      return badRequest(res, `Sender email must be an address on ${domainName}, for example help@${domainName}`);
    }

    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);

    // A domain can only be claimed by one store on the platform
    const existing = await domainRepo.findByDomainName(domainName);
    if (existing && existing.store_id !== storeId) {
      return res.status(409).json({ success: false, message: 'This domain is already connected to another store. Contact support if you own it.' });
    }

    const providerRes = await getEmailProvider().createSenderDomain(domainName);
    const domain = await domainRepo.createDomain(
      storeId,
      domainName,
      providerRes.id,
      providerRes.records,
      parsed.data.sender_name || undefined,
      senderEmail || undefined,
      providerRes.status
    );

    await new AuditRepository(db).logAction(req.user!.id, storeId, 'ADD_SENDER_DOMAIN', 'merchant_sender_domains', {}, { domain_name: domainName });
    res.status(201).json({ success: true, data: domain });
  } catch (err) {
    next(err);
  }
});

emailSenderRouter.put('/domains/:domainId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const domainId = req.params.domainId as string;
    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);

    const domain = await domainRepo.getDomainById(storeId, domainId);
    if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });

    const parsed = senderSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Invalid sender details');
    const senderEmail = parsed.data.sender_email?.toLowerCase() || null;
    if (senderEmail && !senderEmailMatchesDomain(senderEmail, domain.domain_name)) {
      return badRequest(res, `Sender email must be an address on ${domain.domain_name}`);
    }

    const updated = await domainRepo.updateSenderIdentity(storeId, domainId, parsed.data.sender_name || null, senderEmail);
    await new AuditRepository(db).logAction(req.user!.id, storeId, 'UPDATE_SENDER_IDENTITY', 'merchant_sender_domains', domain, updated || {});
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

emailSenderRouter.post('/domains/:domainId/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const domainId = req.params.domainId as string;
    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);

    const domain = await domainRepo.getDomainById(storeId, domainId);
    if (!domain) {
      res.status(404).json({ success: false, error: 'Domain not found', message: 'Domain not found' });
      return;
    }

    const providerRes = await getEmailProvider().verifySenderDomain(domain.provider_domain_id);
    const updated = await domainRepo.updateDomainStatus(storeId, domainId, providerRes.status, providerRes.records);

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

emailSenderRouter.delete('/domains/:domainId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const domainId = req.params.domainId as string;
    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);

    const domain = await domainRepo.getDomainById(storeId, domainId);
    const deleted = await domainRepo.deleteDomain(storeId, domainId);
    if (deleted && domain) {
      await new AuditRepository(db).logAction(req.user!.id, storeId, 'REMOVE_SENDER_DOMAIN', 'merchant_sender_domains', { domain_name: domain.domain_name }, {});
    }
    res.json({ success: true, deleted });
  } catch (err) {
    next(err);
  }
});

// Sends a real preview through the store's current sending identity so merchants can check inbox placement
emailSenderRouter.post('/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ success: false, message: 'Please enter a valid email address' });
      return;
    }

    const identity = await resolveStoreSender(storeId);
    const modeLabel = identity.mode === 'verified_domain' ? `your verified domain (${identity.domain?.domain_name})` : 'the platform default sender';

    await getEmailProvider().sendEmail({
      to: email,
      from: identity.from_address,
      replyTo: identity.reply_to || undefined,
      subject: `[Test] Email preview from ${identity.from_name}`,
      textBody: `This is a test email from your AI Smart Engine dashboard.\n\nSent from: ${identity.from_address}\nReplies go to: ${identity.reply_to || 'not set'}\nSending mode: ${modeLabel}`,
      htmlBody: `<div style="font-family: sans-serif; line-height: 1.6; color: #1e293b; max-width: 560px; margin: 0 auto; padding: 20px;">
        <h3 style="margin-top: 0;">Test email preview</h3>
        <p>This is a test email from your AI Smart Engine dashboard.</p>
        <p style="font-size: 13px; color: #475569;">Sent via ${modeLabel}. Check that it landed in your Primary inbox, not Spam or Promotions.</p>
      </div>`,
      storeId,
      campaignType: 'test_email',
    });

    const provider = getEnvConfig().EMAIL_PROVIDER_MODE;
    res.json({
      success: true,
      message: provider === 'resend'
        ? `Test email sent to ${email} from ${identity.from_address}`
        : `Test email recorded (email provider is in "${provider}" mode, so nothing was delivered)`,
    });
  } catch (err) {
    next(err);
  }
});
