import { SupportTicketRepository, SupportTicket } from './support-ticket.repository';
import { getDatabaseClient } from '../../database/client';
import { getAiProvider } from '../../providers/ai';
import { getEmailProvider } from '../../providers/email';
import { logger } from '../../utils/logger';

export class SupportTicketService {
  private repo: SupportTicketRepository;

  constructor(repo?: SupportTicketRepository) {
    this.repo = repo || new SupportTicketRepository();
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
      const db = getDatabaseClient();
      const storeRes = await db.query(`SELECT brand_name FROM stores WHERE id = $1`, [storeId]);
      const brandName = storeRes.rows[0]?.brand_name || 'Store Support';

      const emailProvider = getEmailProvider();
      await emailProvider.sendEmail({
        to: ticket.customer_email,
        subject: `Update on your ${brandName} inquiry: ${ticket.subject}`,
        textBody: replyText,
        htmlBody: `
          <div style="font-family: sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h3 style="color: #4f46e5; margin-top: 0;">${brandName} Customer Support</h3>
            <p>${replyText.replace(/\n/g, '<br>')}</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="font-size: 12px; color: #64748b;">
              Ticket ID: ${ticket.id}<br>
              Reference: ${ticket.subject}
            </p>
          </div>
        `,
        storeId,
        campaignType: 'ticket_support_reply',
      });
      logger.info(`Support ticket email reply dispatched to ${ticket.customer_email} for ticket ${ticketId}`);
    } catch (emailErr: any) {
      logger.warn(`Could not dispatch support email for ticket ${ticketId}: ${emailErr?.message || emailErr}`);
    }

    return updated;
  }
}
