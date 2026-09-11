import { IWhatsAppProvider } from './whatsapp.provider';
import { MockWhatsAppProvider } from './mock.whatsapp.provider';
import { MetaWhatsAppCloudProvider } from './meta.whatsapp.provider';
import { WatiWhatsAppProvider } from './wati.whatsapp.provider';

export * from './whatsapp.provider';
export * from './mock.whatsapp.provider';
export * from './meta.whatsapp.provider';
export * from './wati.whatsapp.provider';

export type WhatsAppProviderType = 'meta' | 'wati' | 'mock';

let globalOverrideProvider: IWhatsAppProvider | null = null;
const typedOverrides: Partial<Record<WhatsAppProviderType, IWhatsAppProvider>> = {};

/**
 * Returns a WhatsApp provider instance for the specified type ('meta', 'wati', 'mock').
 * If global or typed override is configured (in tests), returns the override.
 */
export function getWhatsAppProvider(type?: WhatsAppProviderType): IWhatsAppProvider {
  // 1. If explicit typed override exists, return it
  if (type && typedOverrides[type]) {
    return typedOverrides[type]!;
  }

  // 2. If global test override exists, return it
  if (globalOverrideProvider) {
    return globalOverrideProvider;
  }

  // 3. Resolve by type
  if (type === 'wati') {
    return new WatiWhatsAppProvider();
  }
  if (type === 'meta') {
    return new MetaWhatsAppCloudProvider();
  }
  if (type === 'mock') {
    return new MockWhatsAppProvider();
  }

  // 4. Default based on environment
  const mode = (process.env.WHATSAPP_PROVIDER_MODE || (process.env.NODE_ENV === 'test' ? 'mock' : 'meta')) as WhatsAppProviderType;
  if (mode === 'wati') {
    return new WatiWhatsAppProvider();
  }
  if (mode === 'meta') {
    return new MetaWhatsAppCloudProvider();
  }
  return new MockWhatsAppProvider();
}

/**
 * Overrides the active WhatsApp provider instance (primarily for testing).
 */
export function setWhatsAppProvider(provider: IWhatsAppProvider | null) {
  globalOverrideProvider = provider;
}

/**
 * Overrides a specific WhatsApp provider type (meta, wati, mock) for granular testing.
 */
export function setWhatsAppProviderForType(type: WhatsAppProviderType, provider: IWhatsAppProvider | null) {
  if (provider) {
    typedOverrides[type] = provider;
  } else {
    delete typedOverrides[type];
  }
}
