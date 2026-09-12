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
import { getShopifyAdapter } from '../providers/shopify';
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
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
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
          configured: Boolean(process.env.OPENAI_API_KEY || env.AI_PROVIDER === 'mock'),
          provider: env.AI_PROVIDER,
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
                }
              : null,
            assistant: assistantSettings
              ? {
                  assistant_name: assistantSettings.assistant_name,
                  privacy_policy_url: assistantSettings.privacy_policy_url,
                  support_contact: assistantSettings.support_contact,
                  is_active: assistantSettings.is_active,
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

        // Simple intent extraction (mock implementation) for budget filtering
        const maxBudgetMatch = message.match(/under\s*\$?(\d+)/i);
        const budgetMax = maxBudgetMatch ? parseInt(maxBudgetMatch[1], 10) : undefined;

        // Fetch catalog subset
        const adapter = getShopifyAdapter();
        const catalogSubset = await adapter.searchProducts(storeId, {
          budget_max: budgetMax,
          keywords: message.split(' '),
        });

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

        // Save recommendations if any
        let targetProductIds = aiRes.recommended_product_ids || [];
        if (targetProductIds.length === 0 && catalogSubset.length > 0) {
          const lowerContent = aiRes.content.toLowerCase();
          const lowerMsg = message.toLowerCase();
          const matched = catalogSubset.filter(p => 
            lowerContent.includes(p.title.toLowerCase()) || 
            (p.handle && lowerContent.includes(p.handle.toLowerCase())) ||
            lowerMsg.includes(p.title.toLowerCase()) ||
            (p.category && lowerMsg.includes(p.category.toLowerCase()))
          );
          if (matched.length > 0) {
            targetProductIds = matched.slice(0, 4).map(p => p.id);
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
            recommendations
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
  app.use('/api/v1/shopify', shopifyRoutes);
  app.use('/api/v1/webhooks/resend', resendWebhookRoutes);
  app.use('/api/v1/webhooks/whatsapp', whatsappWebhookRoutes);
  app.use('/api/v1/reorder', reorderClickRouter);
  app.use('/api/v1/attribution', publicAttributionRouter);

  app.use(errorHandler);

  return app;
}
