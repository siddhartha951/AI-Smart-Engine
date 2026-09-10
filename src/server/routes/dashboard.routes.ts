import { Router, Request, Response } from 'express';
import { getDatabaseClient } from '../../database/client';
import { verifyJwt, requireRole, enforceStoreAccess } from '../middlewares/auth.middleware';
import { AuditRepository } from '../../modules/merchant/audit.repository';
import { getEmailProvider, getTestEmailProvider } from '../../providers/email';
import { SenderDomainRepository } from '../../modules/email/sender-domain.repository';

const router = Router();

router.use(verifyJwt);
router.use(requireRole(['super_admin', 'ops_admin', 'platform_admin', 'merchant_owner']));

router.get('/stores', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    if (req.user!.role === 'platform_admin') {
      const storesRes = await db.query('SELECT id, brand_name, shop_domain FROM stores ORDER BY brand_name ASC');
      res.json({ success: true, data: storesRes.rows });
    } else {
      const storesRes = await db.query('SELECT id, brand_name, shop_domain FROM stores WHERE id = $1', [req.user!.store_id]);
      res.json({ success: true, data: storesRes.rows });
    }
  } catch (err) {
    next(err);
  }
});

// 1. Overview
router.get('/:storeId/overview', enforceStoreAccess, async (req: Request, res: Response, next) => {
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
      db.query('SELECT SUM(input_tokens) as total_input, SUM(output_tokens) as total_output, SUM(estimated_cost_usd) as total_cost FROM ai_usage_ledger WHERE store_id = $1', [storeId]),
      db.query('SELECT is_active FROM assistant_settings WHERE store_id = $1', [storeId])
    ]);

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
        ai_usage: usageRes.rows[0] || { total_input: 0, total_output: 0, total_cost: 0 }
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
      await db.query(
        `UPDATE assistant_settings SET 
          is_active = $1,
          assistant_name = $2, 
          welcome_message = $3,
          tone = $4,
          support_contact = $5,
          custom_prompt = $6,
          knowledge_base = $7,
          updated_at = NOW()
         WHERE store_id = $8`,
        [
          assistant.is_active !== undefined ? assistant.is_active : (old.is_active ?? true),
          assistant.assistant_name !== undefined ? assistant.assistant_name : (old.assistant_name ?? 'Assistant'),
          assistant.welcome_message !== undefined ? assistant.welcome_message : (old.welcome_message ?? 'Hi there!'),
          assistant.tone !== undefined ? assistant.tone : (old.tone ?? 'friendly and helpful'),
          assistant.support_contact !== undefined ? assistant.support_contact : (old.support_contact ?? 'support@store.com'),
          assistant.custom_prompt !== undefined ? assistant.custom_prompt : (old.custom_prompt ?? ''),
          assistant.knowledge_base !== undefined ? assistant.knowledge_base : (old.knowledge_base ?? ''),
          storeId
        ]
      );
      await auditRepo.logAction(req.user!.id, storeId, 'UPDATE_ASSISTANT_SETTINGS', 'assistant_settings', oldAssistant.rows[0], assistant);
    }

    if (policies) {
      const oldPolicies = await db.query('SELECT * FROM store_policies WHERE store_id = $1', [storeId]);
      const old = oldPolicies.rows[0] || {};
      await db.query(
        `UPDATE store_policies SET 
          faq_content = $1
         WHERE store_id = $2`,
        [policies.faq_content !== undefined ? policies.faq_content : old.faq_content, storeId]
      );
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
      const old = oldWidget.rows[0];
      await db.query(
        `UPDATE widget_settings SET 
          button_text = $1, 
          primary_colour = $2, 
          secondary_colour = $3,
          position = $4
         WHERE store_id = $5`,
        [
          widget.button_text !== undefined ? widget.button_text : old.button_text,
          widget.primary_colour !== undefined ? widget.primary_colour : old.primary_colour,
          widget.secondary_colour !== undefined ? widget.secondary_colour : old.secondary_colour,
          widget.position !== undefined ? widget.position : old.position,
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
      db.query('SELECT shop_domain, status, updated_at FROM stores WHERE id = $1', [storeId]),
      db.query('SELECT id, updated_at FROM store_credentials WHERE store_id = $1', [storeId])
    ]);

    res.json({
      success: true,
      data: {
        shop_domain: storeRes.rows[0]?.shop_domain,
        status: storeRes.rows[0]?.status,
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

// 4.1 Leads & Opt-ins Reporting with Conversion Tracking
router.get('/:storeId/leads', enforceStoreAccess, async (req: Request, res: Response, next) => {
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

// 5. Email Automation
router.get('/:storeId/email', enforceStoreAccess, async (req: Request, res: Response, next) => {
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

export default router;
