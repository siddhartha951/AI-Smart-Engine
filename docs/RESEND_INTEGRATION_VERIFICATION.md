# Resend Platform Email Provider Integration — Verification Report

**Component**: Resend Email Integration (`IEmailProvider`, Sender Domains, Webhooks, Idempotency)  
**Status**: **VERIFIED & OPERATIONAL**  
**Date**: September 10, 2026  
**Test Suite**: [`tests/integration/resend_integration.test.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/tests/integration/resend_integration.test.ts) (8 of 8 passed)  
**Full Test Suite**: 14 of 14 test files passed (83 of 83 tests passed)  

---

## 1. Architecture Overview

### 1.1 Single Platform-Level `RESEND_API_KEY`
- Configured once in Railway environment variables (`RESEND_API_KEY`).
- Used exclusively by server-side services.
- Never returned in onboarding wizard, merchant dashboard, public widget, or admin API responses.
- If `RESEND_API_KEY` is not present, falls back gracefully to `EMAIL_API_KEY`.

### 1.2 `IEmailProvider` Interface & Implementations
Located in [`src/providers/email/`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/email/):
- **`IEmailProvider`**: Contract supporting `sendEmail()`, `createSenderDomain()`, `getSenderDomain()`, and `verifySenderDomain()`.
- **`ResendEmailProvider`**: Production provider using the official Resend Node SDK.
  - Automatically attaches `Idempotency-Key` headers.
  - Attaches telemetry tags: `store_id` and `campaign_type`.
  - Enforces environment safety: in non-production environments (`NODE_ENV !== 'production'`), marketing emails are never sent to real customer inboxes and are diverted to Resend test sink addresses (`delivered@resend.dev`).
- **`FakeEmailProvider`**: In-memory test provider supporting simulated DNS records, controllable domain verification states, and sent email inspection.

### 1.3 Merchant-Specific Sender Domains
Database Table: `merchant_sender_domains` (Migration `009_resend_integration.sql`):
- Linked directly to `store_id` with strict cascade and unique `(store_id, domain_name)` constraints.
- Stores provider domain ID, verification status (`pending`, `verified`, `failed`), custom sender display name, and sender email.
- Stores full structured DNS records (`DKIM`, `SPF`, `MX`, `CNAME`) in JSONB format.

### 1.4 Webhook Event Pipeline & Suppression Automation
Route: `POST /api/v1/webhooks/resend` in [`src/server/routes/resend-webhook.routes.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/routes/resend-webhook.routes.ts):
- Resolves `store_id` through three fallback methods:
  1. Payload `data.tags` (`store_id` tag).
  2. Database lookup by `provider_message_id`.
  3. Sender domain match in `merchant_sender_domains`.
- Records raw and parsed events in `email_webhook_events`.
- **Bounce Automation**: `email.bounced` immediately inserts the recipient into `suppression_list` for that store and cancels any pending scheduled jobs for that email.
- **Spam Complaint Automation**: `email.complained` immediately suppresses the recipient and halts recovery sequences.
- **Delivery Confirmation**: `email.delivered` records delivery confirmation against the store.

### 1.5 Pre-Send Validation Engine
Before any recovery email is sent by [`EmailWorker`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/modules/email/email.worker.ts), all 5 gates must pass:
1. **Consent Gate**: Visitor has `marketing_consents.opted_in = true`.
2. **Suppression Gate**: Recipient is NOT on `suppression_list` for this `store_id`.
3. **Purchase Gate**: Customer has not completed a purchase since the chat session started.
4. **Sender Domain Verification Gate**: Store must have a verified sender domain in `merchant_sender_domains`. If unverified, the job is cancelled with `cancelReason: 'Sender domain unverified'`.
5. **Idempotency Gate**: Idempotency key (`${store_id}_job_${id}_stage_${stage}`) is checked. If previously dispatched, duplicate sending is prevented.

---

## 2. Verification Gate Results

### 2.1 Dedicated Resend Integration Tests (8 of 8 Passed)

| # | Test Scenario | Verification Method | Result |
|---|---|---|:---:|
| **1** | **Unverified Domain Rejection** | Store with `pending` domain schedules email. Worker processes jobs. Verified 0 emails sent and job cancelled with `'Sender domain unverified'`. | ✅ **PASSED** |
| **2** | **Verified Domain Execution** | Store with `verified` domain schedules email. Worker dispatches email with verified `from` address, records `idempotency_key` and `provider_message_id`. | ✅ **PASSED** |
| **3** | **Duplicate-Send Prevention** | Multiple executions on the same job record or identical idempotency key are intercepted; email sent count remains strictly 1. | ✅ **PASSED** |
| **4** | **Bounced Recipient Suppression** | `POST /api/v1/webhooks/resend` with `email.bounced` payload adds recipient to `suppression_list` and cancels pending recovery emails. | ✅ **PASSED** |
| **5** | **Spam Complaint Suppression** | `email.complained` webhook adds recipient to `suppression_list`. | ✅ **PASSED** |
| **6** | **Multi-Tenant Store Isolation** | Bounce on Store A suppresses recipient only on Store A; Store B can still email the same user. Store A cannot view, verify, or delete Store B domains. | ✅ **PASSED** |
| **7** | **Domain Creation & Verification Flow** | `POST /api/v1/dashboard/:storeId/email/domains` creates domain with DNS records; `POST .../verify` updates status to `verified`. | ✅ **PASSED** |
| **8** | **Secret Protection & API Key Hygiene** | Validates that `RESEND_API_KEY` is not present in dashboard or domain responses. | ✅ **PASSED** |

```text
 ✓ tests/integration/resend_integration.test.ts (8 tests) 1318ms
   ✓ 1. rejects sending marketing emails when store sender domain is unverified
   ✓ 2. successfully dispatches marketing emails when verified domain exists
   ✓ 3. prevents duplicate email sends using idempotency keys
   ✓ 4. automatically suppresses bounced recipients and cancels pending recovery emails
   ✓ 5. suppresses recipient on spam complaint webhook event
   ✓ 6. guarantees strict store isolation for domains, suppressions, and webhooks
   ✓ 7. allows creating a sender domain, viewing DNS records, and verifying status
   ✓ 8. never leaks platform RESEND_API_KEY in domain or dashboard responses
```

---

## 3. Full Repository Test Suite & Quality Gates

All 14 integration and unit test files pass with zero failures:

```text
 Test Files  14 passed (14)
      Tests  83 passed (83)
```

- **Type Check**: `npm run type-check` (0 errors).
- **Linter**: `npm run lint` (0 errors).
- **Production Build**: `npm run build` (Clean compile).

---

## 4. API Endpoints Reference

### Merchant Onboarding (`/api/v1/onboarding`)
- `POST /api/v1/onboarding/domains`: Register new sender domain with Resend.
- `GET /api/v1/onboarding/domains/:storeId`: Retrieve domain DNS records.
- `POST /api/v1/onboarding/domains/:domainId/verify`: Trigger verification check.

### Merchant Dashboard (`/api/v1/dashboard`)
- `GET /api/v1/dashboard/:storeId/email/domains`: List store domains and DNS records.
- `POST /api/v1/dashboard/:storeId/email/domains`: Add sender domain.
- `POST /api/v1/dashboard/:storeId/email/domains/:domainId/verify`: Verify domain.
- `DELETE /api/v1/dashboard/:storeId/email/domains/:domainId`: Remove sender domain.

### Platform Admin (`/api/v1/admin`)
- `GET /api/v1/admin/stores/:storeId/domains`: Platform admin inspection of store domains.
- `POST /api/v1/admin/stores/:storeId/domains/:domainId/verify`: Admin verification trigger.

### Webhooks (`/api/v1/webhooks`)
- `POST /api/v1/webhooks/resend`: Ingests Resend events (`email.sent`, `email.delivered`, `email.bounced`, `email.complained`).

---

## 5. Merchant DNS Setup Guide

When a merchant adds a custom domain (e.g., `seedsoffusion.com`), they must add the DNS records generated by the engine into their DNS provider (Cloudflare, GoDaddy, Route 53):

| Record Type | Name / Host | Value / Target | Purpose |
|---|---|---|---|
| **TXT** | `resend._domainkey` | `p=MIGfMA0GCSq...` | DKIM authentication |
| **MX** | `bounces` | `feedback-smtp.resend.com` (Priority 10) | SPF return-path routing |
| **TXT** | `bounces` | `v=spf1 include:resend.com ~all` | SPF validation |

Once DNS records propagate, clicking **Verify Domain** in the Dashboard or Onboarding Wizard transitions the domain to `verified`, enabling automated marketing recovery emails for that merchant.
