# Railway Environment Variables Specification

> **Critical Security Architecture Rule**
> Merchant-specific secrets (Shopify Admin Tokens, Storefront Access Tokens, WhatsApp Access Tokens, WATI API Keys) **MUST NEVER** be placed in Railway environment variables.
> Railway environment variables are strictly reserved for **PLATFORM-LEVEL** infrastructure configuration. All merchant credentials are store-scoped, AES-256 encrypted using `ENCRYPTION_KEY`, and persisted in PostgreSQL (`store_credentials` and `whatsapp_configs` tables).

---

## Variable Categories

- **A. REQUIRED FOR APP START**: Baseline runtime, database connection, and encryption secrets required to initialize the Express HTTP server and PostgreSQL pool.
- **B. REQUIRED FOR SHOPIFY**: Platform-level webhook verification secret and API version for live Shopify stores.
- **C. REQUIRED FOR OPENAI**: API key and operational budgeting limits for LLM chat and product grounding.
- **D. REQUIRED FOR EMAIL**: Platform Resend API key and fallback sender settings.
- **E. REQUIRED FOR WHATSAPP**: Platform webhook verification token for Meta WhatsApp Cloud API.
- **F. REQUIRED FOR WORKERS**: Scheduling cadence and intervals for background recovery and replenishment workers.
- **G. OPTIONAL / TUNING**: Log levels, staging delays, model overrides.
- **H. TEST / DEVELOPMENT ONLY**: Mock mode fallbacks and local development URLs.

---

## Complete Variables Audit Table

| Variable Name | Category | Req/Opt | Example Format | Where Consumed | What Happens If Missing | Scope |
| :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| `NODE_ENV` | A | **Required** | `production` | `src/config/env.ts`, `server.ts` | Defaults to `development`. In production, activates database migration check and production logging. | Platform |
| `PORT` | A | **Required** | `3000` | Railway automatically injects `$PORT`; consumed in `server.ts` | Defaults to `3000`. On Railway, dynamic port binding requires this. | Platform |
| `BASE_URL` | A | **Required** | `https://engine-production.up.railway.app` | `src/config/env.ts`, `live.shopify.adapter.ts`, `replenishment.service.ts` | Defaults to `http://localhost:3000`. Webhook callbacks and permalinks will fail if not set to public HTTPS URL. | Platform |
| `DATABASE_URL` | A | **Required** | `postgresql://postgres:pass@junction.railway.internal:5432/railway` | `src/config/env.ts`, `src/database/client.ts` | Server fails to boot; database pool cannot connect; health check returns 503. | Platform |
| `ENCRYPTION_KEY` | A | **Required** | `a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6` (32 bytes) | `src/config/env.ts`, `src/utils/crypto.ts` | Cannot decrypt merchant Shopify or WhatsApp credentials. Onboarding credential storage fails. | Platform |
| `SESSION_SECRET` | A | **Required** | `secure-random-merchant-jwt-signing-secret-minimum-32-chars` | `src/config/env.ts`, `src/server/middlewares/auth.middleware.ts` | Uses insecure default fallback. Merchant dashboard JWT auth tokens compromised. | Platform |
| `UNSUBSCRIBE_SIGNING_SECRET` | A | **Required** | `secure-random-unsub-hmac-secret-minimum-32-chars-hex` | `src/config/env.ts`, `src/modules/email/email.worker.ts` | Uses insecure fallback string. One-click unsubscribe links may have weak signature validation. | Platform |
| `SHOPIFY_ADAPTER_MODE` | B | **Required** | `real` | `src/config/env.ts`, `src/providers/shopify/index.ts` | Defaults to `fake` (in-memory mock adapter). If `real`, queries live Shopify Admin/Storefront APIs. | Platform |
| `SHOPIFY_API_VERSION` | B | Optional | `2024-01` | `src/config/env.ts`, `live.shopify.adapter.ts` | Defaults to `2024-01`. | Platform |
| `SHOPIFY_CLIENT_SECRET` | B | **Required** (if `real`) | `shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | `src/config/env.ts`, `src/server/routes/shopify.routes.ts` | In `real` mode, Shopify HMAC verification fails; incoming order/product webhooks rejected (401). | Platform |
| `AI_PROVIDER` | C | **Required** | `openai` | `src/config/env.ts`, `src/providers/ai/index.ts` | Defaults to `mock`. If set to `openai`, requires valid `OPENAI_API_KEY`. | Platform |
| `OPENAI_API_KEY` | C | **Required** (if `openai`) | `sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | `src/config/env.ts`, `src/providers/ai/openai.provider.ts` | Widget chat fallback responds with graceful default message; AI recommendations disabled. | Platform |
| `OPENAI_MODEL` | C | Optional | `gpt-4o-mini` | `src/config/env.ts`, `openai.provider.ts` | Defaults to `gpt-4o-mini`. | Platform |
| `AI_MONTHLY_BUDGET_WARN_USD` | C | Optional | `10.00` | `src/config/env.ts`, `src/providers/ai/budget.guard.ts` | Defaults to `10.00`. Logs warning when monthly store OpenAI spend exceeds this threshold. | Platform |
| `AI_MONTHLY_BUDGET_STOP_USD` | C | Optional | `14.00` | `src/config/env.ts`, `src/providers/ai/budget.guard.ts` | Defaults to `14.00`. Hard cut-off: rejects LLM calls and serves static fallback if exceeded. | Platform |
| `EMAIL_PROVIDER_MODE` | D | **Required** | `resend` | `src/config/env.ts`, `src/providers/email/index.ts` | Defaults to `fake` (in-memory test sender). If `resend`, dispatches via Resend API. | Platform |
| `RESEND_API_KEY` | D | **Required** (if `resend`) | `re_xxxxxxxxxxxxxxxxxxxxxxxx` | `src/config/env.ts`, `src/providers/email/resend.email.provider.ts` | Email dispatch fails with provider authentication error. Worker marks job failed. | Platform |
| `EMAIL_API_KEY` | D | Optional | `re_xxxxxxxxxxxxxxxxxxxxxxxx` | `src/config/env.ts` | Fallback alias if `RESEND_API_KEY` not populated. | Platform |
| `EMAIL_FROM_ADDRESS` | D | Optional | `notifications@yourdomain.com` | `src/config/env.ts`, `email.worker.ts` | Defaults to `notifications@ai-smart-engine.com` if merchant domain is not verified. | Platform |
| `EMAIL_FROM_NAME` | D | Optional | `Shopify Assistant` | `src/config/env.ts`, `email.worker.ts` | Defaults to `Shopify Shopping Assistant`. | Platform |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | E | **Required** (if Meta WA) | `custom_webhook_secret_verify_token_123` | `src/server/routes/whatsapp-webhook.routes.ts` | Meta WhatsApp Cloud API webhook handshake verification fails (`hub.verify_token`). | Platform |
| `WHATSAPP_PROVIDER_MODE` | E | Optional | `meta` or `wati` | `src/modules/whatsapp/whatsapp.service.ts` | Defaults to `meta`. Individual stores can override by configuring WATI in dashboard. | Platform |
| `EMAIL_WORKER_INTERVAL_MS` | F | Optional | `60000` | `src/modules/email/email.worker.ts` | Defaults to `60000` (1 minute). Defines polling interval for abandoned cart recovery jobs. | Platform |
| `REPLENISHMENT_WORKER_INTERVAL_MS` | F | Optional | `60000` | `src/modules/replenishment/replenishment.worker.ts` | Defaults to `60000` (1 minute). Defines polling interval for due replenishment reminders. | Platform |
| `EMAIL_STAGE_1_DELAY_MINUTES` | G | Optional | `30` | `src/modules/email/email.repository.ts` | Defaults to `30`. Defines delay before stage 1 abandoned cart recovery email is queued. | Platform |
| `LOG_LEVEL` | G | Optional | `info` | `src/utils/logger.ts` | Defaults to `info`. Options: `debug`, `info`, `warn`, `error`. | Platform |
| `APP_URL` | G | Optional | `https://engine-production.up.railway.app` | `src/providers/shopify/live.shopify.adapter.ts` | Fallback alias for `BASE_URL`. | Platform |

---

## Merchant-Specific Credentials (Database-Stored Only)

The following credentials **MUST NEVER** be set as environment variables. They are entered by merchants during onboarding or inside settings tabs, encrypted using AES-256 with the platform's `ENCRYPTION_KEY`, and stored in database tables:

1. **Merchant Shopify Admin Access Token**: Stored in `store_credentials.encrypted_admin_token`.
2. **Merchant Shopify Storefront Access Token**: Stored in `store_credentials.encrypted_storefront_token`.
3. **Merchant Meta WhatsApp Access Token**: Stored in `whatsapp_configs.encrypted_access_token`.
4. **Merchant Meta Phone Number ID & WABA ID**: Stored in `whatsapp_configs.phone_number_id` and `waba_id`.
5. **Merchant WATI API Endpoint & Token**: Stored in `whatsapp_configs.wati_api_endpoint` and `whatsapp_configs.encrypted_wati_token`.
6. **Merchant Verified Sender Domain**: Stored in `sender_domains` table with DNS records and validation status.
