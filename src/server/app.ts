import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { IDatabaseClient, getDatabaseClient } from '../database/client';
import { MerchantRepository } from '../modules/merchant/merchant.repository';
import { VisitorRepository } from '../modules/visitor/visitor.repository';
import { ChatRepository } from '../modules/chat/chat.repository';
import { EventRepository } from '../modules/events/event.repository';
import { EmailRepository } from '../modules/email/email.repository';
import { getEnvConfig } from '../config/env';
import { createStoreAuthMiddleware } from './middlewares/store-auth.middleware';
import { validateStoreOrigin } from './middlewares/cors.middleware';
import { errorHandler } from './middlewares/error.middleware';
import { ValidationError, TenantIsolationError } from '../utils/errors';
import path from 'path';
import fs from 'fs';
import { getShopifyAdapter, ShopifyProduct } from '../providers/shopify';
import { getAiProvider, BudgetGuard } from '../providers/ai';
import authRoutes from './routes/auth.routes';
import dashboardRoutes from './routes/dashboard.routes';
import adminRoutes from './routes/admin.routes';
import onboardingRoutes from './routes/onboarding.routes';
import widgetRoutes from './routes/widget.routes';
import shopifyRoutes from './routes/shopify.routes';
import resendWebhookRoutes from './routes/resend-webhook.routes';
import whatsappWebhookRoutes from './routes/whatsapp-webhook.routes';
import { reorderClickRouter } from './routes/replenishment.routes';
import { publicAttributionRouter } from './routes/attribution.routes';
import { ticketWidgetRouter } from './routes/ticket.routes';

export interface AppDependencies {
  db?: IDatabaseClient;
  merchantRepo?: MerchantRepository;
  visitorRepo?: VisitorRepository;
  chatRepo?: ChatRepository;
  eventRepo?: EventRepository;
  emailRepo?: any;
}

export function createApp(deps: AppDependencies = {}): Express {
  const app = express();
  const db = deps.db || getDatabaseClient();
  const merchantRepo = deps.merchantRepo || new MerchantRepository(db);
  const visitorRepo = deps.visitorRepo || new VisitorRepository(db);
  const chatRepo = deps.chatRepo || new ChatRepository(db);
  const eventRepo = deps.eventRepo || new EventRepository(db);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
          scriptSrcElem: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
          scriptSrcAttr: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          connectSrc: ["'self'", 'https:', 'blob:', 'wss:'],
        },
      },
    })
  );
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    }
  }));
  const publicDir = fs.existsSync(path.join(process.cwd(), 'src/public'))
    ? path.join(process.cwd(), 'src/public')
    : path.join(__dirname, '../../src/public');

  app.use(express.static(publicDir, {
    setHeaders: (res, filePath) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }));

  // Health-check endpoint
  app.get(['/health', '/api/v1/health'], async (_req: Request, res: Response) => {
    const isDbHealthy = await db.isHealthy();
    const env = getEnvConfig();
    const statusCode = isDbHealthy ? 200 : 503;
    res.status(statusCode).json({
      status: isDbHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: isDbHealthy ? 'connected' : 'disconnected',
      dependencies: {
        ai: {
          configured: Boolean((env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'mock') || env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || env.AI_PROVIDER === 'mock'),
          provider: env.AI_PROVIDER,
          active_provider: getAiProvider().constructor.name,
          has_openai_key: Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'mock'),
          has_gemini_key: Boolean(env.GEMINI_API_KEY || (process.env.GOOGLE_AI_API_KEY && process.env.GOOGLE_AI_API_KEY !== 'mock')),
        },
        email: {
          configured: Boolean(process.env.RESEND_API_KEY || env.EMAIL_API_KEY || env.EMAIL_PROVIDER_MODE === 'fake'),
          mode: env.EMAIL_PROVIDER_MODE,
        },
        whatsapp: {
          configured: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
          provider: process.env.WHATSAPP_PROVIDER_MODE || 'meta',
        },
        shopify: {
          mode: env.SHOPIFY_ADAPTER_MODE,
        },
      },
    });
  });

  // Store auth middleware for widget API
  const storeAuth = createStoreAuthMiddleware(merchantRepo);

  // Widget public configuration
  app.get(
    '/api/v1/widget/config',
    storeAuth,
    validateStoreOrigin,
    async (req: Request, res: Response, next) => {
      try {
        const store = req.store!;
        const [widgetSettings, assistantSettings] = await Promise.all([
          merchantRepo.getWidgetSettings(store.id),
          merchantRepo.getAssistantSettings(store.id),
        ]);

        // Disable browser caching so updates in dashboard reflect immediately on storefront
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        const rawPills = (assistantSettings as any)?.quick_action_pills;
        let parsedPills: any[] = [];
        if (Array.isArray(rawPills)) {
          parsedPills = rawPills;
        } else if (typeof rawPills === 'string') {
          try { parsedPills = JSON.parse(rawPills); } catch (_) { parsedPills = []; }
        }

        res.json({
          success: true,
          data: {
            store_id: store.id,
            shop_domain: store.shop_domain,
            brand_name: store.brand_name,
            widget: widgetSettings
              ? {
                  button_text: widgetSettings.button_text,
                  position: widgetSettings.position,
                  primary_colour: widgetSettings.primary_colour,
                  secondary_colour: widgetSettings.secondary_colour,
                  greeting: widgetSettings.greeting,
                  avatar_url: widgetSettings.avatar_url || '',
                  header_title: widgetSettings.header_title || '',
                  custom_css: widgetSettings.custom_css || '',
                  country_code: widgetSettings.country_code || 'IN',
                  avatar_persona: widgetSettings.avatar_persona || 'female_3d',
                  offer_code: widgetSettings.offer_code || '',
                  offer_discount_percent: Number(widgetSettings.offer_discount_percent || 0),
                  offer_text: widgetSettings.offer_text || '',
                  proactive_nudge_enabled: widgetSettings.proactive_nudge_enabled !== false,
                  proactive_nudge_interval_seconds: Number(widgetSettings.proactive_nudge_interval_seconds || 60),
                }
              : null,
            assistant: assistantSettings
              ? {
                  assistant_name: assistantSettings.assistant_name,
                  privacy_policy_url: assistantSettings.privacy_policy_url,
                  support_contact: assistantSettings.support_contact,
                  is_active: assistantSettings.is_active !== false,
                  quick_action_pills: parsedPills,
                }
              : null,
            features: {
              live_tracking_enabled: store.live_tracking_enabled !== false,
            },
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Widget test-mode session scaffolding
  app.post(
    '/api/v1/widget/session',
    storeAuth,
    validateStoreOrigin,
    async (req: Request, res: Response, next) => {
      try {
        const storeId = req.storeId!;
        const { anonymous_id } = req.body;

        if (!anonymous_id || typeof anonymous_id !== 'string') {
          throw new ValidationError('Missing required anonymous_id');
        }

        const visitor = await visitorRepo.getOrCreateVisitor(storeId, anonymous_id.trim());
        const session = await chatRepo.createSession(storeId, visitor.id);

        res.status(201).json({
          success: true,
          data: {
            store_id: storeId,
            visitor_id: visitor.id,
            session_id: session.id,
            status: session.status,
            started_at: session.started_at,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Widget visitor consent capture
  app.post(
    '/api/v1/widget/visitor/consent',
    storeAuth,
    validateStoreOrigin,
    async (req: Request, res: Response, next) => {
      try {
        const storeId = req.storeId!;
        const { visitor_id, email, phone, marketing_opted_in, wording, version, source } = req.body;

        if (!visitor_id || typeof visitor_id !== 'string') {
          throw new ValidationError('Missing required visitor_id');
        }
        if (!email || typeof email !== 'string') {
          throw new ValidationError('Missing required email');
        }

        // Update visitor contact info
        await visitorRepo.updateVisitorLead(storeId, visitor_id, email, phone);

        // Record consent
        await visitorRepo.recordMarketingConsent(
          storeId,
          visitor_id,
          !!marketing_opted_in,
          wording || 'Default consent wording',
          version || '1.0',
          source || 'widget_lead_capture'
        );

        // Record events
        await eventRepo.recordEvent(storeId, visitor_id, 'email_submitted');
        if (marketing_opted_in) {
          await eventRepo.recordEvent(storeId, visitor_id, 'marketing_opted_in');
        }

        res.json({
          success: true,
          data: {
            visitor_id,
            email,
            marketing_opted_in: !!marketing_opted_in
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Widget chat interaction
  app.post(
    '/api/v1/widget/chat/message',
    storeAuth,
    validateStoreOrigin,
    async (req: Request, res: Response, next) => {
      try {
        const storeId = req.storeId!;
        const { session_id, message } = req.body;

        if (!session_id || typeof session_id !== 'string') {
          throw new ValidationError('Missing required session_id');
        }
        if (!message || typeof message !== 'string') {
          throw new ValidationError('Missing required message');
        }

        // Fetch session to validate existence & ownership
        const session = await chatRepo.getSessionById(storeId, session_id);
        if (!session) {
          throw new TenantIsolationError(`Session ${session_id} not found or unauthorized`);
        }

        const budgetGuard = new BudgetGuard(db);
        if (await budgetGuard.isBudgetExceeded(storeId)) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'BUDGET_EXCEEDED',
              message: 'Store AI usage budget exceeded.'
            }
          });
        }

        // Save user message
        await chatRepo.addMessage(storeId, session_id, 'user', message);

        // Fetch context
        const [history, policies, settings] = await Promise.all([
          chatRepo.getSessionMessages(storeId, session_id),
          merchantRepo.getStorePolicies(storeId),
          merchantRepo.getAssistantSettings(storeId)
        ]);

        // If assistant is paused or inactive, respond gracefully instead of failing
        if (settings && settings.is_active === false) {
          const contact = settings.support_contact || 'our store support';
          const offlineContent = `Our shopping assistant is currently undergoing maintenance. Please feel free to explore our catalog or reach out to us at ${contact}!`;
          await chatRepo.addMessage(storeId, session_id, 'assistant', offlineContent, 0, 0, 0);
          return res.json({
            success: true,
            data: {
              content: offlineContent,
              recommended_products: [],
            },
          });
        }

        // Intelligent keyword and intent extraction with stop-word removal
        const stopWords = new Set([
          'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
          'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
          'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
          'each', 'few', 'for', 'from', 'further',
          'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
          'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
          'just', 'me', 'more', 'most', 'my', 'myself',
          'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
          'same', 'she', 'should', 'so', 'some', 'such',
          'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
          'under', 'until', 'up', 'very',
          'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
          'you', 'your', 'yours', 'yourself', 'yourselves',
          // Common shopping & chatter noise words
          'hi', 'hello', 'hey', 'please', 'help', 'show', 'suggest', 'recommend', 'looking', 'want', 'need', 'give', 'take', 'buy', 'product', 'products', 'item', 'items', 'good', 'best', 'seller', 'sellers', 'bestseller', 'bestsellers', 'top', 'popular', 'trending',
          // Common Hinglish stop words
          'hai', 'hain', 'ho', 'mera', 'meri', 'mere', 'kya', 'kaun', 'kaunsa', 'kaunsi', 'ko', 'ke', 'ki', 'liye', 'karo', 'kare', 'mujhe', 'hum', 'chahiye', 'batao', 'dikhaye', 'dikhao'
        ]);

        const cleanMsg = message.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
        const extractedKeywords = cleanMsg.split(/\s+/).filter(t => t.length > 2 && !stopWords.has(t));

        // Detect explicit bestsellers / popular products intent
        const isBestsellerQuery = /\b(best[\s_-]*seller|top[\s_-]*seller|bestseller|popular|trending|most[\s_-]*popular)\b/i.test(message);
        const searchKeywords = isBestsellerQuery ? extractedKeywords.filter(k => !['seller', 'sellers', 'bestseller', 'bestsellers'].includes(k)) : extractedKeywords;

        // Simple intent extraction for budget filtering
        const maxBudgetMatch = message.match(/under\s*\$?(\d+)/i);
        const budgetMax = maxBudgetMatch ? parseInt(maxBudgetMatch[1], 10) : undefined;

        // Fetch catalog subset — a catalog failure (e.g. store has not
        // connected Shopify yet) must never break the chat conversation.
        let catalogSubset: ShopifyProduct[] = [];
        try {
          const adapter = getShopifyAdapter();
          catalogSubset = await adapter.searchProducts(storeId, {
            budget_max: budgetMax,
            keywords: searchKeywords,
            bestseller_only: isBestsellerQuery,
          });
        } catch (catalogErr) {
          console.warn(`[WidgetChat] Catalog lookup failed for store ${storeId}, continuing without products:`, catalogErr);
        }

        // Query AI Provider
        const aiProvider = getAiProvider();
        const aiRes = await aiProvider.generateResponse(history, {
          storeId,
          sessionId: session_id,
          catalogSubset,
          storePolicies: policies || { delivery_policy: '', returns_policy: '', faq_content: '' },
          assistantSettings: {
            assistant_name: settings?.assistant_name || 'Assistant',
            allowed_topics: settings?.allowed_topics || [],
            custom_prompt: (settings as any)?.custom_prompt || '',
            knowledge_base: (settings as any)?.knowledge_base || '',
            support_contact: settings?.support_contact || '',
            ticket_revert_duration: (settings as any)?.ticket_revert_duration || 'within 24 hours',
            quick_action_pills: (settings as any)?.quick_action_pills || [],
          }
        });

        // Save AI message and record usage
        await chatRepo.addMessage(
          storeId, 
          session_id, 
          'assistant', 
          aiRes.content,
          aiRes.input_tokens,
          aiRes.output_tokens,
          aiRes.estimated_cost_usd
        );
        
        await budgetGuard.recordUsage(
          storeId, 
          session_id, 
          'gpt-4o-mini', // Assuming model or use env
          aiRes.input_tokens,
          aiRes.output_tokens,
          aiRes.estimated_cost_usd
        );

        // Save recommendations if any with high-precision text alignment
        let targetProductIds = aiRes.recommended_product_ids || [];
        const boldMatches = Array.from(aiRes.content.matchAll(/\*\*([^*]+)\*\*/g))
          .map(m => m[1].toLowerCase().trim())
          .filter(t => t.length > 3 && !t.includes('http') && !t.includes('key ingredient') && !t.includes('specific benefit'));

        // If the AI explicitly emphasized/recommended specific products in text, search DB if not in subset
        if (boldMatches.length > 0) {
          try {
            const db = getDatabaseClient();
            for (const bold of boldMatches) {
              const cleanWords = bold.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
              if (cleanWords.length > 0) {
                const searchClauses = cleanWords.map((_, i) => `(LOWER(title) LIKE $${i + 2} OR array_to_string(tags, ' ') ILIKE $${i + 2})`);
                const dbRes = await db.query(
                  `SELECT * FROM products WHERE store_id = $1 AND in_stock = true AND price > 0 AND (${searchClauses.join(' OR ')}) LIMIT 4`,
                  [storeId, ...cleanWords.map(w => `%${w}%`)]
                );
                for (const row of dbRes.rows) {
                  const prodId = row.shopify_id || row.id;
                  if (!catalogSubset.some(p => p.id === prodId)) {
                    catalogSubset.push({
                      id: prodId,
                      variant_id: row.variant_id || '',
                      title: row.title,
                      handle: row.handle,
                      description: row.description || '',
                      tags: row.tags || [],
                      is_bestseller: row.is_bestseller || false,
                      sales_rank: row.sales_rank || 999,
                      price: parseFloat(row.price || '0'),
                      compare_at_price: parseFloat(row.compare_at_price || '0'),
                      currency: row.currency || 'INR',
                      in_stock: row.in_stock,
                      category: row.category,
                      image_url: row.image_url,
                      product_url: row.product_url,
                    });
                  }
                }
              }
            }
          } catch (dbErr) {
            console.warn('[WidgetChat] Supplemental product lookup warning:', dbErr);
          }
        }

        // Score products against the AI's actual generated answer
        if (catalogSubset.length > 0) {
          const lowerContent = aiRes.content.toLowerCase();
          const scored = catalogSubset.map(p => {
            const fullTitle = p.title.toLowerCase();
            const shortTitle = fullTitle.split(/[:\-|–]/)[0].trim();
            const titleTokens = fullTitle.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stopWords.has(w));
            let score = 0;

            // 1. Direct bold title match (highest confidence)
            for (const bold of boldMatches) {
              if (fullTitle.includes(bold) || bold.includes(shortTitle) || shortTitle.includes(bold)) {
                score += 150;
              } else {
                const boldTokens = bold.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stopWords.has(w));
                const overlap = boldTokens.filter(bt => titleTokens.some(tt => tt.includes(bt) || bt.includes(tt)));
                if (overlap.length >= 2) {
                  score += overlap.length * 30;
                }
              }
            }

            // 2. Exact title or short title mentioned in assistant text
            if (lowerContent.includes(fullTitle)) score += 80;
            else if (shortTitle.length > 3 && lowerContent.includes(shortTitle)) score += 60;

            // 3. Token overlap with assistant text
            const textOverlap = titleTokens.filter(tt => lowerContent.includes(tt));
            score += textOverlap.length * 10;

            return { product: p, score };
          });

          const highlyRanked = scored.filter(sp => sp.score >= 40).sort((a, b) => b.score - a.score);
          if (highlyRanked.length > 0) {
            targetProductIds = highlyRanked.slice(0, 4).map(sp => sp.product.id);
          } else if (targetProductIds.length === 0 && extractedKeywords.length > 0) {
            // Fallback: match by specific user keywords
            const kwMatches = catalogSubset.filter(p => {
              const fullTitle = p.title.toLowerCase();
              return extractedKeywords.some(kw => fullTitle.includes(kw));
            });
            if (kwMatches.length > 0) {
              targetProductIds = kwMatches.slice(0, 4).map(p => p.id);
            }
          }
        }

        const recommendations = [];
        if (targetProductIds.length > 0) {
          const validProducts = catalogSubset.filter(p => targetProductIds.includes(p.id));
          for (const p of validProducts) {
            const rec = await chatRepo.addRecommendation(storeId, session_id, {
              productId: p.id,
              variantId: p.variant_id || '',
              title: p.title,
              price: p.price,
              currency: p.currency || 'INR',
              reason: 'Recommended by AI',
              imageUrl: p.image_url,
              productUrl: p.product_url,
            });
            recommendations.push({
              ...rec,
              id: rec.id,
              product_id: p.id,
              variant_id: p.variant_id || '',
              title: p.title,
              price: p.price,
              compare_at_price: p.compare_at_price || 0,
              currency: p.currency || 'INR',
              in_stock: p.in_stock ?? true,
              image_url: p.image_url || '',
              product_url: p.product_url || '',
              handle: p.handle || '',
            });
          }
        }

        // Clean conversational text so no raw markdown images/links leak into the chat bubble
        const cleanMessage = aiRes.content
          .replace(/!\[.*?\]\(.*?\)/g, '')
          .replace(/\[(?:View Product|Check out|Buy now|Product).*?\]\(.*?\)/gi, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        res.json({
          success: true,
          data: {
            message: cleanMessage,
            recommendations,
            should_escalate_ticket: Boolean(aiRes.should_escalate_ticket),
            ticket_subject: aiRes.ticket_subject,
            ticket_reason: aiRes.ticket_reason,
            ticket_revert_duration: (settings as any)?.ticket_revert_duration || 'within 24 hours',
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Widget chat history for cross-page persistence
  app.get(
    '/api/v1/widget/chat/history',
    storeAuth,
    validateStoreOrigin,
    async (req: Request, res: Response, next) => {
      try {
        const storeId = req.storeId!;
        const sessionId = req.query.session_id as string;
        if (!sessionId) {
          return res.status(400).json({ success: false, error: 'Missing session_id' });
        }
        const [messages, recs] = await Promise.all([
          chatRepo.getSessionMessages(storeId, sessionId),
          chatRepo.getSessionRecommendations(storeId, sessionId),
        ]);
        res.json({
          success: true,
          data: {
            messages,
            recommendations: recs
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Widget email unsubscribe
  app.post(
    '/api/v1/widget/visitor/unsubscribe',
    storeAuth,
    validateStoreOrigin,
    async (req: Request, res: Response, next) => {
      try {
        const storeId = req.storeId!;
        const { email } = req.body;
        
        if (!email || typeof email !== 'string') {
          throw new ValidationError('Missing required email');
        }
        
        const emailRepo = deps.emailRepo || new EmailRepository(db);
        await emailRepo.addSuppression(storeId, email, 'User unsubscribed via widget');
        
        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // Test endpoint to schedule recovery sequence
  app.post(
    '/api/v1/widget/test/schedule-email',
    storeAuth,
    validateStoreOrigin,
    async (req: Request, res: Response, next) => {
      try {
        const storeId = req.storeId!;
        const { visitor_id, session_id } = req.body;

        if (!visitor_id || !session_id) {
          throw new ValidationError('Missing visitor_id or session_id');
        }

        const emailRepo = deps.emailRepo || new EmailRepository(db);
        
        const stage1Delay = parseInt(process.env.EMAIL_STAGE_1_DELAY_MINUTES || '1', 10); // 1 min by default for test mode
        
        const scheduledFor = new Date(Date.now() + stage1Delay * 60000);

        await emailRepo.scheduleRecoveryJob(storeId, visitor_id, session_id, 1, scheduledFor);

        res.status(201).json({ success: true, scheduled_for: scheduledFor });
      } catch (err) {
        next(err);
      }
    }
  );

  // Safe global error handler
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/dashboard', dashboardRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/onboarding', onboardingRoutes);
  app.use('/api/v1/widget', widgetRoutes);
  app.use('/api/v1/widget', ticketWidgetRouter);
  app.use('/api/v1/shopify', shopifyRoutes);
  app.use('/api/v1/webhooks/resend', resendWebhookRoutes);
  app.use('/api/v1/webhooks/whatsapp', whatsappWebhookRoutes);
  app.use('/api/v1/reorder', reorderClickRouter);
  app.use('/api/v1/attribution', publicAttributionRouter);

  app.use(errorHandler);

  return app;
}
