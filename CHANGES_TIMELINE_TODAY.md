# AI Smart Engine — Daily Engineering Timeline & Changelog
**Date:** September 23–24, 2026  
**Time Range:** 17:39 IST – 02:00 IST  
**Environment:** Production (`main`) & Development  
**Deployment Target:** Railway (`https://web-production-d5df.up.railway.app`)  
**Production Status:** 🟢 All systems operational, zero database drops, 2 live merchants fully preserved.

---

## Executive Summary

Today's engineering effort delivered major capabilities, UI/UX polish, customer support automation, and critical resilience hotfixes across both the storefront widget and the merchant administration dashboard:

1. **Customer Support Tickets & Human Helpdesk Module**: Full end-to-end ticketing system with storefront escalation, email confirmation receipts with configurable SLA revert durations, merchant dashboard ticket management, full chat transcript viewer, and **✨ AI Auto-Generate Reply**.
2. **Product Suggestion & Recommendation Alignment**: Fixed algorithm mismatch so recommended product cards strictly match the AI's response text rather than showing unrelated bestsellers.
3. **Multi-Tenant Custom Brand Reply-To Email**: Ticket emails are routed with `replyTo: supportContact` (e.g. `help@getaniwell.com`), ensuring customer replies reach the merchant's support desk directly.
4. **Bestseller & Search Intelligence**: Excluded $0 sample items from bestseller queries, and expanded stop-words to prevent natural queries (e.g., *"best sellers"*) from being emptied.
5. **UI & Currency Standardization**: Replaced hardcoded currency symbols with dynamic store currency (`USD`, `INR`, etc.) across all telemetry, and enforced high-contrast `#ffffff` text on user chat bubbles.
6. **Critical Hotfix (Widget & Dashboard Recovery)**: Resolved missing CSS closing bracket in `widget.js` that caused launcher disappearance, fixed mobile drawer navigation in `styles.css`, and eliminated Temporal Dead Zone (TDZ) in `app.js`.

---

## Chronological Commits Timeline

| Time (IST) | Commit Hash | Scope | Description |
|---|---|---|---|
| **17:39:03** | `1b18800` | Entitlements & CORS | Added individual feature keys for Meta Ads, Ads Explorer, AI Agent; fixed Shopify preview CORS |
| **18:20:49** | `acf4128` | AI Formatting & Scraper | AI response beautification, stop-words search relevance, bestseller ranking, store website learning scraper |
| **19:03:15** | `e82404a` | Database Migrator | Stripped UTF-8 BOM from SQL migrations to prevent PostgreSQL syntax error at startup |
| **19:32:55** | `9b93b6d` | Scraper Service | Fixed SQL column reference from `s.name` to `s.brand_name` in website scraper |
| **20:05:23** | `01f68d9` | Scraper & Knowledge | Added dashboard authorization header & implemented AI-powered knowledge synthesis |
| **22:48:38** | `303de3a` | Tickets & Currency | Customer support tickets helpdesk, recommendation alignment, white chat text, USD currency standardization |
| **01:15:52** | `03347f3` | SLA & Brand Email | Support tickets SLA duration, brand reply-to email, bestseller filter, widget 1-tap chip & UI |
| **01:55:34** | `c61a8b9` | Widget & Dashboard Hotfix | Restored chatbot launcher visibility (CSS fix) and merchant dashboard navigation options |

---

## Detailed Milestone Breakdown

### Milestone 1: Meta Ads, Ads Explorer, AI Agent Feature Keys & Shopify CORS
**Timestamp:** 2026-09-23 17:39:03 IST  
**Commit:** `1b18800`  
**Files Modified:**
- [`migrations/030_new_feature_keys.sql`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/migrations/030_new_feature_keys.sql)
- [`src/modules/entitlements/entitlement.types.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/modules/entitlements/entitlement.types.ts)
- [`src/server/middlewares/cors.middleware.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/middlewares/cors.middleware.ts)
- [`src/server/routes/dashboard.routes.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/routes/dashboard.routes.ts)
- [`src/public/dashboard/js/app.js`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/dashboard/js/app.js)

**What Was Done:**
- Added individual feature entitlement keys: `meta_ads`, `ads_explorer`, and `ai_agent_chat` to allow independent feature toggling per merchant store.
- Created database migration `030_new_feature_keys.sql` to backfill entitlements for all existing registered stores.
- Updated `cors.middleware.ts` to allow Shopify admin, preview links, and Cloudflare/ngrok developer tunnels to preview storefront widgets without blocking CORS headers.

---

### Milestone 2: AI Response Beautification, Search Stop-Words & Website Learning Scraper
**Timestamp:** 2026-09-23 18:20:49 IST  
**Commit:** `acf4128`  
**Files Modified:**
- [`migrations/031_product_knowledge_and_bestsellers.sql`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/migrations/031_product_knowledge_and_bestsellers.sql)
- [`src/modules/knowledge/website-scraper.service.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/modules/knowledge/website-scraper.service.ts)
- [`src/providers/ai/openai.provider.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/ai/openai.provider.ts)
- [`src/providers/ai/gemini.provider.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/ai/gemini.provider.ts)
- [`src/providers/shopify/live.shopify.adapter.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/shopify/live.shopify.adapter.ts)
- [`src/public/widget.js`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/widget.js)
- [`src/server/app.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/app.ts)

**What Was Done:**
- **Chat Typography & Structure**: Implemented `formatChatContent()` in `widget.js` to parse markdown paragraphs, format clean bullet points (`•`, `-`, `*`), and prevent unbroken sentence runs.
- **Search Stop Words**: Added e-commerce noise words (`seller`, `sellers`, `bestseller`, `popular`, `top`) to stop words lists so searches for *"best sellers"* do not degrade into empty queries.
- **Store Website Learning Scraper**: Introduced `WebsiteScraperService` to autonomously crawl merchant homepage, about page, and policy links to enrich the store's AI knowledge base.

---

### Milestone 3: Database Migrator Fix & Knowledge Base AI Synthesis
**Timestamps:** 2026-09-23 19:03:15 – 20:05:23 IST  
**Commits:** `e82404a`, `9b93b6d`, `01f68d9`  
**Files Modified:**
- [`src/database/migrator.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/database/migrator.ts)
- [`src/modules/knowledge/website-scraper.service.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/modules/knowledge/website-scraper.service.ts)
- [`src/public/dashboard/js/app.js`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/dashboard/js/app.js)
- [`tests/unit/website_scraper.test.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/tests/unit/website_scraper.test.ts)

**What Was Done:**
- **UTF-8 BOM Stripping**: Windows text editors can prepend byte-order marks (`0xFEFF`) to `.sql` files, causing PostgreSQL syntax errors (`syntax error at or near "﻿--"`). Added automatic BOM stripping in `migrator.ts`.
- **Database Column Name Alignment**: Fixed query in `website-scraper.service.ts` to select `brand_name` (actual schema column) instead of `name`.
- **AI Knowledge Synthesis**: Scraped website data is now synthesized using OpenAI/Gemini into clean, concise operational FAQs and appended directly to `assistant_settings.knowledge_base`.

---

### Milestone 4: Customer Support Tickets Helpdesk, Recommendation Alignment, White Chat Text & USD Standardization
**Timestamp:** 2026-09-23 22:48:38 IST  
**Commit:** `303de3a`  
**Files Modified:**
- [`migrations/032_support_tickets.sql`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/migrations/032_support_tickets.sql)
- [`src/modules/support_tickets/support-ticket.repository.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/modules/support_tickets/support-ticket.repository.ts)
- [`src/modules/support_tickets/support-ticket.service.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/modules/support_tickets/support-ticket.service.ts)
- [`src/server/routes/ticket.routes.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/routes/ticket.routes.ts)
- [`src/public/dashboard/index.html`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/dashboard/index.html)
- [`src/public/dashboard/js/app.js`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/dashboard/js/app.js)
- [`src/public/widget.js`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/widget.js)
- [`src/server/app.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/app.ts)
- [`src/providers/ai/openai.provider.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/ai/openai.provider.ts)
- [`tests/integration/support_tickets.test.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/tests/integration/support_tickets.test.ts)

**What Was Done:**
1. **User Bubble Text Color Fix**:
   - In `widget.js`, set `.msg.user` and `.msg.user *` text color to `#ffffff !important`, ensuring crisp, high-contrast white typography on all primary-colored user bubbles.
2. **Product Recommendation Alignment**:
   - OpenAI system instructions updated: when the AI recommends a specific product (e.g., `**Aniwell Itch Relief Formula**`), it strictly passes that exact product ID to the `recommend_products` tool call.
   - In `app.ts`, added bold title extraction (`/\*\*([^*]+)\*\*/g`), supplemental database lookup for items not in the initial 15-product sample, and token-overlap scoring (+150 points for title match) so relevant products never get overwritten by unrelated bestsellers.
3. **Customer Support Tickets & Helpdesk Module**:
   - **Schema**: Created `support_tickets` table (migration `032`) storing `store_id`, `session_id`, `customer_email`, `customer_name`, `subject`, `status`, `chat_transcript` (JSONB), `admin_reply`, and `resolved_at`.
   - **Storefront Escalation**: Added automated detection in `widget.js` when user asks for human help or when conversation reaches an impasse; renders an inline ticket creation card with email auto-fill.
   - **Merchant Dashboard Helpdesk**: Created a dedicated **Support Tickets** tab with counter badges (`Open`, `Replied`, `Resolved`), ticket filtering, detailed drawer showing the complete customer chat conversation transcript, and an **✨ AI Auto-Generate Reply** button.
4. **USD Currency Standardization**:
   - Replaced all hardcoded `₹` and `Rs.` with `getCurrencySymbol(state.activeStoreCurrency)` across overview metrics, analytics cards, tables, and widget previews.

---

### Milestone 5: Ticket Revert Duration SLA, Brand Reply-To Email, Bestseller Filter & Widget 1-Tap Chip
**Timestamp:** 2026-09-24 01:15:52 IST  
**Commit:** `03347f3`  
**Files Modified:**
- [`migrations/033_ticket_revert_duration.sql`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/migrations/033_ticket_revert_duration.sql)
- [`src/modules/support_tickets/support-ticket.service.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/modules/support_tickets/support-ticket.service.ts)
- [`src/providers/ai/openai.provider.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/ai/openai.provider.ts)
- [`src/providers/ai/gemini.provider.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/ai/gemini.provider.ts)
- [`src/providers/email/email.provider.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/email/email.provider.ts)
- [`src/providers/email/resend.email.provider.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/email/resend.email.provider.ts)
- [`src/providers/shopify/live.shopify.adapter.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/providers/shopify/live.shopify.adapter.ts)
- [`src/public/dashboard/index.html`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/dashboard/index.html)
- [`src/public/dashboard/js/app.js`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/dashboard/js/app.js)
- [`src/public/widget.js`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/widget.js)
- [`src/server/routes/dashboard.routes.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/routes/dashboard.routes.ts)
- [`tests/integration/support_tickets.test.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/tests/integration/support_tickets.test.ts)

**What Was Done:**
1. **Configurable Revert Duration SLA**:
   - Added `ticket_revert_duration VARCHAR(100) DEFAULT 'within 24 hours'` to `assistant_settings` (migration `033`).
   - Added SLA dropdown to **Agent Settings** in the dashboard (`within 2 hours`, `within 4 hours`, `within 24 hours`, `within 1-2 business days`).
   - Response SLA duration is quoted in ticket receipt confirmation emails and storefront chat responses.
2. **Multi-Tenant Custom Brand Reply-To Email**:
   - Extended email providers with `replyTo` parameter support.
   - When a ticket confirmation receipt or admin reply is dispatched, `replyTo: supportContact` (e.g. `help@getaniwell.com`) is injected so that customer email replies go directly to the merchant's customer service inbox.
3. **Bestseller $0 Sample Filter**:
   - Updated `live.shopify.adapter.ts` to strictly require `price > 0` for bestselling products, excluding free promotional gifts or test samples.
4. **Widget 1-Tap Quick Action Chip & Header Button**:
   - Redesigned the header **Need Help?** button (`.btn-need-help-header`) with pill styling and subtle glass border.
   - Added 1-tap quick action chip `[ 🛎️ Need Human Help? Open Ticket ]` right above the chat input bar.
   - If visitor email is already saved from session or consent, tapping "Open Ticket" instantly submits the ticket with zero redundant prompts.

---

### Milestone 6: Hotfix — Chatbot Launcher Visibility & Merchant Dashboard Navigation Recovery
**Timestamp:** 2026-09-24 01:55:34 IST  
**Commit:** `c61a8b9`  
**Files Modified:**
- [`src/public/widget.js`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/widget.js)
- [`src/public/dashboard/css/styles.css`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/dashboard/css/styles.css)
- [`src/public/dashboard/js/app.js`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/public/dashboard/js/app.js)
- [`src/server/app.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/app.ts)
- [`src/server/routes/dashboard.routes.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/routes/dashboard.routes.ts)
- [`src/server/routes/widget.routes.ts`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/src/server/routes/widget.routes.ts)

**Root Causes & Fixes:**
1. **Chatbot Launcher Invisible**:
   - In `widget.js` at line 941, the closing brace `}` of `#widget-container` CSS was missing. Inside the Shadow DOM, all subsequent styles (including `#launcher` styling, dimensions, and `pointer-events: auto`) failed to parse.
   - Added `}` closing brace.
   - Enhanced `autoMountWidget()` and `connectedCallback()` to support script URL query parameters (`widget.js?store_id=...` or `widget.js?key=...`) and window globals.
2. **Dashboard Mobile Drawer Navigation Missing**:
   - `styles.css` had `.sidebar.open { transform: translateX(280px); }` while `app.js` was toggling `sidebar.classList.add('mobile-open')`. On mobile/narrow screens, clicking the hamburger icon failed to display navigation options.
   - Added `.sidebar.mobile-open` selector to `styles.css` and updated `app.js` to toggle both classes.
3. **Temporal Dead Zone in `app.js`**:
   - `NAV_FEATURE_MAP` was defined at line 4560 while `showSection()` uses it at line 1282. Moved `NAV_FEATURE_MAP` to line 150 right after `sections`.
4. **Agent Active Default Status**:
   - In `dashboard.routes.ts`, `widget.routes.ts`, and `app.ts`, `is_active` defaulted to `false` if null. Updated to default to `true` (Active) unless explicitly toggled off by the merchant.

---

## Database Migrations Applied Today

1. [`migrations/030_new_feature_keys.sql`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/migrations/030_new_feature_keys.sql): Seeds `meta_ads`, `ads_explorer`, and `ai_agent_chat` feature entitlement rows for all stores.
2. [`migrations/031_product_knowledge_and_bestsellers.sql`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/migrations/031_product_knowledge_and_bestsellers.sql): Adds bestseller indexes and product knowledge support.
3. [`migrations/032_support_tickets.sql`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/migrations/032_support_tickets.sql): Creates `support_tickets` table with JSONB chat transcript, admin reply, status, and store foreign keys.
4. [`migrations/033_ticket_revert_duration.sql`](file:///c:/Users/siddh/OneDrive/Desktop/AI_SMART_ENGINE/migrations/033_ticket_revert_duration.sql): Adds `ticket_revert_duration VARCHAR(100) DEFAULT 'within 24 hours'` to `assistant_settings`.

---

## Verification & Quality Assurance Evidence

### 1. Headless Microsoft Edge (CDP) Testing
Verified using live CDP WebSocket connection to headless Microsoft Edge on port 9222:
```json
// Storefront Widget Verification
{
  "launcherFound": true,
  "launcherDisplay": "flex",
  "launcherVisibility": "visible",
  "launcherOpacity": "1",
  "launcherWidth": "198px",
  "launcherHeight": "50px",
  "launcherPointerEvents": "auto",
  "launcherText": "Ask Eco Stylist ✨"
}

// Query Parameter Script Tag Embedding (<script src="/widget.js?store_id=..."></script>)
{
  "mounted": true,
  "text": "Ask Eco Stylist ✨"
}

// Merchant Dashboard Navigation & Agent Section
{
  "dashboardVisible": true,
  "activeSection": "my-agent",
  "myAgentSectionActive": true,
  "agentIsActiveChecked": true,
  "agentNameVal": "EcoStylist AI",
  "agentSupportVal": "support@london-eco.co.uk",
  "agentSlaVal": "within 24 hours",
  "pillTrackOrderName": "Track My Order",
  "pillBestsellersName": "Best Sellers"
}
```

### 2. Automated Integration & Unit Tests
- **All 6 support ticket integration tests passed**: `tests/integration/support_tickets.test.ts` (100% pass).
- **TypeScript build compiled with zero errors**: `npm run build` (`tsc -p tsconfig.json`).
- **JavaScript syntax validated**: `node --check src/public/dashboard/js/app.js` and `node --check src/public/widget.js`.

---

## Summary of Active Merchant Guarantees
- **No breaking database changes**: All migrations use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.
- **Zero data loss**: Existing merchant catalogs, chat sessions, consent records, and store configurations remain completely intact.
- **Auto-deployment**: All 8 commits are pushed and deployed on Railway production (`main` branch).
