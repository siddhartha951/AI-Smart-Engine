# AI Smart Engine 🚀
### Enterprise-Grade Multi-Tenant AI Shopping Assistant & Abandoned Cart Recovery Platform for Shopify

[![Test Suite](https://img.shields.io/badge/Tests-83%2F83%20Passing-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)]()
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)]()
[![Database](https://img.shields.io/badge/Database-PostgreSQL%2014%2B-blue.svg)]()
[![Email](https://img.shields.io/badge/Email-Resend%20Platform-black.svg)]()
[![Deployment](https://img.shields.io/badge/Deploy-Railway-blueviolet.svg)]()

**AI Smart Engine** is a high-performance, multi-tenant conversational commerce backend and storefront widget engine designed for Shopify merchants. It empowers stores to engage visitors with an AI-driven sales assistant, intelligently recover abandoned carts and checkouts through personalized email sequences via **Resend**, and strictly enforce multi-tenant isolation, AI budget guards, and GDPR / UK PECR privacy compliance.

---

## 📑 Table of Contents
1. [Core Features](#-core-features)
2. [High-Level Architecture](#-high-level-architecture)
3. [Multi-Tenant Architecture Explained](#-multi-tenant-architecture-explained)
4. [Shopify Storefront Integration (Widget Setup)](#-shopify-storefront-integration-widget-setup)
5. [Resend Custom Sender Domain Setup](#-resend-custom-sender-domain-setup)
6. [Railway Deployment Guide](#-railway-deployment-guide)
7. [Environment Variables Reference](#-environment-variables-reference)
8. [API & Webhook Endpoints](#-api--webhook-endpoints)
9. [Local Development & Testing](#-local-development--testing)
10. [Security & Compliance](#-security--compliance)

---

## 🌟 Core Features

- 🏢 **Strict Multi-Tenant Isolation**: Every database query is tenant-scoped via foreign keys and store constraints. Store A can never inspect, modify, or send emails on behalf of Store B.
- 💬 **Lightweight Shadow DOM Widget (`widget.js`)**: Isolated CSS with zero theme styling collisions. Includes dynamic color theming, mobile responsiveness, auto-positioning, product carousels, and one-click cart additions.
- 🤖 **AI Recommendation Engine (`gpt-4o-mini`)**: Context-aware product search and conversational selling using catalog knowledge retrieval.
- 🛡️ **Hard AI Budget Guards**: Pre-computes exact token costs per query; automatically freezes AI capabilities if a merchant reaches their allocated spending threshold.
- 📬 **Resend Platform Integration**: Powered by a single platform API key. Supports merchant-branded custom sender domains (SPF/DKIM/MX), real-time webhook status processing (delivered, bounced, opened, complained), and automated recipient suppression.
- 🔒 **GDPR & UK PECR Compliance**: Granular marketing consent tracking with timestamping and source tracking; instant unsubscribe endpoints; purchase webhook listener that automatically cancels pending recovery emails upon order placement.
- ⚡ **Lock-Free Asynchronous Email Worker**: Built with PostgreSQL `FOR UPDATE SKIP LOCKED` for reliable, horizontally scalable, concurrent email dispatching without duplicate sends.
- 📊 **Modern Visual Dashboards**: Glassmorphism UI with Three.js interactive 3D backgrounds for Merchant Owners and Platform Super Admins.

---

## 🏛️ High-Level Architecture

```mermaid
flowchart TD
    subgraph Storefront ["Shopify Storefront"]
        W[Lightweight Widget (Shadow DOM)]
        C[Shopper / Visitor]
        C <--> W
    end

    subgraph Backend ["AI Smart Engine Platform (Railway / Node.js)"]
        API[Express API Gateway]
        AUTH[Store Auth & Rate Limiter]
        AI[AI Recommendation Engine]
        WORKER[Asynchronous Email Worker]
        SEC[AES-256-GCM Encryption]
    end

    subgraph Storage ["PostgreSQL 14+"]
        DB[(Multi-Tenant Database)]
    end

    subgraph External ["External Services"]
        OAI[OpenAI gpt-4o-mini]
        RES[Resend Email API]
        SHOPIFY[Shopify Store Admin API]
    end

    W -- "data-widget-key / session" --> API
    API --> AUTH --> DB
    API --> AI --> OAI
    SHOPIFY -- "orders/create Webhook" --> API
    API -- "Cancel Pending Emails" --> DB
    WORKER -- "FOR UPDATE SKIP LOCKED" --> DB
    WORKER --> RES
    RES -- "Delivery / Bounce Webhooks" --> API
```

---

## 💡 Multi-Tenant Architecture Explained

> **Key Takeaway**: You do **NOT** need to edit Railway environment variables every time a new client onboard!

The platform uses a **Centralized Multi-Tenant** design:
1. **Platform-Level Secrets** (such as your platform `RESEND_API_KEY`, `DATABASE_URL`, `ENCRYPTION_KEY`, and `OPENAI_API_KEY`) reside in Railway environment variables.
2. **Merchant-Specific Credentials** (Shopify store domains, encrypted API tokens, widget keys, and custom sender domains) are securely stored in the PostgreSQL database.
3. When a merchant signs up via the Onboarding API (`/api/v1/onboarding/stores`), the system generates a unique `widget_key`, stores their encrypted credentials using AES-256-GCM, and creates their merchant profile automatically.

---

## 🛍️ Shopify Storefront Integration (Widget Setup)

To install the AI shopping assistant on any Shopify merchant storefront:

### Step 1: Obtain the Merchant's Widget Key
Log into the Merchant Dashboard or query `/api/v1/dashboard/overview` to get the store's `widget_key`.

### Step 2: Inject the Script in `theme.liquid`
In the Shopify Admin:
1. Navigate to **Online Store** > **Themes**.
2. Click the `...` menu next to the live theme > **Edit code**.
3. Open `layout/theme.liquid`.
4. Scroll to the bottom and paste the following snippet right before the closing `</body>` tag:

```html
<!-- AI Smart Engine Storefront Widget -->
<script 
  src="https://your-engine-domain.up.railway.app/widget.js" 
  data-widget-key="YOUR_STORE_WIDGET_KEY_HERE" 
  data-api-url="https://your-engine-domain.up.railway.app" 
  defer>
</script>
```

> **Important**: Always specify `data-api-url` so the widget knows your Railway backend domain when running on the merchant's custom domain (e.g. `https://client-store.com`).

### Step 3: Test Storefront Widget
Visit the merchant's storefront in an incognito browser window. A floating launcher icon will appear in the bottom-right corner.

---

## 📧 Resend Custom Sender Domain Setup

To send abandoned checkout recovery emails from the merchant's own domain (e.g., `deals@clientstore.com`):

### 1. Register Domain
In the Merchant Dashboard or via API:
```bash
POST /api/v1/dashboard/domains
Authorization: Bearer <MERCHANT_JWT>
Content-Type: application/json

{
  "domain": "clientstore.com",
  "from_email": "deals@clientstore.com",
  "from_name": "Client Store Deals"
}
```

### 2. Configure DNS Records
The API returns required DNS records generated by Resend (DKIM TXT, SPF MX/TXT). The merchant adds these records in their DNS provider (Cloudflare, GoDaddy, Namecheap, etc.):
- **DKIM (TXT)**: `resend._domainkey.clientstore.com`
- **SPF (TXT)**: `v=spf1 include:amazonses.com ~all`
- **MX (Optional)**: `feedback-smtp.resend.com`

### 3. Verify Domain
Once DNS records propagate (typically 5–30 minutes):
```bash
POST /api/v1/dashboard/domains/verify
Authorization: Bearer <MERCHANT_JWT>
```
The system marks the domain as `verified`. Email recovery sequences are automatically unlocked.

---

## 🚀 Railway Deployment Guide

This project contains native configuration (`railway.json`) for seamless 1-click deployment on [Railway](https://railway.app).

### Step 1: Push Repository to GitHub
```bash
git init
git add .
git commit -m "feat: initial commit of AI Smart Engine"
git remote add origin https://github.com/your-username/ai-smart-engine.git
git branch -M main
git push -u origin main
```

### Step 2: Create a Project in Railway
1. Go to [Railway.app](https://railway.app) and create a **New Project**.
2. Select **Deploy from GitHub repo** and choose `ai-smart-engine`.
3. Add a **PostgreSQL** database service to the same project. Railway automatically exposes the connection string as `DATABASE_URL`.

### Step 3: Set Production Environment Variables
In the Railway Web Service settings > **Variables**, add:

| Variable | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `NODE_ENV` | Runtime environment | `production` |
| `PORT` | Server listen port | `3000` (or Railway default) |
| `DATABASE_URL` | PostgreSQL connection URI | `${{Postgres.DATABASE_URL}}` |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256 | Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_SECRET` | Secret key for JWT auth | Long random string (32+ chars) |
| `OPENAI_API_KEY` | OpenAI API key | `sk-proj-...` |
| `RESEND_API_KEY` | Resend platform API key | `re_...` |
| `PLATFORM_ADMIN_SECRET` | Secret to provision admin tokens | Long random string |

### Step 4: Run Database Migrations
Migrations run automatically, or can be triggered via Railway CLI / deploy command:
```bash
npm run migrate
```

### Step 5: (Optional) Dedicated Email Worker Service
For large-scale deployments:
1. In Railway, click **+ New** > select your same GitHub repo.
2. Under **Service Settings** > **Deploy**, set the Custom Start Command to:
   ```bash
   npm run worker
   ```
3. Share the same environment variables. The worker will poll `email_campaign_events` independently using `FOR UPDATE SKIP LOCKED`.

---

## 🔧 Environment Variables Reference

| Variable | Type | Default / Fallback | Purpose |
| :--- | :--- | :--- | :--- |
| `PORT` | Number | `3000` | Express HTTP listen port |
| `NODE_ENV` | String | `development` | Set to `production` in live environments |
| `DATABASE_URL` | String | `mock` (in tests) | PostgreSQL connection string |
| `ENCRYPTION_KEY` | String (64 hex chars) | Random generated | AES-256-GCM merchant token encryption |
| `JWT_SECRET` | String | Dev fallback | Signs auth tokens for merchant & admin logins |
| `OPENAI_API_KEY` | String | `mock` | Powers AI catalog recommendations |
| `RESEND_API_KEY` | String | `mock` | Platform email dispatching via Resend |
| `SHOPIFY_CLIENT_SECRET` | String | `mock` | Verifies Shopify webhook signatures (HMAC) |
| `PLATFORM_ADMIN_SECRET` | String | Dev fallback | Guard for creating platform super-admins |

---

## 📡 API & Webhook Endpoints

### Storefront Widget APIs (Public / Origin-Verified)
- `GET  /api/v1/widget/config` - Fetches widget branding and assistant configuration
- `POST /api/v1/widget/session` - Initializes or resumes a shopper chat session
- `POST /api/v1/widget/chat` - Sends shopper message; returns AI recommendations
- `POST /api/v1/widget/consent` - Records GDPR/PECR marketing consent

### Onboarding & Authentication
- `POST /api/v1/onboarding/stores` - Self-service merchant store registration
- `POST /api/v1/onboarding/register-owner` - Creates store owner credentials
- `POST /api/v1/onboarding/login` - Merchant owner dashboard authentication
- `POST /api/v1/onboarding/domains` - Configures custom Resend sender domain
- `GET  /api/v1/onboarding/domains/:store_id` - Checks domain verification status

### Merchant Dashboard (`/api/v1/dashboard/*`)
- `GET  /api/v1/dashboard/overview` - Real-time metrics (sessions, conversions, budget usage)
- `POST /api/v1/dashboard/regenerate-key` - Rotates widget key safely
- `PUT  /api/v1/dashboard/settings` - Updates agent persona, colors, and thresholds
- `GET  /api/v1/dashboard/domains` - Retrieves sender domain DNS records
- `POST /api/v1/dashboard/domains/verify` - Triggers Resend DNS verification

### Webhook Handlers
- `POST /api/v1/webhooks/shopify/orders-create` - Listens for orders; stops recovery sequence
- `POST /api/v1/webhooks/resend` - Processes bounces, complaints, and delivery receipts

### Platform Health
- `GET  /health` or `GET /api/v1/health` - Liveness & database connection probe

---

## 🧪 Local Development & Testing

### Prerequisites
- Node.js 20+
- npm 9+

### 1. Installation
```bash
git clone https://github.com/your-username/ai-smart-engine.git
cd ai-smart-engine
npm install
```

### 2. Environment Configuration
```bash
cp .env.example .env
```
*(By default, `.env.example` is pre-configured with mock adapters for instant zero-dependency local testing).*

### 3. Run Test Suite
The test suite utilizes `pg-mem` to simulate complete PostgreSQL schemas and migrations in-memory. No live PostgreSQL or Redis instance is required to execute tests:
```bash
# Run all 83 integration tests
npm test

# Run tests with coverage
npm run test:coverage
```

### 4. Run Development Server
```bash
npm run dev
```
Visit `http://localhost:3000` to view the merchant dashboard, or test widget assets at `http://localhost:3000/widget.js`.

---

## 🛡️ Security & Compliance

- **GDPR / PECR**: No marketing email is ever dispatched without an explicit `opt_in` record in `marketing_consents`.
- **Suppression Protection**: Unsubscribes, hard bounces, and spam complaints immediately write to the `email_suppressions` table. Pre-send hooks hard-reject any suppressed address.
- **Idempotency**: All email campaign executions generate a unique deterministic key (`store_id:session_id:step_index`), preventing duplicate sends.
- **Encrypted Credentials**: Merchant Shopify tokens are encrypted with `AES-256-GCM` before being written to disk.
- **Budget Protection**: AI usage is metered per request and tracked in `ai_usage_ledger`. When a store reaches its monthly limit, assistant responses fall back to default store messaging.

---

## 📄 License
This project is licensed under the ISC License.
