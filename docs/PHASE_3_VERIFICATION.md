# Phase 3 Verification

**Date:** 2026-09-04
**Phase:** 3 — Text Assistant UI, Lead Capture and Consent

## 1. Objectives Completed
- ✅ Created a responsive Shadow DOM widget (`src/public/widget.js`).
- ✅ Implemented email capture (required), phone (optional), and an unchecked marketing consent option.
- ✅ Added `POST /api/v1/widget/visitor/consent` to securely process lead capture and save consent timestamps/versions.
- ✅ Added event tracking for lead capture.
- ✅ Created a side-by-side local demo (`src/public/demo.html`) showing Store A and Store B with full widget CSS/UI isolation.

## 2. Testing Evidence

### Automated Tests
```
$ npm run test
✓ tests/integration/health_and_session.test.ts (8 tests)
✓ tests/integration/phase3_consent.test.ts (4 tests)
```
- **Consent Isolation:** Proved that a consent payload sent to Store B using Store A's visitor ID is correctly rejected with `TENANT_ISOLATION_VIOLATION`.
- **Validation:** Proved that missing required emails are cleanly rejected (`400 Bad Request`).
- **Data Save:** Proved that when marketing is opted in, the database correctly saves `email`, `phone`, and `marketing_consents`.

### Visual / Manual Verification
**Steps to Reproduce:**
1. Run the local backend: `npm run dev`
2. Open `http://localhost:3000/demo.html` in your browser.
3. Observe two distinct store panels (Store A and Store B).
4. Each widget button reflects the unique color scheme and text from its store configuration (via `GET /api/v1/widget/config`).
5. Clicking "Get Started" launches a visitor session (via `POST /api/v1/widget/session`).
6. The lead capture form appears, asking for Email (required) and Phone (optional), with an unchecked marketing box.
7. Submitting this form calls `POST /api/v1/widget/visitor/consent` and transitions cleanly to the chat interface.

## 3. Security & Compliance
- Browser code only triggers updates to marketing consent via explicit user action payloads.
- All styles are injected exclusively within the `#shadow-root` to avoid clashing with Shopify host theme.
- Fixed `gen_random_uuid` impurity within pg-mem testing to prevent test leakage and primary key collisions during simultaneous event insertion.

## 4. Known Limitations
- The Chat interface is currently a dummy layout. Real WebSocket/SSE chat streaming will be implemented in a subsequent phase (Phase 4).

## 5. Next Steps
Ready to proceed to **Phase 4 (Shopify Product Adapter and Recommendations)**.
