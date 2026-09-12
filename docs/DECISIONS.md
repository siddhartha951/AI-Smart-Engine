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



