# Pilot Launch Checklist: Single Controlled Merchant

This checklist governs the launch of the initial controlled pilot for **Seeds Of Fusion** (or designated pilot merchant). Every item must be checked and signed off before public promotion.

---

## 1. Pre-Flight Configuration (T-24h)

- [ ] **Environment & Connectivity**
  - [ ] Production/Staging server is running over valid **HTTPS** (`BASE_URL` configured with SSL).
  - [ ] Database is accessible and all 8 migrations are applied.
  - [ ] Database point-in-time backup executed (`npm run backup` or snapshot saved).
- [ ] **Shopify Connection & Scopes**
  - [ ] Merchant Custom App installed in Shopify store.
  - [ ] Admin API credentials configured and encrypted server-side with AES-256-GCM.
  - [ ] Required scopes verified: `read_products`, `read_orders`, `read_inventory`.
  - [ ] Catalog search tested: product titles, prices, currencies (GBP/INR/USD), and stock status match live Shopify store.
- [ ] **AI & Budget Guardrails**
  - [ ] `AI_PROVIDER` set and API key validated.
  - [ ] Store AI monthly budget hard limit enforced at $14.00 (warning threshold $10.00).
  - [ ] Fallback message tested when budget or rate limit is reached.
- [ ] **Safety & Marketing Governance**
  - [ ] `EMAIL_PROVIDER_MODE=fake` (or test inbox) for pilot Day 1.
  - [ ] Explicit merchant written approval verified before switching to real recovery email dispatch.
  - [ ] Suppression list verified empty of false positives.
  - [ ] Unsubscribe token signing secret configured.

---

## 2. Storefront Installation & Widget Verification (T-2h)

- [ ] **Script Placement**
  - [ ] Embed script snippet added before closing `</head>` tag in `theme.liquid`:
    ```html
    <script src="https://<YOUR-LIVE-DOMAIN>/widget.js" data-widget-key="<STORE-WIDGET-KEY>" defer></script>
    ```
  - [ ] Script URL uses valid HTTPS and returns HTTP 200 without CORS or mixed-content warnings.
- [ ] **Responsive Design & Display Checks**
  - [ ] **Desktop**: Widget floating launcher appears in the configured corner (`bottom-right`).
  - [ ] **Mobile**: Widget button does not overlap cart icons, WhatsApp floating buttons, or checkout navigation.
  - [ ] Shadow DOM verified: Theme CSS styles do not leak into or break widget modal layouts.
- [ ] **Interaction & Consent Flow**
  - [ ] Welcome message displays correctly.
  - [ ] Shopper email/phone submission records consent with timestamp and version in `marketing_consents`.
  - [ ] Audit log records action in `audit_logs`.

---

## 3. Launch Day Zero (T-0)

- [ ] Store status set to `active` in Admin Dashboard (`http://<DOMAIN>/admin/index.html`).
- [ ] Assistant status confirmed `active: true`.
- [ ] Internal team executes 3 end-to-end test chats on store:
  1. Ask for a specific product recommendation -> Verify link opens correct product.
  2. Enter test email with marketing opt-in -> Verify visitor record created.
  3. Simulate test checkout/order -> Verify purchase halts recovery email.
- [ ] Admin Dashboard alerts panel confirmed clean (`0 active critical alerts`).

---

## 4. Post-Launch Supervision (T+24h)

- [ ] Review Daily Monitoring Checklist.
- [ ] Check AI token ledger (`ai_usage_ledger`) spend < $1.00 for Day 1.
- [ ] Verify 0 unhandled 500 errors in backend logs.
- [ ] Conduct check-in with merchant contact person.
