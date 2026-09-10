# Internal Support & Operations Runbook

This runbook outlines operational procedures and technical diagnostics for support engineers managing the pilot merchant store.

---

## 1. System Architecture & Key Services

| Service / Component | Role | Health Endpoint / Verification |
|---|---|---|
| **Core API Server** | Express web server, Widget API & Webhooks | `GET /health` -> `{ status: "ok", database: "connected" }` |
| **Email Worker** | Background recovery email processor | `src/server/worker.ts` or integrated runner |
| **Admin Dashboard** | Super admin overview, alerts, controls | `GET /admin/index.html` |
| **Merchant Dashboard** | Merchant analytics, policies, agent toggle | `GET /dashboard/index.html` |
| **PostgreSQL Database** | Storage for visitors, chat, events, ledger | Connection via `DATABASE_URL` |

---

## 2. Common Support Scenarios & Quick Fixes

### Scenario A: Merchant says "Widget is not showing up on our site"
1. **Check Script HTTPS URL**:
   - Inspect the live store via DevTools (`F12` -> Network).
   - Verify `widget.js` returns HTTP 200 and NOT `net::ERR_NAME_NOT_RESOLVED` or Mixed-Content block.
2. **Check Agent Active Status**:
   - Query database:
     ```sql
     SELECT is_active FROM assistant_settings s
     JOIN stores st ON st.id = s.store_id
     WHERE st.shop_domain = 'merchant-domain.myshopify.com';
     ```
   - If `is_active` is `false`, the assistant was paused (either manually or via connection alert).
3. **Check Allowed Origin**:
   - If the merchant has multiple custom domains (e.g. `store.com` vs `store.myshopify.com`), verify `validateStoreOrigin` allows the origin.

### Scenario B: AI responses are slow or returning fallbacks
1. Check OpenAI budget ledger:
   ```sql
   SELECT SUM(estimated_cost_usd) FROM ai_usage_ledger 
   WHERE store_id = (SELECT id FROM stores WHERE shop_domain = 'merchant-domain.myshopify.com');
   ```
2. If total spend >= $14.00, the **Hard Stop Threshold** has triggered.
   - Admin can increase limit in Admin Dashboard -> Platform Controls -> Budget.
3. Check OpenAI API quota or upstream rate limits in application logs.

### Scenario C: Merchant wants to change Assistant Tone or Welcome Message
1. Log in to Merchant Dashboard -> Assistant Setup.
2. Update tone (`Professional`, `Friendly`, `Luxury`) or custom prompt instructions.
3. Click **Save Changes**. Changes take effect instantly on subsequent widget chats without code changes.

---

## 3. Database Diagnostics Queries

### Recent Store Events
```sql
SELECT type, payload, created_at 
FROM events 
WHERE store_id = '<STORE-ID>' 
ORDER BY created_at DESC 
LIMIT 25;
```

### Active Alerts
```sql
SELECT id, type, severity, message, created_at 
FROM admin_alerts 
WHERE acknowledged = FALSE 
ORDER BY created_at DESC;
```

### Email Suppression Check
```sql
SELECT * FROM suppression_list 
WHERE store_id = '<STORE-ID>' AND email = '<CUSTOMER-EMAIL>';
```
