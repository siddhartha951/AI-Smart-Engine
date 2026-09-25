import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SupportTicketRepository } from '../../modules/support_tickets/support-ticket.repository';
import { SupportTicketService } from '../../modules/support_tickets/support-ticket.service';
import { MerchantRepository } from '../../modules/merchant/merchant.repository';
import { EntitlementRepository } from '../../modules/entitlements/entitlement.repository';
import { FeatureKey } from '../../modules/entitlements/entitlement.types';
import { triageTicket, computeSlaDueAt } from '../../modules/support_tickets/ticket-triage';
import { enforceStoreAccess } from '../middlewares/auth.middleware';
import { getDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';
import { deliverSupportTicket } from '../../modules/helpdesk/freshdesk-sync.service';

export const ticketDashboardRouter = Router({ mergeParams: true });
export const ticketWidgetRouter = Router();

const repo = new SupportTicketRepository();
const service = new SupportTicketService(repo);

// ==========================================
// Merchant Dashboard Endpoints (Protected)
// ==========================================

// 1. List Tickets & Stats
ticketDashboardRouter.get('/', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const status = req.query.status as string | undefined;
    const category = req.query.category as string | undefined;
    const db = getDatabaseClient();

    const [tickets, stats, categoryCounts, assistantRes] = await Promise.all([
      repo.listTickets(storeId, status, category),
      repo.getTicketStats(storeId),
      repo.getCategoryCounts(storeId),
      db.query(`SELECT ticket_revert_duration FROM assistant_settings WHERE store_id = $1`, [storeId]),
    ]);

    const sla = assistantRes.rows[0]?.ticket_revert_duration || 'within 24 hours';

    res.json({
      success: true,
      data: {
        tickets,
        stats,
        category_counts: categoryCounts,
        sla,
        // Lets the dashboard correct for client clock drift in the SLA countdown
        server_time: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// 2. Get Single Ticket Details with Chat Transcript
ticketDashboardRouter.get('/:ticketId', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const ticketId = req.params.ticketId as string;

    const ticket = await repo.getTicketById(storeId, ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const macros = await service.getReplyMacros(storeId, ticket);

    res.json({
      success: true,
      data: { ...ticket, macros },
    });
  } catch (err) {
    next(err);
  }
});

// 3. AI Auto-Generate Reply for Ticket
ticketDashboardRouter.post('/:ticketId/generate-reply', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const ticketId = req.params.ticketId as string;

    const generatedReply = await service.generateAiReply(storeId, ticketId);
    res.json({
      success: true,
      data: {
        generated_reply: generatedReply,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 4. Send Admin Reply
const sendReplySchema = z.object({
  replyText: z.string().min(1, 'Reply message is required'),
  markResolved: z.boolean().optional().default(false),
});

ticketDashboardRouter.post('/:ticketId/reply', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const ticketId = req.params.ticketId as string;
    const { replyText, markResolved } = sendReplySchema.parse(req.body);

    const updated = await service.sendTicketReply(storeId, ticketId, replyText, markResolved);
    res.json({
      success: true,
      message: markResolved ? 'Reply sent and ticket resolved!' : 'Reply sent successfully!',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// Public Widget Endpoint
// ==========================================
const createWidgetTicketSchema = z.object({
  // The storefront snippet usually only knows its widget_key, so either identifier is accepted
  store_id: z.string().optional().nullable(),
  widget_key: z.string().optional().nullable(),
  session_id: z.string().optional().nullable(),
  customer_email: z.string().max(254).email('Please provide a valid email address'),
  // Public endpoint: long values are trimmed (not rejected) so a shopper's ticket never fails
  customer_name: z.string().optional().transform(v => (v === undefined ? v : v.slice(0, 200))),
  subject: z.string().min(1, 'Subject or question is required').transform(v => v.slice(0, 500)),
  chat_transcript: z.array(z.object({
    role: z.string().transform(v => v.slice(0, 20)),
    content: z.string().transform(v => v.slice(0, 4000)),
  })).optional().transform(v => (v ? v.slice(-50) : v)),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolves the real store from a widget_key or store_id (widget_key takes precedence, matching store-auth)
async function resolveWidgetStoreId(candidates: Array<string | null | undefined>): Promise<string | null> {
  const merchantRepo = new MerchantRepository();
  for (const raw of candidates) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value || !UUID_RE.test(value)) continue;
    const store = (await merchantRepo.getStoreByWidgetKey(value)) || (await merchantRepo.getStoreById(value));
    if (store && store.status === 'active') return store.id;
  }
  return null;
}

ticketWidgetRouter.post('/tickets', async (req: Request, res: Response, next) => {
  try {
    const body = createWidgetTicketSchema.parse(req.body);

    const storeId = await resolveWidgetStoreId([
      body.widget_key,
      req.headers['x-widget-key'] as string | undefined,
      body.store_id,
      req.headers['x-store-id'] as string | undefined,
    ]);
    if (!storeId) {
      return res.status(401).json({ success: false, message: 'Unknown or inactive store. Please refresh and try again.' });
    }

    if (!(await new EntitlementRepository().isFeatureEnabled(storeId, FeatureKey.SUPPORT_TICKETS))) {
      return res.status(403).json({ success: false, message: 'Support tickets are not enabled for this store. Please email the store directly.' });
    }

    // Only link the chat session if it genuinely belongs to this store
    let sessionId: string | undefined;
    if (body.session_id && UUID_RE.test(body.session_id)) {
      const sessionRes = await getDatabaseClient().query(
        `SELECT id FROM chat_sessions WHERE id = $1 AND store_id = $2`,
        [body.session_id, storeId]
      );
      if (sessionRes.rows[0]) sessionId = body.session_id;
    }

    const transcript = body.chat_transcript || [];
    const [triage, slaRes] = await Promise.all([
      triageTicket(storeId, body.subject, transcript),
      getDatabaseClient().query(`SELECT ticket_revert_duration FROM assistant_settings WHERE store_id = $1`, [storeId]),
    ]);

    const ticket = await repo.createTicket({
      storeId,
      sessionId,
      customerEmail: body.customer_email,
      customerName: body.customer_name,
      subject: body.subject,
      chatTranscript: transcript,
      priority: triage.priority,
      category: triage.category,
      sentiment: triage.sentiment,
      slaDueAt: computeSlaDueAt(new Date(), slaRes.rows[0]?.ticket_revert_duration),
    });

    logger.info(`New support ticket created from storefront widget: ${ticket.id} (${ticket.customer_email}) [${triage.category}/${triage.priority} via ${triage.source}]`);

    // Freshdesk (when the store connected it) or the built-in receipt + merchant alert.
    // The ticket is already saved here, so a delivery failure never loses it.
    await deliverSupportTicket(storeId, ticket, service).catch((deliveryErr) => {
      logger.warn('Support ticket delivery failed', { storeId, ticketId: ticket.id, reason: deliveryErr?.message });
    });

    res.status(201).json({
      success: true,
      message: 'Support ticket submitted successfully! Our team will contact you via email.',
      data: {
        ticket_id: ticket.id,
      },
    });
  } catch (err) {
    next(err);
  }
});
