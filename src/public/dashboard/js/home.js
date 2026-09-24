// Home: the merged Overview + Growth Copilot landing page. Every KPI comes from one
// /home request for one time window, so the numbers always agree with each other.
// app.js passes in its auth/state helpers via initHome().

let ctx = null;
let range = '7d';
let loadSeq = 0;

const RANGE_LABELS = { today: 'yesterday', '7d': 'previous 7 days', '30d': 'previous 30 days' };
const RANGE_KEY = 'home_range';

const KPI_DEFS = {
  revenue: 'Total value of orders placed in this period. Uses your synced Shopify orders; if orders are not synced yet, storefront purchase events.',
  orders: 'Number of orders placed in this period. Average order value = revenue ÷ orders.',
  conversion_rate: 'Share of storefront visitors in this period who completed a purchase.',
  ai_assisted_revenue: 'Revenue from orders where the shopper was helped by your AI assistant (chat or a recommended product).',
  roas: 'Return on ad spend: revenue in this period ÷ ad spend recorded for the same days.',
};

function esc(value) {
  return ctx.escapeHtml(value == null ? '' : String(value));
}

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (_) { return null; }
}
function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (_) { /* storage unavailable */ }
}

function money(value, currency) {
  const cur = String(currency || 'INR').toUpperCase();
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-GB', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    }).format(value || 0);
  } catch (_) {
    return `${cur} ${Number(value || 0).toFixed(2)}`;
  }
}

function number(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

function delta(metric, { invert = false } = {}) {
  if (!metric || metric.change_pct === null || metric.change_pct === undefined) {
    return `<span class="home-delta home-delta--none" title="No data in the ${esc(RANGE_LABELS[range])}">Nothing to compare yet</span>`;
  }
  const pct = Number(metric.change_pct);
  const up = pct > 0;
  const good = invert ? !up : up;
  const tone = pct === 0 ? 'flat' : good ? 'good' : 'bad';
  const arrow = pct === 0 ? '' : up ? '&#9650; ' : '&#9660; ';
  return `<span class="home-delta home-delta--${tone}">${arrow}${Math.abs(pct).toFixed(1)}%<span class="home-delta-label"> vs ${esc(RANGE_LABELS[range])}</span></span>`;
}

function kpiCard(key, title, valueHtml, sub, deltaHtml, extraClass = '') {
  return `
    <div class="home-kpi ${extraClass}">
      <div class="home-kpi-head">
        <h3>${esc(title)}</h3>
        <button type="button" class="home-kpi-info" aria-expanded="false" aria-controls="home-def-${key}" aria-label="What does ${esc(title)} mean?">i</button>
      </div>
      <p class="home-kpi-value">${valueHtml}</p>
      ${sub ? `<p class="home-kpi-sub">${sub}</p>` : ''}
      ${deltaHtml}
      <p class="home-kpi-def" id="home-def-${key}" hidden>${esc(KPI_DEFS[key])}</p>
    </div>`;
}

function renderKpis(d) {
  const el = document.getElementById('home-kpis');
  if (!el) return;
  const k = d.kpis;
  const c = d.currency;
  const roasCard = k.roas.value === null
    ? kpiCard('roas', 'ROAS', '<span class="home-kpi-empty">No ad spend</span>',
        d.has_ad_spend_history
          ? 'No ad spend recorded for these days.'
          : `Add ad spend or <button type="button" class="home-link" data-home-open="meta-ads">connect Meta Ads</button> to see it.`,
        '', 'home-kpi--empty')
    : kpiCard('roas', 'ROAS', `${Number(k.roas.value).toFixed(2)}x`, `on ${esc(money(k.ad_spend.value, c))} spend`, delta(k.roas));

  el.innerHTML = [
    kpiCard('revenue', 'Revenue', esc(money(k.revenue.value, c)), d.revenue_source === 'storefront_events' ? 'From storefront purchase events' : '', delta(k.revenue)),
    kpiCard('orders', 'Orders', esc(number(k.orders.value)), `Avg. order ${esc(money(k.average_order_value.value, c))}`, delta(k.orders)),
    kpiCard('conversion_rate', 'Conversion rate', `${Number(k.conversion_rate.value).toFixed(1)}%`, `${esc(number(d.activity.visitors.value))} visitors`, delta(k.conversion_rate)),
    kpiCard('ai_assisted_revenue', 'AI-assisted sales', esc(money(k.ai_assisted_revenue.value, c)), 'Helped by your AI assistant', delta(k.ai_assisted_revenue)),
    roasCard,
  ].join('');
}

function renderActivity(d) {
  const el = document.getElementById('home-activity');
  if (!el) return;
  const a = d.activity;
  const items = [
    ['Chats', a.chats],
    ['Product suggestions', a.recommendations],
    ['Add to carts', a.add_to_carts],
    ['New leads', a.new_leads],
    ['Marketing opt-ins', a.opt_ins],
    ['Recovery emails sent', a.recovery_emails_sent],
  ];
  el.innerHTML = items.map(([label, m]) => `
    <div class="home-activity-item">
      <span class="home-activity-label">${esc(label)}</span>
      <strong>${esc(number(m.value))}</strong>
      <span class="home-activity-prev">${esc(number(m.previous))} in the ${esc(RANGE_LABELS[range])}</span>
    </div>`).join('');
}

function renderCompare(d) {
  const el = document.getElementById('home-compare');
  if (!el) return;
  const k = d.kpis;
  const c = d.currency;
  const rows = [
    ['Revenue', money(k.revenue.value, c), money(k.revenue.previous, c), k.revenue],
    ['Orders', number(k.orders.value), number(k.orders.previous), k.orders],
    ['Conversion rate', `${k.conversion_rate.value.toFixed(1)}%`, `${k.conversion_rate.previous.toFixed(1)}%`, k.conversion_rate],
    ['AI-assisted sales', money(k.ai_assisted_revenue.value, c), money(k.ai_assisted_revenue.previous, c), k.ai_assisted_revenue],
    ['Ad spend', money(k.ad_spend.value, c), money(k.ad_spend.previous, c), k.ad_spend],
  ];
  const title = range === 'today' ? 'Today vs yesterday' : range === '7d' ? 'This week vs last week' : 'Last 30 days vs the 30 before';
  document.getElementById('home-compare-title').textContent = title;
  el.innerHTML = `
    <table class="home-compare-table">
      <thead><tr><th scope="col">Metric</th><th scope="col">Now</th><th scope="col">Before</th><th scope="col">Change</th></tr></thead>
      <tbody>
        ${rows.map(([label, now, before, m]) => `
          <tr>
            <th scope="row">${esc(label)}</th>
            <td>${esc(now)}</td>
            <td>${esc(before)}</td>
            <td>${m.change_pct === null ? '<span class="home-delta home-delta--none">&mdash;</span>' : delta(m, { invert: label === 'Ad spend' }).replace(/<span class="home-delta-label">.*?<\/span>/, '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function renderActions() {
  const el = document.getElementById('home-actions');
  if (!el) return;
  if (!ctx.isFeatureOn('growth_copilot')) {
    const plan = ctx.planNameFor('growth_copilot');
    el.innerHTML = `
      <div class="home-empty">
        <p>Daily growth actions tell you what to do next, based on your store's data.${plan ? ` They are included in the ${esc(plan)} plan.` : ''}</p>
        <button type="button" class="btn btn-secondary btn-sm" data-home-open="plan-billing">See plans</button>
      </div>`;
    return;
  }
  try {
    const res = await fetch(`/api/v1/dashboard/${ctx.getStoreId()}/growth/actions`, {
      headers: { 'Authorization': `Bearer ${ctx.getToken()}` },
    });
    if (!res.ok) throw new Error('actions failed');
    const { data } = await res.json();
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    const active = (data || [])
      .filter((a) => a.status === 'pending' || a.status === 'in_progress')
      .sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9))
      .slice(0, 3);
    if (active.length === 0) {
      el.innerHTML = '<div class="home-empty"><p>Nothing urgent right now. New actions appear here as your store data changes.</p></div>';
      return;
    }
    el.innerHTML = active.map((a) => `
      <div class="home-action">
        <div class="home-action-main">
          <div class="home-action-title">
            <span class="home-priority home-priority--${esc(a.priority)}">${esc(a.priority)}</span>
            <strong>${esc(a.title)}</strong>
          </div>
          <p>${esc(a.reason)}</p>
        </div>
        <div class="home-action-side">
          ${Number(a.estimated_opportunity) > 0 ? `<span class="home-impact">+${esc(money(Number(a.estimated_opportunity), ctx.getCurrency()))} potential</span>` : ''}
          <button type="button" class="btn btn-primary btn-sm" data-home-action="${esc(a.id)}" data-home-module="${esc(a.target_module)}">Open &rarr;</button>
        </div>
      </div>`).join('');
  } catch (_) {
    el.innerHTML = `<div class="home-empty"><p>${esc(ctx.loadErrorText)}</p></div>`;
  }
}

async function renderInsights(force = false) {
  const el = document.getElementById('home-insights');
  if (!el) return;
  el.innerHTML = '<p class="home-muted">Reading your store data...</p>';
  try {
    const res = await fetch(`/api/v1/dashboard/${ctx.getStoreId()}/ai/overview-insights${force ? '?refresh=true' : ''}`, {
      headers: { 'Authorization': `Bearer ${ctx.getToken()}` },
    });
    if (!res.ok) throw new Error('insights failed');
    const { data } = await res.json();
    el.innerHTML = `
      <div class="home-insight"><h4>What is happening</h4><p>${esc(data?.what_is_happening || 'Not enough data yet.')}</p></div>
      <div class="home-insight"><h4>Why</h4><p>${esc(data?.why_it_is_happening || 'Not enough data yet.')}</p></div>`;
  } catch (_) {
    el.innerHTML = `<p class="home-muted">${esc(ctx.loadErrorText)}</p>`;
  }
}

function setRangeButtons() {
  document.querySelectorAll('[data-home-range]').forEach((b) => {
    const on = b.getAttribute('data-home-range') === range;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

export async function loadHome() {
  if (!ctx || !ctx.getStoreId()) return;
  const seq = ++loadSeq;
  setRangeButtons();
  const kpis = document.getElementById('home-kpis');
  if (kpis) kpis.setAttribute('aria-busy', 'true');
  try {
    const tz = new Date().getTimezoneOffset();
    const res = await fetch(`/api/v1/dashboard/${ctx.getStoreId()}/home?range=${encodeURIComponent(range)}&tz=${tz}`, {
      headers: { 'Authorization': `Bearer ${ctx.getToken()}` },
    });
    if (!res.ok) throw new Error('home failed');
    const { data } = await res.json();
    if (seq !== loadSeq) return; // a newer range was picked meanwhile
    ctx.setCurrency(data.currency);
    const badge = document.getElementById('home-agent-status');
    if (badge) {
      badge.textContent = data.agent_active ? 'Assistant live' : 'Assistant paused';
      badge.dataset.tone = data.agent_active ? 'success' : 'warning';
    }
    renderKpis(data);
    renderActivity(data);
    renderCompare(data);
  } catch (_) {
    if (seq !== loadSeq) return;
    if (kpis) kpis.innerHTML = `<div class="home-empty home-empty--wide"><p>${esc(ctx.loadErrorText)}</p></div>`;
  } finally {
    if (kpis && seq === loadSeq) kpis.removeAttribute('aria-busy');
  }
  if (seq === loadSeq) {
    renderActions();
    renderInsights(false);
  }
}

export function initHome(options) {
  ctx = options;
  const saved = storageGet(RANGE_KEY);
  if (saved === 'today' || saved === '7d' || saved === '30d') range = saved;

  document.addEventListener('click', (e) => {
    const rangeBtn = e.target.closest('[data-home-range]');
    if (rangeBtn) {
      range = rangeBtn.getAttribute('data-home-range');
      storageSet(RANGE_KEY, range);
      loadHome();
      return;
    }
    const info = e.target.closest('.home-kpi-info');
    if (info) {
      const def = document.getElementById(info.getAttribute('aria-controls'));
      const open = info.getAttribute('aria-expanded') === 'true';
      info.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (def) def.hidden = open;
      return;
    }
    const open = e.target.closest('[data-home-open]');
    if (open) {
      ctx.openSection(open.getAttribute('data-home-open'));
      return;
    }
    const act = e.target.closest('[data-home-action]');
    if (act && typeof window.executeGrowthAction === 'function') {
      window.executeGrowthAction(act.getAttribute('data-home-action'), act.getAttribute('data-home-module'), '');
      return;
    }
    if (e.target.closest('#home-insights-refresh')) renderInsights(true);
  });
}
