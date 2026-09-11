import { IWhatsAppProvider } from './whatsapp.provider';
import { MockWhatsAppProvider } from './mock.whatsapp.provider';
import { MetaWhatsAppCloudProvider } from './meta.whatsapp.provider';

export * from './whatsapp.provider';
export * from './mock.whatsapp.provider';
export * from './meta.whatsapp.provider';

let activeProvider: IWhatsAppProvider | null = null;

/**
 * Returns the configured WhatsApp provider instance (Mock by default in test/dev, Meta in production).
 */
export function getWhatsAppProvider(): IWhatsAppProvider {
  if (activeProvider) {
    return activeProvider;
  }

  const mode = process.env.WHATSAPP_PROVIDER_MODE || (process.env.NODE_ENV === 'test' ? 'mock' : 'meta');
  if (mode === 'meta') {
    activeProvider = new MetaWhatsAppCloudProvider();
  } else {
    activeProvider = new MockWhatsAppProvider();
  }

  return activeProvider;
}

/**
 * Overrides the active WhatsApp provider instance (primarily for tests).
 */
export function setWhatsAppProvider(provider: IWhatsAppProvider | null) {
  activeProvider = provider;
}
