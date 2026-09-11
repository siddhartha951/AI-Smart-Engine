import crypto from 'crypto';
import {
  IWhatsAppProvider,
  WhatsAppSendParams,
  WhatsAppSendResult,
  WhatsAppWebhookEvent,
} from './whatsapp.provider';

export class MetaWhatsAppCloudProvider implements IWhatsAppProvider {
  private apiVersion: string;

  constructor(apiVersion = 'v20.0') {
    this.apiVersion = apiVersion;
  }

  async sendMessage(params: WhatsAppSendParams): Promise<WhatsAppSendResult> {
    const { phoneNumberId, accessToken, to, message } = params;

    if (!phoneNumberId || !accessToken) {
      return {
        success: false,
        error: 'Missing WhatsApp phone number ID or access token.',
        statusCode: 401,
      };
    }

    if (!to) {
      return {
        success: false,
        error: 'Recipient phone number is required.',
        statusCode: 400,
      };
    }

    // Clean phone number: remove '+' and whitespace
    const cleanTo = to.replace(/\D/g, '');

    const url = `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/messages`;

    const body: Record<string, any> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: message.type,
    };

    if (message.type === 'text') {
      body.text = message.text;
    } else if (message.type === 'template') {
      body.template = message.template;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = data?.error?.message || `Meta API request failed with status ${response.status}`;
        return {
          success: false,
          error: errorMsg,
          statusCode: response.status,
        };
      }

      const messageId = data?.messages?.[0]?.id;
      return {
        success: true,
        messageId,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error communicating with Meta WhatsApp Cloud API',
        statusCode: 500,
      };
    }
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

    try {
      const hmac = crypto.createHmac('sha256', appSecret);
      hmac.update(rawBody);
      const expected = hmac.digest('hex');
      return crypto.timingSafeEqual(Buffer.from(cleanHeader, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
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

        // Process contacts
        const contactMap: Record<string, string> = {};
        if (Array.isArray(val.contacts)) {
          for (const c of val.contacts) {
            contactMap[c.wa_id] = c.profile?.name || 'Customer';
          }
        }

        // Process incoming messages
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

        // Process delivery / read statuses
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
