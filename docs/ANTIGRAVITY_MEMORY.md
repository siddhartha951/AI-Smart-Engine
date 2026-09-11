# ANTIGRAVITY MEMORY — AI SMART ENGINE

## 1. PROJECT IDENTITY

Project Name:
AI Smart Engine

Product Type:
AI-powered Shopify D2C SaaS.

Primary Goal:
Shopify merchants ko ek single AI-powered shopping assistant + conversion platform provide karna.

Initial Target:
Shopify D2C brands, especially UK-focused merchants.

Core Proposition:
Visitor ko Shopify store par AI shopping assistant mile jo:
- visitor ki requirements samjhe
- merchant ke catalogue se relevant products recommend kare
- product details accurately provide kare
- Add to Cart facilitate kare
- shopper behaviour/events track kare
- consent ke according abandoned-cart/recovery emails trigger kare
- merchant ko analytics provide kare

The platform is multi-tenant:
ONE backend + ONE database + ONE codebase
serving MANY merchants/stores.

Every merchant-owned operation MUST be isolated using store_id.


==================================================
## 2. CURRENT PRODUCT ARCHITECTURE
==================================================

High-level:

Shopify Store
    ↓
widget.js
    ↓
AI Smart Engine API
    ↓
AI / Shopify / Events / Database / Email services
    ↓
Merchant Dashboard

Widget architecture:
- Single lightweight widget.js
- Shadow DOM isolation
- Widget styles must not bleed into Shopify theme
- Widget is embedded into merchant Shopify store
- Backend credentials must NEVER be exposed to browser
- Merchant-specific secrets remain server-side


==================================================
## 3. TECHNOLOGY / INFRASTRUCTURE DECISIONS
==================================================

Backend:
- Node.js
- TypeScript
- Express

Database:
- PostgreSQL
- Railway managed PostgreSQL in production

Testing:
- Vitest
- pg-mem for in-memory DB testing

AI:
- OpenAI API
- IAiProvider abstraction
- MockAiProvider
- OpenAiProvider

Shopify:
- IShopifyCatalogAdapter abstraction
- FakeShopifyAdapter for testing
- RealShopifyAdapter for production

Email:
- Email provider abstraction
- Mock provider for testing
- Resend for production

Infrastructure:
- Railway
- Web/API Node.js service
- PostgreSQL
- Scheduled worker

Do NOT introduce Redis, Celery, Supabase,
Vercel, ElevenLabs, Twilio SMS, etc. unless a
future architecture decision explicitly approves them.

Voice/ElevenLabs is NOT part of the initial core platform.


==================================================
## 4. MULTI-TENANT ARCHITECTURE — CRITICAL
==================================================

Every merchant-related record must be associated with:

store_id → stores(id)

Relevant tables include:

- stores
- widget_settings
- assistant_settings
- store_policies
- visitors
- marketing_consents
- chat_sessions
- chat_messages
- events
- recommendations
- email_jobs
- suppression_list
- ai_usage_ledger
- users
- audit_logs

Rules:

1. Every repository/query MUST scope by store_id where applicable.

2. Browser-supplied store_id MUST NOT be trusted to override
   the authenticated merchant's store.

3. Authentication context determines the merchant/store.

4. Cross-tenant reads/writes must fail.

5. Merchant A must never be able to access Merchant B's:
   - visitors
   - chats
   - recommendations
   - events
   - analytics
   - settings
   - users
   - audit information
   - usage data

6. Add integration tests for cross-tenant isolation whenever
   a new merchant-facing API is introduced.

Multi-tenant isolation is a security requirement, not merely
a feature.


==================================================
## 5. EXISTING DATABASE / DATA ACCESS ARCHITECTURE
==================================================

Database abstraction exists:

IDatabaseClient

Production:
PostgresClient using pg.Pool

Testing:
InMemoryPostgresClient using pg-mem

Migration system:
Migrator

Existing baseline migrations include:
- 001_initial_schema.sql
- 002_seed_two_stores.sql

Repositories include:
- MerchantRepository
- VisitorRepository
- ChatRepository
- EventRepository
- EmailRepository
- AiUsageRepository

Do not bypass repository/data-access architecture without a
specific reason.

Use parameterized queries.

Do not load huge event datasets into application memory
when SQL aggregation can perform the work.


==================================================
## 6. EXISTING AI ARCHITECTURE
==================================================

AI abstraction:

IAiProvider
├── MockAiProvider
└── OpenAiProvider

AI usage is tracked in:

ai_usage_ledger

Budget protection:
- BudgetGuard exists
- estimated USD cost is calculated
- $10 warning threshold
- $14 application-level exhaustion threshold
- new AI conversations should be rejected when budget guard
  is exhausted

IMPORTANT:
The application-level budget guard is a protection/control,
not a guarantee of total external OpenAI billing never exceeding
a particular amount.

AI recommendation flow:

Visitor intent
    ↓
Deterministic catalogue filtering
    ↓
Small relevant product subset
    ↓
AI prompt
    ↓
Structured recommendation output

Only approximately 3–5 relevant products should be supplied
to the AI where appropriate.

AI must NOT:
- invent products
- invent prices
- invent inventory
- invent policies
- fabricate product IDs
- make claims unsupported by supplied catalogue/store data

Recommendations must be constrained to valid injected product IDs.


==================================================
## 7. SHOPIFY ARCHITECTURE
==================================================

Interface:

IShopifyCatalogAdapter

Testing:
FakeShopifyAdapter

Production:
RealShopifyAdapter

Merchant credentials:
- server-side only
- encrypted at rest
- associated with store_id
- never expose credentials in widget.js

Client-side Add to Cart:
Shopify Ajax Cart API:
POST /cart/add.js

Fallback:
Product URL with variant information when necessary.

The browser should never receive private Shopify credentials.


==================================================
## 8. WIDGET ARCHITECTURE
==================================================

Widget:
- widget.js
- Shadow DOM
- isolated styles
- responsive/mobile-friendly
- merchant theme must not break widget
- widget communicates with backend APIs

Widget flow:

Visitor lands on store
    ↓
Floating assistant button
    ↓
Assistant popup
    ↓
Email capture
    ↓
Marketing consent separately presented
    ↓
Conversation
    ↓
AI recommendations
    ↓
Product interaction
    ↓
Add to Cart


==================================================
## 9. UK CONSENT / EMAIL PRIVACY RULES
==================================================

Email is required to start the assistant.

Marketing consent is SEPARATE.

Marketing checkbox:
- separate from assistant access
- unchecked by default
- must not be required to use assistant

A visitor can use the assistant without marketing consent.

Marketing consent stores metadata such as:
- store_id
- visitor_id
- opted_in
- version
- wording
- source
- captured_at

Recovery emails MUST NOT be sent without valid marketing consent.

Email flows must check:
- marketing consent
- suppression list
- purchase_completed

Unsubscribe:
- signed one-click unsubscribe
- visitor added to suppression_list
- future recovery emails blocked

Purchase:
- if purchase is detected, pending recovery should stop/cancel.

Worker idempotency:
- PostgreSQL row locking / FOR UPDATE SKIP LOCKED
- prevents duplicate processing by concurrent workers.


==================================================
## 10. EXISTING AUTHENTICATION / DASHBOARD
==================================================

Merchant dashboard exists.

Authentication:
- JWT
- role-based access control
- users table
- audit_logs table

Dashboard APIs are tenant isolated.

Three.js interactive background and existing visual style
are already implemented.

Do NOT rebuild dashboard authentication unless an actual
defect is discovered.


==================================================
## 11. VERIFIED QA STATUS
==================================================

QA has been completed for core engine and dashboard.

Phase 6:
APPROVED

Phase 7:
APPROVED

Phase 7 QA:
- JWT authentication tested
- RBAC tested
- store isolation tested
- dashboard APIs tested
- dashboard UI implemented
- 34-test regression suite reported passing

Known QA bugs:
BUG-009 — pg-mem ON CONFLICT limitation
Status: FIXED

BUG-010 — Express routes not sharing migrated pg-mem DB
Status: FIXED

Core verified areas include:

Multi-tenant:
PASS

Origin verification:
PASS

Widget:
PASS

Shadow DOM:
PASS

Responsive UI:
PASS

AI budget enforcement:
PASS

Deterministic catalogue filtering:
PASS

Anti-hallucination controls:
PASS

Marketing consent:
PASS

Purchase stop:
PASS

Suppression/unsubscribe:
PASS

Email worker idempotency:
PASS

Dashboard authentication:
PASS

Dashboard tenant isolation:
PASS


==================================================
## 12. PRODUCTION STATUS
==================================================

IMPORTANT CURRENT STATE:

Production deployment has already been completed.

The user has explicitly confirmed:
- deployment is complete
- production has been cross-verified

Therefore DO NOT repeatedly suggest:
- initial Railway deployment
- initial DB provisioning
- basic deployment setup
- repeating already completed deployment verification

If production issues are discovered later, diagnose the actual issue
instead of repeating the deployment process.


==================================================
## 13. DEVELOPMENT HISTORY
==================================================

Phase 0:
Application planning/foundation.
SYSTEM_DESIGN and implementation planning created.

Phase 1:
Application foundation + multi-tenant PostgreSQL architecture.
Repositories, DB abstraction, middleware, widget session scaffolding,
tests etc.

Phase 6:
Core engine resilience, architecture documentation,
error handling, mock cleanup, test plans.
QA APPROVED.

Phase 7:
Secure Merchant Dashboard.
JWT authentication, RBAC, users/audit_logs,
strict tenant isolation, dashboard UI.
QA APPROVED.

IMPORTANT:
Historical DEVLOG numbering is inconsistent because Phase 2–5
completion entries are not all explicitly documented.

Therefore:
Do NOT assume a phase is complete simply because its number is
missing from the DEVLOG or because it appears in a roadmap.

Always inspect actual code/tests when determining completion.


==================================================
## 14. CURRENT DEVELOPMENT POSITION
==================================================

Production deployment:
COMPLETE

Cross-verification:
COMPLETE

Completed Phases:
- Phases 0–11: COMPLETE
- Phase 12 (AI Ad Creative Studio): COMPLETE (12/12 tests passing, verified)
- Phase 13 (WhatsApp Growth Engine): COMPLETE (17/17 tests passing, 125/125 regression tests passing, verified)

Current product state:
PHASE 13 — WHATSAPP GROWTH ENGINE IS COMPLETE.
Do NOT start Phase 14 without explicit instruction.



==================================================
## 15. PHASE 2 OBJECTIVE
==================================================

Build merchant-facing live analytics on top of the existing
event infrastructure.

Required capabilities:

1. Active Visitor Pulse
- number of currently active shoppers
- explicit activity/heartbeat definition
- store scoped

2. Live Activity Feed
Examples:
- visitor started session
- chat started
- product viewed
- recommendation generated
- product clicked
- add to cart
- checkout started
- purchase completed

3. Conversion Funnel

Visitors
→ Chats
→ Recommendations
→ Product Engagement
→ Add to Cart
→ Checkout
→ Purchase

4. Recommendation Performance
- recommendation count
- clicks
- add-to-cart
- purchases where reliable attribution exists

5. Recommended vs Purchased
- recommended products
- recommendation frequency
- engagement
- resulting purchases where supported by real data

6. Merchant Analytics APIs

7. Dashboard UI integration

8. Performance-safe DB aggregation

9. Security and tenant isolation

10. Integration tests


==================================================
## 16. ANALYTICS RULES
==================================================

Do not invent attribution.

If a purchase cannot be reliably attributed to an AI
recommendation, clearly mark attribution as unavailable
rather than claiming a conversion.

Define every metric mathematically/technically.

For active visitors, explicitly define the inactivity window.

Prefer SQL aggregation over retrieving all events into Node.js.

Add indexes based on actual query patterns.


==================================================
## 17. DEVELOPMENT WORKFLOW — MANDATORY
==================================================

EVERY PHASE MUST FOLLOW:

READ
→ INSPECT
→ PLAN
→ IMPLEMENT
→ TEST
→ VERIFY
→ DOCUMENT
→ STOP

Never jump directly into coding.

Before implementation:
- read relevant documentation
- inspect existing implementation
- identify reusable components
- identify existing tests
- identify architecture constraints

After implementation:
- run targeted tests
- run full regression suite
- run TypeScript/typecheck
- run ESLint
- run production build
- verify tenant isolation
- verify security-sensitive paths
- update DEVLOG

Then STOP.

Do not automatically start the next phase.


==================================================
## 18. ANTIGRAVITY BEHAVIOUR RULES
==================================================

1. Do NOT assume documentation equals implementation.

2. Do NOT rebuild working features.

3. Do NOT introduce unnecessary dependencies.

4. Do NOT change architecture decisions casually.

5. If an existing ADR must change:
   - explain why
   - propose/update a new ADR
   - do not silently overwrite an established decision.

6. Preserve multi-tenant isolation.

7. Preserve existing abstractions.

8. Do not expose secrets.

9. Do not fabricate test results.

10. Never claim "complete" unless implementation and verification
    actually support it.

11. If something is partially implemented, mark it PARTIAL.

12. If a blocker exists, STOP and report it.

13. Do not implement unrelated features during a phase.

14. Keep production code clean and typed.

15. Prefer simple maintainable architecture over unnecessary
    complexity.


==================================================
## 19. DOCUMENTATION RULES
==================================================

Important project documents:

- SYSTEM_DESIGN.md
- DECISIONS.md
- DEVLOG.md
- QA_REPORT.md
- docs/IMPLEMENTATION_PLAN.md

When completing a phase:
- update DEVLOG.md
- update relevant technical documentation
- update DECISIONS.md only if an actual new architectural
  decision is required

Do not rewrite historical decisions merely to make documentation
look cleaner.


==================================================
## 20. FUTURE PRODUCT ROADMAP
==================================================

After Phase 2 is properly implemented and verified:

PHASE 3
AI Ad Creative Studio
- ad copy
- hooks
- creative generation workflow
- Meta export

PHASE 4
WhatsApp Growth Engine
- Meta Cloud API
- cart recovery
- two-way AI WhatsApp assistant
- order/delivery notifications

PHASE 5
Auto Replenishment
- consumable product cycles
- reorder triggers
- one-click reorder
- LTV/replenishment analytics

PHASE 6
Multi-Touch Ad Intelligence
- UTM capture
- fbclid
- gclid
- ttclid
- visitor attribution
- Shopify order reconciliation
- AI-assisted revenue
- blended ROAS

Later:
- advanced admin/control centre
- billing/usage
- production observability improvements
- more merchant pilots
- proper Shopify App Store application
- advanced voice/AI features


==================================================
## 21. IMPORTANT PRODUCT PRINCIPLE
==================================================

AI Smart Engine is NOT just a chatbot.

The long-term product is:

AI Shopping Assistant
+
Conversion Engine
+
Customer Recovery
+
Live Analytics
+
Ad Intelligence
+
WhatsApp Growth
+
Replenishment

The assistant is the entry point; the platform's value comes
from measurable merchant revenue impact.


==================================================
## 22. CURRENT INSTRUCTION
==================================================

When the user asks what to do next:

1. Check the current documented/project state.
2. Do not repeat already completed deployment work.
3. Continue from the next genuinely uncompleted phase.
4. Give a dedicated implementation prompt for Antigravity.
5. Include explicit acceptance criteria.
6. Include explicit testing/verification requirements.
7. Tell Antigravity to STOP after that phase.
8. Wait for the verification report before advancing.

CURRENT STATUS:

PHASE 13 & PHASE 13 EXTENSION (WATI WHATSAPP PROVIDER) VERIFIED & COMPLETE
- Phase 13 WhatsApp Growth Engine (Meta Cloud API): 17/17 tests passing.
- Phase 13 Extension WATI WhatsApp Provider: 28/28 tests passing.
- Full Platform Regression: 20/20 test suites, 153/153 tests passing (100%).
- Documentation & Verification: PHASE_13_VERIFICATION.md & PHASE_13_WATI_VERIFICATION.md complete.

STOPPED. Do NOT start Phase 14 without explicit instruction.


==================================================
END OF ANTIGRAVITY MEMORY
==================================================