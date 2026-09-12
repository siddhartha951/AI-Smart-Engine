# Architecture Decision Records (ADR)

## ADR-001: Multi-Tenant PostgreSQL Schema with Mandatory `store_id`
- **Context**: The application serves multiple independent UK Shopify merchants on a shared infrastructure hosted on Railway.
- **Decision**: All merchant-related tables (`stores`, `widget_settings`, `assistant_settings`, `store_policies`, `visitors`, `marketing_consents`, `chat_sessions`, `chat_messages`, `events`, `recommendations`, `email_jobs`, `suppression_list`, `ai_usage_ledger`) MUST contain a `store_id` foreign key referencing `stores(id)`.
- **Enforcement**: All database queries, repository methods, and controllers MUST scope by `store_id`. Automated tests must explicitly attempt cross-tenant reads/writes and prove they fail.
- **Consequences**: Eliminates data leakage risk between merchants while keeping infrastructure costs minimal ($10 Railway target).

---

## ADR-002: Infrastructure Topology & Scope Locking (Railway + PostgreSQL + Worker)
- **Context**: A tight $25/month platform test budget requires disciplined infrastructure choices.
- **Decision**: Deploy only on Railway using:
  1. One Web/API Node.js service.
  2. One PostgreSQL managed database.
  3. One scheduled worker process (polling or cron).
- **Exclusions**: Do NOT introduce Redis, Celery, Supabase, Vercel, ElevenLabs, Twilio SMS, or a Shopify App Store app in Phase 1.
- **Consequences**: Zero cloud complexity, easy local reproducibility, and zero extra third-party service bills.

---

## ADR-003: Client Widget Isolation via Shadow DOM
- **Context**: The shopping assistant widget is embedded directly into merchant Shopify themes. Merchants use diverse themes with unpredictable global CSS rules.
- **Decision**: Wrap the entire floating assistant button, popup chat interface, and product cards inside an open `ShadowRoot`.
- **Consequences**: Guarantees pixel-perfect styling regardless of the merchant's active theme, resets CSS resets, and prevents widget styles from leaking into the merchant's storefront.

---

## ADR-004: AI Provider Interface and Strict $14 Monthly Budget Guard
- **Context**: LLM API calls incur variable costs. Runaway traffic or automated loops could quickly exhaust prepaid test credits.
- **Decision**:
  1. Abstract AI communication behind `IAiProvider`.
  2. Provide `MockAiProvider` for unit, integration, and E2E automated tests (zero OpenAI cost).
  3. Provide `OpenAiProvider` for real testing.
  4. Track all input and output tokens in `ai_usage_ledger` with estimated USD cost.
  5. Enforce an application-level guard: log a warning when monthly spend reaches $10.00, and immediately reject new AI conversation requests when monthly spend reaches $14.00.
  6. Filter product catalogues in deterministic application code BEFORE calling AI: send only the 3–5 most relevant products into the prompt context. The AI is strictly instructed not to hallucinate prices, inventory, or policies.
- **Consequences**: Guarantees the monthly OpenAI test budget ($15 credit) is never exceeded.

---

## ADR-005: Shopify Adapter Abstraction & Safe Cart Additions
- **Context**: Shopify store integration must be reliable in tests and safe in production. Shopify admin credentials must never touch browser code.
- **Decision**:
  1. Abstract catalog search behind `IShopifyCatalogAdapter`.
  2. Implement `FakeShopifyAdapter` with distinct product datasets for Store A and Store B for all automated testing and local demos.
  3. Implement `RealShopifyAdapter` using server-side encrypted credentials only.
  4. Client-side Add to Cart uses standard Shopify Ajax Cart API (`POST /cart/add.js`) with an immediate fallback to direct product detail URLs (`/products/:handle?variant=:variant_id`) if theme cart drawers or scripts intercept the call.
- **Consequences**: Robust testability without live Shopify dependencies; seamless compatibility across varied themes.

---

## ADR-006: UK Privacy & Marketing Consent Enforcement
- **Context**: UK PECR / GDPR regulations require unambiguous, freely given, specific opt-in for marketing emails.
- **Decision**:
  1. Email capture is required to start the shopping assistant, but marketing consent is a separate, explicitly unchecked checkbox.
  2. Visitors can use the full conversational shopping assistant even if they decline marketing consent.
  3. If consent is not opted-in, the recovery email worker strictly refuses to enqueue or dispatch recovery emails.
  4. Consent metadata is stored with full audit trail: `store_id`, `visitor_id`, `opted_in`, `version`, `wording`, `source`, `captured_at`.
  5. All email flows check the `suppression_list` and check for any `purchase_completed` events after the session before sending.
  6. Every email includes a signed one-click unsubscribe link.
- **Consequences**: Full legal compliance and protection against spam complaints.

---

## ADR-007: Database Abstraction (`IDatabaseClient`) for Dual-Mode Execution
- **Context**: Local test runs need to be instant, reproducible, and zero-dependency across any developer machine without requiring a running Docker daemon or local Postgres server, while production on Railway requires standard PostgreSQL pool connection.
- **Decision**: Define `IDatabaseClient` interface with two implementations:
  1. `PostgresClient`: uses `pg.Pool` connecting via `DATABASE_URL` (for Railway production and live Postgres instances).
  2. `InMemoryPostgresClient`: uses `pg-mem` to execute the exact identical SQL DDL migration files (`001_initial_schema.sql` and `002_seed_two_stores.sql`) in memory.
- **Consequences**: All automated tests run on the exact same schema, foreign keys, and indexes in < 5 seconds with zero external database dependencies. Zero risk of environment drift.

---

## ADR-008: WhatsApp Growth Engine Architecture & Dual-Provider Abstraction (Meta Cloud API & WATI BSP)
- **Context**: Merchants require multi-channel conversational capabilities on WhatsApp for shopping assistance, abandoned cart recovery, and order notifications. Different merchants use direct Meta WhatsApp Cloud API credentials or WhatsApp Business Solution Providers (BSPs) such as WATI.
- **Decision**:
  1. Maintain a clean provider abstraction layer via `IWhatsAppProvider` (`sendMessage`, `verifyWebhookChallenge`, `validateSignature`, `parseWebhook`).
  2. Support Meta WhatsApp Cloud API (`MetaWhatsAppCloudProvider`), official WATI WhatsApp BSP (`WatiWhatsAppProvider`), and mock testing (`MockWhatsAppProvider`).
  3. Store-level selection: Each merchant configures their chosen provider (`provider: 'meta' | 'wati' | 'mock'`) independently without cross-tenant interference.
  4. Credential Security: All permanent access tokens and WATI Bearer tokens are encrypted at rest with AES-256-GCM. Secret tokens are never exposed in GET responses (using `has_access_token` / `has_wati_token` booleans).
  5. Normalized Ingestion: Meta webhooks ingest at `/api/v1/webhooks/whatsapp`, while WATI webhooks ingest at store-scoped endpoints `/api/v1/webhooks/whatsapp/wati/:storeId` with verify token authorization. Both normalize payloads into unified `WhatsAppWebhookEvent` structures.
  6. Compliance & Opt-out: Strict UK GDPR/PECR compliance. Automatic opt-out on `STOP`/`UNSUBSCRIBE`, reactivation on `START`, and pre-send suppression if purchase already completed.
- **Consequences**: Complete flexibility for merchants to integrate directly via Meta or via WATI BSP, zero provider lock-in, zero cross-tenant contamination, and robust testability.

---

## ADR-009: Auto Replenishment & Reorder Reminders Architecture
- **Context**: Consumable and replenishable products (e.g. coffee, cosmetics, supplements, apparel) experience natural usage depletion cycles. Merchants lose repeat revenue if reorder nudges are not sent, but building a full recurring subscription / payment vaulting platform introduces massive regulatory and PCI/ReCharge-level scope creep.
- **Decision**:
  1. Position strictly as "Reorder Reminders" / "Smart Reorder" — NOT a subscription billing system or ReCharge replacement. No recurring credit card tokenization or unauthorized billing.
  2. Ground schedule calculations in deterministic math: `scheduled_at = order_date + consumption_days - reminder_buffer_days`. LLMs are strictly forbidden from calculating dates, cadences, eligibility, or prices.
  3. Strict multi-tenant isolation: All product settings, schedules, channel configurations, and analytics are keyed by `store_id`.
  4. Multi-Channel dispatch with independent consent: Email dispatches check `marketing_consents.opted_in` and `suppression_list`; WhatsApp dispatches check `whatsapp_consents.opted_in`. Opting out of one does not affect the other.
  5. Repurchase cycle reset: When an order webhook arrives, any pending/scheduled reminder for the same customer and product is cancelled with `cancel_reason = 'repurchased'`, and a new schedule is created. If already sent, it is attributed as converted.
  6. 1-click Shopify cart permalinks: Generated via `/cart/{variant_id}:{qty}?discount={discount_code}` with click tracking via `/api/v1/reorder/:storeId/:scheduleId/click`.
- **Consequences**: Safe, compliant, merchant-controlled repeat revenue automation without subscription complexity.

---

## ADR-010: Multi-Touch Ad Intelligence & Attribution Architecture
- **Context**: Merchants run multi-channel advertising (Meta, Google, TikTok, email) and need to understand customer conversion journeys, calculate true ROAS, and measure the revenue impact of on-site AI assistance. However, relying on external ad platform black-box attribution or generative AI for financial math introduces hallucinations, bias, and compliance risks.
- **Decision**:
  1. 100% Deterministic Attribution: All revenue attribution calculations, touchpoint weightings, and ROAS calculations are strictly deterministic SQL and code formulas. LLMs are never used for financial calculations or attribution rules.
  2. Multi-Model Support: Store and calculate First-Touch (100% credit to initial touchpoint), Last-Touch (100% credit to final pre-order touchpoint), and Linear Multi-Touch ($1/N$ credit split evenly across all $N$ journey touchpoints).
  3. Click ID Normalization: Ingest `fbclid`, `gclid`, and `ttclid` query parameters and automatically resolve to standard channel/medium defaults (`facebook`/`paid_social`, `google`/`cpc`, `tiktok`/`paid_social`) when explicit UTMs are absent.
  4. AI-Assisted Revenue Tracking: Identify orders influenced by AI shopping assistants or recommendations within a 30-day lookback window prior to order placement.
  5. Merchant-Controlled Ad Spend: Maintain an ad spend ledger table partitioned by `store_id`, channel, campaign, and date ranges without requiring high-friction external OAuth integrations.
  6. Zero-Division ROAS Safety: Guard all ROAS computations ($ROAS = \frac{Revenue}{Spend}$) such that zero or negative spend cleanly yields $0.00x$ rather than `Infinity` or `NaN`.
  7. Strict Tenant Isolation: All touchpoint ingestion, spend records, attribution summaries, and journey timelines strictly enforce `store_id` isolation.
- **Consequences**: Merchants gain transparent, reliable multi-touch ad intelligence and AI impact visibility with zero external platform dependencies or division-by-zero errors.

---

## ADR-011: AI Merchant Growth Copilot & Action Center Architecture
- **Context**: Merchants have multiple advanced modules (AI Agent, Ad Creative Studio, WhatsApp Engine, Smart Reorder, Multi-Touch Attribution) but lack a unified intelligence layer to synthesize cross-module signals into prioritized, high-leverage merchant actions. Furthermore, some data flows (e.g. storefront UTM capture, cart recovery triggering, order cancellation) were disconnected end-to-end.
- **Decision**:
  1. Integration-First Mandate: Audited and repaired real cross-module data pipelines before building new abstractions:
     - Storefront widget captures UTMs and click IDs (`fbclid`, `gclid`, `ttclid`), sends them to `/api/v1/attribution/touchpoint`, and attaches them to Shopify cart note attributes via `/cart/update.js`.
     - Storefront `add_to_cart` events trigger automated abandoned cart recovery scheduling in email and WhatsApp modules subject to visitor consent.
     - Shopify order webhooks immediately cancel pending abandoned cart recovery jobs (`purchased`).
  2. Deterministic Growth Signal Engine: All telemetry aggregation across orders, spend, ROAS, funnel conversion, abandoned carts, and reorders is computed with strict deterministic SQL aggregations. Generative AI is strictly forbidden from computing metrics.
  3. Rule-Based Opportunity Detection: Implemented 8 deterministic opportunity detection rules (AOV, cart abandonment, low ROAS campaigns, due replenishment, eligible cart recovery, AI assistant lift, storefront conversion, zero-conversion campaign stops).
  4. Dynamic Goal Alignment: Merchants can select their primary growth goal (`increase_revenue`, `improve_roas`, `improve_conversion`, `boost_reorders`, `reduce_abandonment`). Opportunities dynamically adjust their priority scores based on alignment with the active goal.
  5. Action Center Execution & Audit Trail: Created `growth_actions` and `growth_action_history` tables to track status transitions (`pending`, `in_progress`, `completed`, `dismissed`) with user ID attribution and audit notes.
  6. Zero Fabricated Metrics: Opportunity estimates use documented conservative formulas and prominently disclaim revenue guarantees. The AI explanation endpoint (`/explain`) is strictly grounded in verified database numbers.
- **Consequences**: Closed-loop platform integration, deterministic business logic, safe AI co-piloting, and an actionable merchant workflow with zero revenue fabrication.

---

## ADR-012: AI Intelligence Layer, Domain Analytics & Admin Feature Entitlements Architecture
- **Context**: The platform contained rich telemetry across catalog, live visitor radar, email automation, replenishment reorders, ad attribution, and growth copilot, but lacked:
  1. A unified AI Intelligence Layer providing grounded, actionable merchant insights across every dashboard tab.
  2. Granular Admin Feature Entitlements allowing platform administrators to control, enable, or disable individual features on a per-store basis with full auditability.
  3. AI response caching and budget guards protecting against redundant LLM token consumption.
- **Decision**:
  1. **Canonical 13-Feature Catalog**: Defined canonical feature keys (`overview`, `live_pulse`, `funnel`, `catalogue`, `leads`, `email_automation`, `whatsapp`, `smart_reorder`, `ad_intelligence`, `ad_creative`, `growth_copilot`, `ai_store_analysis`, `ai_assistant`) with granular metadata and default enablement states.
  2. **Multi-Tenant Feature Entitlement Isolation**: Persisted in `store_feature_entitlements` table keyed by `(store_id, feature_key)` with index on `store_id`. Enforced via `enforceFeature(key)` middleware across all dashboard and AI routes, returning HTTP 403 Forbidden if disabled.
  3. **Platform Admin Entitlement Controls**: Admin endpoints (`GET/PUT/POST /api/v1/admin/stores/:storeId/features/*`) allow individual and bulk feature toggling with audit logging in `audit_logs` table (`UPDATE_FEATURE_ENTITLEMENT`). Admin frontend renders live toggle switches in merchant details.
  4. **Scoped Context Assembly (`AiContextService`)**: Gathers bounded store context (catalog summary, policies, visitor counts, funnel metrics, attribution revenue, ad spend) strictly scoped by `store_id` without exposing tokens or credentials.
  5. **Structured Output & Schema Enforcement**: All AI domain operations are governed by Zod schemas and validated before returning to clients (`StoreAnalysisSchema`, `OverviewInsightsSchema`, `CatalogueAnalysisSchema`, `ProductSuggestionsSchema`, `FunnelAnalysisSchema`, `FunnelAskSchema`, `EmailGenerationResultSchema`, `ReorderRecommendationsListSchema`, `AdAnalysisSchema`, `AdAskSchema`, `CopilotAskSchema`).
  6. **Multi-Tenant Database Caching (`ai_cache`)**: Caches heavy AI analysis in PostgreSQL with SHA-256 data hashing and TTL expiration (1–2 hours). Supports manual merchant cache refresh (`forceRefresh = true`).
  7. **Strict Anti-Fabrication Safeguards**: Where real data is absent or sparse (e.g. ad spend), clean connect/empty states are returned without hallucinating ad impressions, clicks, or revenue.
- **Consequences**: Fine-grained merchant feature access control, sub-second cached AI analytics responses, 0 token waste, and complete multi-tenant isolation across all 13 core modules.
