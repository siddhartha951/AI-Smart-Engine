# Phase 7.1 Verification Report

## Verification Checklist

1. **Merchant Authentication & Scope**
   - [x] Login endpoint validates credentials against `users` table.
   - [x] JWT token carries `storeId` and `role`.
   - [x] Cross-merchant data access is STRICTLY blocked (Store A token cannot query Store B dashboard endpoints).
   - [x] `platform_admin` role allows viewing any store dashboard.

2. **Dashboard UI & API Integration**
   - [x] "My Agent" page built with Three.js micro-animations (GSAP, Vite, styling via ui-ux-pro-max guidelines).
   - [x] Widget Preview section visually validates the widget's configured colours and text in a simulated store interface.
   - [x] Settings form seamlessly calls the dashboard API securely (`GET/PUT /api/v1/dashboard/:storeId/agent` and `/widget`).

3. **Secure Widget Snippet Strategy**
   - [x] Widget bootstrap and chat initiation now use a secure `widget_key` (UUID) instead of public `store_id`.
   - [x] `regenerate-key` API safely invalidates the old widget key, replacing it immediately, meaning old snippet installations are safely blocked.
   - [x] Disabled Assistant behavior: `is_active=false` prevents new widget sessions from starting (401 Unauthorized), safely shutting down bot presence.

4. **Integration Testing**
   - [x] `tests/integration/phase7_1_dashboard.test.ts` passing all assertions for auth scope, disabling agent, and widget_key rotation.
   - [x] Regression testing ensures previous integration tests (`phase3`, `phase4`, `phase5`) have been successfully updated to use `widget_key` instead of `store_id` in their test scaffolds.

## Test Results
All integration tests successfully pass:
```
 ✓ tests/integration/phase7_1_dashboard.test.ts (6 tests)
 ✓ tests/integration/health_and_session.test.ts (4 tests)
 ✓ tests/integration/phase3_consent.test.ts (4 tests)
 ✓ tests/integration/phase4_recommendations.test.ts (4 tests)
 ✓ tests/integration/phase5_email.test.ts (4 tests)
```

## Security Posture
The platform has been enhanced with:
- **Tenant Isolation**: Direct endpoint parameter tampering (e.g. replacing `STORE_A` with `STORE_B` in URL) is intercepted by JWT-claims validation.
- **Opaque Identifiers**: Client-side widget snippet only exposes an arbitrary `widget_key`, mitigating enumeration and abuse risks associated with exposing internal primary keys (`store_id`).
- **Audit Logging**: Sensitive configuration mutations (Agent persona, Policies, Email Settings) are logged centrally.

## Next Steps
- Continue with **Phase 7.2**: Implement the "Admin Dashboard" for comprehensive platform monitoring, merchant on-boarding management, and global metrics viewing.
