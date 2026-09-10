# Phase 10 Verification: Live Shopify Activation and Operational Tracking

## Verification Summary
This document summarizes the changes made to connect the verified merchant onboarding flow to the live Shopify API, establish a secure widget bootstrapping pipeline, and track operational metrics.

## Component Verification
### 1. `LiveShopifyAdapter`
- **Location**: `src/providers/shopify/live.shopify.adapter.ts`
- **Validation**: Implements `validateConnection` to securely decrypt credentials and verify against the Shopify Admin API.
- **Webhooks**: Implements `registerWebhooks` to subscribe to `orders/create` and `products/update`.
- **Error Handling**: Invalid credentials trigger an automatic status update (`connection_needs_attention`), pause the agent, and emit an admin alert.

### 2. Widget Activation & CORS
- **Location**: `src/server/routes/widget.routes.ts`
- **Security**: Utilizes `widget_key` to obscure the `store_id`.
- **Origin Validation**: `validateStoreOrigin` ensures requests originate from the approved `shop_domain` (with exceptions for local development).
- **Bootstrap**: Provides agent tone, welcome messages, and policies to the frontend without exposing API keys.

### 3. Tracking & Webhooks
- **Tracking Pipeline**: `POST /api/v1/widget/events` handles `widget_opened`, `add_to_cart`, `purchase_signal`, etc.
- **Webhook Ingress**: `POST /api/v1/shopify/webhooks/orders` protected by `X-Shopify-Hmac-Sha256` hashing of the raw request body.
- **Order Handling**: Correlates incoming orders with visitors via email.

## Test Results
Integration tests passing locally: `npx vitest tests/integration/phase10_shopify.test.ts`
- ✓ `should securely bootstrap the widget using widget_key and check origin` (tests valid local origin vs. rejected malicious origin).
- ✓ `should track widget opened event securely` (tests event tracking insertion).
- ✓ `should validate HMAC for Shopify webhooks` (simulates webhook payload, builds matching HMAC, validates).

## Monitoring Alerts
If credentials become invalid post-activation:
1. `validateConnection` or webhook endpoints catch HTTP 401/403.
2. Store `assistant_settings` `is_active` transitions to `false`.
3. `admin_alerts` inserts a 'high' severity alert visible on the Admin Dashboard.
