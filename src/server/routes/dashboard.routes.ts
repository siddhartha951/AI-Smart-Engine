import { Router, Request, Response } from 'express';
import { getDatabaseClient } from '../../database/client';
import { verifyJwt, requireRole, enforceStoreAccess } from '../middlewares/auth.middleware';
import { AuditRepository } from '../../modules/merchant/audit.repository';
import { getEmailProvider, getTestEmailProvider } from '../../providers/email';
import { SenderDomainRepository } from '../../modules/email/sender-domain.repository';
import { AnalyticsRepository } from '../../modules/analytics/analytics.repository';
import { AdCreativeService, BudgetExceededError, ProductNotFoundError } from '../../modules/ad_creatives/ad_creative.service';
import { WhatsAppService } from '../../modules/whatsapp/whatsapp.service';
import { WhatsAppRepository } from '../../modules/whatsapp/whatsapp.repository';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { resolveProductImageUrl } from '../../providers/shopify/shopify.utils';
import { replenishmentRouter } from './replenishment.routes';
import { attributionRouter } from './attribution.routes';
import { growthRouter } from './growth.routes';
import { aiRouter } from './ai.routes';
import { enforceFeature } from '../middlewares/entitlement.middleware';
import { FeatureKey } from '../../modules/entitlements/entitlement.types';
import { EntitlementRepository } from '../../modules/entitlements/entitlement.repository';

const router = Router();

router.use(verifyJwt);
router.use(requireRole(['super_admin', 'ops_admin', 'platform_admin', 'merchant_owner']));

router.get('/stores', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const adminRoles = ['super_admin', 'ops_admin', 'platform_admin'];
    if (adminRoles.includes(req.user!.role)) {
      const storesRes = await db.query('SELECT id, brand_name, shop_domain, currency FROM stores ORDER BY brand_name ASC');
      res.json({ success: true, data: storesRes.rows });
    } else {
      const storesRes = await db.query('SELECT id, brand_name, shop_domain, currency FROM stores WHERE id = $1', [req.user!.store_id]);
      res.json({ success: true, data: storesRes.rows });
    }
  } catch (err) {
    next(err);
  }
});

// Feature Entitlements endpoint for frontend checks
router.get('/:storeId/features', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const repo = new EntitlementRepository(db);
    const [features, storeRes] = await Promise.all([
      repo.getStoreEntitlements(storeId),
      db.query('SELECT currency FROM stores WHERE id = $1', [storeId]),
    ]);
    res.json({
      success: true,
      data: {
        store_id: storeId,
        currency: storeRes.rows[0]?.currency || 'INR',
        features,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update Store Currency (Merchant / Admin)
router.put('/:storeId/currency', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { currency } = req.body;

    if (!currency || typeof currency !== 'string') {
      res.status(400).json({ error: 'Valid currency code is required' });
      return;
    }

    const cleanCurrency = currency.trim().toUpperCase();
    const db = getDatabaseClient();

    const oldStore = await db.query('SELECT currency FROM stores WHERE id = $1', [storeId]);
    if (oldStore.rows.length === 0) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const updated = await db.query(
      'UPDATE stores SET currency = $1, updated_at = NOW() WHERE id = $2 RETURNING id, brand_name, currency',
      [cleanCurrency, storeId]
    );

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(
      req.user!.id,
      storeId,
      'UPDATE_STORE_CURRENCY',
      'stores',
      { currency: oldStore.rows[0]?.currency },
      { currency: cleanCurrency }
    );

    res.json({ success: true, data: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 1. Overview
router.get('/:storeId/overview', enforceStoreAccess, enforceFeature(FeatureKey.OVERVIEW), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();

    const [
      chatRes, leadsRes, optInRes, recRes, addCartRes, purchaseRes, emailStatsRes, usageRes, assistantRes
    ] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM chat_sessions WHERE store_id = $1', [storeId]),
      db.query('SELECT COUNT(*) as count FROM visitors WHERE store_id = $1 AND email IS NOT NULL', [storeId]),
      db.query('SELECT COUNT(*) as count FROM marketing_consents WHERE store_id = $1 AND opted_in = true', [storeId]),
      db.query('SELECT COUNT(*) as count FROM recommendations WHERE store_id = $1', [storeId]),
      db.query('SELECT COUNT(*) as count FROM events WHERE store_id = $1 AND type = $2', [storeId, 'add_to_cart']),
      db.query('SELECT COUNT(*) as count FROM events WHERE store_id = $1 AND type = $2', [storeId, 'purchase_completed']),
      db.query(`SELECT 
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'opened') as opened,
        (SELECT COUNT(*) FROM suppression_list WHERE store_id = $1) as unsubscribed
        FROM email_campaign_events WHERE store_id = $1`, [storeId]),
      db.query(`SELECT 
        COALESCE(SUM(input_tokens), 0) as total_input, 
        COALESCE(SUM(output_tokens), 0) as total_output, 
        COALESCE(SUM(estimated_cost_usd), 0) as total_cost 
        FROM ai_usage_ledger WHERE store_id = $1`, [storeId]),
      db.query('SELECT is_active FROM assistant_settings WHERE store_id = $1', [storeId])
    ]);

    const usageRow = usageRes.rows[0];

    res.json({
      success: true,
      data: {
        agent_active: assistantRes.rows[0]?.is_active ?? false,
        chats: parseInt(chatRes.rows[0]?.count || '0', 10),
        leads: parseInt(leadsRes.rows[0]?.count || '0', 10),
        opt_ins: parseInt(optInRes.rows[0]?.count || '0', 10),
        recommendations: parseInt(recRes.rows[0]?.count || '0', 10),
        add_to_carts: parseInt(addCartRes.rows[0]?.count || '0', 10),
        purchases: parseInt(purchaseRes.rows[0]?.count || '0', 10),
        emails_sent: parseInt(emailStatsRes.rows[0]?.sent || '0', 10),
        emails_opened: parseInt(emailStatsRes.rows[0]?.opened || '0', 10),
        emails_unsubscribed: parseInt(emailStatsRes.rows[0]?.unsubscribed || '0', 10),
        ai_usage: {
          total_input: parseInt(usageRow?.total_input || '0', 10),
          total_output: parseInt(usageRow?.total_output || '0', 10),
          total_cost: parseFloat(usageRow?.total_cost || '0')
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// 2. My Agent
router.get('/:storeId/agent', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();

    const [assistantRes, policyRes] = await Promise.all([
      db.query('SELECT * FROM assistant_settings WHERE store_id = $1', [storeId]),
      db.query('SELECT * FROM store_policies WHERE store_id = $1', [storeId])
    ]);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json({
      success: true,
      data: {
        assistant: assistantRes.rows[0] || null,
        policies: policyRes.rows[0] || null
      }
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:storeId/agent', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { assistant, policies } = req.body;
    const db = getDatabaseClient();
    const auditRepo = new AuditRepository(db);

    if (assistant) {
      const oldAssistant = await db.query('SELECT * FROM assistant_settings WHERE store_id = $1', [storeId]);
      const old = oldAssistant.rows[0] || {};
      
      const pillsJson = assistant.quick_action_pills !== undefined 
        ? JSON.stringify(assistant.quick_action_pills) 
        : (old.quick_action_pills ? (typeof old.quick_action_pills === 'string' ? old.quick_action_pills : JSON.stringify(old.quick_action_pills)) : '[]');

      if (oldAssistant.rows.length === 0) {
        await db.query(
          `INSERT INTO assistant_settings (
            store_id, is_active, assistant_name, welcome_message, tone, support_contact, custom_prompt, knowledge_base, quick_action_pills, allowed_topics, privacy_policy_url
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
          [
            storeId,
            assistant.is_active ?? true,
            assistant.assistant_name ?? 'Assistant',
            assistant.welcome_message ?? 'Hi there!',
            assistant.tone ?? 'friendly and helpful',
            assistant.support_contact ?? 'support@store.com',
            assistant.custom_prompt ?? '',
            assistant.knowledge_base ?? '',
            pillsJson,
            ['products', 'orders', 'store_info'],
            '#'
          ]
        );
      } else {
        await db.query(
          `UPDATE assistant_settings SET 
            is_active = $1,
            assistant_name = $2, 
            welcome_message = $3,
            tone = $4,
            support_contact = $5,
            custom_prompt = $6,
            knowledge_base = $7,
            quick_action_pills = $8::jsonb,
            updated_at = NOW()
           WHERE store_id = $9`,
          [
            assistant.is_active !== undefined ? assistant.is_active : (old.is_active ?? true),
            assistant.assistant_name !== undefined ? assistant.assistant_name : (old.assistant_name ?? 'Assistant'),
            assistant.welcome_message !== undefined ? assistant.welcome_message : (old.welcome_message ?? 'Hi there!'),
            assistant.tone !== undefined ? assistant.tone : (old.tone ?? 'friendly and helpful'),
            assistant.support_contact !== undefined ? assistant.support_contact : (old.support_contact ?? 'support@store.com'),
            assistant.custom_prompt !== undefined ? assistant.custom_prompt : (old.custom_prompt ?? ''),
            assistant.knowledge_base !== undefined ? assistant.knowledge_base : (old.knowledge_base ?? ''),
            pillsJson,
            storeId
          ]
        );
      }
      await auditRepo.logAction(req.user!.id, storeId, 'UPDATE_ASSISTANT_SETTINGS', 'assistant_settings', oldAssistant.rows[0] || {}, assistant);
    }

    if (policies) {
      const oldPolicies = await db.query('SELECT * FROM store_policies WHERE store_id = $1', [storeId]);
      const old = oldPolicies.rows[0] || {};
      if (oldPolicies.rows.length === 0) {
        await db.query(
          `INSERT INTO store_policies (store_id, delivery_policy, returns_policy, faq_content)
           VALUES ($1, 'Standard delivery', '7 days return', $2)`,
          [storeId, policies.faq_content || '']
        );
      } else {
        await db.query(
          `UPDATE store_policies SET 
            faq_content = $1
           WHERE store_id = $2`,
          [policies.faq_content !== undefined ? policies.faq_content : old.faq_content, storeId]
        );
      }
      await auditRepo.logAction(req.user!.id, storeId, 'UPDATE_STORE_POLICIES', 'store_policies', oldPolicies.rows[0] || {}, policies);
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:storeId/agent/upload-knowledge', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { text_content, title } = req.body;
    if (!text_content || typeof text_content !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing text_content string' });
    }

    const db = getDatabaseClient();
    const old = await db.query('SELECT knowledge_base FROM assistant_settings WHERE store_id = $1', [storeId]);
    const currentKb = old.rows[0]?.knowledge_base || '';
    const header = title ? `\n--- Document: ${title} ---\n` : '\n--- Document ---\n';
    const updatedKb = (currentKb + '\n' + header + text_content).trim();

    await db.query('UPDATE assistant_settings SET knowledge_base = $1, updated_at = NOW() WHERE store_id = $2', [updatedKb, storeId]);

    res.json({
      success: true,
      message: 'Knowledge base updated successfully',
      knowledge_base: updatedKb,
    });
  } catch (err) {
    next(err);
  }
});

// 3. Widget Settings
router.get('/:storeId/widget', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();

    const [widgetRes, storeRes] = await Promise.all([
      db.query('SELECT * FROM widget_settings WHERE store_id = $1', [storeId]),
      db.query('SELECT widget_key FROM stores WHERE id = $1', [storeId])
    ]);

    res.json({
      success: true,
      data: {
        widget: widgetRes.rows[0] || null,
        widget_key: storeRes.rows[0]?.widget_key
      }
    });
  } catch (err) {
    next(err);
  }
});

router.put(['/:storeId/widget', '/:storeId/settings'], enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { widget } = req.body;
    const db = getDatabaseClient();
    const auditRepo = new AuditRepository(db);

    if (widget) {
      const oldWidget = await db.query('SELECT * FROM widget_settings WHERE store_id = $1', [storeId]);
      const old = oldWidget.rows[0] || {};
      await db.query(
        `UPDATE widget_settings SET 
          button_text = $1, 
          primary_colour = $2, 
          secondary_colour = $3,
          position = $4,
          avatar_url = $5,
          header_title = $6,
          custom_css = $7,
          country_code = $8,
          avatar_persona = $9,
          offer_code = $10,
          offer_discount_percent = $11,
          offer_text = $12,
          proactive_nudge_enabled = $13,
          proactive_nudge_interval_seconds = $14,
          updated_at = NOW()
         WHERE store_id = $15`,
        [
          widget.button_text !== undefined ? widget.button_text : old.button_text,
          widget.primary_colour !== undefined ? widget.primary_colour : old.primary_colour,
          widget.secondary_colour !== undefined ? widget.secondary_colour : old.secondary_colour,
          widget.position !== undefined ? widget.position : old.position,
          widget.avatar_url !== undefined ? widget.avatar_url : old.avatar_url,
          widget.header_title !== undefined ? widget.header_title : old.header_title,
          widget.custom_css !== undefined ? widget.custom_css : old.custom_css,
          widget.country_code !== undefined ? widget.country_code : (old.country_code || 'IN'),
          widget.avatar_persona !== undefined ? widget.avatar_persona : (old.avatar_persona || 'female_3d'),
          widget.offer_code !== undefined ? widget.offer_code : (old.offer_code || ''),
          widget.offer_discount_percent !== undefined ? Number(widget.offer_discount_percent) : (old.offer_discount_percent || 0),
          widget.offer_text !== undefined ? widget.offer_text : (old.offer_text || ''),
          widget.proactive_nudge_enabled !== undefined ? Boolean(widget.proactive_nudge_enabled) : (old.proactive_nudge_enabled !== false),
          widget.proactive_nudge_interval_seconds !== undefined ? Number(widget.proactive_nudge_interval_seconds) : (old.proactive_nudge_interval_seconds || 60),
          storeId
        ]
      );
      await auditRepo.logAction(req.user!.id, storeId, 'UPDATE_WIDGET_SETTINGS', 'widget_settings', oldWidget.rows[0], widget);
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:storeId/widget/regenerate-key', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const auditRepo = new AuditRepository(db);

    const resDb = await db.query('UPDATE stores SET widget_key = gen_random_uuid() WHERE id = $1 RETURNING widget_key', [storeId]);
    await auditRepo.logAction(req.user!.id, storeId, 'REGENERATE_WIDGET_KEY', 'stores', {}, { widget_key_regenerated: true });

    res.json({ success: true, data: { widget_key: resDb.rows[0].widget_key } });
  } catch (err) {
    next(err);
  }
});

// 4. Shopify Connection
router.get('/:storeId/shopify', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();

    const [storeRes, credsRes] = await Promise.all([
      db.query('SELECT shop_domain, status, currency, updated_at FROM stores WHERE id = $1', [storeId]),
      db.query('SELECT id, updated_at FROM store_credentials WHERE store_id = $1', [storeId])
    ]);

    res.json({
      success: true,
      data: {
        shop_domain: storeRes.rows[0]?.shop_domain,
        status: storeRes.rows[0]?.status,
        currency: storeRes.rows[0]?.currency || 'INR',
        last_sync: storeRes.rows[0]?.updated_at,
        credentials_configured: credsRes.rows.length > 0
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:storeId/shopify/test', enforceStoreAccess, async (req: Request, res: Response, next) => {
  // Just simulate success for Phase 7.1 since no real validator is built yet
  res.json({ success: true, message: 'Connection valid' });
});

router.post('/:storeId/shopify/sync', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const { getShopifyAdapter } = await import('../../providers/shopify');
    const adapter = getShopifyAdapter();

    let result = { count: 0, products: [] as any[] };
    if (adapter.syncAllProducts) {
      result = await adapter.syncAllProducts(storeId);
    } else {
      const list = await adapter.searchProducts(storeId, {});
      result = { count: list.length, products: list };
    }

    // Save/upsert products into products table
    if (result.products && result.products.length > 0) {
      for (const p of result.products) {
        const rawId = p.id.split('/').pop() || p.id;
        const compositeId = `${storeId}_${rawId}`;
        await db.query(`
          INSERT INTO products (
            id, store_id, shopify_id, variant_id, title, handle, price, currency, in_stock, category, image_url, product_url, synced_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            handle = EXCLUDED.handle,
            price = EXCLUDED.price,
            currency = EXCLUDED.currency,
            in_stock = EXCLUDED.in_stock,
            category = EXCLUDED.category,
            image_url = CASE WHEN EXCLUDED.image_url IS NOT NULL AND EXCLUDED.image_url != '' THEN EXCLUDED.image_url ELSE products.image_url END,
            product_url = EXCLUDED.product_url,
            synced_at = NOW(),
            updated_at = NOW()
        `, [
          compositeId,
          storeId,
          p.id,
          p.variant_id || '',
          p.title,
          p.handle || (p.title ? p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') : ''),
          p.price || 0,
          p.currency || 'INR',
          p.in_stock ?? true,
          p.category || '',
          resolveProductImageUrl(p.image_url, p.category, p.title),
          p.product_url || ''
        ]);
      }
    }

    // Update stores updated_at so dashboard displays fresh sync timestamp
    await db.query('UPDATE stores SET updated_at = NOW() WHERE id = $1', [storeId]);

    res.json({
      success: true,
      message: `Successfully synced ${result.count} products from Shopify.`,
      count: result.count,
      total_synced: result.count,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || 'Product sync failed' });
  }
});

// 3.1 Synced Products Catalog
router.get('/:storeId/products', enforceStoreAccess, enforceFeature(FeatureKey.CATALOGUE), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const search = (req.query.q as string || '').trim();

    let query = 'SELECT * FROM products WHERE store_id = $1';
    const params: any[] = [storeId];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      query += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(category) LIKE $${params.length})`;
    }

    query += ' ORDER BY synced_at DESC, title ASC LIMIT 250';

    const resProducts = await db.query(query, params);
    const totalCount = resProducts.rows.length;
    const inStockCount = resProducts.rows.filter((r: any) => r.in_stock).length;
    const uniqueCategories = Array.from(new Set(resProducts.rows.map((r: any) => r.category).filter(Boolean)));

    res.json({
      success: true,
      data: {
        summary: {
          total: totalCount,
          in_stock: inStockCount,
          out_of_stock: totalCount - inStockCount,
          categories_count: uniqueCategories.length,
        },
        products: resProducts.rows.map((p: any) => ({
          ...p,
          image_url: resolveProductImageUrl(p.image_url, p.category, p.title),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// 4.1 Leads & Opt-ins Reporting with Conversion Tracking
router.get('/:storeId/leads', enforceStoreAccess, enforceFeature(FeatureKey.LEADS), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();

    const leadsQuery = `
      SELECT 
        mc.id,
        mc.store_id,
        mc.visitor_id,
        mc.opted_in,
        mc.captured_at,
        mc.source,
        v.email,
        v.phone,
        v.anonymous_id
      FROM marketing_consents mc
      JOIN visitors v ON v.id = mc.visitor_id
      WHERE mc.store_id = $1
      ORDER BY mc.captured_at DESC
      LIMIT 100
    `;

    const leadsRes = await db.query(leadsQuery, [storeId]);
    const visitorIds = leadsRes.rows.map((r: any) => r.visitor_id);

    const purchasesByVisitor: Record<string, any> = {};
    if (visitorIds.length > 0) {
      const placeholders = visitorIds.map((_, idx) => `$${idx + 2}`).join(', ');
      const purchasesRes = await db.query(
        `SELECT visitor_id, payload, created_at FROM events 
         WHERE store_id = $1 AND type = 'purchase_completed' AND visitor_id IN (${placeholders})
         ORDER BY created_at DESC`,
        [storeId, ...visitorIds]
      );
      for (const p of purchasesRes.rows) {
        if (!purchasesByVisitor[p.visitor_id]) {
          purchasesByVisitor[p.visitor_id] = p;
        }
      }
    }

    const leads = leadsRes.rows.map((r: any) => {
      const purchase = purchasesByVisitor[r.visitor_id];
      let payload = purchase?.payload;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch {}
      }
      payload = payload || {};
      const converted = Boolean(purchase);

      return {
        id: r.id,
        email: r.email || 'Anonymous Visitor',
        phone: r.phone || '',
        opted_in: r.opted_in,
        captured_at: r.captured_at,
        source: r.source || 'widget_chat_v1',
        converted,
        order_id: payload.order_id || null,
        order_total: payload.total_price || null,
      };
    });

    const totalLeads = leads.length;
    const optedInCount = leads.filter((r: any) => r.opted_in).length;
    const convertedCount = leads.filter((r: any) => r.converted).length;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0';

    res.json({
      success: true,
      data: {
        summary: {
          total_leads: totalLeads,
          opted_in: optedInCount,
          converted: convertedCount,
          conversion_rate: conversionRate + '%',
        },
        leads,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 4.2 Leads CSV Export
router.get('/:storeId/leads/export', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();

    const leadsQuery = `
      SELECT 
        mc.id,
        mc.store_id,
        mc.visitor_id,
        mc.opted_in,
        mc.captured_at,
        mc.source,
        v.email,
        v.phone,
        v.anonymous_id
      FROM marketing_consents mc
      JOIN visitors v ON v.id = mc.visitor_id
      WHERE mc.store_id = $1
      ORDER BY mc.captured_at DESC
    `;

    const leadsRes = await db.query(leadsQuery, [storeId]);
    const visitorIds = leadsRes.rows.map((r: any) => r.visitor_id);

    const purchasesByVisitor: Record<string, any> = {};
    if (visitorIds.length > 0) {
      const placeholders = visitorIds.map((_, idx) => `$${idx + 2}`).join(', ');
      const purchasesRes = await db.query(
        `SELECT visitor_id, payload, created_at FROM events 
         WHERE store_id = $1 AND type = 'purchase_completed' AND visitor_id IN (${placeholders})
         ORDER BY created_at DESC`,
        [storeId, ...visitorIds]
      );
      for (const p of purchasesRes.rows) {
        if (!purchasesByVisitor[p.visitor_id]) {
          purchasesByVisitor[p.visitor_id] = p;
        }
      }
    }

    const csvHeaders = ['ID', 'Email', 'Phone', 'Marketing Opt-In', 'Captured Date', 'Source', 'Converted', 'Order Number', 'Order Total', 'Currency'];
    const rows = leadsRes.rows.map((r: any) => {
      const purchase = purchasesByVisitor[r.visitor_id];
      let payload = purchase?.payload;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch {}
      }
      payload = payload || {};
      const converted = Boolean(purchase) ? 'Yes' : 'No';
      const orderNum = payload.order_number || payload.order_id || '';
      const orderTotal = payload.total_price || '';
      const currency = payload.currency || '';

      return [
        `"${r.id}"`,
        `"${(r.email || '').replace(/"/g, '""')}"`,
        `"${(r.phone || '').replace(/"/g, '""')}"`,
        r.opted_in ? 'Yes' : 'No',
        `"${new Date(r.captured_at).toISOString()}"`,
        `"${r.source || 'widget'}"`,
        converted,
        `"${orderNum}"`,
        `"${orderTotal}"`,
        `"${currency}"`
      ].join(',');
    });

    const csvContent = [csvHeaders.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${storeId.substring(0, 8)}_${Date.now()}.csv"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
});

// 5. Email Automation
router.get('/:storeId/email', enforceStoreAccess, enforceFeature(FeatureKey.EMAIL_AUTOMATION), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();

    const emailSettingsRes = await db.query('SELECT * FROM email_settings WHERE store_id = $1', [storeId]);
    
    res.json({
      success: true,
      data: {
        settings: emailSettingsRes.rows[0] || null
      }
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:storeId/email', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { settings } = req.body;
    const db = getDatabaseClient();
    const auditRepo = new AuditRepository(db);

    if (settings) {
      const oldSettings = await db.query('SELECT * FROM email_settings WHERE store_id = $1', [storeId]);
      const old = oldSettings.rows[0] || {};
      await db.query(
        `UPDATE email_settings SET 
          is_enabled = $1,
          follow_up_interval_minutes = $2,
          max_recovery_emails = $3,
          consent_wording = $4
         WHERE store_id = $5`,
        [
          settings.is_enabled !== undefined ? settings.is_enabled : old.is_enabled,
          settings.follow_up_interval_minutes !== undefined ? settings.follow_up_interval_minutes : old.follow_up_interval_minutes,
          settings.max_recovery_emails !== undefined ? settings.max_recovery_emails : old.max_recovery_emails,
          settings.consent_wording !== undefined ? settings.consent_wording : old.consent_wording,
          storeId
        ]
      );
      await auditRepo.logAction(req.user!.id, storeId, 'UPDATE_EMAIL_SETTINGS', 'email_settings', oldSettings.rows[0] || {}, settings);
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:storeId/email/test', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { email } = req.body;
    
    if (!email) {
      res.status(400).json({ success: false, message: 'Email required' });
      return;
    }

    // Phase 7.1 requires fake provider test only
    const provider = getTestEmailProvider();
    await provider.sendEmail({
      to: email as string,
      subject: 'Test Email from Merchant Dashboard',
      textBody: 'This is a test email sent from the Merchant Dashboard.',
      htmlBody: '<p>This is a test email sent from the Merchant Dashboard.</p>',
      storeId: storeId,
      campaignType: 'test_email'
    });

    res.json({ success: true, message: 'Test email sent using fake provider' });
  } catch (err) {
    next(err);
  }
});

router.get('/:storeId/email/domains', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);
    const domains = await domainRepo.getDomainsByStore(storeId);
    res.json({ success: true, data: domains });
  } catch (err) {
    next(err);
  }
});

router.post('/:storeId/email/domains', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { domain_name, sender_name, sender_email } = req.body;
    if (!domain_name || typeof domain_name !== 'string') {
      res.status(400).json({ success: false, error: 'domain_name is required' });
      return;
    }

    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);
    const provider = getEmailProvider();

    const providerRes = await provider.createSenderDomain(domain_name);
    const domain = await domainRepo.createDomain(
      storeId,
      domain_name,
      providerRes.id,
      providerRes.records,
      sender_name,
      sender_email,
      providerRes.status
    );

    res.status(201).json({ success: true, data: domain });
  } catch (err) {
    next(err);
  }
});

router.post('/:storeId/email/domains/:domainId/verify', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const domainId = req.params.domainId as string;
    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);

    const domain = await domainRepo.getDomainById(storeId, domainId);
    if (!domain) {
      res.status(404).json({ success: false, error: 'Domain not found' });
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

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/:storeId/email/domains/:domainId', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const domainId = req.params.domainId as string;
    const db = getDatabaseClient();
    const domainRepo = new SenderDomainRepository(db);

    const deleted = await domainRepo.deleteDomain(storeId, domainId);
    res.json({ success: true, deleted });
  } catch (err) {
    next(err);
  }
});

// 6. Live Analytics & Funnel Tracking (Phase 2)
router.get('/:storeId/analytics/live', enforceStoreAccess, enforceFeature(FeatureKey.LIVE_PULSE), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const analyticsRepo = new AnalyticsRepository(db);

    const [activeShoppers, feed, storeRes] = await Promise.all([
      analyticsRepo.getActiveShoppersCount(storeId, 5),
      analyticsRepo.getLiveActivityFeed(storeId, 30),
      db.query('SELECT live_tracking_enabled FROM stores WHERE id = $1', [storeId]),
    ]);

    const isTrackingEnabled = storeRes.rows[0]?.live_tracking_enabled !== false;

    res.json({
      success: true,
      data: {
        active_shoppers: activeShoppers,
        feed,
        live_tracking_enabled: isTrackingEnabled,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:storeId/analytics/funnel', enforceStoreAccess, enforceFeature(FeatureKey.FUNNEL), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const days = parseInt((req.query.days as string) || '7', 10);
    const db = getDatabaseClient();
    const analyticsRepo = new AnalyticsRepository(db);

    const funnel = await analyticsRepo.getConversionFunnel(storeId, isNaN(days) ? 7 : days);

    res.json({
      success: true,
      data: funnel,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:storeId/analytics/products', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const limit = parseInt((req.query.limit as string) || '10', 10);
    const db = getDatabaseClient();
    const analyticsRepo = new AnalyticsRepository(db);

    const performance = await analyticsRepo.getRecommendationPerformance(storeId, isNaN(limit) ? 10 : limit);

    res.json({
      success: true,
      data: performance,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 8. Phase 12: AI Ad Creative Studio Routes
// ==========================================

// 8.1 Available Catalogue Products for Ad Creative Studio
router.get('/:storeId/ad-creatives/products', enforceStoreAccess, enforceFeature(FeatureKey.AD_CREATIVE), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const service = new AdCreativeService({ db });

    const products = await service.getCatalogueProducts(storeId);
    res.json({
      success: true,
      data: {
        products,
        total: products.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 8.2 Generate Ad Creative Variations
router.post('/:storeId/ad-creatives/generate', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { productId, platform, objective } = req.body || {};

    if (!productId || typeof productId !== 'string') {
      res.status(400).json({ success: false, error: 'Product ID is required.' });
      return;
    }

    const validPlatforms = ['facebook', 'instagram'];
    if (!platform || !validPlatforms.includes(platform)) {
      res.status(400).json({ success: false, error: 'Platform must be "facebook" or "instagram".' });
      return;
    }

    const validObjectives = ['product_sales', 'traffic', 'retargeting', 'product_launch'];
    if (!objective || !validObjectives.includes(objective)) {
      res.status(400).json({ success: false, error: 'Invalid ad objective provided.' });
      return;
    }

    const db = getDatabaseClient();
    const service = new AdCreativeService({ db });

    const result = await service.generateCreatives(storeId, {
      productId: productId.trim(),
      platform,
      objective,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    if (err instanceof BudgetExceededError) {
      res.status(403).json({ success: false, error: err.message, code: 'BUDGET_EXCEEDED' });
      return;
    }
    if (err instanceof ProductNotFoundError) {
      res.status(404).json({ success: false, error: err.message });
      return;
    }
    next(err);
  }
});

// 8.2b Generate AI Ad Creative Image via OpenAI DALL-E
router.post('/:storeId/ad-creatives/generate-image', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { productId, prompt, hook, headline, platform, style } = req.body || {};

    if (!productId || typeof productId !== 'string') {
      res.status(400).json({ success: false, error: 'Product ID is required.' });
      return;
    }

    const db = getDatabaseClient();
    const service = new AdCreativeService({ db });

    const result = await service.generateAdImage(storeId, {
      productId: productId.trim(),
      prompt: prompt ? String(prompt).trim() : undefined,
      hook: hook ? String(hook).trim() : undefined,
      headline: headline ? String(headline).trim() : undefined,
      platform: platform === 'instagram' ? 'instagram' : 'facebook',
      style: style || 'commercial_studio',
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    if (err instanceof BudgetExceededError) {
      res.status(403).json({ success: false, error: err.message, code: 'BUDGET_EXCEEDED' });
      return;
    }
    if (err instanceof ProductNotFoundError) {
      res.status(404).json({ success: false, error: err.message });
      return;
    }
    next(err);
  }
});

// 8.3 Save an Ad Creative Variation
router.post('/:storeId/ad-creatives/save', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { productId, productTitle, platform, objective, hook, primaryText, headline, cta, imageUrl, metadata } = req.body || {};

    if (!productId || !productTitle || !platform || !objective || !hook || !primaryText || !headline || !cta) {
      res.status(400).json({ success: false, error: 'Missing required creative fields.' });
      return;
    }

    const validPlatforms = ['facebook', 'instagram'];
    if (!validPlatforms.includes(platform)) {
      res.status(400).json({ success: false, error: 'Platform must be "facebook" or "instagram".' });
      return;
    }

    const validObjectives = ['product_sales', 'traffic', 'retargeting', 'product_launch'];
    if (!validObjectives.includes(objective)) {
      res.status(400).json({ success: false, error: 'Invalid ad objective provided.' });
      return;
    }

    const db = getDatabaseClient();
    const service = new AdCreativeService({ db });

    const saved = await service.saveCreative(storeId, {
      productId: String(productId).trim(),
      productTitle: String(productTitle).trim(),
      platform,
      objective,
      hook: String(hook).trim(),
      primaryText: String(primaryText).trim(),
      headline: String(headline).trim(),
      cta: String(cta).trim(),
      imageUrl: imageUrl ? String(imageUrl).trim() : '',
      metadata,
    });

    res.status(201).json({
      success: true,
      message: 'Creative saved successfully.',
      data: saved,
    });
  } catch (err) {
    next(err);
  }
});

// 8.4 Retrieve Saved Creatives
router.get('/:storeId/ad-creatives/saved', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const db = getDatabaseClient();
    const service = new AdCreativeService({ db });

    const result = await service.getSavedCreatives(
      storeId,
      isNaN(limit) ? 50 : Math.min(limit, 100),
      isNaN(offset) ? 0 : offset
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// 8.5 Delete a Saved Creative
router.delete('/:storeId/ad-creatives/saved/:id', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const creativeId = req.params.id as string;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(creativeId);
    if (!isUuid) {
      res.status(400).json({ success: false, error: 'Invalid creative ID format.' });
      return;
    }

    const db = getDatabaseClient();
    const service = new AdCreativeService({ db });

    const deleted = await service.deleteSavedCreative(storeId, creativeId);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Creative not found or already deleted.' });
      return;
    }

    res.json({
      success: true,
      message: 'Creative deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 9. Phase 13: WhatsApp Growth Engine Routes
// ==========================================

// 9.1 WhatsApp Configuration Status
router.get('/:storeId/whatsapp/config', enforceStoreAccess, enforceFeature(FeatureKey.WHATSAPP), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    const config = await service.getConfig(storeId);
    res.json({
      success: true,
      data: config,
    });
  } catch (err) {
    next(err);
  }
});

// 9.2 Save WhatsApp Configuration (supports PUT and POST)
const handleSaveWhatsAppConfig = async (req: Request, res: Response, next: any) => {
  try {
    const storeId = req.params.storeId as string;
    const {
      provider,
      phoneNumberId,
      wabaId,
      accessToken,
      webhookVerifyToken,
      appSecret,
      displayPhoneNumber,
      watiApiEndpoint,
      watiAccessToken,
    } = req.body || {};

    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    const saved = await service.saveConfig(storeId, {
      provider,
      phoneNumberId,
      wabaId,
      accessToken,
      webhookVerifyToken,
      appSecret,
      displayPhoneNumber,
      watiApiEndpoint,
      watiAccessToken,
    });

    res.json({
      success: true,
      message: 'WhatsApp configuration saved successfully.',
      data: saved,
    });
  } catch (err: any) {
    logger.error(`Failed to save WhatsApp configuration for store ${String(req.params.storeId)}`, err, {
      storeId: String(req.params.storeId),
      provider: req.body?.provider,
    });
    if (err instanceof AppError) {
      next(err);
    } else {
      next(new AppError(err?.message || 'Failed to save WhatsApp configuration', 400, 'SAVE_CONFIG_ERROR'));
    }
  }
};

router.put('/:storeId/whatsapp/config', enforceStoreAccess, handleSaveWhatsAppConfig);
router.post('/:storeId/whatsapp/config', enforceStoreAccess, handleSaveWhatsAppConfig);

// 9.3 Send Test WhatsApp Message
router.post('/:storeId/whatsapp/test', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const phone = req.body?.toPhone || req.body?.phone;

    if (!phone || typeof phone !== 'string') {
      res.status(400).json({ success: false, error: 'Recipient phone number is required.' });
      return;
    }

    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    const result = await service.sendTestMessage(storeId, phone);
    res.json({
      success: true,
      message: 'Test message sent successfully.',
      data: result,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.4 List WhatsApp Conversations
router.get('/:storeId/whatsapp/conversations', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    const result = await service.getConversations(storeId, isNaN(limit) ? 50 : limit, isNaN(offset) ? 0 : offset);
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// 9.5 Get Messages for Conversation
const handleGetWhatsAppMessages = async (req: Request, res: Response, next: any) => {
  try {
    const storeId = req.params.storeId as string;
    const convId = (req.params.id || req.query.conversationId) as string;

    if (!convId) {
      res.status(400).json({ success: false, error: 'conversationId is required' });
      return;
    }

    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    const messages = await service.getConversationMessages(storeId, convId);
    res.json({
      success: true,
      data: { messages },
    });
  } catch (err) {
    next(err);
  }
};

router.get('/:storeId/whatsapp/messages', enforceStoreAccess, handleGetWhatsAppMessages);
router.get('/:storeId/whatsapp/conversations/:id/messages', enforceStoreAccess, handleGetWhatsAppMessages);

// 9.6 List Consented Contacts
router.get('/:storeId/whatsapp/consents', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    const result = await service.getConsents(storeId, isNaN(limit) ? 50 : limit, isNaN(offset) ? 0 : offset);
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// 9.7 Revoke Consent by ID
router.delete('/:storeId/whatsapp/consents/:id', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const consentId = req.params.id as string;

    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    await service.revokeConsentById(storeId, consentId);
    res.json({
      success: true,
      message: 'WhatsApp marketing consent revoked successfully.',
    });
  } catch (err) {
    next(err);
  }
});

// Revoke Consent by Phone
router.post('/:storeId/whatsapp/consents/revoke', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { phone } = req.body || {};

    if (!phone || typeof phone !== 'string') {
      res.status(400).json({ success: false, error: 'Phone number is required.' });
      return;
    }

    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    await service.revokeConsent(storeId, phone);
    res.json({
      success: true,
      message: 'WhatsApp marketing consent revoked successfully.',
    });
  } catch (err) {
    next(err);
  }
});

// 9.8 Record Opt-In
const handleRecordOptIn = async (req: Request, res: Response, next: any) => {
  try {
    const storeId = req.params.storeId as string;
    const phone = req.body?.phoneNumber || req.body?.phone;
    const wording = req.body?.consentWording || req.body?.wording;
    const { source, visitorId } = req.body || {};

    if (!phone || typeof phone !== 'string') {
      res.status(400).json({ success: false, error: 'Phone number is required.' });
      return;
    }

    const db = getDatabaseClient();
    const repo = new WhatsAppRepository(db);

    const consent = await repo.recordConsent(storeId, {
      phoneNumber: phone,
      optedIn: true,
      wording: wording || 'Opted in to WhatsApp updates',
      source: source || 'merchant_dashboard',
      visitorId,
    });

    res.status(201).json({
      success: true,
      message: 'WhatsApp consent recorded successfully.',
      data: consent,
    });
  } catch (err) {
    next(err);
  }
};

router.post('/:storeId/whatsapp/opt-in', enforceStoreAccess, handleRecordOptIn);
router.post('/:storeId/whatsapp/consents/opt-in', enforceStoreAccess, handleRecordOptIn);

// 9.9 WhatsApp Growth Analytics Summary
router.get('/:storeId/whatsapp/analytics', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    const analytics = await service.getAnalytics(storeId);
    res.json({
      success: true,
      data: {
        active_conversations: analytics.activeConversations,
        inbound_messages: analytics.inboundMessages,
        outbound_messages: analytics.outboundMessages,
        recovered_carts: analytics.recoveredCarts,
        consented_contacts: analytics.consentedContacts,
        ...analytics,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 9.10 Schedule Abandoned Cart Recovery
router.post('/:storeId/whatsapp/recovery/schedule', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const phone = req.body?.customerPhone || req.body?.phone;
    const cartToken = req.body?.checkoutToken || req.body?.cartToken;
    const checkoutUrl = req.body?.recoveryUrl || req.body?.checkoutUrl;
    const { productId, productTitle, price, currency, cartItems, visitorId } = req.body || {};

    if (!phone) {
      res.status(400).json({ success: false, error: 'Phone number is required.' });
      return;
    }

    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    const result = await service.scheduleAbandonedCartRecovery(storeId, {
      phone,
      cartToken,
      productId,
      productTitle,
      price,
      currency,
      checkoutUrl,
      cartItems,
      visitorId,
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// 9.11 Process Abandoned Cart Recovery Job
router.post('/:storeId/whatsapp/recovery/:id/process', enforceStoreAccess, async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const jobId = req.params.id as string;

    const db = getDatabaseClient();
    const service = new WhatsAppService({ db });

    const result = await service.processRecoveryJob(storeId, jobId);
    res.json({
      success: true,
      message: result.status === 'sent' ? 'Recovery job processed successfully.' : 'Recovery job evaluated.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// 10. Auto Replenishment & Reorder Reminders
router.use('/:storeId/replenishment', enforceStoreAccess, enforceFeature(FeatureKey.SMART_REORDER), replenishmentRouter);

// 11. Multi-Touch Ad Intelligence & Attribution Engine
router.use('/:storeId/attribution', enforceStoreAccess, enforceFeature(FeatureKey.AD_INTELLIGENCE), attributionRouter);

// 12. AI Merchant Growth Copilot & Action Center
router.use('/:storeId/growth', enforceStoreAccess, enforceFeature(FeatureKey.GROWTH_COPILOT), growthRouter);

// 13. AI Intelligence Layer & Domain Analytics
router.use('/:storeId/ai', enforceStoreAccess, aiRouter);

export default router;

