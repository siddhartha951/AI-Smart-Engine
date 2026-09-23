import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SupportTicketRepository } from '../../modules/support_tickets/support-ticket.repository';
import { SupportTicketService } from '../../modules/support_tickets/support-ticket.service';
import { enforceStoreAccess } from '../middlewares/auth.middleware';
import { logger } from '../../utils/logger';

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

    const [tickets, stats] = await Promise.all([
      repo.listTickets(storeId, status),
      repo.getTicketStats(storeId),
    ]);

    res.json({
      success: true,
      data: {
        tickets,
        stats,
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

    res.json({
      success: true,
      data: ticket,
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
  store_id: z.string().min(1, 'store_id is required'),
  session_id: z.string().optional(),
  customer_email: z.string().email('Please provide a valid email address'),
  customer_name: z.string().optional(),
  subject: z.string().min(1, 'Subject or question is required'),
  chat_transcript: z.array(z.object({
    role: z.string(),
    content: z.string(),
  })).optional(),
});

ticketWidgetRouter.post('/tickets', async (req: Request, res: Response, next) => {
  try {
    const body = createWidgetTicketSchema.parse(req.body);

    const ticket = await repo.createTicket({
      storeId: body.store_id,
      sessionId: body.session_id,
      customerEmail: body.customer_email,
      customerName: body.customer_name,
      subject: body.subject,
      chatTranscript: body.chat_transcript,
      priority: 'medium',
    });

    logger.info(`New support ticket created from storefront widget: ${ticket.id} (${ticket.customer_email})`);

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
