# Phase 5 Verification

**Date:** 2026-09-07
**Phase:** 5 — Email Recovery Sequence

## 1. Objectives Completed
- ✅ Implemented `IEmailProvider` and `FakeEmailProvider`.
- ✅ Implemented `IPurchaseAdapter` and `FakePurchaseAdapter`.
- ✅ Built `EmailRepository` with atomic job claiming (`FOR UPDATE SKIP LOCKED`).
- ✅ Created `EmailWorker` to run asynchronously and send scheduled emails using constraints.
- ✅ Added constraint checks: `marketing_opted_in` (VisitorRepository), `suppression_list` (EmailRepository), and `hasPurchasedSince` (PurchaseAdapter).
- ✅ Added `POST /api/v1/widget/visitor/unsubscribe` to allow users to opt-out, mapping to `suppression_list`.
- ✅ Created tests covering: successful emails, no-marketing-consent cancellation, purchase cancellation, unsubscribe suppression, and parallel worker idempotency.

## 2. Test Execution
- **Command:** `npm run test`
- **Results:** 30 passing tests (including 5 new tests in `phase5_email.test.ts`).
- **Coverage:** Tested API failures, worker constraints, email payloads, and SQL-level idempotency (`SKIP LOCKED`).

## 3. Build & Type Checking
- **Command:** `npm run type-check && npm run build`
- **Result:** Successfully compiled `tsc --noEmit` and `tsc -p tsconfig.json` with 0 errors.

## 4. Risks and Open Questions
- **Real Email Provider:** A real email provider (like Resend or Postmark) will need to be swapped in. This can be configured by replacing the factory logic in `src/providers/email/index.ts`.
- **Worker Concurrency in Production:** Currently, the `EmailWorker` uses `setInterval` internally. In production on Railway, we should consider running the worker in a separate long-running process (e.g., `npm run worker`) instead of within the same Node process as the web API to prevent CPU blockage, or using an external chron trigger.
- **Purchase State Polling:** The `FakePurchaseAdapter` uses in-memory states. For production, it needs to be wired directly to the real `ShopifyCatalogAdapter` order API to verify purchases accurately.

**Sign-off:** Phase 5 completed successfully. The application is ready for Phase 6.
