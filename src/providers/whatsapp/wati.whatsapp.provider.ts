import crypto from 'crypto';
import {
  IWhatsAppProvider,
  WhatsAppSendParams,
  WhatsAppSendResult,
  WhatsAppWebhookEvent,
} from './whatsapp.provider';

export class WatiWhatsAppProvider implements IWhatsAppProvider {
  private timeoutMs: number;

  constructor(opts?: { timeoutMs?: number }) {
    this.timeoutMs = opts?.timeoutMs || 10000;
  }

  /**
   * Normalizes and cleans phone numbers into digits-only format expected by WATI.
   */
  private cleanPhoneNumber(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  /**
   * Cleans and formats base API endpoint URL without trailing slash.
   */
  private cleanEndpoint(endpoint?: string): string {
    if (!endpoint) return '';
    return endpoint.trim().replace(/\/+$/, '');
  }

  /**
   * Dispatches outbound WhatsApp message (Session text or Template) via WATI API.
   */
  async sendMessage(params: WhatsAppSendParams): Promise<WhatsAppSendResult> {
    const apiEndpoint = this.cleanEndpoint(params.apiEndpoint);
    const cleanToken = (params.accessToken || '').trim().replace(/^(?:Bearer\s+)+/i, '');

    if (!apiEndpoint || !cleanToken) {
      return {
        success: false,
        error: 'Missing WATI API Endpoint URL or Access Token.',
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

    const cleanTo = this.cleanPhoneNumber(params.to);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      let url: string;
      let bodyData: any;

      if (params.message.type === 'text') {
        // WATI Session Message API endpoint: /api/v1/sendSessionMessage/{whatsappNumber}
        const textBody = params.message.text.body;
        url = `${apiEndpoint}/api/v1/sendSessionMessage/${cleanTo}?messageText=${encodeURIComponent(textBody)}`;
        bodyData = params.channelPhoneNumber ? { channelPhoneNumber: this.cleanPhoneNumber(params.channelPhoneNumber) } : {};
      } else if (params.message.type === 'template') {
        // WATI Template Message API endpoint: /api/v1/sendTemplateMessage?whatsappNumber={whatsappNumber}
        url = `${apiEndpoint}/api/v1/sendTemplateMessage?whatsappNumber=${cleanTo}`;
        const templateParams = (params.message.template.components || []).flatMap(c => 
          (c.parameters || []).map((p, idx) => ({
            name: `param_${idx + 1}`,
            value: p.text || (p.currency ? p.currency.fallback_value : ''),
          }))
        );

        bodyData = {
          template_name: params.message.template.name,
          broadcast_name: 'ai_smart_engine_notification',
          parameters: templateParams,
        };
      } else {
        clearTimeout(timeoutId);
        return {
          success: false,
          error: 'Unsupported message payload type for WATI provider.',
          statusCode: 400,
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const resText = await response.text();
      let resJson: any = null;
      try {
        resJson = JSON.parse(resText);
      } catch {
        resJson = null;
      }

      if (!response.ok) {
        const errorMsg = resJson?.info || resJson?.message || resJson?.error || response.statusText || 'WATI API error';
        return {
          success: false,
          error: `WATI API error (${response.status}): ${errorMsg}`,
          statusCode: response.status,
        };
      }

      const messageId = resJson?.whatsappMessageId || resJson?.id || resJson?.localMessageId || `wati_${Date.now()}`;
      return {
        success: true,
        messageId,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return {
          success: false,
          error: `WATI API request timed out after ${this.timeoutMs}ms.`,
          statusCode: 504,
        };
      }
      return {
        success: false,
        error: `WATI network error: ${err.message}`,
        statusCode: 500,
      };
    }
  }

  /**
   * Webhook verification token check.
   */
  verifyWebhookChallenge(
    mode: string,
    token: string,
    challenge: string,
    expectedToken: string
  ): string | null {
    if (token && token === expectedToken) {
      return challenge || 'OK';
    }
    return null;
  }

  /**
   * Validates WATI webhook token or custom secret header using timing-safe comparison.
   */
  validateSignature(
    _rawBody: Buffer | string,
    signatureHeader: string,
    appSecret: string
  ): boolean {
    if (!signatureHeader || !appSecret) return false;
    try {
      const a = Buffer.from(signatureHeader);
      const b = Buffer.from(appSecret);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Normalizes WATI webhook payload into standard WhatsAppWebhookEvent format.
   */
  parseWebhook(body: any): WhatsAppWebhookEvent[] {
    const events: WhatsAppWebhookEvent[] = [];
    if (!body || typeof body !== 'object') return events;

    const eventType = body.eventType || body.type;

    // 1. Inbound Customer Message
    if (eventType === 'message' || eventType === 'messageReceived' || (body.text && body.waId)) {
      const rawWaId = String(body.waId || body.sender || '');
      const cleanFrom = rawWaId.startsWith('+') ? rawWaId : (rawWaId ? `+${rawWaId}` : '');
      const messageId = body.whatsappMessageId || body.id || `wati_${Date.now()}`;
      const timestamp = parseInt(body.timestamp || String(Math.floor(Date.now() / 1000)), 10);

      events.push({
        displayPhoneNumber: body.channelPhoneNumber,
        customerName: body.senderName || 'Customer',
        message: {
          from: cleanFrom,
          messageId,
          timestamp,
          type: body.type || 'text',
          text: body.text,
        },
        rawPayload: body,
      });
      return events;
    }

    // 2. Outbound Delivery / Read Status Updates
    if (
      eventType === 'sentMessageDELIVERED_v2' || 
      eventType === 'sentMessageREAD_v2' || 
      eventType === 'sessionMessageSent_v2' ||
      body.statusString
    ) {
      let normalizedStatus: 'sent' | 'delivered' | 'read' | 'failed' = 'delivered';
      const st = String(body.statusString || eventType || '').toLowerCase();

      if (st.includes('read')) {
        normalizedStatus = 'read';
      } else if (st.includes('deliver')) {
        normalizedStatus = 'delivered';
      } else if (st.includes('sent')) {
        normalizedStatus = 'sent';
      } else if (st.includes('fail') || st.includes('error')) {
        normalizedStatus = 'failed';
      }

      const messageId = body.whatsappMessageId || body.id || body.localMessageId;
      if (messageId) {
        events.push({
          displayPhoneNumber: body.channelPhoneNumber,
          status: {
            messageId,
            recipientId: String(body.waId || body.sender || ''),
            status: normalizedStatus,
            timestamp: parseInt(body.timestamp || String(Math.floor(Date.now() / 1000)), 10),
          },
          rawPayload: body,
        });
      }
      return events;
    }

    return events;
  }
}
