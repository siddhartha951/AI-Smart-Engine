// Settings → Shopify connection → Permissions & data.
// Shows every Shopify permission (granted / missing), which data a missing one stops,
// the live data feeds (orders sync, webhooks, checkout pixel, Meta spend) and the keys.
// app.js passes in its auth/state helpers via initShopifyData().

let ctx = null;
let loading = false;

const FEED_ICON = { working: '✅', limited: '⚠️', blocked: '❌', unknown: '➖' };
const FEED_LABEL = { working: 'Working', limited: 'Working (partly)', blocked: 'Blocked', unknown: 'Not checked yet' };
const SCOPE_MARK = { ok: '✅ Granted', missing: '❌ Missing', error: '⚠️ Could not check', unchecked: '➖ Not checked' };
const LEVEL_LABEL = { required: 'Required', recommended: 'Recommended', optional: 'Optional' };
const SYNC_BADGE = {
  ok: ['Working', 'badge--success'],
  blocked: ['Blocked', 'badge--danger'],
  error: ['Needs attention', 'badge--danger'],
  running: ['Running', 'badge--neutral'],
  never: ['Not set up', 'badge--neutral'],
};

function $(id) {
  return document.getElementById(id);
}

function esc(value) {
  return ctx.escapeHtml(value == null ? '' : String(value));
}

function when(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleString();
}

async function request(path, options = {}) {
  const res = await fetch(`/api/v1/dashboard/${ctx.getStoreId()}/shopify-data${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${ctx.getToken()}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (typeof json.error === 'string' ? json.error : json.error?.message) || json.message || 'Request failed';
    throw new Error(msg);
  }
  return json.data;
}

function renderSummary(d) {
  const el = $('sd-summary');
  if (!el) return;
  const c = d.connection;
  if (!c.connected) {
    el.innerHTML = '<strong>Shopify is not connected.</strong> Press "Update access token" and paste your Admin API access token.';
    return;
  }
  const blocked = d.feeds.filter((f) => f.status === 'blocked').length;
  const state = c.token_valid === false
    ? `<strong style="color:var(--color-danger)">${c.reason === 'unreachable' ? 'Shopify could not be reached' : c.reason === 'not_connected' ? 'Saved access token cannot be read' : 'Access token rejected by Shopify'}</strong>`
    : blocked
      ? `<strong style="color:var(--color-danger)">${blocked} data type${blocked > 1 ? 's' : ''} blocked by missing permissions</strong>`
      : '<strong style="color:var(--color-success)">All key data is flowing</strong>';
  el.innerHTML = `${esc(c.shop_name || c.shop_domain || '')} · ${state} · permissions checked ${esc(when(c.checked_at))} · ${esc(Number(d.orders.mirrored).toLocaleString())} Shopify orders synced`;
}

function renderFeeds(d) {
  const el = $('sd-feeds');
  if (!el) return;
  el.innerHTML = d.feeds.map((f) => `
    <div class="sd-feed" data-status="${esc(f.status)}">
      <span class="sd-feed-icon" aria-hidden="true">${FEED_ICON[f.status] || '➖'}</span>
      <div class="sd-feed-body">
        <strong>${esc(f.label)} · ${esc(FEED_LABEL[f.status] || f.status)}</strong>
        <span>${esc(f.used_by)}</span>
        ${f.note ? `<span class="sd-feed-note">${esc(f.note)}</span>` : ''}
      </div>
    </div>`).join('');

  const fix = $('sd-fix');
  if (fix) {
    const steps = d.fix_steps || [];
    fix.innerHTML = steps.length
      ? `<strong>How to fix</strong><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
      : '';
    fix.classList.toggle('hidden', steps.length === 0);
  }
}

function renderScopes(d) {
  const body = $('sd-scopes-body');
  if (!body) return;
  const order = { missing: 0, error: 1, unchecked: 2, ok: 3 };
  const levelOrder = { required: 0, recommended: 1, optional: 2 };
  const rows = [...d.scopes].sort((a, b) =>
    (order[a.status] ?? 9) - (order[b.status] ?? 9) || (levelOrder[a.level] ?? 9) - (levelOrder[b.level] ?? 9));
  body.innerHTML = rows.map((s) => `
    <tr class="sd-scope-row" data-status="${esc(s.status)}">
      <td><code>${esc(s.scope)}</code></td>
      <td>${esc(LEVEL_LABEL[s.level] || '')}</td>
      <td><span class="sd-mark" data-status="${esc(s.status)}">${SCOPE_MARK[s.status] || esc(s.status)}</span></td>
      <td>${esc(s.unlocks || '')}</td>
    </tr>`).join('');
}

function syncCard(title, state, lines, button) {
  const [label, cls] = SYNC_BADGE[state?.status || 'never'] || SYNC_BADGE.never;
  const error = state?.last_error && state.status !== 'ok' ? `<span class="sd-sync-error">${esc(state.last_error)}</span>` : '';
  return `
    <div class="sd-sync">
      <div class="sd-sync-head"><strong>${esc(title)}</strong><span class="badge ${cls}">${esc(label)}</span></div>
      ${lines.filter(Boolean).map((l) => `<span>${l}</span>`).join('')}
      ${error}
      ${button ? `<button type="button" class="btn btn-secondary btn-sm" data-sd-action="${esc(button.action)}">${esc(button.label)}</button>` : ''}
    </div>`;
}

function renderSyncs(d) {
  const el = $('sd-syncs');
  if (!el) return;
  const s = d.syncs;
  const orders = s.orders;
  const hooks = s.webhooks;
  const pixel = s.pixel;
  const meta = s.meta_spend;
  const hookDetails = hooks?.details || {};
  const topics = hookDetails.topics ? Object.entries(hookDetails.topics).map(([t, v]) => `${esc(t)}: ${esc(v)}`).join(' · ') : '';

  el.innerHTML = [
    syncCard('Shopify orders', orders, [
      `${esc(Number(d.orders.mirrored).toLocaleString())} orders synced${d.orders.latest_order_name ? ` · latest ${esc(d.orders.latest_order_name)} (${esc(when(d.orders.latest_order_at))})` : ''}`,
      `Last sync: ${esc(when(orders?.last_success_at))} · refreshes every 5 minutes`,
      orders && !orders.backfill_done && orders.status === 'ok'
        ? `Importing older orders${orders.details?.history_before && orders.details.history_before !== 'done' ? `: complete back to ${esc(new Date(orders.details.history_before).toLocaleDateString())}` : ''}. Today's orders are already included.`
        : '',
    ], { action: 'orders', label: 'Sync orders now' }),
    syncCard('Order webhooks (instant updates)', hooks, [
      hookDetails.last_received_at ? `Last webhook received: ${esc(when(hookDetails.last_received_at))}` : 'No webhook received yet.',
      topics,
      d.connection.webhook_secret_saved ? '' : 'Save your API secret key below so Shopify\'s signed webhooks are accepted.',
    ], { action: 'webhooks', label: 'Register webhooks' }),
    syncCard('Checkout pixel (purchases & product views)', pixel, [
      pixel?.details?.last_event_at
        ? `Last event: ${esc(when(pixel.details.last_event_at))}${pixel.details.last_purchase_at ? ` · last purchase ${esc(when(pixel.details.last_purchase_at))}` : ''}`
        : 'Not installed yet: the funnel cannot see checkout without it.',
    ], { action: 'pixel', label: 'Get pixel code' }),
    syncCard('Meta ad spend (for ROAS)', meta, [
      meta?.last_success_at
        ? `Last sync: ${esc(when(meta.last_success_at))} · ${esc(meta.details?.total_spend ?? 0)} spent in the last 30 days`
        : 'Connect Meta Ads (Ads section) and spend is copied here every hour.',
    ], { action: 'meta', label: 'Sync ad spend' }),
  ].join('');
}

function renderKeys(d) {
  const secret = $('sd-secret-saved');
  if (secret) {
    secret.textContent = d.connection.webhook_secret_saved ? 'Saved' : 'Not saved';
    secret.className = `badge ${d.connection.webhook_secret_saved ? 'badge--success' : 'badge--warning'}`;
  }
  const sf = $('sd-storefront-saved');
  if (sf) {
    sf.textContent = d.connection.storefront_token_saved ? 'Saved' : 'Not saved';
    sf.className = `badge ${d.connection.storefront_token_saved ? 'badge--success' : 'badge--neutral'}`;
  }
}

export async function loadShopifyData(refresh = false) {
  if (!ctx || !ctx.getStoreId() || loading) return;
  if (!$('shopify-data-panel')) return;
  loading = true;
  const btn = $('sd-recheck');
  if (refresh && btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    const d = await request(`/status${refresh ? '?refresh=1' : ''}`);
    renderSummary(d);
    renderFeeds(d);
    renderScopes(d);
    renderSyncs(d);
    renderKeys(d);
    if (refresh) ctx.onHealthChecked();
  } catch (err) {
    const el = $('sd-summary');
    if (el) el.textContent = err.message || ctx.loadErrorText;
  } finally {
    loading = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Re-check permissions'; }
  }
}

async function runAction(action, button) {
  const original = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = 'Working…'; }
  try {
    if (action === 'orders') {
      const r = await request('/orders/sync', { method: 'POST', body: '{}' });
      if (r.status === 'blocked') ctx.showToast(`Orders are blocked: Shopify has not given ${r.blocked_scope}.`, true);
      else if (r.status === 'ok') ctx.showToast(`${r.synced} orders synced${r.complete ? '' : ', more on the way'}`);
      else ctx.showToast(r.message || 'Order sync needs attention', true);
    } else if (action === 'webhooks') {
      const r = await request('/webhooks/register', { method: 'POST', body: '{}' });
      ctx.showToast(r.status === 'ok' ? 'Webhooks registered ✓' : (r.message || 'Some webhooks could not be registered'), r.status !== 'ok');
    } else if (action === 'meta') {
      const r = await request('/meta-spend/sync', { method: 'POST', body: '{}' });
      ctx.showToast(r.status === 'ok' ? 'Meta ad spend synced ✓' : r.status === 'not_connected' ? 'Connect Meta Ads first (Ads section).' : (r.message || 'Meta sync failed'), r.status !== 'ok');
    } else if (action === 'pixel') {
      const r = await request('/pixel-snippet');
      const box = $('sd-pixel');
      const code = $('sd-pixel-code');
      if (code) code.textContent = r.snippet;
      if (box) { box.classList.remove('hidden'); box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      return;
    }
    await loadShopifyData(false);
  } catch (err) {
    ctx.showToast(err.message || 'Request failed', true);
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

async function saveKey(kind) {
  const input = $(kind === 'secret' ? 'sd-secret' : 'sd-storefront');
  const status = $(kind === 'secret' ? 'sd-secret-status' : 'sd-storefront-status');
  const value = (input?.value || '').trim();
  if (!value) {
    if (status) { status.textContent = 'Paste the value first.'; status.dataset.tone = 'danger'; }
    return;
  }
  try {
    await request(kind === 'secret' ? '/webhook-secret' : '/storefront-token', {
      method: 'PUT',
      body: JSON.stringify(kind === 'secret' ? { secret: value } : { token: value }),
    });
    if (input) input.value = ''; // never keep secrets in the page
    if (status) { status.textContent = 'Saved and encrypted ✓'; status.dataset.tone = 'success'; }
    await loadShopifyData(false);
  } catch (err) {
    if (status) { status.textContent = err.message || 'Could not save'; status.dataset.tone = 'danger'; }
  }
}

export function initShopifyData(options) {
  ctx = options;
  $('sd-recheck')?.addEventListener('click', () => loadShopifyData(true));
  $('sd-update-token')?.addEventListener('click', () => ctx.openReconnect());
  $('sd-secret-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveKey('secret'); });
  $('sd-storefront-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveKey('storefront'); });
  $('sd-copy-pixel')?.addEventListener('click', async () => {
    const code = $('sd-pixel-code')?.textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      ctx.showToast('Pixel code copied ✓');
    } catch (_) {
      ctx.showToast('Select the code and copy it manually.', true);
    }
  });
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-sd-action]');
    if (action) {
      runAction(action.getAttribute('data-sd-action'), action);
      return;
    }
    // "Check Shopify connection" links elsewhere (Live Pulse, Ask AI notes)
    if (e.target.closest('[data-open-shopify-data]')) {
      e.preventDefault();
      ctx.openShopifyConnection();
    }
  });
}
