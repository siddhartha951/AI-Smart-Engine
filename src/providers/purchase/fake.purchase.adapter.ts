import { IPurchaseAdapter } from './purchase.adapter';

export class FakePurchaseAdapter implements IPurchaseAdapter {
  private purchasedEmails = new Set<string>();

  async hasPurchasedSince(storeId: string, email: string, since: Date): Promise<boolean> {
    // In our fake implementation, if the email is in the set, we pretend they bought something.
    return this.purchasedEmails.has(`${storeId}:${email.toLowerCase()}`);
  }

  // Helper for tests to simulate a purchase
  simulatePurchase(storeId: string, email: string) {
    this.purchasedEmails.add(`${storeId}:${email.toLowerCase()}`);
  }

  // Helper for tests to reset state
  reset() {
    this.purchasedEmails.clear();
  }
}
