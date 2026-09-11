export interface WhatsAppTextMessage {
  type: 'text';
  text: { body: string };
}

export interface WhatsAppTemplateComponentParameter {
  type: 'text' | 'currency' | 'date_time' | 'image';
  text?: string;
  currency?: { fallback_value: string; code: string; amount_1000: number };
  image?: { link: string };
}

export interface WhatsAppTemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'url' | 'quick_reply';
  index?: number;
  parameters: WhatsAppTemplateComponentParameter[];
}

export interface WhatsAppTemplateMessage {
  type: 'template';
  template: {
    name: string;
    language: { code: string };
    components?: WhatsAppTemplateComponent[];
  };
}

export type WhatsAppOutgoingPayload = WhatsAppTextMessage | WhatsAppTemplateMessage;

export interface WhatsAppSendParams {
  phoneNumberId?: string; // Meta WhatsApp Phone Number ID
  apiEndpoint?: string;   // WATI API Endpoint / Server URL
  accessToken: string;    // Meta system user token or WATI Bearer token
  to: string;             // Recipient phone number (E.164 format)
  message: WhatsAppOutgoingPayload;
  channelPhoneNumber?: string; // Optional channel phone number
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string; // wamid
  error?: string;
  statusCode?: number;
}

export interface WhatsAppParsedMessage {
  from: string; // sender phone
  messageId: string; // wamid
  timestamp: number;
  type: 'text' | 'interactive' | 'button' | 'unknown';
  text?: string;
  buttonPayload?: string;
}

export interface WhatsAppParsedStatus {
  messageId: string; // wamid
  recipientId?: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: number;
  error?: {
    code: number;
    title: string;
    message?: string;
  };
}

export interface WhatsAppWebhookEvent {
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  customerName?: string;
  message?: WhatsAppParsedMessage;
  status?: WhatsAppParsedStatus;
  rawPayload: any;
}

export interface IWhatsAppProvider {
  /**
   * Sends an outgoing WhatsApp message (text or template) via Meta Cloud API.
   */
  sendMessage(params: WhatsAppSendParams): Promise<WhatsAppSendResult>;

  /**
   * Verifies the webhook challenge from Meta during webhook configuration.
   */
  verifyWebhookChallenge(
    mode: string,
    token: string,
    challenge: string,
    expectedToken: string
  ): string | null;

  /**
   * Validates the SHA256 HMAC signature of incoming webhooks.
   */
  validateSignature(
    rawBody: Buffer | string,
    signatureHeader: string,
    appSecret: string
  ): boolean;

  /**
   * Parses standard Meta WhatsApp Cloud API webhook JSON body into typed events.
   */
  parseWebhook(body: any): WhatsAppWebhookEvent[];
}
