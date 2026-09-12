# Phase 16: Mandatory System Integration Audit

## 1. Executive Summary
This document provides a comprehensive, ground-truth integration audit of the entire **AI Smart Engine** architecture as of Phase 15. The objective is to verify real end-to-end data flows, identify architectural disconnections between components, and ensure that Phase 16 (**AI Merchant Growth Copilot & Action Center**) operates on genuinely unified data rather than siloed abstractions.

---

## 2. End-to-End Data Flow Mapping

### Flow A: Visitor Shopping Assistant Journey
```
Visitor
  ↓ [CONNECTED]
Storefront Widget (<ai-shopping-assistant>)
  ↓ [CONNECTED]
Session Creation (`POST /api/v1/widget/session`)
  ↓ [CONNECTED]
Lead & Consent Capture (`POST /api/v1/widget/visitor/consent`)
  ↓ [CONNECTED]
Chat Interaction (`POST /api/v1/widget/chat/message`)
  ↓ [CONNECTED]
Product Recommendations (`chatRepo.addRecommendation` -> `recommendations` table)
  ↓ [CONNECTED]
Product Card Display (Shadow DOM rendering)
  ↓ [PARTIALLY CONNECTED]
Add to Cart Click (`syncShopifyCartAttributes` -> `/cart/add.js` -> `POST /api/v1/widget/events`)
  ↓ [CONNECTED]
Shopify Checkout
  ↓ [CONNECTED]
Order Placement
  ↓ [CONNECTED]
Shopify Webhook (`POST /api/v1/shopify/webhooks` with topic `orders/create`)
  ↓ [CONNECTED]
Order Webhook Ingestion (`WebhookService.processOrderWebhook`)
  ↓ [CONNECTED]
Customer & Purchase Event Logging (`events` table: `purchase_completed`)
  ↓ [CONNECTED]
Downstream Processing:
  ├── WhatsApp Order Confirmation (`WhatsAppService.processOrderNotification`) [CONNECTED]
  ├── Auto Replenishment Engine (`ReplenishmentService.handleOrderCompleted`) [CONNECTED]
  └── Multi-Touch Attribution (`AttributionService.processOrderAttribution`) [CONNECTED]
```

---

### Flow B: Ad to Purchase Journey
```
External Ad Click (Meta / Google / TikTok)
  ↓ [BROKEN - FIXED IN PHASE 16]
URL Query Parameters (?utm_source=...&utm_medium=...&fbclid=...&gclid=...)
  ↓ [BROKEN - FIXED IN PHASE 16]
Storefront Widget Initialization
  ↓ [BROKEN - FIXED IN PHASE 16]
Marketing Touchpoint Ingestion (`POST /api/v1/attribution/touchpoint`)
  ↓ [CONNECTED]
Visitor Session Linking (`marketing_touchpoints` table)
  ↓ [CONNECTED]
Customer Engagement / Product Interaction
  ↓ [CONNECTED]
Cart Addition & Shopify Checkout
  ↓ [CONNECTED]
Shopify Order Webhook
  ↓ [CONNECTED]
Deterministic Attribution Calculation (First-Touch, Last-Touch, Linear Multi-Touch)
  ↓ [CONNECTED]
Ad Spend Reconciliation & ROAS Calculation (`calculateRoas` with zero-division guard)
  ↓ [CONNECTED]
Ad Intelligence Dashboard Display
```

---

### Flow C: Abandoned Cart Recovery Journey
```
Visitor Views Product & Adds to Cart
  ↓ [CONNECTED]
`add_to_cart` Event Emitted (`POST /api/v1/widget/events`)
  ↓ [BROKEN / NOT CONNECTED - FIXED IN PHASE 16]
Automated Abandoned Cart Recovery Scheduling
  ↓ [CONNECTED]
Marketing Consent Check (`marketing_consents.opted_in` / `whatsapp_consents.opted_in`)
  ↓ [CONNECTED]
Suppression & Unsubscribe Check (`suppression_list`)
  ↓ [CONNECTED]
Recovery Job Queued (`email_campaign_events` / `whatsapp_recovery_jobs`)
  ↓ [CONNECTED]
Worker Dispatch (`EmailWorker` / `WhatsAppService.processRecoveryJob`)
  ↓ [CONNECTED]
Customer Clicks Recovery Link
  ↓ [CONNECTED]
Shopify Cart Permalinks Pre-loaded
  ↓ [CONNECTED]
Customer Completes Purchase
  ↓ [BROKEN - FIXED IN PHASE 16]
Cancellation of Pending Recovery Jobs Upon Purchase
```

---

### Flow D: Auto Replenishment Reorder Journey
```
Shopify Order Webhook Ingested
  ↓ [CONNECTED]
Consumable Catalogue Check (`replenishment_product_settings.is_replenishable = true`)
  ↓ [CONNECTED]
Deterministic Schedule Calculation (`scheduled_at = order_date + consumption_days - buffer_days`)
  ↓ [CONNECTED]
Schedule Created (`replenishment_schedules` table)
  ↓ [CONNECTED]
Schedule Reaches Due Date
  ↓ [CONNECTED]
`ReplenishmentWorker` Polling Cycle
  ↓ [CONNECTED]
Multi-Channel Consent Check (Independent Email & WhatsApp verification)
  ↓ [CONNECTED]
1-Click Shopify Cart Permalinks Dispatched (`/cart/:variantId:1?discount=:code`)
  ↓ [CONNECTED]
Customer Clicks Permalink (`/api/v1/reorder/:storeId/:scheduleId/click`)
  ↓ [CONNECTED]
Subsequent Purchase Placed
  ↓ [CONNECTED]
Previous Pending Schedules Cancelled (`cancel_reason = 'repurchased'`) & New Cycle Scheduled
```

---

### Flow E: AI-Assisted Revenue Journey
```
Visitor Engages with AI Assistant
  ↓ [CONNECTED]
AI Generates Grounded Catalogue Recommendations
  ↓ [CONNECTED]
Recommendation Logged (`recommendations` table)
  ↓ [CONNECTED]
Visitor Browses Store & Purchases within 30-day Window
  ↓ [CONNECTED]
Order Webhook Ingested (`orders/create`)
  ↓ [CONNECTED]
Attribution Service Detects AI Engagement within 30 days (`chat_sessions` & `recommendations`)
  ↓ [CONNECTED]
Order Flagged with `is_ai_assisted: true`
  ↓ [CONNECTED]
Surfaced in Overview, Live Pulse, and Ad Intelligence Dashboards
```

---

## 3. Comprehensive Connection Classification Matrix

| Connection Point | Source | Target | Status | Failure Mode / Disconnect Description |
|---|---|---|:---:|---|
| **Widget $\rightarrow$ Touchpoint API** | `widget.js` | `POST /api/v1/attribution/touchpoint` | **BROKEN** | Widget only parsed `utm_source` into `sessionStorage` and never emitted touchpoint with `fbclid`, `gclid`, `ttclid`, or UTM parameters to attribution engine. |
| **Widget $\rightarrow$ Cart Attributes** | `widget.js` | `/cart/update.js` | **PARTIALLY CONNECTED** | `syncShopifyCartAttributes` hardcoded `utm_source: 'ai_smart_engine'`, overwriting incoming ad campaign parameters if customer arrived via paid ads. |
| **Cart Add $\rightarrow$ Recovery Schedule** | `POST /api/v1/widget/events` | `email_campaign_events` / `whatsapp_recovery_jobs` | **NOT CONNECTED** | `add_to_cart` event was stored in `events` table, but no recovery job was scheduled automatically for consented visitors. Recovery scheduling was only present in test endpoints. |
| **Order Webhook $\rightarrow$ Recovery Cancellation** | `WebhookService` | `email_campaign_events` / `whatsapp_recovery_jobs` | **BROKEN** | Incoming orders did not cancel pending abandoned cart recovery jobs for the customer, risking sending recovery nudges after purchase completed. |
| **Widget $\rightarrow$ Session API** | `widget.js` | `POST /api/v1/widget/session` | **CONNECTED** | Correctly establishes anonymous visitor and chat session with store ID and origin validation. |
| **Chat $\rightarrow$ AI Provider** | `POST /api/v1/widget/chat/message` | `IAiProvider` | **CONNECTED** | History, catalog subset, and policies passed into provider; responses sanitized before returning. |
| **AI $\rightarrow$ Recommendation Table** | `chatRepo` | `recommendations` | **CONNECTED** | Product IDs validated against catalog subset and inserted with titles, prices, and image URLs. |
| **Widget $\rightarrow$ Product Clicks** | `widget.js` | `POST /api/v1/widget/events` | **CONNECTED** | Product click tracks `product_click` event and refreshes cart attributes. |
| **Shopify Webhook $\rightarrow$ Order Attribution** | `WebhookService` | `AttributionService` | **CONNECTED** | Resolves touchpoints, computes First/Last/Linear models, detects AI assistance, and saves records idempotently. |
| **Shopify Webhook $\rightarrow$ Replenishment** | `WebhookService` | `ReplenishmentService` | **CONNECTED** | Filters replenishable items, schedules reminders, and suppresses prior un-dispatched schedules. |
| **Replenishment $\rightarrow$ Worker Dispatch** | `ReplenishmentWorker` | `IEmailProvider` / `IWhatsAppProvider` | **CONNECTED** | Batch polls due schedules, checks independent consent, and emits permalinks. |
| **Ad Spend $\rightarrow$ ROAS Computation** | `ad_spend` | `AttributionService.calculateRoas` | **CONNECTED** | Deterministic math with zero-division protection returning `0.00x` when spend $\le 0$. |
| **Merchant Dashboard $\rightarrow$ Backend** | `app.js` | `dashboard.routes.ts` | **CONNECTED** | All dashboard tabs (Overview, Live Pulse, Catalog, WhatsApp, Email, Reorders, Ad Intelligence) call verified endpoints with JWT auth and store isolation. |

---

## 4. Root Causes & Detailed Disconnect Analysis

### 1. The Ad Touchpoint Ingestion Gap
- **Why it occurred**: Phase 15 created `POST /api/v1/attribution/touchpoint` and verified it via integration tests (`supertest`). However, `widget.js` (the client-side storefront script) was not updated to extract `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, and `ttclid` from `window.location.search` and send them to the public touchpoint endpoint.
- **Impact**: Without inline UTM attributes from checkout or manual API posts, real ad clicks landing on Shopify storefronts were not getting recorded in `marketing_touchpoints`.
- **Resolution**: Update `src/public/widget.js` to detect marketing query parameters on initial page load, store them in `sessionStorage` and `localStorage`, post them asynchronously to `/api/v1/attribution/touchpoint`, and merge them into Shopify cart note attributes.

### 2. The Abandoned Cart Auto-Scheduling Gap
- **Why it occurred**: Phase 5 built the `email.worker.ts` and `email_campaign_events` table, but scheduling was only triggered via test endpoint `/api/v1/widget/test/schedule-email`. Phase 13 created `whatsapp_recovery_jobs` and `scheduleRecovery` in `WhatsAppService`, but no event hook connected storefront cart additions to the scheduler.
- **Impact**: Abandoned cart recovery jobs never populated organically during real visitor browse sessions.
- **Resolution**: In `src/server/routes/widget.routes.ts`, when `POST /api/v1/widget/events` receives `type: 'add_to_cart'`, verify if visitor has email or phone. If marketing consent is active, schedule an email recovery job (default 1-hour delay) and/or WhatsApp recovery job (default 30-minute delay).

### 3. The Order Webhook Recovery Cancellation Gap
- **Why it occurred**: `WebhookService.processOrderWebhook` triggered WhatsApp order notifications, replenishment, and attribution, but did not update the `email_campaign_events` or `whatsapp_recovery_jobs` tables.
- **Impact**: A customer who added to cart, received an abandoned cart job in queue, and subsequently completed checkout on Shopify could still be sent an abandoned cart reminder.
- **Resolution**: In `WebhookService.processOrderWebhook`, add an automated cancellation step:
  - `UPDATE email_campaign_events SET status = 'cancelled', cancel_reason = 'purchased' WHERE store_id = $1 AND (visitor_id = $2 OR session_id = $3) AND status = 'pending'`
  - `UPDATE whatsapp_recovery_jobs SET status = 'cancelled', cancel_reason = 'purchased' WHERE store_id = $1 AND (visitor_id = $2 OR phone_number = $3) AND status = 'pending'`

---

## 5. Scope of Phase 16 Growth Copilot
The **AI Merchant Growth Copilot & Action Center** acts as the overarching analytical brain connecting all audited modules:
1. **Unifies Signals**: Aggregates conversion funnel drop-offs, ad spend ROAS anomalies, abandoned cart volumes, replenishment queues, and AI assistant engagement.
2. **Deterministic Opportunities**: Implements 8 strict mathematical rules to identify high-leverage growth opportunities without LLM hallucinations.
3. **Action Routing**: Instead of duplicating tools, the Action Center provides 1-click navigation into the existing audited modules (`ad-intelligence`, `email-automation`, `whatsapp-growth`, `reorder-reminders`, `my-agent`).
4. **Merchant Goals**: Aligns opportunity prioritization with merchant strategic objectives (`increase_revenue`, `improve_roas`, `improve_conversion`, `increase_repeat_purchases`, `recover_abandoned_carts`, `improve_ai_conversion`).
5. **AI Contextualization**: Uses generative AI strictly to explain verified numbers in plain language, with zero authority to alter financial calculations.
