import { IEmailProvider } from './email.provider';
import { FakeEmailProvider } from './fake.email.provider';
import { ResendEmailProvider } from './resend.email.provider';
import { getEnvConfig } from '../../config/env';

export * from './email.provider';
export * from './fake.email.provider';
export * from './resend.email.provider';

// Expose a singleton FakeEmailProvider so tests can inspect sent emails
const fakeEmailProvider = new FakeEmailProvider();
let resendEmailProvider: ResendEmailProvider | null = null;

export function getEmailProvider(): IEmailProvider {
  const env = getEnvConfig();

  if (env.EMAIL_PROVIDER_MODE === 'resend') {
    if (!resendEmailProvider) {
      resendEmailProvider = new ResendEmailProvider();
    }
    return resendEmailProvider;
  }

  if (env.EMAIL_PROVIDER_MODE === 'postmark') {
    throw new Error('Postmark Email Provider not configured. Use resend or fake.');
  }

  return fakeEmailProvider;
}

export function getTestEmailProvider(): FakeEmailProvider {
  return fakeEmailProvider;
}

export function resetEmailProviders(): void {
  fakeEmailProvider.clearInbox();
  resendEmailProvider = null;
}
