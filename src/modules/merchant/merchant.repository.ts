import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import {
  Merchant,
  Store,
  StoreCredentials,
  WidgetSettings,
  AssistantSettings,
  StorePolicy,
} from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

export class MerchantRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  async createMerchant(name: string, contactEmail: string): Promise<Merchant> {
    const res = await this.db.query<Merchant>(
      `INSERT INTO merchants (name, contact_email)
       VALUES ($1, $2)
       RETURNING *`,
      [name, contactEmail]
    );
    return res.rows[0];
  }

  async createStore(
    merchantId: string,
    shopDomain: string,
    brandName: string
  ): Promise<Store> {
    const res = await this.db.query<Store>(
      `INSERT INTO stores (merchant_id, shop_domain, brand_name, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING *`,
      [merchantId, shopDomain, brandName]
    );
    return res.rows[0];
  }

  async getStoreById(storeId: string): Promise<Store | null> {
    const res = await this.db.query<Store>(
      `SELECT * FROM stores WHERE id = $1`,
      [storeId]
    );
    return res.rows[0] || null;
  }

  async getStoreByDomain(shopDomain: string): Promise<Store | null> {
    const res = await this.db.query<Store>(
      `SELECT * FROM stores WHERE shop_domain = $1`,
      [shopDomain]
    );
    return res.rows[0] || null;
  }

  async getStoreByWidgetKey(widgetKey: string): Promise<Store | null> {
    const res = await this.db.query<Store>(
      `SELECT * FROM stores WHERE widget_key = $1`,
      [widgetKey]
    );
    return res.rows[0] || null;
  }

  // --- Scoped by store_id ---

  async getStoreCredentials(storeId: string): Promise<StoreCredentials | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<StoreCredentials>(
      `SELECT * FROM store_credentials WHERE store_id = $1`,
      [storeId]
    );
    return res.rows[0] || null;
  }

  async saveStoreCredentials(
    storeId: string,
    encryptedAdminToken: string | null,
    encryptedStorefrontToken: string | null,
    encryptionIv: string | null
  ): Promise<StoreCredentials> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<StoreCredentials>(
      `INSERT INTO store_credentials (store_id, encrypted_admin_token, encrypted_storefront_token, encryption_iv, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (store_id) DO UPDATE SET
         encrypted_admin_token = EXCLUDED.encrypted_admin_token,
         encrypted_storefront_token = EXCLUDED.encrypted_storefront_token,
         encryption_iv = EXCLUDED.encryption_iv,
         updated_at = NOW()
       RETURNING *`,
      [storeId, encryptedAdminToken, encryptedStorefrontToken, encryptionIv]
    );
    return res.rows[0];
  }

  async getWidgetSettings(storeId: string): Promise<WidgetSettings | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<WidgetSettings>(
      `SELECT * FROM widget_settings WHERE store_id = $1`,
      [storeId]
    );
    return res.rows[0] || null;
  }

  async upsertWidgetSettings(
    storeId: string,
    settings: {
      button_text?: string;
      position?: 'bottom-right' | 'bottom-left';
      primary_colour?: string;
      secondary_colour?: string;
      greeting?: string;
      avatar_url?: string;
      header_title?: string;
      custom_css?: string;
    }
  ): Promise<WidgetSettings> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<WidgetSettings>(
      `INSERT INTO widget_settings (store_id, button_text, position, primary_colour, secondary_colour, greeting, avatar_url, header_title, custom_css, updated_at)
       VALUES ($1, COALESCE($2, 'Ask our shopping assistant'), COALESCE($3, 'bottom-right'), COALESCE($4, '#1a1a1a'), COALESCE($5, '#ffffff'), COALESCE($6, 'Hi there! Looking for recommendations today?'), $7, $8, $9, NOW())
       ON CONFLICT (store_id) DO UPDATE SET
         button_text = COALESCE($2, widget_settings.button_text),
         position = COALESCE($3, widget_settings.position),
         primary_colour = COALESCE($4, widget_settings.primary_colour),
         secondary_colour = COALESCE($5, widget_settings.secondary_colour),
         greeting = COALESCE($6, widget_settings.greeting),
         avatar_url = COALESCE($7, widget_settings.avatar_url),
         header_title = COALESCE($8, widget_settings.header_title),
         custom_css = COALESCE($9, widget_settings.custom_css),
         updated_at = NOW()
       RETURNING *`,
      [
        storeId,
        settings.button_text,
        settings.position,
        settings.primary_colour,
        settings.secondary_colour,
        settings.greeting,
        settings.avatar_url || null,
        settings.header_title || null,
        settings.custom_css || null,
      ]
    );
    return res.rows[0];
  }

  async getAssistantSettings(storeId: string): Promise<AssistantSettings | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<AssistantSettings>(
      `SELECT * FROM assistant_settings WHERE store_id = $1`,
      [storeId]
    );
    return res.rows[0] || null;
  }

  async getStorePolicies(storeId: string): Promise<StorePolicy | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<StorePolicy>(
      `SELECT * FROM store_policies WHERE store_id = $1`,
      [storeId]
    );
    return res.rows[0] || null;
  }
}
