# Development Log (DEVLOG)

## Entry 2026-09-12 - Phase 16: AI Merchant Growth Copilot & Action Center (Integration-First Implementation)
- **Date**: 2026-09-12
- **Status**: **COMPLETE & VERIFIED**
- **Objective**: Implement Phase 16 AI Merchant Growth Copilot & Action Center with an integration-first approach: audit and fix cross-module data breaks, build deterministic Growth Signal Engine, 8 opportunity detection rules, non-guaranteed conservative opportunity estimation, dynamic merchant goal alignment, actionable execution workflow with audit history, unified dashboard UI, and grounded AI explanations with zero fabricated numbers.
- **Components Implemented**:
  - Integration Audit & Pipeline Fixes:
    - `docs/PHASE_16_INTEGRATION_AUDIT.md`: Documented all 5 end-to-end data flows with classification.
    - `src/public/widget.js`: Ingested touchpoints with click IDs (`fbclid`, `gclid`, `ttclid`) via `/api/v1/attribution/touchpoint`, appended UTMs and AI IDs to Shopify cart notes.
    - `src/server/routes/widget.routes.ts`: Wired `add_to_cart` event to automatically schedule email and WhatsApp abandoned cart recovery for consented shoppers.
    - `src/modules/events/webhook.service.ts`: Added automated cancellation of pending email and WhatsApp recovery jobs upon purchase webhook completion.
  - Database Migration `migrations/023_growth_copilot.sql`:
    - Created `growth_goals`, `growth_actions`, and `growth_action_history` tables with constraints and indexes.
  - Module Layer (`src/modules/growth/`):
    - `GrowthRepository`: Scoped multi-tenant telemetry aggregation across orders, spend, ROAS, funnel conversion, abandoned carts, and reorders, plus full CRUD for goals, actions, and history.
    - `GrowthService`: Growth Signal Engine, 8 deterministic opportunity detection rules (AOV, cart checkout, low ROAS campaigns, replenishment reorders, eligible cart recovery, AI assistant conversion, storefront conversion, zero-conversion campaign stops), conservative bounded opportunity estimation, dynamic goal reprioritization, weekly summary generator, and contextual AI explanation generator grounded in real metrics.
  - Server Routes (`src/server/routes/growth.routes.ts` & `dashboard.routes.ts`):
    - Mounted at `/api/v1/dashboard/:storeId/growth/*` (`/overview`, `/actions`, `/actions/:id/status`, `/history`, `/goal`, `/weekly-summary`, `/explain`) with `enforceStoreAccess`.
  - Frontend Dashboard UI (`src/public/dashboard/`):
    - Added `🚀 Growth Copilot` sidebar item and dedicated section with Goal selector, KPI metrics grid, today's Action Center cards with 1-click execution and dismissal, weekly summary, grounded AI Copilot insights, and action audit ledger.
  - Automated Tests:
    - Created `tests/integration/phase16_growth_copilot.test.ts` with 20 dedicated integration tests (20/20 passed).
    - Full regression test run: 24 test suites, 224 tests passing (100%).
    - Zero TypeScript compilation errors; zero ESLint errors; clean production build.

---

## Entry 2026-09-12 - Phase 15: Multi-Touch Ad Intelligence & Attribution Engine
- **Date**: 2026-09-12
- **Status**: **COMPLETE & VERIFIED**
- **Objective**: Implement Multi-Touch Ad Intelligence & Attribution Engine with First-Touch, Last-Touch, and Linear Multi-Touch models, click ID capture (`fbclid`, `gclid`, `ttclid`), AI-assisted revenue attribution, merchant ad spend tracking, zero-division ROAS safety, and attribution dashboard.
- **Components Implemented**:
  - Database Migration `migrations/022_ad_intelligence_attribution_engine.sql`
  - Attribution module (`src/modules/attribution/`)
  - Integration with Shopify order webhooks and widget touchpoints
  - Dedicated test suite `tests/integration/phase15_attribution.test.ts` (20/20 passed)
  - Full platform test suite (23 test suites, 204 tests passed)

---
- **Date**: 2026-09-12
- **Status**: **COMPLETE & VERIFIED**
- **Objective**: Implement the Auto Replenishment & Reorder Engine ("Smart Reorder" / "Reorder Reminders") allowing merchants to automate post-purchase reorder nudges for consumable products across Email and WhatsApp with deterministic cadence calculations, independent marketing consent verification, repurchase cycle reset, and 1-click Shopify cart permalinks.
- **Components Implemented**:
  - Database Migration `migrations/021_auto_replenishment_reorder_engine.sql`:
    - Created `replenishment_product_settings`, `replenishment_schedules`, and `replenishment_channel_settings` tables with store cascades and indexes.
  - Module & Service Layer (`src/modules/replenishment/`):
    - `ReplenishmentRepository`: Scoped multi-tenant data access, pg-mem safe upserts, schedule state transitions, and metrics aggregation.
    - `ReplenishmentService`: Deterministic scheduling math (`order_date + consumption_days - reminder_buffer_days`), webhook order ingestion (`orders/create`), repurchase suppression & cycle reset, multi-channel dispatch (Email & WhatsApp), consent checks, and 1-click cart permalink builder.
    - `ReplenishmentWorker`: Background polling service processing due schedules periodically alongside `EmailWorker`.
  - Integrations:
    - Webhook service wired to trigger replenishment scheduling upon `orders/create`.
    - Dashboard routes mounted at `/api/v1/dashboard/:storeId/replenishment/*` with `enforceStoreAccess`.
    - Public click tracking route mounted at `/api/v1/reorder/:storeId/:scheduleId/click`.
  - Merchant Dashboard UI:
    - Added `🔄 Smart Reorder` navigation item and `#reorder-reminders` section to `src/public/dashboard/index.html` and `src/public/dashboard/js/app.js`.
    - Full analytics cards, store channel configuration, product catalog configuration, and schedules ledger.
  - Automated Tests:
    - Created `tests/integration/phase14_replenishment.test.ts` with 22 comprehensive integration tests covering all requirements.
    - Full regression test run: 22 test files, 184 tests passing (100%).
    - Zero TypeScript compilation errors; clean production build.

---

## Entry 2026-09-11 - Phase 13 Extension: Add WATI WhatsApp Provider Integration
- **Date**: 2026-09-11
- **Status**: **COMPLETE & VERIFIED**
- **Objective**: Add WATI (official WhatsApp Business Solution Provider) as a first-class WhatsApp provider alongside Meta WhatsApp Cloud API without breaking existing architecture or provider abstraction.
- **Components Implemented**:
  - Database Migration `migrations/018_wati_whatsapp_provider.sql`: Adds `provider`, `wati_api_endpoint`, and `encrypted_wati_token` columns to `whatsapp_configs` with index on `provider`.
  - Core Provider Abstraction:
    - Updated `IWhatsAppProvider` and `WhatsAppSendParams` with optional `apiEndpoint` and `channelPhoneNumber`.
    - Created `WatiWhatsAppProvider` (`src/providers/whatsapp/wati.whatsapp.provider.ts`) implementing session messages (`/api/v1/sendSessionMessage`), template messages (`/api/v1/sendTemplateMessage`), timing-safe signature validation, and normalized webhook parsing (`parseWebhook`) for customer inbound messages and delivery/read receipts.
    - Provider Factory: `getWhatsAppProvider(type)` with store-level resolution and granular test overrides (`setWhatsAppProviderForType`).
  - Security & Encryption:
    - AES-256-GCM authenticated encryption at rest for WATI Bearer tokens (`encrypted_wati_token`).
    - Plain-text secret tokens never stored in database and never exposed in REST responses (`has_wati_token: boolean`).
  - Webhook Route:
    - Added `POST /api/v1/webhooks/whatsapp/wati/:storeId` with verify token authorization, payload deduplication, and normalized ingestion into `WhatsAppService.handleIncomingMessage` and `handleStatusUpdate`.
  - Frontend Workspace:
    - Added Provider selection dropdown (`meta`, `wati`, `mock`) with dynamic toggling of credentials, 1-click webhook URL copier, and masked credential state management.
  - Automated Tests:
    - Created dedicated integration suite `tests/integration/phase13_wati_extension.test.ts` (28/28 passed).
    - Verified 0 regression on existing Meta suite `tests/integration/phase13_whatsapp.test.ts` (17/17 passed).
    - Full regression test suite: 20 test files, 153 tests passed (100% pass rate).
    - TypeScript (`npm run type-check`), ESLint (`npm run lint`), and production build (`npm run build`) all passing.

---

## Entry 2026-09-11 - Phase 13: WhatsApp Growth Engine
- **Date**: 2026-09-11
- **Status**: **COMPLETE & VERIFIED**
- **Components Built**:
  - Full WhatsApp Growth Engine with Meta WhatsApp Cloud API integration, conversational AI shopping assistant, abandoned cart recovery, order transactional notifications, consent management (`STOP`/`START`), and multi-tenant isolation.
  - Verification: 17/17 dedicated tests and 125/125 regression tests passing.

---
- **Date**: 2026-09-11
- **Verification Status**: **COMPLETE**
- **Tests**:
  - Phase 12 Dedicated Suite (`tests/integration/phase12_ad_creatives.test.ts`): 12 passed, 0 failed, 0 skipped.
  - Complete Regression Suite (18 test files): 108 passed, 0 failed, 0 skipped.
- **Build Checks**:
  - TypeScript Typecheck (`npm run type-check`): PASS (0 errors).
  - ESLint (`npm run lint`): PASS (0 errors, 48 warnings in test mocks).
  - Production Build (`npm run build`): PASS (clean dist bundle).
- **Security Checks**:
  - Store A vs Store B cross-tenant isolation verified across product catalogue, creative generation, reading saved creatives, and deletion.
  - Client-supplied `store_id` parameters in request bodies cannot override JWT authentication context.
  - AI `BudgetGuard` hard stop ($14.00) verified to block requests upon budget exhaustion.
  - Usage ledger properly logs input/output tokens and estimated USD costs.
- **Defects**: None found.
- **Final Sign-Off**: **APPROVED / COMPLETE**

---

## Entry 2026-09-11 - Phase 12: AI Ad Creative Studio
- **Status**: Completed Phase 12 implementation and verification.
- **Components Built**:
  - PostgreSQL schema migration `migrations/016_ad_creative_studio.sql` creating `ad_creatives` table with composite indexes on `(store_id, created_at DESC)` and `(store_id, product_id)`.
  - Extended AI Provider architecture (`IAiProvider`, `MockAiProvider`, `OpenAiProvider` in `src/providers/ai/`) with `generateAdCreatives()`, structured multi-angle copy variations, strict catalogue grounding, and quota fallback.
  - Multi-tenant data repository `src/modules/ad_creatives/ad_creative.repository.ts` enforcing store-level isolation for saving, fetching, and deleting ad creatives.
  - Business service layer `src/modules/ad_creatives/ad_creative.service.ts` integrating Shopify catalogue product resolution, `BudgetGuard` ($14 limit), and `ai_usage_ledger` token tracking.
  - Authenticated REST API endpoints mounted in `src/server/routes/dashboard.routes.ts`:
    - `GET /api/v1/dashboard/:storeId/ad-creatives/products`
    - `POST /api/v1/dashboard/:storeId/ad-creatives/generate`
    - `POST /api/v1/dashboard/:storeId/ad-creatives/save`
    - `GET /api/v1/dashboard/:storeId/ad-creatives/saved`
    - `DELETE /api/v1/dashboard/:storeId/ad-creatives/saved/:id`
  - Merchant Dashboard Studio UI in `src/public/dashboard/`:
    - Responsive desktop two-column & mobile stacked layout.
    - Product selector with dynamic preview card, Meta (Facebook & Instagram) platform pills, and campaign objective selection.
    - Realistic social mockup feed card with brand badge, sponsored tag, hook banner, primary text, product visual, headline, and CTA.
    - 3 variation tabs with smooth switching, 1-click individual element copying, full ad copying, saving to library, and regeneration.
    - Saved Creatives Library table with preview, copy, and deletion actions.
- **Verification Evidence**:
  - 12/12 integration tests passing in `tests/integration/phase12_ad_creatives.test.ts`.
  - Migration test updated in `tests/integration/migrations.test.ts`.
  - Full test suite: 18 test suites, 108 tests passing (0 failures).
  - Clean TypeScript compilation (`npm run type-check`), linting (`npm run lint`), and production build (`npm run build`).
  - Live HTTP verification on port 3000 verifying full Generate → Preview → Save → Retrieve → Delete lifecycle.
- **Rules Adherence**:
  - Zero browser-supplied `store_id` trust.
  - Multi-tenant isolation verified with cross-store generation and deletion blocking.
  - Purely additive changes; zero regressions to existing chat widget, Shopify cart injection, live analytics, or admin features.
  - Stopping upon Phase 12 completion as mandated.

---

## Entry 2026-09-10 - Phase 2: Live Visitor Pulse & Analytics & Merchant Dashboard Overhaul
- **Status**: Completed Phase 2 implementation and verification.
- **Components Built**:
  - PostgreSQL compound index migration `migrations/014_live_analytics_indexes.sql` on `events(store_id, created_at DESC)` and `events(store_id, type, created_at DESC)`.
  - Repository `src/modules/analytics/analytics.repository.ts`:
    - `getActiveShoppersCount(storeId, windowMinutes = 5)`: Distinct shoppers with activity inside 5-minute inactivity window.
    - `getLiveActivityFeed(storeId, limit = 30)`: Real-time event ticker with human-readable labels, icons, and badges.
    - `getConversionFunnel(storeId, days = 7)`: 5-stage conversion funnel (Store Visitors -> AI Chats Initiated -> Products Explored -> Added to Cart -> Completed Purchases) with step drop-off computation.
    - `getRecommendationPerformance(storeId, limit = 10)`: Direct attribution tracking of products suggested by the AI agent.
  - Endpoints in `src/server/routes/dashboard.routes.ts`:
    - `GET /api/v1/dashboard/:storeId/analytics/live`
    - `GET /api/v1/dashboard/:storeId/analytics/funnel`
    - `GET /api/v1/dashboard/:storeId/analytics/products`
    - Strictly protected with `enforceStoreAccess` (multi-tenant isolation).
  - Storefront Heartbeat in `src/public/widget.js`:
    - Silent 90-second heartbeat beacon keeping active visitor telemetry up-to-date while the tab is active.
  - Pixel-Perfect Merchant Dashboard UI Overhaul:
    - Integrated GSAP 3.12 + ScrollTrigger CDN for high-performance micro-animations and counter interpolations.
    - Responsive mobile drawer navigation (< 768px) with animated hamburger toggle, backdrop blur, and live shopper badge.
    - Hero Live Pulse Card featuring a pulsating radar wave indicator, live active shopper counter, and inactivity window pill.
    - Interactive 5-stage conversion funnel with animated gradient progress fills and drop-off pills.
    - Real-time live activity ticker with colored badges and relative timestamps.
    - Top recommended product attribution table.
- **Verification Evidence**:
  - Full automated integration test suite `tests/integration/phase2_analytics.test.ts` passing 3/3 tests (5-min pulse window, funnel drop-off math, strict cross-tenant isolation).
  - Complete repository test suite: 16 test suites, 91 tests passing (0 failures).
  - Live local server testing on port 3000: Verified end-to-end event submission (`page_view`, `product_click`, `add_to_cart`) instantly reflects in Store A's live feed and does not leak to Store B.
  - TypeScript compilation `npm run build` passing with 0 errors.
- **Rules Adherence**:
  - Non-breaking, purely additive changes. Storefront chat, Shopify cart injection, and existing dashboard sections continue without disruption.
  - Zero fabricated metrics.
  - Stopping upon Phase 2 completion as mandated by `ANTIGRAVITY_MEMORY.md`.

- **Status**: Completed Phase 1 build and verification.
- **Components Built**:
  - PostgreSQL schema migrations: `migrations/001_initial_schema.sql` and `migrations/002_seed_two_stores.sql`.
  - Typed database access layer (`IDatabaseClient`, `PostgresClient`, `InMemoryPostgresClient`, `Migrator`).
  - Strict multi-tenant repositories (`MerchantRepository`, `VisitorRepository`, `ChatRepository`, `EventRepository`, `EmailRepository`, `AiUsageRepository`).
  - Configuration validator with Zod schema (`src/config/env.ts`) and structured JSON logger with secret redaction (`src/utils/logger.ts`).
  - Express application foundation (`src/server/app.ts`, `src/server/server.ts`) with `/health` endpoint, `store-auth` middleware, `cors-origin` validation, and safe error handling.
  - Widget session scaffolding (`POST /api/v1/widget/session` and `GET /api/v1/widget/config`).
- **Verification Evidence**:
  - 17 automated tests passing across 4 suites (migrations, tenant isolation, health & session, configuration validation).
  - Cross-store reads and writes between Store A ("London Eco Apparel") and Store B ("Highland Peak Gear") rigorously tested and rejected.
  - TypeScript type-checking (`tsc --noEmit`), ESLint (`eslint src/ tests/`), and production build (`tsc -p tsconfig.json`) passing with zero errors.
- **Next Phase**: Phase 2 — Merchant Setup and Widget Bootstrap.

### [2026-09-09] Phase 6 Completed
- **Changes**: Documented system architecture in `SYSTEM_DESIGN.md`. Formalized error handling. Cleaned up mock data. Created test plans.
- **Next Step**: Build Phase 7 (Secure Merchant Dashboard).

### [2026-09-09] Phase 7 Completed
- **Changes**: Implemented secure merchant dashboard. Added Auth middleware, `users` and `audit_logs` tables. Applied strict `store_id` isolation checks. Built UI with Three.js interactive background, glassmorphism aesthetics, and native JS/CSS.
- **Verification**: Integration tests verified tenant isolation (merchant A cannot view merchant B's settings).
- **Next Step**: Proceed to further enhancements or deployment configurations. Widget Bootstrap.

---

## Entry 2026-09-04 - Phase 0: Repository Audit & Initial Planning
- **Status**: Completed Phase 0 audit.
- **Repository State**:
  - Found empty repository containing only `SYSTEM_DESIGN.md`.
  - Node.js runtime environment verified: Node `v24.18.0`, npm `11.16.0`.
  - No previous source code, dependencies, or git commits existed.
- **Actions Taken**:
  - Read `SYSTEM_DESIGN.md` in full as the single source of truth.
  - Formulated comprehensive technical implementation plan in `docs/IMPLEMENTATION_PLAN.md`.
  - Documented core architectural decisions in `docs/DECISIONS.md`.
  - Created sanitized `.env.example` containing variable names only, without secrets.
  - Verified no external calls or paid services were invoked.
  - Prepared repository structure for Phase 1 (Application Foundation and Multi-Tenant Database).

---

### [2026-09-10] Full-Store Auto-Tracking & Admin Feature Control
- **Changes**:
  - Added Migration 015 (`live_tracking_enabled` on `stores` table, `default_live_tracking_enabled` on `platform_config`).
  - Implemented `PATCH /api/v1/admin/stores/:storeId/features` with audit logging.
  - Updated `widget.js` to auto-initialize anonymous sessions, fire instant `page_view`, start 90s heartbeat beacons, and intercept theme cart additions (`/cart/add.js`) to emit live `add_to_cart` events.
  - Added Actionable Funnel Diagnostics & Optimization Insights card in Merchant Dashboard with tailored advice for cart abandonment, engagement, and conversion velocity.
  - Added channel source badges (`[Storefront]`, `[Shopify Order]`, `[Cart Add]`, `[Lead Capture]`, `[AI Assistant]`, `[Live Pulse]`).
  - Added one-click live tracking toggle in the Admin Portal merchant detail card.
- **Verification**: 17 of 17 test suites passing (96 tests total, 0 failures). Live HTTP verification confirmed toggle state switching and real-time activity ingestion.

---

### [2026-09-11] Phase 12 Completed — AI Ad Creative Studio
- **Changes**:
  - Added Migration 016 (`ad_creatives` table with composite indexes on `(store_id, created_at DESC)` and `(store_id, product_id)`).
  - Extended `IAiProvider` with `generateAdCreatives` grounded in catalogue inventory with strict anti-hallucination constraints and Zod schema validation.
  - Implemented `AdCreativeRepository` and `AdCreativeService` supporting variation generation, saving, retrieval, and deletion with tenant isolation.
  - Added full dashboard UI under `📢 Ad Creative Studio` with interactive platform toggles, objectives, live Facebook/Instagram mock previews, and 1-click clipboard copy.
- **Verification**: 12/12 dedicated integration tests passing; 108/108 total regression tests passing.

---

### [2026-09-11] Phase 13 Completed — WhatsApp Growth Engine
- **Changes**:
  - Added Migration 017 (`whatsapp_configs`, `whatsapp_consents`, `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_recovery_jobs`, `whatsapp_webhook_events`).
  - Implemented `IWhatsAppProvider` abstraction with `MetaWhatsAppCloudProvider` and `MockWhatsAppProvider`.
  - Implemented AES-256-GCM token encryption at rest via `src/utils/crypto.ts` with masked retrieval (`has_access_token`).
  - Added Meta Webhook Challenge verification (`GET /api/v1/webhooks/whatsapp`) and event ingestion with HMAC validation and deduplication.
  - Built two-way conversational AI assistant grounded in Shopify catalogue products and bounded by AI BudgetGuard.
  - Built consent-gated abandoned cart recovery engine with completed order suppression and idempotency guarantees.
  - Automated transactional order confirmation and delivery notifications linked to Shopify order webhooks.
  - Added WhatsApp Growth workspace in Merchant Dashboard with connection credentials, live conversation manager, test message dispatch, and consent directory.

---

### [2026-09-11] Phase 13 Hotfix — WATI Credential Storage & Frontend Error Formatter
- **Issue**:
  - When saving WATI credentials in the Merchant Dashboard, if the user entered long JWT bearer tokens into the `Webhook Secret / Verify Token` or token fields, the operation failed with a database length constraint error, which was subsequently displayed in the dashboard as `[object Object]` instead of human-readable text.
- **Root Causes**:
  - Column `webhook_verify_token` was defined as `VARCHAR(255)` in `017_whatsapp_growth_engine.sql`. Full JWT tokens copied by merchants exceeded 255 characters, triggering PostgreSQL truncation errors.
  - In `src/public/dashboard/js/app.js`, API errors returned in standard `{ success: false, error: { code, message } }` format were passed to `new Error(result.error)` which cast the object into `"[object Object]"` for `showToast`.
  - Tokens entered with leading `"Bearer "` prefix were not stripped prior to encryption and WATI API header attachment.
- **Resolution**:
  - Added Migration 019 (`019_expand_whatsapp_config_fields.sql`) altering `webhook_verify_token` and `app_secret` to `TEXT`, and `display_phone_number` to `VARCHAR(100)`, while guaranteeing all WATI columns exist idempotently.
  - Updated `017_whatsapp_growth_engine.sql` for future fresh installs.
  - Enhanced `src/public/dashboard/js/app.js` with `getErrorMessage` and safe `showToast` that never displays `[object Object]` and properly unrolls nested API error payloads.
  - Sanitized access tokens in `WhatsAppService` and `WatiWhatsAppProvider` to strip any leading `Bearer ` prefixes automatically.
  - Added operational error wrapping in `handleSaveWhatsAppConfig` and endpoint protocol validation (`http://` or `https://`).
- **Verification**:
  - Dedicated tests added in `tests/integration/phase13_wati_extension.test.ts` for long JWT bearer tokens (> 350 chars) and Bearer prefix stripping.
  - 155/155 tests passing across 20 test files. TypeScript type-check and ESLint clean. Production build compiled cleanly.

---

### [2026-09-11] Production Hotfix — RealPurchaseAdapter Implementation
- **Issue**:
  - In production (`SHOPIFY_ADAPTER_MODE=real`), instantiating `WhatsAppService` or running `email.worker.ts` threw `Real Purchase Adapter not yet implemented in Phase 5 MVP`, blocking WhatsApp configuration saves.
- **Root Cause**:
  - `src/providers/purchase/index.ts` contained a Phase 5 stub that threw an unconditional error whenever `SHOPIFY_ADAPTER_MODE === 'real'`.
- **Resolution**:
  - Implemented `RealPurchaseAdapter` (`src/providers/purchase/real.purchase.adapter.ts`) that verifies purchases against the database `events` table (`purchase_completed` events).
  - Updated `getPurchaseAdapter()` in `src/providers/purchase/index.ts` to return `RealPurchaseAdapter` when in `real` mode without throwing.
  - Wrapped `purchaseAdapter` instantiation in `WhatsAppService` constructor in a safe try-catch fallback.
  - Added unit test suite in `tests/unit/purchase_adapter.test.ts` and integration test in `tests/integration/phase13_wati_extension.test.ts`.
- **Verification**:
  - 159/159 tests passing across 21 test files. TypeScript type-check and production build clean.

---

### [2026-09-12] Phase 14 Completed — Auto Replenishment & Reorder Engine
- **Changes**:
  - Added Migration 021 (`replenishment_product_settings`, `replenishment_schedules`, `replenishment_channel_settings`).
  - Implemented `ReplenishmentRepository` and `ReplenishmentService` with deterministic cadence calculations.
  - Added Shopify `orders/create` webhook ingestion with line-item replenishment checks and automatic repurchase cancellation/reset.
  - Implemented multi-channel dispatch (Email & WhatsApp) respecting independent marketing consents.
  - Generated 1-click Shopify cart permalinks with discount codes and click tracking.
  - Added `ReplenishmentWorker` polling service and merchant dashboard UI under `🔄 Smart Reorder`.
- **Verification**: 22/22 dedicated integration tests passing; 184/184 total regression tests passing.

---

### [2026-09-12] Phase 15 Completed — Multi-Touch Ad Intelligence & Attribution Engine
- **Changes**:
  - Added Migration 022 (`marketing_touchpoints`, `ad_spend`, `order_attributions`, `order_attribution_touchpoints`).
  - Implemented `AttributionRepository` and `AttributionService` supporting First-Touch, Last-Touch, and Linear Multi-Touch models.
  - Implemented marketing parameter ingestion with automatic Click ID normalization (`fbclid`, `gclid`, `ttclid`).
  - Connected `AttributionService.processOrderAttribution` to Shopify `orders/create` webhook pipeline with direct/organic fallback.
  - Implemented 30-day lookback AI-assisted revenue identification from chat sessions and product recommendations.
  - Added merchant ad spend ledger and zero-division guarded ROAS calculations ($0.00x$ on $\le 0$ spend).
  - Built Ad Intelligence dashboard under `🎯 Ad Intelligence` with KPI cards, model switcher, channel/campaign breakdowns, journey timeline explorer, and spend management modal.
314: - **Verification**: 20/20 dedicated integration tests passing; 204/204 total regression tests passing across 23 test suites. 0 TypeScript errors, 0 ESLint errors, clean production build.
315: 
316: ---
317: 
318: ### [2026-09-12] Phase 16 Completed — AI Merchant Growth Copilot & Action Center
319: - **Changes**:
320:   - Performed integration-first audit and repaired:
321:     1. Storefront widget marketing touchpoint ingestion (`recordMarketingTouchpoint`).
322:     2. Add-to-cart abandoned cart recovery scheduling (`POST /api/v1/widget/events`).
323:     3. Shopify order webhook recovery job cancellation.
324:   - Added Migration 023 (`growth_copilot_recommendations`, `growth_copilot_actions`).
325:   - Implemented `GrowthRepository` and `GrowthService` with deterministic metric analysis across Funnel, Attribution, Abandoned Cart, Replenishment, and AI recommendations.
326:   - Built Growth Copilot dashboard under `🚀 Growth Copilot` with real action routing.
327: - **Verification**: 20/20 dedicated integration tests passing; 224/224 total platform regression tests passing across 24 suites.
328: 
329: ---
330: 
331: ### [2026-09-12] Production Readiness & Real End-to-End Connectivity Audit
332: - **Audit Scope**: Complete system audit across Frontend, Backend, Infrastructure, External Services, Security, and Configuration.
333: - **Issues Identified & Fixed**:
334:   - BUG-01 (P2): Fixed artificial UTM overwrite in `widget.js` (`syncShopifyCartAttributes`) to preserve actual marketing attribution.
335:   - BUG-02 (P2): Added `SIGTERM` and `SIGINT` graceful shutdown handlers in `server.ts` for clean connection draining during Railway redeployments.
336:   - BUG-03 (P2): Enhanced `/health` and `/api/v1/health` endpoints to report safe dependency readiness status (AI, Email, WhatsApp, Shopify) without exposing secrets.
337:   - BUG-04 (P3): Fixed webhook callback URL resolution in `live.shopify.adapter.ts` to check `BASE_URL || APP_URL`.
338:   - BUG-05 (P3): Added static public directory fallback in `app.ts` for consistent asset delivery across deployment contexts.
- **Verification**: 20/20 dedicated integration tests passing; 204/204 total regression tests passing across 23 test suites. 0 TypeScript errors, 0 ESLint errors, clean production build.

---

### [2026-09-12] Phase 16 Completed — AI Merchant Growth Copilot & Action Center
- **Changes**:
  - Performed integration-first audit and repaired:
    1. Storefront widget marketing touchpoint ingestion (`recordMarketingTouchpoint`).
    2. Add-to-cart abandoned cart recovery scheduling (`POST /api/v1/widget/events`).
    3. Shopify order webhook recovery job cancellation.
  - Added Migration 023 (`growth_copilot_recommendations`, `growth_copilot_actions`).
  - Implemented `GrowthRepository` and `GrowthService` with deterministic metric analysis across Funnel, Attribution, Abandoned Cart, Replenishment, and AI recommendations.
  - Built Growth Copilot dashboard under `🚀 Growth Copilot` with real action routing.
- **Verification**: 20/20 dedicated integration tests passing; 224/224 total platform regression tests passing across 24 suites.

---

### [2026-09-12] Production Readiness & Real End-to-End Connectivity Audit
- **Audit Scope**: Complete system audit across Frontend, Backend, Infrastructure, External Services, Security, and Configuration.
- **Issues Identified & Fixed**:
  - BUG-01 (P2): Fixed artificial UTM overwrite in `widget.js` (`syncShopifyCartAttributes`) to preserve actual marketing attribution.
  - BUG-02 (P2): Added `SIGTERM` and `SIGINT` graceful shutdown handlers in `server.ts` for clean connection draining during Railway redeployments.
  - BUG-03 (P2): Enhanced `/health` and `/api/v1/health` endpoints to report safe dependency readiness status (AI, Email, WhatsApp, Shopify) without exposing secrets.
  - BUG-04 (P3): Fixed webhook callback URL resolution in `live.shopify.adapter.ts` to check `BASE_URL || APP_URL`.
  - BUG-05 (P3): Added static public directory fallback in `app.ts` for consistent asset delivery across deployment contexts.
- **Deliverables Created**:
  - `docs/PRODUCTION_READINESS_AUDIT.md`: Comprehensive system inventory, flow audits, security verification, and bug classifications.
  - `docs/RAILWAY_VARIABLES.md`: Complete audit of platform-level environment variables categorized from A to H.
  - `docs/PRODUCTION_SMOKE_TEST.md`: 20-item manual smoke test matrix with step-by-step instructions for live Shopify store validation.
- **Verification Metrics**:
  - Automated Tests: 224/224 passing across 24 test suites.
  - TypeScript: 0 errors (`npm run type-check`).
  - ESLint: 0 errors (`npm run lint`).
  - Production Build: Successful (`npm run build`).
  - Git Hygiene: Staged zero changes; no commits or pushes made.
- **Verdict**: READY WITH BLOCKERS (Requires External Production Credentials).

---

### [2026-09-12] Phase 17 Completed — AI Intelligence Layer, Domain Analytics & Admin Feature Entitlements
- **Core Additions**:
  1. **Database Migration (`migrations/024_feature_entitlements_and_ai_cache.sql`)**:
     - Created `store_feature_entitlements` table with unique constraint on `(store_id, feature_key)`.
     - Created `ai_cache` table with composite index on `(store_id, analysis_type)` for fast cached intelligence retrieval.
     - Seeded all canonical 13 features enabled by default for existing stores A and B.
  2. **Feature Entitlements Engine (`src/modules/entitlements/`)**:
     - `entitlement.types.ts`: 13 canonical features (`overview`, `live_pulse`, `funnel`, `catalogue`, `leads`, `email_automation`, `whatsapp`, `smart_reorder`, `ad_intelligence`, `ad_creative`, `growth_copilot`, `ai_store_analysis`, `ai_assistant`) with names, descriptions, categories, and defaults.
     - `entitlement.repository.ts`: Full store entitlement query, single toggle, bulk update, lazy auto-provisioning, and audit logging (`UPDATE_FEATURE_ENTITLEMENT`).
     - `entitlement.middleware.ts`: Route guard `enforceFeature(featureKey)` enforcing 403 Forbidden with actionable error messages when disabled.
     - `admin.routes.ts`: Added admin endpoints `GET/PUT/POST /api/v1/admin/stores/:storeId/features/*` and updated Admin UI with live toggle switches.
  3. **AI Intelligence Layer (`src/modules/ai/`)**:
     - `ai-types.ts`: Zod schemas for 10 domain intelligence operations.
     - `ai-cache.service.ts`: PostgreSQL `ai_cache` caching with automatic TTL (1–2h) and SHA-256 data hash invalidation.
     - `ai-context.service.ts`: Assembles bounded, compact store context from catalog, visitors, funnel, email, replenishment, and attribution strictly scoped by `store_id`.
     - `ai-orchestrator.service.ts`: Budget-guarded structured JSON and text generation with token tracking in `ai_usage_ledger`.
     - `ai-analysis.service.ts`: Implemented 10 domain intelligence methods (Store Deep Audit, Overview Insights, Catalogue Audit, Product Listing Improvements, Funnel Drop-Off, Funnel Q&A, Email Generator, Reorder AI Recommendations, Ad Attribution Audit, Ad Attribution Q&A, and Growth Copilot Q&A).
     - `ai.routes.ts`: Mounted all endpoints at `/api/v1/dashboard/:storeId/ai/*` guarded by `enforceFeature`.
  4. **Frontend Dashboard UI Enhancements (`src/public/dashboard/`)**:
     - Overview: AI Store Insights card with What, Why, Next Actions, and "Deep Store Audit" modal.
     - Catalogue: AI Listing Quality Audit banner & "Improve with AI" modal for individual products.
     - Live Pulse & Funnel: Funnel AI Deep-Dive and interactive Ask AI Q&A box.
     - Email Automation: "Create Email with AI" studio card and draft generator modal.
     - Smart Reorder: AI Consumable Recommendations button and Reorder Product Settings modal.
     - Ad Intelligence: AI Ad Performance Audit & Ask AI box.
     - Client-side feature entitlement fetching and graceful navigation hiding when features are disabled.
- **Verification Metrics**:
  - Automated Integration Tests:
    * `tests/integration/phase17_feature_entitlements.test.ts`: 8/8 passing.
    * `tests/integration/phase17_ai_intelligence.test.ts`: 13/13 passing.
  - Full Platform Regression: 26/26 test suites passing (245/245 tests passing).
  - TypeScript: 0 errors (`npm run type-check`).
  - ESLint: 0 errors (`npm run lint`).
  - Production Build: Successful (`npm run build`).
  - Git Hygiene: Zero commits or pushes.
