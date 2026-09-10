# Incident Response & Disaster Recovery Procedure

This procedure establishes the protocol for detecting, mitigating, and resolving technical or operational anomalies during the controlled merchant pilot.

---

## 1. Incident Severity Definitions

| Level | Definition | Target Response Time | Examples |
|---|---|---|---|
| **P1 - Critical** | Severe customer impact; store degradation; budget breach; data contamination. | **< 15 minutes** | Widget throwing JavaScript syntax errors breaking Shopify checkout; cross-tenant data leaked; runaway OpenAI bill (> $14). |
| **P2 - High** | Major feature unavailable; assistant unresponsive; Shopify connection revoked. | **< 1 hour** | Shopify API tokens revoked; webhook failure preventing purchase tracking; widget modal won't open. |
| **P3 - Medium** | Non-critical feature degraded; single product query anomaly; fallback response triggered. | **< 4 hours** | Typo in policy answers; minor styling offset on specific mobile screen size. |
| **P4 - Low** | Cosmetic or administrative question; non-blocking telemetry delay. | **< 24 hours** | Minor reporting timestamp formatting; admin dashboard polish. |

---

## 2. Emergency Kill-Switch (Immediate Containment)

If an active P1 or P2 incident occurs:

### Option 1: Global Pause (All Stores)
From the Admin Dashboard:
1. Navigate to `https://<DOMAIN>/admin/index.html`.
2. Click **Platform Controls** on the left menu.
3. Click the red **"Global Pause"** button and confirm.
   - All assistants across all stores are immediately paused.
   - Widget frontend gracefully switches to inactive without console errors.

### Option 2: Single Merchant Emergency Pause (API or SQL)
If the dashboard is unavailable, execute via direct SQL or curl:
```sql
-- Instantly pause the pilot store's assistant
UPDATE assistant_settings 
SET is_active = FALSE, updated_at = NOW() 
WHERE store_id = '<STORE-ID>';
```

---

## 3. Disaster Recovery & Rollback Procedure

### Database Point-in-Time Restore
If database corruption or erroneous deletions occur:
1. Locate the latest validated snapshot in the `backups/` directory (e.g. `backups/backup_1789024563477.json`).
2. Run the restore CLI command:
   ```bash
   npx ts-node scripts/backup-restore.ts restore backups/<BACKUP_FILE>.json
   ```
3. Verify restored tables and counts:
   ```bash
   node -e "require('./dist/src/database/client').getDatabaseClient().query('SELECT count(*) FROM stores').then(console.log)"
   ```
4. Restart the API server and worker daemon.

### Codebase Rollback
If a newly deployed build introduces a regression:
1. Revert to the last stable git commit tag:
   ```bash
   git checkout <LAST_STABLE_COMMIT_HASH>
   ```
2. Recompile and start:
   ```bash
   npm run build
   node dist/src/server/server.js
   ```

---

## 4. Post-Incident Review (PIR) Template
Every P1 or P2 incident must be followed by a Post-Incident Review within 48 hours:
- **Incident Summary**: What happened and what was the customer impact?
- **Root Cause Analysis (5 Whys)**: Why did it fail, and why wasn't it caught earlier?
- **Corrective Actions Taken**: Immediate hotfixes and mitigations.
- **Preventative Measures**: Automated tests or lint checks added to prevent recurrence.
