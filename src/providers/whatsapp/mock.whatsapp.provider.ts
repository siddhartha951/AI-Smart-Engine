import crypto from 'crypto';
import {
  IWhatsAppProvider,
  WhatsAppSendParams,
  WhatsAppSendResult,
  WhatsAppWebhookEvent,
} from './whatsapp.provider';

export class MockWhatsAppProvider implements IWhatsAppProvider {
  public sentMessages: Array<WhatsAppSendParams & { id: string; sentAt: Date; text?: string }> = [];
  private failNextSend: string | null = null;

  /**
   * For testing: force the next sendMessage call to reject with an error.
   */
  setFailNextSend(errorMessage: string | null) {
    this.failNextSend = errorMessage;
  }

  /**
   * For testing: retrieve all messages sent through this mock.
   */
  getSentMessages() {
    return [...this.sentMessages];
  }

  /**
   * For testing: clear history of sent messages.
   */
  clear() {
    this.sentMessages = [];
    this.failNextSend = null;
  }

  async sendMessage(params: WhatsAppSendParams): Promise<WhatsAppSendResult> {
    if (this.failNextSend) {
      const err = this.failNextSend;
      this.failNextSend = null;
      return {
        success: false,
        error: err,
        statusCode: 500,
      };
    }

    if (!params.phoneNumberId || !params.accessToken) {
      return {
        success: false,
        error: 'Missing phone number ID or access token.',
        statusCode: 401,
      };
    }

    if (!params.to) {
      return {
        success: false,
        error: 'Recipient phone number is required.',
        statusCode: 400,
      };
    }

    const messageId = `wamid.HBg${crypto.randomBytes(12).toString('hex')}`;
    let textBody: string | undefined;
    if (params.message.type === 'text') {
      textBody = params.message.text.body;
    } else if (params.message.type === 'template') {
      const texts: string[] = [];
      for (const comp of params.message.template.components || []) {
        for (const p of comp.parameters || []) {
          if (p.text) texts.push(p.text);
          if (p.currency) texts.push(p.currency.fallback_value);
        }
      }
      textBody = `Template: ${params.message.template.name} [${texts.join(', ')}]`;
    }

    this.sentMessages.push({
      ...params,
      id: messageId,
      sentAt: new Date(),
      text: textBody,
    });

    return {
      success: true,
      messageId,
    };
  }

  verifyWebhookChallenge(
    mode: string,
    token: string,
    challenge: string,
    expectedToken: string
  ): string | null {
    if (mode === 'subscribe' && token === expectedToken) {
      return challenge;
    }
    return null;
  }

  validateSignature(
    rawBody: Buffer | string,
    signatureHeader: string,
    appSecret: string
  ): boolean {
    if (!signatureHeader || !appSecret) return false;
    const cleanHeader = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice(7)
      : signatureHeader;

    const hmac = crypto.createHmac('sha256', appSecret);
    hmac.update(rawBody);
    const expected = hmac.digest('hex');
    return crypto.timingSafeEqual(Buffer.from(cleanHeader, 'hex'), Buffer.from(expected, 'hex'));
  }

  parseWebhook(body: any): WhatsAppWebhookEvent[] {
    const events: WhatsAppWebhookEvent[] = [];
    if (!body || !Array.isArray(body.entry)) return events;

    for (const entry of body.entry) {
      const wabaId = entry.id;
      if (!Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const val = change.value || {};
        const metadata = val.metadata || {};
        const phoneNumberId = metadata.phone_number_id;
        const displayPhoneNumber = metadata.display_phone_number;

        // 1. Process contacts
        const contactMap: Record<string, string> = {};
        if (Array.isArray(val.contacts)) {
          for (const c of val.contacts) {
            contactMap[c.wa_id] = c.profile?.name || 'Customer';
          }
        }

        // 2. Process incoming messages
        if (Array.isArray(val.messages)) {
          for (const msg of val.messages) {
            const from = msg.from;
            const customerName = contactMap[from] || 'Customer';
            const messageId = msg.id;
            const timestamp = parseInt(msg.timestamp || '0', 10);
            const msgType = msg.type;

            let text: string | undefined;
            let buttonPayload: string | undefined;

            if (msgType === 'text') {
              text = msg.text?.body;
            } else if (msgType === 'button') {
              text = msg.button?.text;
              buttonPayload = msg.button?.payload;
            } else if (msgType === 'interactive') {
              if (msg.interactive?.type === 'button_reply') {
                text = msg.interactive.button_reply?.title;
                buttonPayload = msg.interactive.button_reply?.id;
              } else if (msg.interactive?.type === 'list_reply') {
                text = msg.interactive.list_reply?.title;
                buttonPayload = msg.interactive.list_reply?.id;
              }
            }

            events.push({
              wabaId,
              phoneNumberId,
              displayPhoneNumber,
              customerName,
              message: {
                from,
                messageId,
                timestamp,
                type: msgType,
                text,
                buttonPayload,
              },
              rawPayload: msg,
            });
          }
        }

        // 3. Process delivery / read statuses
        if (Array.isArray(val.statuses)) {
          for (const st of val.statuses) {
            events.push({
              wabaId,
              phoneNumberId,
              displayPhoneNumber,
              status: {
                messageId: st.id,
                recipientId: st.recipient_id,
                status: st.status,
                timestamp: parseInt(st.timestamp || '0', 10),
                error: st.errors && st.errors[0] ? {
                  code: st.errors[0].code,
                  title: st.errors[0].title,
                  message: st.errors[0].message,
                } : undefined,
              },
              rawPayload: st,
            });
          }
        }
      }
    }

    return events;
  }
}
