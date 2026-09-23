import { SupportTicketRepository, SupportTicket } from './support-ticket.repository';
import { CATEGORY_LABELS, TicketCategory } from './ticket-triage';
import { resolveStoreSender } from '../email/sender-identity';
import { getDatabaseClient } from '../../database/client';
import { getAiProvider } from '../../providers/ai';
import { getEmailProvider } from '../../providers/email';
import { getEnvConfig } from '../../config/env';
import { logger } from '../../utils/logger';

interface StoreTicketContext {
  brandName: string;
  shopDomain: string;
  supportContact: string | null;
  merchantEmail: string | null;
  revertDuration: string;
  fromAddress: string | undefined;
  apologyDiscountCode: string | null;
  apologyDiscountPercent: number;
}

export interface TicketMacros {
  order_status: string;
  apology_discount: string;
  apology_discount_code: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function shortTicketId(ticket: Pick<SupportTicket, 'id'>): string {
  return ticket.id.substring(0, 8).toUpperCase();
}

function categoryLabel(category: string | null | undefined): string {
  return CATEGORY_LABELS[(category || 'general') as TicketCategory] || CATEGORY_LABELS.general;
}

function renderTranscriptHtml(ticket: SupportTicket, brandName: string): string {
  const messages = (ticket.chat_transcript || []).filter(m => m && m.content).slice(-20);
  if (messages.length === 0) return '';

  const rows = messages.map(m => {
    const isCustomer = m.role === 'user';
    return `
      <div style="margin: 0 0 10px 0; text-align: ${isCustomer ? 'right' : 'left'};">
        <div style="font-size: 11px; color: #94a3b8; margin-bottom: 2px;">${isCustomer ? 'You' : `${escapeHtml(brandName)} Assistant`}</div>
        <div style="display: inline-block; max-width: 85%; text-align: left; padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; ${isCustomer ? 'background: #eef2ff; color: #1e293b;' : 'background: #f8fafc; color: #334155; border: 1px solid #e2e8f0;'}">
          ${escapeHtml(m.content).replace(/\n/g, '<br>')}
        </div>
      </div>`;
  }).join('');

  return `
    <div style="margin: 20px 0;">
      <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 10px;">Your conversation</div>
      <div style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px;">${rows}</div>
    </div>`;
}

function renderTranscriptText(ticket: SupportTicket): string {
  const messages = (ticket.chat_transcript || []).filter(m => m && m.content).slice(-20);
  if (messages.length === 0) return '';
  return '\n\nYour conversation:\n' + messages.map(m => `${m.role === 'user' ? 'You' : 'Assistant'}: ${m.content}`).join('\n');
}

export class SupportTicketService {
  private repo: SupportTicketRepository;

  constructor(repo?: SupportTicketRepository) {
    this.repo = repo || new SupportTicketRepository();
  }

  private async getStoreContext(storeId: string): Promise<StoreTicketContext> {
    const db = getDatabaseClient();
    const [storeRes, assistantRes] = await Promise.all([
      db.query(
        `SELECT s.brand_name, s.shop_domain, m.contact_email
         FROM stores s LEFT JOIN merchants m ON m.id = s.merchant_id
         WHERE s.id = $1`,
        [storeId]
      ),
      db.query(`SELECT * FROM assistant_settings WHERE store_id = $1`, [storeId]),
    ]);
    const store = storeRes.rows[0] || {};
    const assistant = assistantRes.rows[0] || {};
    const brandName = store.brand_name || 'Store Support';

    // Verified merchant domain when connected, otherwise "<Store Name> <platform address>" with Reply-To the store inbox
    let fromAddress: string | undefined;
    let supportContact: string | null = null;
    try {
      const identity = await resolveStoreSender(storeId, db);
      fromAddress = identity.from_address;
      supportContact = identity.reply_to;
    } catch (err: any) {
      logger.warn(`Could not resolve sender identity for store ${storeId}: ${err?.message || err}`);
    }

    return {
      brandName,
      shopDomain: store.shop_domain || '',
      supportContact,
      merchantEmail: store.contact_email && EMAIL_RE.test(store.contact_email) ? store.contact_email : null,
      revertDuration: assistant.ticket_revert_duration || 'within 24 hours',
      fromAddress,
      apologyDiscountCode: assistant.ticket_apology_discount_code ? String(assistant.ticket_apology_discount_code).trim() || null : null,
      apologyDiscountPercent: Number(assistant.ticket_apology_discount_percent) > 0 ? Number(assistant.ticket_apology_discount_percent) : 10,
    };
  }

  async generateAiReply(storeId: string, ticketId: string): Promise<string> {
    const ticket = await this.repo.getTicketById(storeId, ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const db = getDatabaseClient();
    const [storeRes, assistantRes] = await Promise.all([
      db.query(`SELECT brand_name, shop_domain FROM stores WHERE id = $1`, [storeId]),
      db.query(`SELECT knowledge_base, custom_prompt FROM assistant_settings WHERE store_id = $1`, [storeId]),
    ]);

    const brandName = storeRes.rows[0]?.brand_name || 'Our Store';
    const domain = storeRes.rows[0]?.shop_domain || '';
    const knowledgeBase = assistantRes.rows[0]?.knowledge_base || 'No specialized knowledge base provided.';

    // Format chat history
    const transcriptText = ticket.chat_transcript.length > 0
      ? ticket.chat_transcript.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')
      : `Customer Inquiry: ${ticket.subject}`;

    const systemPrompt = `You are an elite customer support specialist for ${brandName} (${domain}).
Your goal is to draft a helpful, empathetic, and definitive resolution for a customer support ticket.
Ground all answers in the store's verified policies, products, and knowledge base.
Write warmly and professionally, addressing the customer by name if known.
Keep the draft ready to send as an email response.`;

    const userPrompt = `
=== CUSTOMER TICKET DETAILS ===
Customer Email: ${ticket.customer_email}
Customer Name: ${ticket.customer_name || 'Valued Customer'}
Ticket Subject / Query: ${ticket.subject}

=== CHAT TRANSCRIPT PRIOR TO ESCALATION ===
${transcriptText}

=== STORE KNOWLEDGE BASE & POLICIES ===
${knowledgeBase.slice(0, 3000)}

Draft a complete, compassionate, and solution-oriented reply to resolve this customer's inquiry.
Provide clear next steps, tracking guidance, return rules, or product advice as applicable.
Do not include subject lines or metadata markers; write only the message body.`;

    try {
      const aiProvider = getAiProvider();
      const aiRes = await aiProvider.generateText(userPrompt, {
        systemPrompt,
        temperature: 0.3,
        storeId,
      });

      const reply = (aiRes.text || '').trim();
      if (reply.length > 50 && !reply.includes('Mock AI response for:')) {
        return reply;
      }
    } catch (aiErr: any) {
      logger.warn(`AI support reply generation failed, using standard template: ${aiErr?.message || aiErr}`);
    }

    // High quality deterministic fallback
    const greeting = ticket.customer_name ? `Hi ${ticket.customer_name},` : 'Hello,';
    return `${greeting}\n\nThank you for reaching out to ${brandName} support regarding "${ticket.subject}".\n\nWe have reviewed your request and chat history. Our team is actively on it to ensure you have the best possible experience.\n\nIf you have any further questions or details to add, please feel free to reply directly to this message.\n\nWarm regards,\n${brandName} Customer Support Team`;
  }

  /**
   * Canned replies for the ticket modal. Built from real store data only; the apology discount uses the
   * merchant-configured code and never invents one.
   */
  async getReplyMacros(storeId: string, ticket: SupportTicket): Promise<TicketMacros> {
    const ctx = await this.getStoreContext(storeId);
    const greeting = ticket.customer_name ? `Hi ${ticket.customer_name},` : 'Hi there,';
    const signOff = `Warm regards,\n${ctx.brandName} Customer Support Team`;
    const accountUrl = ctx.shopDomain ? `https://${ctx.shopDomain}/account` : '';

    const orderStatus = [
      greeting,
      '',
      `Thank you for your patience, and sorry for the wait on your ${ctx.brandName} order.`,
      '',
      accountUrl
        ? `You can check your live order and shipping status anytime at ${accountUrl} by signing in with ${ticket.customer_email}. The tracking link is also in your shipping confirmation email.`
        : `Your tracking link is in your shipping confirmation email, sent to ${ticket.customer_email}.`,
      '',
      'If you can reply with your order number, we will check it with our courier partner and share the latest tracking update with you personally.',
      '',
      signOff,
    ].join('\n');

    const code = ctx.apologyDiscountCode;
    const apology = [
      greeting,
      '',
      `We are truly sorry for the trouble you have had. This is not the experience we want for any ${ctx.brandName} customer, and we are sorting it out for you right away.`,
      '',
      `As an apology, please enjoy ${ctx.apologyDiscountPercent}% off your next order with code: ${code || '[ADD-YOUR-DISCOUNT-CODE]'}`,
      '',
      'Thank you for giving us the chance to make this right.',
      '',
      signOff,
    ].join('\n');

    return { order_status: orderStatus, apology_discount: apology, apology_discount_code: code };
  }

  async sendTicketReply(
    storeId: string,
    ticketId: string,
    replyText: string,
    markResolved: boolean = false
  ): Promise<SupportTicket> {
    const ticket = await this.repo.getTicketById(storeId, ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const newStatus = markResolved ? 'resolved' : 'replied';
    const updated = await this.repo.updateTicketReply(storeId, ticketId, replyText, newStatus);
    if (!updated) {
      throw new Error(`Failed to update ticket ${ticketId}`);
    }

    // Dispatch email to customer
    try {
      const ctx = await this.getStoreContext(storeId);
      const emailProvider = getEmailProvider();
      await emailProvider.sendEmail({
        to: ticket.customer_email,
        from: ctx.fromAddress,
        replyTo: ctx.supportContact || undefined,
        subject: `Update on your ${ctx.brandName} inquiry: ${ticket.subject}`,
        textBody: replyText,
        htmlBody: `
          <div style="font-family: sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h3 style="color: #4f46e5; margin-top: 0;">${escapeHtml(ctx.brandName)} Customer Support</h3>
            <p>${escapeHtml(replyText).replace(/\n/g, '<br>')}</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="font-size: 12px; color: #64748b;">
              Ticket #${shortTicketId(ticket)}<br>
              Reference: ${escapeHtml(ticket.subject)}
            </p>
          </div>
        `,
        storeId,
        campaignType: 'ticket_support_reply',
      });
      logger.info(`Support ticket email reply dispatched to ${ticket.customer_email} for ticket ${ticketId} (Reply-To: ${ctx.supportContact || 'none'})`);
    } catch (emailErr: any) {
      logger.warn(`Could not dispatch support email for ticket ${ticketId}: ${emailErr?.message || emailErr}`);
    }

    return updated;
  }

  async sendTicketReceiptEmail(storeId: string, ticket: SupportTicket): Promise<void> {
    try {
      const ctx = await this.getStoreContext(storeId);
      const shortId = shortTicketId(ticket);
      const customerGreeting = ticket.customer_name ? `Hi ${ticket.customer_name},` : 'Hello,';
      const brand = escapeHtml(ctx.brandName);
      const subject = escapeHtml(ticket.subject);

      const emailProvider = getEmailProvider();
      await emailProvider.sendEmail({
        to: ticket.customer_email,
        from: ctx.fromAddress,
        replyTo: ctx.supportContact || undefined,
        subject: `[Ticket #${shortId}] Support Request Received: ${ticket.subject}`,
        textBody: `${customerGreeting}\n\nWe've received your inquiry (Ticket #${shortId}) regarding "${ticket.subject}".\n\nOur team will review your conversation and revert to this email address (${ticket.customer_email}) ${ctx.revertDuration}.${renderTranscriptText(ticket)}\n\nTicket Reference: #${shortId}\nStatus: Open\n\nWarm regards,\n${ctx.brandName} Support Team`,
        htmlBody: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #f1f5f9; padding-bottom: 16px; margin-bottom: 20px;">
              <h2 style="color: #4f46e5; margin: 0; font-size: 20px; font-weight: 700;">${brand} Support</h2>
              <span style="background: #ecfdf5; color: #059669; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; border: 1px solid #a7f3d0;">Ticket #${shortId}</span>
            </div>
            <p style="font-size: 15px; margin-bottom: 14px;">${escapeHtml(customerGreeting)}</p>
            <p style="font-size: 14px; margin-bottom: 14px;">
              We've received your inquiry <strong>(Ticket #${shortId})</strong> regarding <strong>"${subject}"</strong>. Here is a copy of your conversation for your records.
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin: 18px 0;">
              <div style="font-size: 13px; color: #64748b; margin-bottom: 4px;">Expected Response Time</div>
              <div style="font-size: 16px; font-weight: 700; color: #0f172a;">⚡ ${escapeHtml(ctx.revertDuration)}</div>
              <p style="font-size: 12px; color: #64748b; margin: 6px 0 0 0;">
                Our team will review your conversation and revert to you at ${escapeHtml(ticket.customer_email)}.
              </p>
            </div>
            ${renderTranscriptHtml(ticket, ctx.brandName)}
            <p style="font-size: 13px; color: #475569;">
              If you have any further details or screenshots to add, simply reply directly to this email.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="font-size: 12px; color: #94a3b8; margin: 0;">
              Ticket #${shortId}<br>
              Inquiry: ${subject}
            </p>
          </div>
        `,
        storeId,
        campaignType: 'ticket_confirmation_receipt',
      });
      logger.info(`Support ticket confirmation email sent to ${ticket.customer_email} for ticket ${ticket.id} (Reply-To: ${ctx.supportContact || 'none'})`);
    } catch (err: any) {
      logger.warn(`Could not dispatch support confirmation receipt email for ticket ${ticket.id}: ${err?.message || err}`);
    }
  }

  /**
   * Alerts the merchant's support inbox (or the merchant account email) that a new ticket arrived.
   * Reply-To is the customer so the merchant can answer straight from their inbox.
   */
  async sendMerchantTicketAlert(storeId: string, ticket: SupportTicket): Promise<void> {
    try {
      const ctx = await this.getStoreContext(storeId);
      const recipient = ctx.supportContact || ctx.merchantEmail;
      if (!recipient) {
        logger.warn(`No merchant alert recipient configured for store ${storeId}; skipping new ticket alert for ${ticket.id}`);
        return;
      }

      const shortId = shortTicketId(ticket);
      const who = ticket.customer_name ? `${ticket.customer_name} (${ticket.customer_email})` : ticket.customer_email;
      const isUrgent = ticket.priority === 'urgent' || ticket.priority === 'high';
      const priorityLabel = (ticket.priority || 'medium').toUpperCase();
      const dueText = ticket.sla_due_at ? new Date(ticket.sla_due_at).toUTCString() : ctx.revertDuration;
      const baseUrl = (getEnvConfig().BASE_URL || '').replace(/\/$/, '');
      const dashboardUrl = baseUrl ? `${baseUrl}/dashboard/index.html#support-tickets` : '';

      const emailProvider = getEmailProvider();
      await emailProvider.sendEmail({
        to: recipient,
        from: ctx.fromAddress,
        replyTo: ticket.customer_email,
        subject: `${isUrgent ? '🔴 URGENT ' : '🚨 '}New Support Ticket #${shortId} from ${who} on ${ctx.brandName}`,
        textBody: `New Support Ticket #${shortId} received from ${who} on ${ctx.brandName}.\n\nSubject: ${ticket.subject}\nCategory: ${categoryLabel(ticket.category)}\nPriority: ${priorityLabel}\nCustomer mood: ${ticket.sentiment || 'neutral'}\nReply due by: ${dueText}${renderTranscriptText(ticket)}\n\n${dashboardUrl ? `Open the helpdesk: ${dashboardUrl}\n` : ''}Reply to this email to answer the customer directly.`,
        htmlBody: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid ${isUrgent ? '#fecaca' : '#e2e8f0'}; border-radius: 12px; background: #ffffff;">
            <h2 style="margin: 0 0 6px 0; font-size: 18px; color: ${isUrgent ? '#b91c1c' : '#0f172a'};">${isUrgent ? '🔴 Urgent' : '🚨 New'} support ticket #${shortId}</h2>
            <p style="margin: 0 0 16px 0; font-size: 14px;">From <strong>${escapeHtml(who)}</strong> on <strong>${escapeHtml(ctx.brandName)}</strong></p>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px;">
              <tr><td style="padding: 6px 0; color: #64748b; width: 130px;">Subject</td><td style="padding: 6px 0; font-weight: 600;">${escapeHtml(ticket.subject)}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Category</td><td style="padding: 6px 0;">${escapeHtml(categoryLabel(ticket.category))}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Priority</td><td style="padding: 6px 0; font-weight: 700; color: ${isUrgent ? '#b91c1c' : '#334155'};">${escapeHtml(priorityLabel)}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Customer mood</td><td style="padding: 6px 0;">${escapeHtml(ticket.sentiment || 'neutral')}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Reply due by</td><td style="padding: 6px 0;">${escapeHtml(dueText)}</td></tr>
            </table>
            ${renderTranscriptHtml(ticket, ctx.brandName)}
            ${dashboardUrl ? `<p style="margin: 20px 0 8px 0;"><a href="${escapeHtml(dashboardUrl)}" style="background: #4f46e5; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;">Open helpdesk</a></p>` : ''}
            <p style="font-size: 12px; color: #94a3b8; margin: 12px 0 0 0;">Reply to this email to answer the customer directly.</p>
          </div>
        `,
        storeId,
        campaignType: 'ticket_merchant_alert',
      });
      logger.info(`Merchant new-ticket alert sent to ${recipient} for ticket ${ticket.id}`);
    } catch (err: any) {
      logger.warn(`Could not dispatch merchant alert for ticket ${ticket.id}: ${err?.message || err}`);
    }
  }
}
