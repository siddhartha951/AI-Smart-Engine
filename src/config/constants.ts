export const APP_CONSTANTS = {
  BUDGET: {
    MONTHLY_WARN_USD: 10.0,
    MONTHLY_STOP_USD: 14.0,
  },
  EMAIL: {
    MAX_RECOVERY_EMAILS_PER_JOURNEY: 3,
    DEFAULT_INTERVALS_HOURS: {
      STAGE_1_SUMMARY: 0, // Day 0 immediate
      STAGE_2_REMINDER: 72, // Day 3
      STAGE_3_FINAL: 168, // Day 7
    },
  },
  WIDGET: {
    DEFAULT_BUTTON_TEXT: 'Ask our shopping assistant',
    DEFAULT_POSITION: 'bottom-right' as const,
    DEFAULT_PRIMARY_COLOR: '#1a1a1a',
    DEFAULT_SECONDARY_COLOR: '#ffffff',
    DEFAULT_GREETING: 'Hi there! Looking for recommendations today?',
  },
  CONSENT: {
    DEFAULT_VERSION: '1.0',
    DEFAULT_WORDING:
      'I agree to receive helpful shopping recommendations and follow-up emails from this store. I can unsubscribe anytime.',
    DEFAULT_SOURCE: 'widget_chat_v1',
  },
  EVENTS: {
    WIDGET_OPENED: 'widget_opened',
    EMAIL_SUBMITTED: 'email_submitted',
    MARKETING_OPTED_IN: 'marketing_opted_in',
    CHAT_MESSAGE: 'chat_message',
    PRODUCT_RECOMMENDED: 'product_recommended',
    PRODUCT_CLICKED: 'product_clicked',
    ADD_TO_CART: 'add_to_cart',
    CHECKOUT_STARTED: 'checkout_started',
    PURCHASE_COMPLETED: 'purchase_completed',
    EMAIL_SENT: 'email_sent',
    EMAIL_UNSUBSCRIBED: 'email_unsubscribed',
  },
} as const;
