export interface IPurchaseAdapter {
  /**
   * Checks if a specific visitor (by email or customer ID) has made a purchase 
   * since a given date.
   */
  hasPurchasedSince(storeId: string, email: string, since: Date): Promise<boolean>;
}
