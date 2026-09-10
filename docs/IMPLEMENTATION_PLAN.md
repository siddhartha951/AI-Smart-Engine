# Implementation Plan: AI Shopping Assistant for Shopify Stores (Phase 1 MVP)

## 1. Existing Repository Audit & Baseline
- **Current Stack**: Node.js `v24.18.0`, npm `11.16.0`, Windows OS.
- **Source Tree Audit**: Found empty repository containing only `SYSTEM_DESIGN.md`. No pre-existing application code, configurations, or secrets exist.
- **Existing Scripts**: No `package.json` exists yet. Running `npm test`, `npm run lint`, `npm run type-check`, or `npm run build` is not possible at baseline.
- **Functionality to Preserve**: `SYSTEM_DESIGN.md` is the locked source of truth.
- **Scope Safeguard**: No external APIs called, no credentials added, and no dependencies installed during Phase 0.

---

## 2. Overview & Objective
Build a production-minded, multi-tenant AI shopping-assistant MVP for manually integrated Shopify stores.
Hosted on Railway with PostgreSQL, OpenAI API, lightweight embeddable Shadow DOM widget, and a scheduled email recovery worker.
Strict tenant isolation via `store_id` on all merchant data tables and queries. Initial QA performed with two distinct mock stores (Store A and Store B) to prove tenant separation.

---

## 3. Core Architectural & Technology Decisions

- **Runtime & Language**: Node.js (v20+) with TypeScript end-to-end (`strict: true`).
- **Web API Service**: Fastify or Express in TypeScript. Clean layered architecture (Routes -> Controllers -> Services -> Repositories -> Adapters).
- **Database & Migrations**: PostgreSQL with raw SQL migrations or Drizzle ORM schema migrations for typed, robust query construction and strict foreign-key integrity.
- **Widget Layer**: Vanilla TypeScript or Preact bundled into a single lightweight `widget.js` (< 40 KB uncompressed) using Vite / esbuild / tsup. Styles isolated inside a **Shadow DOM** to prevent Shopify theme CSS bleed.
- **AI Recommendation Engine**:
  - `IAiProvider` interface supporting `MockAiProvider` (local deterministic test mode) and `OpenAiProvider` (production/real test mode).
  - Code-level product filtering: only top relevant products (3–5) passed in prompt context, never the entire catalogue.
  - Usage tracker recording token usage and cost in `ai_usage_ledger`.
  - Application budget guard enforcing a **$10 warning** and a hard stop at **$14/month** total platform AI spend.
- **Shopify Adapter Layer**:
  - `IShopifyCatalogAdapter` interface supporting `FakeShopifyAdapter` (test stores A and B) and `RealShopifyAdapter` (server-side Storefront/Admin API queries).
  - Admin credentials never sent to the browser.
  - Cart actions use safe standard Shopify Cart API (`/cart/add.js`) with immediate product-link fallback.
- **Lead Capture & Consent (UK Privacy Compliance)**:
  - Email required to proceed with conversational shopping assistant.
  - Phone is optional.
  - Marketing consent is an explicit, separate, unchecked checkbox.
  - Persist consent record: `opted_in`, `version`, `wording`, `captured_at`, `source`, `visitor_id`, `store_id`.
  - In absence of marketing opt-in, visitor still receives full chat assistance, but recovery emails are strictly blocked.
- **Recovery Email Worker**:
  - Scheduled worker polling an `email_jobs` table.
  - `IEmailProvider` interface with `FakeEmailProvider` (recording sent messages to database/log) and `ResendProvider`.
  - Strict pre-send validation:
    1. Marketing consent is true.
    2. Email not in suppression list.
    3. No completed purchase after the session.
    4. Frequency limit respected (max 3 emails: Day 0 summary, Day 3 reminder, Day 7 follow-up).
    5. Store is active.
- **Hosting & Infrastructure**:
  - Platform: Railway.
  - Topology: 1 Web/API Service, 1 PostgreSQL Database, 1 Scheduled Worker.
  - No out-of-scope services (no Redis, no Supabase, no Vercel, no ElevenLabs, no SMS).

---

## 3. Directory & File Structure Plan

```text
AI_SMART_ENGINE/
├── .env.example                     # Environment template (names only, no secrets)
├── .gitignore                       # Standard Node/TypeScript gitignore
├── package.json                     # Root project configuration & scripts
├── tsconfig.json                    # Base TypeScript compiler configuration
├── tsconfig.server.json             # Server-specific TypeScript configuration
├── tsconfig.widget.json             # Widget-specific TypeScript configuration
├── railway.json                     # Railway deployment configuration
├── Procfile                         # Railway process definitions (web & worker)
├── docs/
│   ├── IMPLEMENTATION_PLAN.md       # This file
│   ├── DECISIONS.md                 # Architecture decision records
│   ├── DEVLOG.md                    # Development log & audit trail
│   ├── PHASE_0_VERIFICATION.md      # Repository audit report
│   ├── PHASE_1_VERIFICATION.md      # Application foundation verification
│   ├── PHASE_2_VERIFICATION.md      # Merchant setup & widget bootstrap verification
│   ├── PHASE_3_VERIFICATION.md      # Widget UI & consent verification
│   ├── PHASE_4_VERIFICATION.md      # Shopify adapter & AI recommendations verification
│   ├── PHASE_5_VERIFICATION.md      # Event tracking & email recovery verification
│   ├── PHASE_6_VERIFICATION.md      # Deployment readiness & final verification
│   └── QA_REPORT.md                 # Full acceptance criteria verification report
├── migrations/
│   ├── 001_initial_schema.sql       # Multi-tenant tables with foreign keys and store_id indexes
│   └── 002_seed_two_stores.sql      # Seed data for Store A and Store B
├── src/
│   ├── config/                      # Environment schema validation (Zod) and constants
│   │   ├── env.ts
│   │   └── constants.ts
│   ├── database/                    # Connection pool, query helpers, migration runner
│   │   ├── client.ts
│   │   ├── migrator.ts
│   │   └── seed.ts
│   ├── modules/
│   │   ├── merchant/                # Merchant onboarding, store profile, credentials
│   │   │   ├── merchant.repository.ts
│   │   │   ├── merchant.service.ts
│   │   │   └── merchant.controller.ts
│   │   ├── widget/                  # Public widget configuration & snippet generation
│   │   │   ├── widget.repository.ts
│   │   │   ├── widget.service.ts
│   │   │   └── widget.controller.ts
│   │   ├── visitor/                 # Visitor session & consent management
│   │   │   ├── visitor.repository.ts
│   │   │   ├── visitor.service.ts
│   │   │   └── visitor.controller.ts
│   │   ├── chat/                    # Conversational engine & message orchestration
│   │   │   ├── chat.repository.ts
│   │   │   ├── chat.service.ts
│   │   │   └── chat.controller.ts
│   │   ├── catalog/                 # Product filtering & recommendation logic
│   │   │   ├── catalog.types.ts
│   │   │   ├── catalog.filter.ts
│   │   │   └── catalog.service.ts
│   │   ├── events/                  # Tracking events (recommendations, cart, purchase)
│   │   │   ├── event.repository.ts
│   │   │   └── event.service.ts
│   │   └── email/                   # Recovery emails, suppression list, job processor
│   │       ├── email.repository.ts
│   │       ├── email.service.ts
│   │       └── email.worker.ts
│   ├── providers/
│   │   ├── ai/                      # IAiProvider interface + Mock & OpenAI implementations
│   │   │   ├── ai.interface.ts
│   │   │   ├── mock.ai.provider.ts
│   │   │   ├── openai.provider.ts
│   │   │   └── budget.guard.ts
│   │   ├── shopify/                 # IShopifyCatalogAdapter interface + Fake & Real adapters
│   │   │   ├── shopify.interface.ts
│   │   │   ├── fake.shopify.adapter.ts
│   │   │   └── real.shopify.adapter.ts
│   │   ├── email/                   # IEmailProvider interface + Fake & Resend adapters
│   │   │   ├── email.interface.ts
│   │   │   ├── fake.email.provider.ts
│   │   │   └── resend.email.provider.ts
│   │   └── purchase/                # IPurchaseAdapter interface + Webhook/Order sync
│   │       ├── purchase.interface.ts
│   │       └── test.purchase.adapter.ts
│   ├── server/                      # HTTP server initialization, middleware, routes
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── middlewares/
│   │   │   ├── cors.middleware.ts
│   │   │   ├── rate-limit.middleware.ts
│   │   │   ├── store-auth.middleware.ts
│   │   │   └── error.middleware.ts
│   │   └── routes.ts
│   └── worker.ts                    # Standalone entrypoint for scheduled email worker
├── widget/                          # Embeddable client-side widget source
│   ├── src/
│   │   ├── loader.ts                # Ultra-lightweight loader (<5KB)
│   │   ├── widget.ts                # Shadow DOM host & UI manager
│   │   ├── components/              # Chat window, product cards, consent checkbox
│   │   │   ├── button.ts
│   │   │   ├── chat-window.ts
│   │   │   ├── lead-form.ts
│   │   │   └── product-card.ts
│   │   ├── styles/                  # Embedded styles for Shadow DOM
│   │   │   └── widget.css.ts
│   │   └── api.ts                   # Widget backend client
│   └── vite.config.ts               # Bundler config producing dist/widget.js
├── public/
│   ├── demo.html                    # Local demo page with two store widgets for testing
│   ├── setup.html                   # Merchant setup UI form
│   └── widget.js                    # Built widget bundle for script tag inclusion
└── tests/
    ├── helpers/
    │   ├── test-db.ts               # Test database setup / cleanup
    │   └── fixtures.ts              # Store A & Store B seed fixtures
    ├── unit/
    │   ├── budget_guard.test.ts     # OpenAI $14 budget hard stop test
    │   ├── catalog_filter.test.ts   # Catalogue search & rule-based filtering test
    │   └── consent.test.ts          # Consent verification & structure test
    ├── integration/
    │   ├── tenant_isolation.test.ts # Proof Store A cannot access Store B data
    │   ├── product_mismatch.test.ts # Rejection of cross-store product references
    │   ├── email_flow.test.ts       # Opt-in, suppression, purchase stop test
    │   └── origin_cors.test.ts      # CORS domain allowlisting test
    └── e2e/
        └── visitor_journey.test.ts  # Full journey: widget -> chat -> cart -> purchase stop
```

---

## 4. Database Schema Specification

All merchant-specific tables contain `store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE`.

### 1. `merchants`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `name`: VARCHAR(255) NOT NULL
- `contact_email`: VARCHAR(255) NOT NULL
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()

### 2. `stores`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `merchant_id`: UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE
- `shop_domain`: VARCHAR(255) NOT NULL UNIQUE (e.g., `store-a.myshopify.com`)
- `brand_name`: VARCHAR(255) NOT NULL
- `status`: VARCHAR(50) NOT NULL DEFAULT 'active' ('active', 'paused', 'disabled')
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Index*: `idx_stores_domain (shop_domain)`

### 3. `store_credentials`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE
- `encrypted_admin_token`: TEXT
- `encrypted_storefront_token`: TEXT
- `encryption_iv`: VARCHAR(64)
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()

### 4. `widget_settings`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE
- `button_text`: VARCHAR(100) NOT NULL DEFAULT 'Ask our shopping assistant'
- `position`: VARCHAR(20) NOT NULL DEFAULT 'bottom-right' ('bottom-right', 'bottom-left')
- `primary_colour`: VARCHAR(30) NOT NULL DEFAULT '#1a1a1a'
- `secondary_colour`: VARCHAR(30) NOT NULL DEFAULT '#ffffff'
- `greeting`: TEXT NOT NULL DEFAULT 'Hi there! Looking for recommendations today?'
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()

### 5. `assistant_settings`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE
- `assistant_name`: VARCHAR(100) NOT NULL DEFAULT 'Shopping Assistant'
- `allowed_topics`: TEXT[] DEFAULT ARRAY['product_recommendation', 'size_guide', 'stock_check']
- `support_contact`: VARCHAR(255) NOT NULL DEFAULT 'support@store.com'
- `privacy_policy_url`: TEXT NOT NULL DEFAULT 'https://store.com/policies/privacy'
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()

### 6. `store_policies`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE
- `delivery_policy`: TEXT NOT NULL
- `returns_policy`: TEXT NOT NULL
- `faq_content`: TEXT NOT NULL
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()

### 7. `visitors`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE
- `anonymous_id`: VARCHAR(100) NOT NULL
- `email`: VARCHAR(255)
- `phone`: VARCHAR(50)
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Constraint*: `UNIQUE (store_id, anonymous_id)`
- *Index*: `idx_visitors_store_email (store_id, email)`

### 8. `marketing_consents`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE
- `visitor_id`: UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE
- `opted_in`: BOOLEAN NOT NULL DEFAULT FALSE
- `captured_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `source`: VARCHAR(100) NOT NULL DEFAULT 'widget_chat_v1'
- `version`: VARCHAR(50) NOT NULL DEFAULT '1.0'
- `wording`: TEXT NOT NULL
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Index*: `idx_consents_store_visitor (store_id, visitor_id)`

### 9. `chat_sessions`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE
- `visitor_id`: UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE
- `started_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `ended_at`: TIMESTAMPTZ
- `status`: VARCHAR(50) NOT NULL DEFAULT 'active' ('active', 'completed', 'abandoned')
- `summary`: TEXT
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Index*: `idx_chat_sessions_store_visitor (store_id, visitor_id)`

### 10. `chat_messages`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE
- `session_id`: UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE
- `role`: VARCHAR(20) NOT NULL ('user', 'assistant', 'system')
- `content`: TEXT NOT NULL
- `ai_input_tokens`: INT DEFAULT 0
- `ai_output_tokens`: INT DEFAULT 0
- `estimated_cost_usd`: NUMERIC(10, 6) DEFAULT 0
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Index*: `idx_chat_messages_session (store_id, session_id)`

### 11. `recommendations`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE
- `session_id`: UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE
- `product_id`: VARCHAR(100) NOT NULL
- `variant_id`: VARCHAR(100) NOT NULL
- `title`: VARCHAR(255) NOT NULL
- `price`: NUMERIC(10, 2) NOT NULL
- `currency`: VARCHAR(10) NOT NULL DEFAULT 'GBP'
- `reason`: TEXT NOT NULL
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Index*: `idx_recommendations_store_session (store_id, session_id)`

### 12. `events`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE
- `visitor_id`: UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE
- `session_id`: UUID REFERENCES chat_sessions(id) ON DELETE SET NULL
- `type`: VARCHAR(50) NOT NULL ('widget_opened', 'email_submitted', 'marketing_opted_in', 'chat_message', 'product_recommended', 'product_clicked', 'add_to_cart', 'checkout_started', 'purchase_completed', 'email_sent', 'email_unsubscribed')
- `payload`: JSONB NOT NULL DEFAULT '{}'::jsonb
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Index*: `idx_events_store_visitor_type (store_id, visitor_id, type)`

### 13. `email_jobs`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE
- `visitor_id`: UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE
- `session_id`: UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE
- `campaign_type`: VARCHAR(50) NOT NULL DEFAULT 'abandoned_chat_recovery'
- `stage`: INT NOT NULL DEFAULT 1 (1: Day 0 summary, 2: Day 3 reminder, 3: Day 7 follow-up)
- `scheduled_for`: TIMESTAMPTZ NOT NULL
- `sent_at`: TIMESTAMPTZ
- `status`: VARCHAR(50) NOT NULL DEFAULT 'pending' ('pending', 'processing', 'sent', 'cancelled', 'failed')
- `cancel_reason`: VARCHAR(100) (e.g., 'purchased', 'unsubscribed', 'suppressed', 'no_consent')
- `retry_count`: INT NOT NULL DEFAULT 0
- `last_error`: TEXT
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Constraint*: `UNIQUE (store_id, session_id, stage)`
- *Index*: `idx_email_jobs_dispatch (status, scheduled_for)`

### 14. `suppression_list`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE
- `email`: VARCHAR(255) NOT NULL
- `reason`: VARCHAR(100) NOT NULL ('unsubscribed', 'bounce', 'complaint', 'manual')
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Constraint*: `UNIQUE (store_id, email)`
- *Index*: `idx_suppression_store_email (store_id, email)`

### 15. `ai_usage_ledger`
- `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `store_id`: UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE
- `session_id`: UUID REFERENCES chat_sessions(id) ON DELETE SET NULL
- `model`: VARCHAR(100) NOT NULL
- `input_tokens`: INT NOT NULL
- `output_tokens`: INT NOT NULL
- `estimated_cost_usd`: NUMERIC(10, 6) NOT NULL
- `billing_period`: VARCHAR(7) NOT NULL (e.g., '2026-09')
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- *Index*: `idx_ai_usage_period (billing_period)`

---

## 5. API Endpoints Specification

### Merchant & Store Admin
- `POST /api/v1/merchants/setup`
  - Creates merchant, store, default widget & assistant settings, policies. Returns `store_id` and unique embed snippet.
- `GET /api/v1/merchants/stores/:id/snippet`
  - Returns script tag snippet for manual theme insertion.

### Public Widget API
- `GET /api/v1/widget/config`
  - Query: `store_id`
  - Headers: `Origin: https://store-a.myshopify.com`
  - Validates origin against configured `stores.shop_domain`.
  - Returns public styling, greeting, assistant name, privacy policy URL. No secrets.
- `POST /api/v1/widget/session`
  - Body: `{ store_id, anonymous_id }`
  - Creates/finds visitor, starts chat session, returns session token.
- `POST /api/v1/widget/lead`
  - Body: `{ store_id, session_id, email, phone?, marketing_opt_in, consent_wording_version }`
  - Saves email, writes consent record with timestamp and wording.
- `POST /api/v1/widget/chat`
  - Body: `{ store_id, session_id, message }`
  - Filters products deterministically via adapter.
  - Passes subset to `IAiProvider`.
  - Records message & token cost.
  - Returns assistant response with 3–5 product recommendation objects.
- `POST /api/v1/widget/event`
  - Body: `{ store_id, session_id, type, payload }`
  - Ingests `product_clicked`, `add_to_cart`, `checkout_started`.
- `POST /api/v1/widget/purchase`
  - Body: `{ store_id, session_id?, email?, order_id, total }`
  - Records `purchase_completed` event and immediately cancels all pending recovery email jobs for the visitor.

### Unsubscribe & Compliance
- `GET /api/v1/email/unsubscribe?token=...`
  - Cryptographically verifies signed token, adds email to `suppression_list` under `store_id`, and cancels pending jobs.

### System & Health
- `GET /health`
  - Checks database connection and reports server status.

---

## 6. Test Strategy

1. **Unit Tests**:
   - `budget_guard.test.ts`: Enforces $10 warning and $14 hard stop based on `ai_usage_ledger`.
   - `catalog_filter.test.ts`: Verifies in-code filtering by budget, stock status, category.
   - `consent.test.ts`: Ensures marketing opt-in requires explicit `true` and records wording version.
2. **Integration Tests (Strict Tenant Isolation)**:
   - `tenant_isolation.test.ts`:
     - Store A visitor cannot be queried by Store B.
     - Store A cannot read or modify Store B's chat sessions or messages.
     - Store A cannot access Store B's recommendations or events.
     - Seed Store A and Store B with different products and verify results never cross over.
   - `product_mismatch.test.ts`:
     - Sending a product ID belonging to Store B in a Store A request triggers rejection.
   - `email_recovery.test.ts`:
     - No email job created if `opted_in` is false.
     - Email job cancelled immediately if purchase occurs.
     - Suppressed email addresses are never sent.
     - Idempotency test: duplicate worker runs do not send duplicate emails.
   - `origin_cors.test.ts`:
     - Requests from unconfigured origins are rejected.
3. **End-to-End Simulation**:
   - Full journey test simulating: Widget bootstrap -> Lead capture -> Chat query -> Product recommendation -> Add to Cart -> Simulated purchase -> Verified email cancellation.

---

## 7. Railway Deployment Topology

- **Web/API Service**:
  - Command: `node dist/src/server/server.js`
  - Exposes port 3000 (Railway `$PORT`).
  - Serves API and compiled static widget (`dist/widget.js`).
- **PostgreSQL Service**:
  - Railway managed PostgreSQL.
  - `DATABASE_URL` injected automatically.
- **Worker Service (or Railway Cron)**:
  - Command: `node dist/src/worker.js`
  - Polls `email_jobs` every 60 seconds (or runs on a scheduled cron trigger).
- **Environment Variables**:
  - Strict placeholder configuration documented in `.env.example`.
  - Zero hardcoded credentials in source code.
