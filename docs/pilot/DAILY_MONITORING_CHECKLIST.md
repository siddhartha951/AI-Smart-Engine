# Daily Monitoring Checklist (Controlled Pilot)

Support engineers must perform this 5-minute routine every morning (09:00 local time) during the 14-day pilot window.

---

## 1. System Health & Process Status
- [ ] Verify Server status via Health endpoint:
  ```bash
  curl -s https://<DOMAIN>/health
  ```
  Expected: `{"status":"ok","database":"connected"}`.
- [ ] Verify Background Email Worker process is active and running.

---

## 2. Admin Dashboard Quick Check
Log in to `https://<DOMAIN>/admin/index.html`:
- [ ] **Alerts Panel**: Ensure 0 unacknowledged High or Critical severity alerts.
- [ ] **Merchant Status**: Verify Pilot Merchant status shows `ACTIVE` with a green indicator.
- [ ] **AI Budget Meter**: Confirm total platform spend is within the safe zone (< 66% of $15.00 limit).

---

## 3. Log Inspection & Error Detection
Check server logs for anomalies in the past 24 hours:
- [ ] No unhandled HTTP 500 status codes.
- [ ] No repeated `Shopify API 401/403 Unauthorized` errors.
- [ ] No unhandled Webhook HMAC validation failures.
- [ ] No database deadlocks or foreign key constraint exceptions.

---

## 4. Operational Telemetry & Funnel Metrics
Run daily query to check key event volumes:
```sql
SELECT 
    type, 
    COUNT(*) as count_24h 
FROM events 
WHERE created_at >= NOW() - INTERVAL '24 hours' 
GROUP BY type 
ORDER BY count_24h DESC;
```
Expected events to observe:
- `widget_opened` > 0
- `product_click` or `recommendation_shown` > 0
- `email_submitted` (if shoppers engaged with lead capture)

---

## 5. Daily Backup Point
- [ ] Automated or manual snapshot taken and verified in `backups/`:
  ```bash
  npx ts-node scripts/backup-restore.ts backup
  ```
