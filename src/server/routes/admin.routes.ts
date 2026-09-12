import { Router, Request, Response } from 'express';
import { getDatabaseClient } from '../../database/client';
import { verifyJwt, requireAdminOnly, requireSuperAdmin } from '../middlewares/auth.middleware';
import { AuditRepository } from '../../modules/merchant/audit.repository';
import { getEmailProvider } from '../../providers/email';
import { SenderDomainRepository } from '../../modules/email/sender-domain.repository';
import { EntitlementRepository } from '../../modules/entitlements/entitlement.repository';
import { ALL_FEATURE_KEYS, FEATURE_CATALOG, FeatureKey } from '../../modules/entitlements/entitlement.types';
import crypto from 'crypto';

const router = Router();

// All admin routes require auth + admin role
router.use(verifyJwt);
router.use(requireAdminOnly);

// =========================================================================
// ADMIN OVERVIEW
// =========================================================================
router.get('/overview', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();

    const [
      merchantsTotal,
      merchantsByStatus,
      totalChats,
      totalLeads,
      totalOptIns,
      totalAddToCart,
      totalPurchases,
      totalEmails,
      globalAiSpend,
      platformConfig,
      topConsumers,
      recentAlerts
    ] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM merchants'),
      db.query(`SELECT status, COUNT(*) as count FROM merchants GROUP BY status`),
      db.query('SELECT COUNT(*) as count FROM chat_sessions'),
      db.query('SELECT COUNT(*) as count FROM visitors WHERE email IS NOT NULL'),
      db.query('SELECT COUNT(*) as count FROM marketing_consents WHERE opted_in = true'),
      db.query("SELECT COUNT(*) as count FROM events WHERE type = 'add_to_cart'"),
      db.query("SELECT COUNT(*) as count FROM events WHERE type = 'purchase_completed'"),
      db.query("SELECT COUNT(*) as count FROM email_campaign_events WHERE status = 'sent'"),
      db.query('SELECT COALESCE(SUM(estimated_cost_usd), 0) as total_spend FROM ai_usage_ledger'),
      db.query('SELECT * FROM platform_config LIMIT 1'),
      db.query(`SELECT s.brand_name, s.id as store_id, 
        COALESCE(SUM(a.estimated_cost_usd), 0) as total_spend,
        COALESCE(SUM(a.input_tokens + a.output_tokens), 0) as total_tokens
        FROM stores s LEFT JOIN ai_usage_ledger a ON s.id = a.store_id
        GROUP BY s.id, s.brand_name ORDER BY total_spend DESC LIMIT 10`),
      db.query('SELECT * FROM admin_alerts WHERE acknowledged = false ORDER BY created_at DESC LIMIT 20')
    ]);

    const config = platformConfig.rows[0] || {};
    const totalSpend = parseFloat(globalAiSpend.rows[0]?.total_spend || '0');

    // Parse merchants by status
    const statusMap: Record<string, number> = {};
    for (const row of merchantsByStatus.rows) {
      statusMap[row.status] = parseInt(row.count, 10);
    }

    res.json({
      success: true,
      data: {
        merchants: {
          total: parseInt(merchantsTotal.rows[0]?.count || '0', 10),
          by_status: statusMap
        },
        totals: {
          chats: parseInt(totalChats.rows[0]?.count || '0', 10),
          leads: parseInt(totalLeads.rows[0]?.count || '0', 10),
          opt_ins: parseInt(totalOptIns.rows[0]?.count || '0', 10),
          add_to_cart: parseInt(totalAddToCart.rows[0]?.count || '0', 10),
          purchases: parseInt(totalPurchases.rows[0]?.count || '0', 10),
          emails_sent: parseInt(totalEmails.rows[0]?.count || '0', 10)
        },
        ai_budget: {
          total_spend_usd: totalSpend,
          monthly_budget_usd: parseFloat(config.monthly_ai_budget_usd || '15'),
          remaining_usd: parseFloat(config.monthly_ai_budget_usd || '15') - totalSpend,
          warn_threshold_usd: parseFloat(config.ai_warn_threshold_usd || '10'),
          stop_threshold_usd: parseFloat(config.ai_stop_threshold_usd || '14')
        },
        top_consumers: topConsumers.rows,
        recent_alerts: recentAlerts.rows,
        global_pause: config.global_pause || false
      }
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// MERCHANT MANAGEMENT
// =========================================================================

// List/search merchants
router.get('/merchants', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const search = req.query.search as string || '';
    const statusFilter = req.query.status as string || '';

    let query = `SELECT m.*, s.id as store_id, s.brand_name, s.shop_domain, s.status as store_status,
      a.assistant_name, a.is_active as agent_active,
      w.button_text
      FROM merchants m
      LEFT JOIN stores s ON s.merchant_id = m.id
      LEFT JOIN assistant_settings a ON a.store_id = s.id
      LEFT JOIN widget_settings w ON w.store_id = s.id
      WHERE 1=1`;
    
    const params: any[] = [];
    
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (m.name ILIKE $${params.length} OR m.contact_email ILIKE $${params.length} OR s.shop_domain ILIKE $${params.length})`;
    }
    
    if (statusFilter) {
      params.push(statusFilter);
      query += ` AND m.status = $${params.length}`;
    }
    
    query += ' ORDER BY m.created_at DESC';

    const result = await db.query(query, params);
    
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// Create merchant
router.post('/merchants', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { name, contact_email, shop_domain, brand_name } = req.body;

    if (!name || !contact_email) {
      res.status(400).json({ error: 'Missing required fields: name, contact_email' });
      return;
    }

    // Create merchant
    const merchantRes = await db.query(
      `INSERT INTO merchants (name, contact_email, status) VALUES ($1, $2, 'draft') RETURNING *`,
      [name, contact_email]
    );
    const merchant = merchantRes.rows[0];

    // Create store if shop_domain provided
    if (shop_domain) {
      const storeRes = await db.query(
        `INSERT INTO stores (merchant_id, shop_domain, brand_name, status) VALUES ($1, $2, $3, 'active') RETURNING *`,
        [merchant.id, shop_domain, brand_name || name]
      );
      const store = storeRes.rows[0];

      // Create default settings
      await db.query('INSERT INTO widget_settings (store_id) VALUES ($1)', [store.id]);
      await db.query('INSERT INTO assistant_settings (store_id) VALUES ($1)', [store.id]);
      await db.query("INSERT INTO store_policies (store_id, delivery_policy, returns_policy, faq_content) VALUES ($1, '', '', '')", [store.id]);
      await db.query('INSERT INTO email_settings (store_id) VALUES ($1)', [store.id]);
    }

    // Audit log
    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'CREATE_MERCHANT', 'merchants', null, merchant);

    res.status(201).json({ success: true, data: merchant });
  } catch (err) {
    next(err);
  }
});

// Get merchant detail (NEVER exposes raw credentials)
router.get('/merchants/:merchantId', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;

    const merchantRes = await db.query('SELECT * FROM merchants WHERE id = $1', [merchantId]);
    if (merchantRes.rows.length === 0) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }
    const merchant = merchantRes.rows[0];

    const storesRes = await db.query('SELECT id, merchant_id, shop_domain, brand_name, status, widget_key, live_tracking_enabled, created_at FROM stores WHERE merchant_id = $1', [merchantId]);
    
    // Get store details without raw credentials
    const storeDetails = [];
    for (const store of storesRes.rows) {
      const [agent, widget, policies, usage, chatCount, leadCount, emailCount] = await Promise.all([
        db.query('SELECT assistant_name, is_active, tone, support_contact FROM assistant_settings WHERE store_id = $1', [store.id]),
        db.query('SELECT button_text, position, primary_colour, secondary_colour FROM widget_settings WHERE store_id = $1', [store.id]),
        db.query('SELECT delivery_policy, returns_policy, faq_content FROM store_policies WHERE store_id = $1', [store.id]),
        db.query('SELECT COALESCE(SUM(input_tokens), 0) as total_input, COALESCE(SUM(output_tokens), 0) as total_output, COALESCE(SUM(estimated_cost_usd), 0) as total_cost FROM ai_usage_ledger WHERE store_id = $1', [store.id]),
        db.query('SELECT COUNT(*) as count FROM chat_sessions WHERE store_id = $1', [store.id]),
        db.query('SELECT COUNT(*) as count FROM visitors WHERE store_id = $1 AND email IS NOT NULL', [store.id]),
        db.query("SELECT COUNT(*) as count FROM email_campaign_events WHERE store_id = $1 AND status = 'sent'", [store.id])
      ]);

      // Check if credentials exist (boolean only, never the actual values)
      const credCheck = await db.query('SELECT id FROM store_credentials WHERE store_id = $1', [store.id]);

      storeDetails.push({
        ...store,
        agent: agent.rows[0] || null,
        widget: widget.rows[0] || null,
        policies: policies.rows[0] || null,
        has_shopify_credentials: credCheck.rows.length > 0,
        usage: usage.rows[0],
        metrics: {
          chats: parseInt(chatCount.rows[0]?.count || '0', 10),
          leads: parseInt(leadCount.rows[0]?.count || '0', 10),
          emails_sent: parseInt(emailCount.rows[0]?.count || '0', 10)
        }
      });
    }

    // Get audit log for this merchant
    const auditRes = await db.query(
      `SELECT al.*, u.email as user_email FROM audit_logs al 
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.store_id IN (SELECT id FROM stores WHERE merchant_id = $1) 
       OR (al.target_table = 'merchants' AND al.new_state::text LIKE $2)
       ORDER BY al.created_at DESC LIMIT 50`,
      [merchantId, `%${merchantId}%`]
    );

    res.json({
      success: true,
      data: {
        merchant,
        stores: storeDetails,
        audit_log: auditRes.rows
      }
    });
  } catch (err) {
    next(err);
  }
});

// Edit merchant non-secret details
router.put('/merchants/:merchantId', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;
    const { name, contact_email } = req.body;

    const oldRes = await db.query('SELECT * FROM merchants WHERE id = $1', [merchantId]);
    if (oldRes.rows.length === 0) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }

    const old = oldRes.rows[0];
    await db.query(
      'UPDATE merchants SET name = $1, contact_email = $2, updated_at = NOW() WHERE id = $3',
      [name || old.name, contact_email || old.contact_email, merchantId]
    );

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'UPDATE_MERCHANT', 'merchants', old, { name, contact_email });

    res.json({ success: true, message: 'Merchant updated' });
  } catch (err) {
    next(err);
  }
});

// Pause agent
router.post('/merchants/:merchantId/pause', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;

    // Pause all stores for this merchant
    const storesRes = await db.query('SELECT id FROM stores WHERE merchant_id = $1', [merchantId]);
    for (const store of storesRes.rows) {
      await db.query('UPDATE assistant_settings SET is_active = false WHERE store_id = $1', [store.id]);
    }
    await db.query("UPDATE merchants SET status = 'paused', updated_at = NOW() WHERE id = $1", [merchantId]);

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'PAUSE_MERCHANT', 'merchants', { merchantId }, { status: 'paused' });

    res.json({ success: true, message: 'Merchant paused' });
  } catch (err) {
    next(err);
  }
});

// Resume agent
router.post('/merchants/:merchantId/resume', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;

    const storesRes = await db.query('SELECT id FROM stores WHERE merchant_id = $1', [merchantId]);
    for (const store of storesRes.rows) {
      await db.query('UPDATE assistant_settings SET is_active = true WHERE store_id = $1', [store.id]);
    }
    await db.query("UPDATE merchants SET status = 'active', updated_at = NOW() WHERE id = $1", [merchantId]);

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'RESUME_MERCHANT', 'merchants', { merchantId }, { status: 'active' });

    res.json({ success: true, message: 'Merchant resumed' });
  } catch (err) {
    next(err);
  }
});

// Disable merchant (requires confirmation)
router.post('/merchants/:merchantId/disable', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;
    const { confirm_action } = req.body;

    if (confirm_action !== 'DISABLE') {
      res.status(400).json({ error: 'Missing or invalid confirm_action. Send { "confirm_action": "DISABLE" }' });
      return;
    }

    const storesRes = await db.query('SELECT id FROM stores WHERE merchant_id = $1', [merchantId]);
    for (const store of storesRes.rows) {
      await db.query('UPDATE assistant_settings SET is_active = false WHERE store_id = $1', [store.id]);
    }
    await db.query("UPDATE merchants SET status = 'disabled', updated_at = NOW() WHERE id = $1", [merchantId]);

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'DISABLE_MERCHANT', 'merchants', { merchantId }, { status: 'disabled' });

    res.json({ success: true, message: 'Merchant disabled' });
  } catch (err) {
    next(err);
  }
});

// Enable merchant
router.post('/merchants/:merchantId/enable', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;

    const storesRes = await db.query('SELECT id FROM stores WHERE merchant_id = $1', [merchantId]);
    for (const store of storesRes.rows) {
      await db.query('UPDATE assistant_settings SET is_active = true WHERE store_id = $1', [store.id]);
    }
    await db.query("UPDATE merchants SET status = 'active', updated_at = NOW() WHERE id = $1", [merchantId]);

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'ENABLE_MERCHANT', 'merchants', { merchantId }, { status: 'active' });

    res.json({ success: true, message: 'Merchant enabled' });
  } catch (err) {
    next(err);
  }
});

// Toggle store features (e.g. live_tracking_enabled)
router.patch('/stores/:storeId/features', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const storeId = req.params.storeId as string;
    const { live_tracking_enabled } = req.body;

    const storeRes = await db.query('SELECT id, merchant_id, brand_name, live_tracking_enabled FROM stores WHERE id = $1', [storeId]);
    if (storeRes.rows.length === 0) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const currentStore = storeRes.rows[0];
    const newTrackingState = typeof live_tracking_enabled === 'boolean'
      ? live_tracking_enabled
      : (currentStore.live_tracking_enabled === false ? true : false);

    await db.query(
      'UPDATE stores SET live_tracking_enabled = $1, updated_at = NOW() WHERE id = $2',
      [newTrackingState, storeId]
    );

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(
      req.user!.id,
      storeId,
      'TOGGLE_STORE_LIVE_TRACKING',
      'stores',
      { live_tracking_enabled: currentStore.live_tracking_enabled },
      { live_tracking_enabled: newTrackingState }
    );

    res.json({
      success: true,
      data: {
        store_id: storeId,
        live_tracking_enabled: newTrackingState,
        message: `Live tracking ${newTrackingState ? 'enabled' : 'disabled'} for store ${currentStore.brand_name}`
      }
    });
  } catch (err) {
    next(err);
  }
});

// Generate/resend onboarding invite
router.post('/merchants/:merchantId/invite', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.query(
      "UPDATE merchants SET onboarding_token = $1, onboarding_expires_at = $2, status = 'invited', updated_at = NOW() WHERE id = $3",
      [token, expiresAt.toISOString(), merchantId]
    );

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'SEND_INVITE', 'merchants', { merchantId }, { token_generated: true, expires_at: expiresAt });

    // Note: actual email sending uses fake provider mode in this phase
    res.json({
      success: true,
      message: 'Onboarding invite generated (email delivery pending Phase 10)',
      data: { onboarding_token: token, expires_at: expiresAt }
    });
  } catch (err) {
    next(err);
  }
});

// Regenerate onboarding link
router.post('/merchants/:merchantId/regenerate-invite', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;

    const newToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.query(
      'UPDATE merchants SET onboarding_token = $1, onboarding_expires_at = $2, updated_at = NOW() WHERE id = $3',
      [newToken, expiresAt.toISOString(), merchantId]
    );

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'REGENERATE_INVITE', 'merchants', { merchantId }, { new_token: true, expires_at: expiresAt });

    res.json({
      success: true,
      message: 'Onboarding link regenerated. Old link invalidated.',
      data: { onboarding_token: newToken, expires_at: expiresAt }
    });
  } catch (err) {
    next(err);
  }
});

// Delete merchant (super_admin only, requires confirmation)
router.delete('/merchants/:merchantId', requireSuperAdmin, async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;
    const { confirm_action } = req.body;

    if (confirm_action !== 'DELETE') {
      res.status(400).json({ error: 'Missing or invalid confirm_action. Send { "confirm_action": "DELETE" }' });
      return;
    }

    const merchantRes = await db.query('SELECT * FROM merchants WHERE id = $1', [merchantId]);
    if (merchantRes.rows.length === 0) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'DELETE_MERCHANT', 'merchants', merchantRes.rows[0], { deleted: true });

    // Cascade delete handled by foreign keys
    await db.query('DELETE FROM merchants WHERE id = $1', [merchantId]);

    res.json({ success: true, message: 'Merchant permanently deleted' });
  } catch (err) {
    next(err);
  }
});

// Merchant audit log
router.get('/merchants/:merchantId/audit', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { merchantId } = req.params;

    const auditRes = await db.query(
      `SELECT al.*, u.email as user_email FROM audit_logs al 
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.store_id IN (SELECT id FROM stores WHERE merchant_id = $1)
       OR (al.target_table = 'merchants')
       ORDER BY al.created_at DESC LIMIT 100`,
      [merchantId]
    );

    res.json({ success: true, data: auditRes.rows });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// PLATFORM CONTROLS (super_admin only for writes)
// =========================================================================

// Get platform config
router.get('/platform/config', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const configRes = await db.query('SELECT * FROM platform_config LIMIT 1');
    
    // ops_admin can read config, but sensitive fields are masked
    const config = configRes.rows[0] || {};
    if (req.user!.role === 'ops_admin') {
      // Mask nothing visible — ops can see budgets but cannot change them
    }

    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

// Update platform config (super_admin only)
router.put('/platform/config', requireSuperAdmin, async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const {
      monthly_ai_budget_usd,
      ai_warn_threshold_usd,
      ai_stop_threshold_usd,
      default_chat_limit_per_store,
      default_token_limit_per_store,
      default_email_recovery_enabled,
      default_email_max_recovery,
      default_email_interval_minutes,
      default_widget_position,
      default_widget_primary_colour
    } = req.body;

    const oldConfig = await db.query('SELECT * FROM platform_config LIMIT 1');
    const old = oldConfig.rows[0] || {};

    await db.query(
      `UPDATE platform_config SET 
        monthly_ai_budget_usd = $1,
        ai_warn_threshold_usd = $2,
        ai_stop_threshold_usd = $3,
        default_chat_limit_per_store = $4,
        default_token_limit_per_store = $5,
        default_email_recovery_enabled = $6,
        default_email_max_recovery = $7,
        default_email_interval_minutes = $8,
        default_widget_position = $9,
        default_widget_primary_colour = $10,
        updated_at = NOW()`,
      [
        monthly_ai_budget_usd ?? old.monthly_ai_budget_usd,
        ai_warn_threshold_usd ?? old.ai_warn_threshold_usd,
        ai_stop_threshold_usd ?? old.ai_stop_threshold_usd,
        default_chat_limit_per_store ?? old.default_chat_limit_per_store,
        default_token_limit_per_store ?? old.default_token_limit_per_store,
        default_email_recovery_enabled ?? old.default_email_recovery_enabled,
        default_email_max_recovery ?? old.default_email_max_recovery,
        default_email_interval_minutes ?? old.default_email_interval_minutes,
        default_widget_position ?? old.default_widget_position,
        default_widget_primary_colour ?? old.default_widget_primary_colour
      ]
    );

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'UPDATE_PLATFORM_CONFIG', 'platform_config', old, req.body);

    res.json({ success: true, message: 'Platform configuration updated' });
  } catch (err) {
    next(err);
  }
});

// Global pause all agents
router.post('/platform/global-pause', requireSuperAdmin, async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();

    await db.query('UPDATE platform_config SET global_pause = true, updated_at = NOW()');
    await db.query('UPDATE assistant_settings SET is_active = false');

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'GLOBAL_PAUSE', 'platform_config', null, { global_pause: true });

    res.json({ success: true, message: 'All agents paused globally' });
  } catch (err) {
    next(err);
  }
});

// Global resume all agents
router.post('/platform/global-resume', requireSuperAdmin, async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();

    await db.query('UPDATE platform_config SET global_pause = false, updated_at = NOW()');
    await db.query('UPDATE assistant_settings SET is_active = true');

    const auditRepo = new AuditRepository(db);
    await auditRepo.logAction(req.user!.id, null, 'GLOBAL_RESUME', 'platform_config', null, { global_pause: false });

    res.json({ success: true, message: 'All agents resumed globally' });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// ALERTS
// =========================================================================

// Get active alerts
router.get('/alerts', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const alertsRes = await db.query(
      'SELECT * FROM admin_alerts ORDER BY created_at DESC LIMIT 50'
    );
    res.json({ success: true, data: alertsRes.rows });
  } catch (err) {
    next(err);
  }
});

// Acknowledge alert
router.post('/alerts/:alertId/acknowledge', async (req: Request, res: Response, next) => {
  try {
    const db = getDatabaseClient();
    const { alertId } = req.params;

    await db.query(
      'UPDATE admin_alerts SET acknowledged = true, acknowledged_by = $1, acknowledged_at = NOW() WHERE id = $2',
      [req.user!.id, alertId]
    );

    res.json({ success: true, message: 'Alert acknowledged' });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// SENDER DOMAIN MANAGEMENT (ADMIN)
// =========================================================================

// List sender domains for a store
router.get('/stores/:storeId/domains', async (req: Request, res: Response, next) => {
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

// Admin verify domain check
router.post('/stores/:storeId/domains/:domainId/verify', async (req: Request, res: Response, next) => {
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

// =========================================================================
// FEATURE ENTITLEMENT MANAGEMENT (PHASE L & O)
// =========================================================================

// Get store feature entitlements
router.get('/stores/:storeId/features', async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const storeCheck = await db.query('SELECT id, brand_name, shop_domain FROM stores WHERE id = $1', [storeId]);
    if (storeCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Store not found' });
      return;
    }

    const entitlementRepo = new EntitlementRepository(db);
    const featuresMap = await entitlementRepo.getStoreEntitlements(storeId);
    const featureList = ALL_FEATURE_KEYS.map((key) => ({
      ...FEATURE_CATALOG[key],
      enabled: featuresMap[key],
    }));

    res.json({
      success: true,
      data: {
        store_id: storeId,
        store_name: storeCheck.rows[0].brand_name,
        features: featureList,
        catalog: FEATURE_CATALOG,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update single feature entitlement
router.put('/stores/:storeId/features/:featureKey', async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const featureKey = req.params.featureKey as FeatureKey;
    const { enabled } = req.body;

    if (!ALL_FEATURE_KEYS.includes(featureKey)) {
      res.status(400).json({ success: false, error: `Invalid feature key: ${featureKey}` });
      return;
    }

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ success: false, error: 'Field "enabled" must be a boolean' });
      return;
    }

    const db = getDatabaseClient();
    const storeCheck = await db.query('SELECT id FROM stores WHERE id = $1', [storeId]);
    if (storeCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Store not found' });
      return;
    }

    const entitlementRepo = new EntitlementRepository(db);
    await entitlementRepo.setFeatureEntitlement(storeId, featureKey, enabled, req.user!.id);

    res.json({
      success: true,
      data: {
        store_id: storeId,
        feature_key: featureKey,
        enabled,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Bulk update feature entitlements
router.post('/stores/:storeId/features/bulk', async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const { features, entitlements } = req.body;
    const targetFeatures = features || entitlements;

    if (!targetFeatures || typeof targetFeatures !== 'object') {
      res.status(400).json({ success: false, error: 'Field "features" or "entitlements" must be a key-value object' });
      return;
    }

    const db = getDatabaseClient();
    const storeCheck = await db.query('SELECT id FROM stores WHERE id = $1', [storeId]);
    if (storeCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Store not found' });
      return;
    }

    const entitlementRepo = new EntitlementRepository(db);
    await entitlementRepo.setBulkFeatureEntitlements(storeId, targetFeatures, req.user!.id);

    const updatedFeaturesMap = await entitlementRepo.getStoreEntitlements(storeId);
    const updatedFeaturesList = ALL_FEATURE_KEYS.map((key) => ({
      ...FEATURE_CATALOG[key],
      enabled: updatedFeaturesMap[key],
    }));

    res.json({
      success: true,
      data: {
        store_id: storeId,
        features: updatedFeaturesList,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
