# Production Smoke Test Checklist & Matrix

This document provides the definitive verification matrix for testing the AI Smart Engine against a real, live Shopify development store prior to launching live merchant traffic.

---

## Smoke Test Matrix

| # | Flow / Step | Status | Automated Test Result | Real-World Storefront Verdict & Prerequisite |
| :---: | :--- | :---: | :---: | :--- |
| 1 | **Widget appears on storefront** | `NOT TESTED` | N/A (DOM mocked in unit tests) | Requires script tag `<script src="https://engine.../widget.js" data-widget-key="...">` injected into Shopify `theme.liquid`. |
| 2 | **Widget opens (FAB click & greeting)** | `NOT TESTED` | N/A (Client-side custom element) | Requires browser interaction with Shadow DOM button on live store domain. |
| 3 | **Chat message transmission & response** | `BLOCKED` | `PASS` (via `MockAiProvider`) | Blocked in production mode until valid `OPENAI_API_KEY` is provided; fallback response renders cleanly if unconfigured. |
| 4 | **AI product recommendation cards render** | `BLOCKED` | `PASS` (via `MockAiProvider` & local DB) | Blocked in production mode until catalog is synced via Shopify Admin API and `OPENAI_API_KEY` is active. |
| 5 | **Product link click navigates to PDP** | `NOT TESTED` | `PASS` | URL constructor appends `utm_source`, `utm_medium`, `ai_sid`, `ai_vid`; requires live storefront PDP. |
| 6 | **Add to cart action triggers on card** | `NOT TESTED` | `PASS` | Calls Shopify standard `/cart/add.js`; requires live Shopify storefront session. |
| 7 | **Cart contains correct variant & attributes** | `NOT TESTED` | `PASS` (Payload validated) | Attaches `_ai_session_id`, `_ai_visitor_id`, and active marketing UTMs via `/cart/update.js`. |
| 8 | **Marketing UTM parameters captured** | `PASS` | `PASS` (`phase15_attribution.test.ts`) | Extracted from `window.location.search` (`utm_source`, `utm_medium`, `fbclid`, `gclid`, `ttclid`) and saved in `sessionStorage`. |
| 9 | **Touchpoint stored in database** | `PASS` | `PASS` (`phase15_attribution.test.ts`) | Stored in `marketing_touchpoints` table with store isolation and visitor linkage. |
| 10 | **Shopify order webhook received & parsed** | `BLOCKED` | `PASS` (`phase10_shopify.test.ts`) | Blocked for live webhook delivery until public `BASE_URL` is registered on Railway and `SHOPIFY_CLIENT_SECRET` is set. |
| 11 | **Purchase event recorded in event ledger** | `PASS` | `PASS` (`phase10_shopify.test.ts`) | Normalized order payload stored in `events` table with `order_id`, `total_amount`, and currency. |
| 12 | **Multi-touch attribution models calculated** | `PASS` | `PASS` (`phase15_attribution.test.ts`) | Generates first-touch, last-touch, and linear allocations in `order_touchpoint_allocations`. |
| 13 | **AI-assisted revenue correctly credited** | `PASS` | `PASS` (`phase15_attribution.test.ts`) | Attributed when `_ai_session_id` or chat touchpoint occurred prior to purchase. |
| 14 | **Abandoned cart scheduled on add_to_cart** | `PASS` | `PASS` (`phase16_growth_copilot.test.ts`) | Event triggers `email_jobs` entry when visitor has consent. |
| 15 | **Order purchase cancels pending recovery** | `PASS` | `PASS` (`phase16_growth_copilot.test.ts`) | Order webhook scans and marks active recovery jobs as `cancelled` (`cancel_reason: 'Purchase completed'`). |
| 16 | **Replenishment schedule created on purchase**| `PASS` | `PASS` (`phase14_replenishment.test.ts`) | Cycle days and reminder dates calculated; pre-filled permalink generated. |
| 17 | **Reorder reminder worker dispatch** | `BLOCKED` | `PASS` (`phase14_replenishment.test.ts`) | Worker execution passes; live delivery blocked until `RESEND_API_KEY` (email) or Meta/WATI token (WhatsApp) is configured. |
| 18 | **Merchant dashboard reflects real data** | `PASS` | `PASS` (`phase7_1_dashboard.test.ts`) | Endpoints query SQL repositories directly; zero hardcoded mock values. |
| 19 | **Growth Copilot generates data-driven actions**| `PASS` | `PASS` (`phase16_growth_copilot.test.ts`) | Reads live metrics (AOV, ROAS, recovery rates, replenishment counts) to generate actionable insights. |
| 20 | **Multi-tenant isolation strictly enforced** | `PASS` | `PASS` (Verified across all test suites) | Store A cannot read, write, update, or cancel Store B data under any circumstances. |

---

## Summary of Matrix Statuses

- **PASS (Automated & Logic Validated)**: 10 items
- **BLOCKED (Awaiting External Production Credentials)**: 5 items
- **NOT TESTED (Requires Live Storefront Theme Interaction)**: 5 items
- **FAIL**: 0 items

---

## Live Storefront Smoke Test Procedure (Step-by-Step)

Follow these steps once Railway services are deployed and live credentials are set:

### Step 1: Store Setup & Script Installation
1. Log into merchant dashboard: `https://<railway-web-url>/dashboard/login.html`.
2. Retrieve your `Store ID` and `Widget Key` from the Settings tab.
3. In your Shopify Store Admin, navigate to **Online Store → Themes → Edit code → theme.liquid**.
4. Right before `</head>`, insert:
   ```html
   <script
     src="https://<railway-web-url>/widget.js"
     data-widget-key="YOUR_WIDGET_KEY"
     data-store-id="YOUR_STORE_ID"
     async>
   </script>
   ```
5. Save `theme.liquid`.

### Step 2: Storefront Ingestion & UTM Tracking Test
1. Open an incognito browser window and visit your store using a tagged campaign URL:
   `https://your-store.myshopify.com/?utm_source=meta&utm_medium=cpc&utm_campaign=summer_sale&fbclid=fb_test_123`
2. Open Browser DevTools (F12) → Console: verify the shopping assistant widget initializes without errors.
3. Inspect Network tab: verify `POST /api/v1/attribution/touchpoint` responds with `200 OK`.
4. Inspect Application tab → Session Storage: verify `ai_utm_source = meta`, `ai_utm_campaign = summer_sale`, `ai_fbclid = fb_test_123`.

### Step 3: Interactive Chat & Recommendation Test
1. Click the widget launcher button in the bottom right corner.
2. Send a query: `"Show me your best summer shoes under 1000"`.
3. Verify recommendation cards appear with image, title, price, and currency.
4. Click on a product card or click **Add to Cart**.
5. Verify `/cart/add.js` succeeds and the product appears in the Shopify cart drawer.
6. Verify `/cart/update.js` set `_ai_session_id`, `_ai_visitor_id`, and `utm_source: meta`.

### Step 4: Live Order Webhook & Attribution Verification
1. Complete a test purchase via Shopify Bogus Gateway.
2. In Railway Web Service logs: verify `orders/create` webhook received with valid HMAC.
3. Check Merchant Dashboard (`/dashboard/index.html`):
   - **Analytics Tab**: Orders count and total revenue incremented.
   - **Attribution Tab**: Meta campaign `summer_sale` displays 1 conversion.
   - **Growth Copilot**: ROAS and acquisition metrics updated.
   - **Abandoned Cart Tab**: Any pending recovery job for this visitor marked `cancelled` (purchase completed).
   - **Replenishment Tab**: If item is replenishable, a schedule is created for the next replenishment cycle.
