import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { getDatabaseClient } from '../../database/client';
import { encryptString } from '../../utils/crypto';
import { ValidationError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { getShopifyAdapter } from '../../providers/shopify';
import { getEmailProvider } from '../../providers/email';
import { SenderDomainRepository } from '../../modules/email/sender-domain.repository';

const router = Router();

// ===== Middleware: Require valid onboarding token =====
const requireOnboardingToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header (onboarding token)' });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token)) {
      res.status(401).json({ error: 'Invalid onboarding token' });
      return;
    }

    const db = getDatabaseClient();
    
    // Check merchant by token
    const result = await db.query(
      `SELECT id, name, contact_email, status, onboarding_expires_at 
       FROM merchants 
       WHERE onboarding_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid onboarding token' });
      return;
    }

    const merchant = result.rows[0];
    if (new Date() > new Date(merchant.onboarding_expires_at)) {
      res.status(401).json({ error: 'Onboarding token expired' });
      return;
    }
    
    if (merchant.status === 'active') {
      res.status(400).json({ error: 'Merchant is already fully onboarded' });
      return;
    }

    // Any store referenced by the request must belong to this merchant. store_id is
    // public (widget config), so without this an invited merchant could overwrite a
    // live store's Shopify credentials, AI settings or sender domains.
    const referencedStoreId = req.params.storeId || (req.body && typeof req.body === 'object' ? req.body.store_id : undefined);
    if (referencedStoreId !== undefined && referencedStoreId !== null && referencedStoreId !== '') {
      const owned = typeof referencedStoreId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(referencedStoreId)
        ? await db.query('SELECT id FROM stores WHERE id = $1 AND merchant_id = $2', [referencedStoreId, merchant.id])
        : { rows: [] };
      if (owned.rows.length === 0) {
        res.status(403).json({ error: 'This store does not belong to your onboarding session' });
        return;
      }
    }

    (req as any).merchant = merchant;
    (req as any).onboardingToken = token;
    next();
  } catch (err) {
    next(err);
  }
};

// =========================================================
// GET /verify
// =========================================================
router.get('/verify', requireOnboardingToken, (req: Request, res: Response) => {
  res.json({ success: true, data: (req as any).merchant });
});

// =========================================================
// POST /step1-business
// =========================================================
const Step1Schema = z.object({
  merchant_name: z.string().min(2),
  brand_name: z.string().min(2),
  contact_email: z.string().email(),
  shop_domain: z.string().min(5),
  currency: z.string().length(3),
  timezone: z.string().min(2),
  support_email: z.string().email().optional(),
  password: z.string().min(8)
});

router.post('/step1-business', requireOnboardingToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = Step1Schema.parse(req.body);
    const db = getDatabaseClient();
    const merchantId = (req as any).merchant.id;

    await db.query('BEGIN');

    // Update merchant
    await db.query(
      `UPDATE merchants SET name = $1, contact_email = $2, status = 'onboarding', updated_at = NOW() WHERE id = $3`,
      [input.merchant_name, input.contact_email, merchantId]
    );

    // Create or update store
    let storeId: string;
    const storeRes = await db.query('SELECT id FROM stores WHERE merchant_id = $1', [merchantId]);
    if (storeRes.rows.length > 0) {
      storeId = storeRes.rows[0].id;
      await db.query(
        `UPDATE stores SET shop_domain = $1, brand_name = $2, currency = $3, timezone = $4, updated_at = NOW() WHERE id = $5`,
        [input.shop_domain, input.brand_name, input.currency, input.timezone, storeId]
      );
    } else {
      const newStoreRes = await db.query(
        `INSERT INTO stores (merchant_id, shop_domain, brand_name, currency, timezone, status) 
         VALUES ($1, $2, $3, $4, $5, 'paused') RETURNING id`,
        [merchantId, input.shop_domain, input.brand_name, input.currency, input.timezone]
      );
      storeId = newStoreRes.rows[0].id;
    }

    // Create user with password so they can log in later
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [input.contact_email]);
    if (existingUser.rows.length === 0) {
      const passwordHash = await bcrypt.hash(input.password, 10);
      await db.query(
        `INSERT INTO users (email, password_hash, role, merchant_id, store_id) VALUES ($1, $2, 'merchant_owner', $3, $4)`,
        [input.contact_email, passwordHash, merchantId, storeId]
      );
    }

    // Create initial widget settings so widget_key is created
    await db.query(`
      INSERT INTO widget_settings (store_id, button_text, position, primary_colour, secondary_colour, greeting) 
      VALUES ($1, 'Chat', 'bottom-right', '#000000', '#ffffff', 'Hello!') ON CONFLICT DO NOTHING
    `, [storeId]);

    await db.query('COMMIT');

    res.json({ success: true, store_id: storeId });
  } catch (err) {
    const db = getDatabaseClient();
    await db.query('ROLLBACK');
    next(err);
  }
});

// =========================================================
// POST /step2-shopify
// =========================================================
const Step2Schema = z.object({
  store_id: z.string().uuid(),
  admin_token: z.string().min(10),
  storefront_token: z.string().min(10)
});

router.post('/step2-shopify', requireOnboardingToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = Step2Schema.parse(req.body);
    const db = getDatabaseClient();

    const encAdmin = encryptString(input.admin_token);
    const encStorefront = encryptString(input.storefront_token);

    // Store credentials securely
    await db.query(`
      INSERT INTO store_credentials (store_id, encrypted_admin_token, encrypted_storefront_token, encryption_iv) 
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (store_id) DO UPDATE SET 
        encrypted_admin_token = EXCLUDED.encrypted_admin_token,
        encrypted_storefront_token = EXCLUDED.encrypted_storefront_token,
        encryption_iv = EXCLUDED.encryption_iv,
        updated_at = NOW()
    `, [input.store_id, encAdmin.encryptedString, encStorefront.encryptedString, encAdmin.iv]);

    // Validate connection
    const adapter = getShopifyAdapter();
    if (adapter.validateConnection) {
      const isValid = await adapter.validateConnection(input.store_id);
      if (!isValid) {
        res.status(400).json({ error: 'Shopify credentials invalid or lacking required scopes.' });
        return;
      }
    }

    // Auto-run the connection health check so the dashboard badge/panel is
    // populated immediately. A health-check failure must never fail the connect.
    try {
      const { ShopifyHealthService } = await import('../../modules/shopify_health/shopify_health.service');
      await new ShopifyHealthService().checkHealth(input.store_id);
    } catch {
      logger.warn('Shopify health auto-check failed after connect', { storeId: input.store_id });
    }

    res.json({ success: true, message: 'Shopify credentials saved and verified' });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// POST /step3-assistant
// =========================================================
const Step3Schema = z.object({
  store_id: z.string().uuid(),
  assistant_name: z.string().min(2),
  welcome_message: z.string(),
  tone: z.string(),
  allowed_categories: z.array(z.string()),
  delivery_policy: z.string(),
  returns_policy: z.string(),
  faq_content: z.string()
});

router.post('/step3-assistant', requireOnboardingToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = Step3Schema.parse(req.body);
    const db = getDatabaseClient();

    await db.query('BEGIN');

    await db.query(`
      INSERT INTO assistant_settings (store_id, assistant_name, allowed_topics, support_contact, privacy_policy_url)
      VALUES ($1, $2, $3, 'support@example.com', 'https://example.com/privacy')
      ON CONFLICT (store_id) DO UPDATE SET
        assistant_name = EXCLUDED.assistant_name,
        allowed_topics = EXCLUDED.allowed_topics,
        updated_at = NOW()
    `, [input.store_id, input.assistant_name, input.allowed_categories]);

    await db.query(`
      INSERT INTO store_policies (store_id, delivery_policy, returns_policy, faq_content)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (store_id) DO UPDATE SET
        delivery_policy = EXCLUDED.delivery_policy,
        returns_policy = EXCLUDED.returns_policy,
        faq_content = EXCLUDED.faq_content,
        updated_at = NOW()
    `, [input.store_id, input.delivery_policy, input.returns_policy, input.faq_content]);

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    const db = getDatabaseClient();
    await db.query('ROLLBACK');
    next(err);
  }
});

// =========================================================
// POST /step4-email
// =========================================================
const Step4Schema = z.object({
  store_id: z.string().uuid(),
  sender_name: z.string().min(2),
  sender_email: z.string().email(),
  recovery_enabled: z.boolean(),
  marketing_consent_wording: z.string()
});

router.post('/step4-email', requireOnboardingToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = Step4Schema.parse(req.body);
    const db = getDatabaseClient();

    // Upsert email settings
    await db.query(`
      INSERT INTO email_settings (store_id, is_enabled, max_recovery_emails, follow_up_interval_minutes, consent_wording)
      VALUES ($1, $2, 3, 30, $3)
      ON CONFLICT (store_id) DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        consent_wording = EXCLUDED.consent_wording,
        updated_at = NOW()
    `, [input.store_id, input.recovery_enabled, input.marketing_consent_wording]);

    res.json({ success: true, message: 'Email settings saved' });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// POST /domains - Register Resend sender domain
// =========================================================
const CreateDomainSchema = z.object({
  store_id: z.string().uuid(),
  domain_name: z.string().min(3),
  sender_name: z.string().optional(),
  sender_email: z.string().email().optional(),
});

router.post('/domains', requireOnboardingToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = CreateDomainSchema.parse(req.body);
    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);
    const provider = getEmailProvider();

    const providerRes = await provider.createSenderDomain(input.domain_name);
    const domain = await domainRepo.createDomain(
      input.store_id,
      input.domain_name,
      providerRes.id,
      providerRes.records,
      input.sender_name,
      input.sender_email,
      providerRes.status
    );

    res.status(201).json({ success: true, domain });
  } catch (err) {
    next(err);
  }
});

// GET /domains/:storeId - Retrieve sender domains & DNS records
router.get('/domains/:storeId', requireOnboardingToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);
    const domains = await domainRepo.getDomainsByStore(storeId);
    res.json({ success: true, domains });
  } catch (err) {
    next(err);
  }
});

// POST /domains/:domainId/verify - Verify sender domain against Resend
router.post('/domains/:domainId/verify', requireOnboardingToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const domainId = req.params.domainId as string;
    const storeId = req.body.store_id;
    if (!storeId) {
      res.status(400).json({ error: 'store_id is required' });
      return;
    }
    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);
    const domain = await domainRepo.getDomainById(storeId, domainId);
    if (!domain) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }

    const provider = getEmailProvider();
    const providerRes = await provider.verifySenderDomain(domain.provider_domain_id);
    const updated = await domainRepo.updateDomainStatus(
      storeId,
      domainId,
      providerRes.status,
      providerRes.records
    );

    res.json({ success: true, domain: updated });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// POST /step5-sync
// =========================================================
const Step5Schema = z.object({
  store_id: z.string().uuid()
});

router.post('/step5-sync', requireOnboardingToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = Step5Schema.parse(req.body);
    
    // Register webhooks
    const adapter = getShopifyAdapter();
    if (adapter.registerWebhooks) {
      await adapter.registerWebhooks(input.store_id);
    }

    // Fake sync response (In reality this would queue a background job)
    res.json({
      success: true,
      synced_products: 42,
      categories: ['T-Shirts', 'Accessories', 'Mugs']
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// POST /step6-finish
// =========================================================
const Step6Schema = z.object({
  store_id: z.string().uuid()
});

router.post('/step6-finish', requireOnboardingToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = Step6Schema.parse(req.body);
    const db = getDatabaseClient();
    const merchantId = (req as any).merchant.id;

    // Fetch widget key from store
    const sRes = await db.query('SELECT widget_key FROM stores WHERE id = $1', [input.store_id]);
    const widgetKey = sRes.rows[0]?.widget_key || input.store_id;

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const embedScript = `<script src="${baseUrl}/widget.js" data-widget-key="${widgetKey}" defer></script>`;

    // Mark as active and clear token
    await db.query(`
      UPDATE merchants SET status = 'active', onboarding_token = NULL, onboarding_expires_at = NULL, updated_at = NOW()
      WHERE id = $1
    `, [merchantId]);

    // Set store to active
    await db.query(`UPDATE stores SET status = 'active', updated_at = NOW() WHERE id = $1`, [input.store_id]);

    res.json({
      success: true,
      embed_script: embedScript
    });
  } catch (err) {
    next(err);
  }
});

export default router;
