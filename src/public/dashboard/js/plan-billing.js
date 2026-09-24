// Settings → Plan & billing, the sidebar plan card and "available on Pro" hints for locked
// features. app.js passes in its auth/state helpers via initPlanBilling().

let ctx = null;
let cache = { storeId: null, data: null };

const STATUS = {
  trial: { label: 'Trial', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Past due', tone: 'warning' },
  paused: { label: 'Paused', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

function esc(value) {
  return ctx.escapeHtml(value == null ? '' : String(value));
}

function money(amount, currency) {
  if (amount === null || amount === undefined) return 'Custom';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return (currency === 'USD' ? '$' : '₹') + Number(amount).toLocaleString(locale, { maximumFractionDigits: 2 });
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function initPlanBilling(options) {
  ctx = options;
  document.getElementById('sidebar-plan-card')?.addEventListener('click', () => ctx.openSection('plan-billing'));
  document.addEventListener('click', (e) => {
    if (e.target.closest('#pb-compare-btn')) {
      const panel = document.getElementById('pb-compare-panel');
      if (!panel) return;
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

/** Plan summary for the active store (cached per store; `force` refetches). Null on failure. */
export async function getPlanSummary(force = false) {
  const storeId = ctx.getStoreId();
  if (!storeId) return null;
  if (!force && cache.storeId === storeId && cache.data) return cache.data;
  try {
    const res = await fetch(`/api/v1/dashboard/${storeId}/plan`, {
      headers: { 'Authorization': `Bearer ${ctx.getToken()}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    cache = { storeId, data: json.data || null };
    return cache.data;
  } catch (_) {
    return null;
  }
}

/** Name of the cheapest plan that unlocks a feature key, e.g. "Pro". */
export function planNameFor(summary, featureKey) {
  if (!summary || !Array.isArray(summary.sections)) return null;
  for (const section of summary.sections) {
    const f = section.features.find((x) => x.key === featureKey);
    if (f) return f.available_on ? f.available_on.name : null;
  }
  return null;
}

export function renderSidebarPlan(summary) {
  const card = document.getElementById('sidebar-plan-card');
  if (!card) return;
  if (!summary || !summary.plan) {
    card.classList.add('hidden');
    return;
  }
  const sub = summary.subscription || {};
  const status = STATUS[sub.status] || { label: sub.status || '', tone: 'neutral' };
  document.getElementById('sidebar-plan-name').textContent = `${summary.plan.name} plan`;
  const statusEl = document.getElementById('sidebar-plan-status');
  statusEl.textContent = status.label;
  statusEl.dataset.tone = status.tone;
  const when = sub.status === 'trial' && sub.trial_ends_at
    ? `Trial ends ${formatDate(sub.trial_ends_at)}`
    : sub.renews_at ? `Renews ${formatDate(sub.renews_at)}` : '';
  document.getElementById('sidebar-plan-renews').textContent = when;
  card.classList.remove('hidden');
}

function usageBar(label, text, pct, tone) {
  const width = Math.max(0, Math.min(100, pct));
  return `
    <div class="pb-usage-row">
      <div class="pb-usage-label"><strong>${esc(label)}</strong><span>${esc(text)}</span></div>
      <div class="pb-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(width)}">
        <span class="pb-bar-fill pb-bar-fill--${tone}" style="width: ${width}%"></span>
      </div>
    </div>`;
}

function renderCurrent(summary) {
  const el = document.getElementById('pb-current');
  if (!el) return;
  const plan = summary.plan;
  const sub = summary.subscription;
  if (!plan || !sub) {
    el.innerHTML = `
      <span class="pb-eyebrow">Current plan</span>
      <h3 class="pb-plan-name">Custom setup</h3>
      <p class="pb-muted">Your features were set up for you by Novatech Digital. Compare the plans below to see what else is available.</p>
      <div class="pb-actions"><button type="button" class="btn btn-primary btn-sm" id="pb-compare-btn">Compare plans</button></div>`;
    return;
  }
  const status = STATUS[sub.status] || { label: sub.status, tone: 'neutral' };
  const cycle = sub.billing_cycle === 'yearly' ? 'year' : 'month';
  const price = sub.charged_price === null || sub.charged_price === undefined
    ? 'Custom price'
    : `${money(sub.charged_price, sub.currency)} / ${cycle}`;
  const dates = [];
  if (sub.status === 'trial' && sub.trial_ends_at) dates.push(`Trial ends on ${formatDate(sub.trial_ends_at)}.`);
  if (sub.renews_at) dates.push(`Renews on ${formatDate(sub.renews_at)}.`);
  el.innerHTML = `
    <div class="pb-current-head">
      <div>
        <span class="pb-eyebrow">Current plan</span>
        <h3 class="pb-plan-name">${esc(plan.name)}</h3>
        <p class="pb-price">${esc(price)} &middot; billed ${sub.billing_cycle === 'yearly' ? 'yearly' : 'monthly'}</p>
      </div>
      <span class="pb-status" data-tone="${status.tone}">${esc(status.label)}</span>
    </div>
    <p class="pb-muted">${esc(dates.join(' '))} Plan changes are handled by Novatech Digital.</p>
    <div class="pb-actions"><button type="button" class="btn btn-primary btn-sm" id="pb-compare-btn">Compare plans</button></div>`;
}

function renderUsage(summary) {
  const el = document.getElementById('pb-usage');
  if (!el) return;
  const { usage, limits } = summary;
  const ai = Number(usage.ai_cost_usd) || 0;
  const aiLimit = Number(limits.ai_budget_usd) || 0;
  const aiPct = aiLimit > 0 ? (ai / aiLimit) * 100 : 0;
  const docs = Number(usage.knowledge_documents) || 0;
  const docLimit = Number(limits.knowledge_doc_limit) || 0;
  el.innerHTML = `
    <span class="pb-eyebrow">Usage this month</span>
    ${usageBar('AI usage', `$${ai.toFixed(2)} of $${aiLimit}`, aiPct, aiPct >= 90 ? 'danger' : aiPct >= 70 ? 'warning' : 'accent')}
    ${usageBar('Knowledge documents', `${docs} of ${docLimit}`, docLimit > 0 ? (docs / docLimit) * 100 : 0, 'success')}
    ${usageBar('Features on', `${summary.enabled_count} of ${summary.total_features}`, (summary.enabled_count / Math.max(1, summary.total_features)) * 100, 'neutral')}
    <p class="pb-muted pb-small">When AI usage reaches the limit, the assistant pauses until next month.</p>`;
}

const CHECK = '<svg class="pb-icon pb-icon--ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>';
const LOCK = '<svg class="pb-icon pb-icon--lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';

function renderSections(summary) {
  const el = document.getElementById('pb-sections');
  if (!el) return;
  el.innerHTML = summary.sections.map((section) => `
    <div class="pb-section">
      <h4>${esc(section.name)}</h4>
      <ul>
        ${section.features.map((f) => f.enabled
          ? `<li>${CHECK}<span>${esc(f.label)}</span></li>`
          : `<li class="pb-locked">${LOCK}<span>${esc(f.label)}</span>${f.available_on ? `<span class="pb-plan-badge">${esc(f.available_on.name)}</span>` : ''}<span class="sr-only">(not included)</span></li>`
        ).join('')}
      </ul>
    </div>`).join('');
}

function renderCompare(summary) {
  const el = document.getElementById('pb-compare');
  if (!el) return;
  const plans = summary.plans || [];
  const currency = summary.subscription ? summary.subscription.currency : 'INR';
  const current = summary.plan ? summary.plan.id : null;
  const price = (p) => {
    const v = currency === 'USD' ? p.price_usd_monthly : p.price_inr_monthly;
    return v === null || v === undefined ? 'Custom' : `${money(v, currency)} / month`;
  };
  const head = plans.map((p) => `<th scope="col"${p.id === current ? ' class="pb-current-col"' : ''}>${esc(p.name)}${p.id === current ? '<span class="pb-you">Your plan</span>' : ''}<small>${esc(price(p))}</small></th>`).join('');
  const rows = summary.sections.map((section) => `
    <tr class="pb-compare-section"><th scope="rowgroup" colspan="${plans.length + 1}">${esc(section.name)}</th></tr>
    ${section.features.map((f) => `
      <tr>
        <th scope="row">${esc(f.label)}</th>
        ${plans.map((p) => p.features.includes(f.key)
          ? `<td${p.id === current ? ' class="pb-current-col"' : ''}>${CHECK}<span class="sr-only">Included</span></td>`
          : `<td${p.id === current ? ' class="pb-current-col"' : ''}><span aria-hidden="true">&mdash;</span><span class="sr-only">Not included</span></td>`).join('')}
      </tr>`).join('')}`).join('');
  el.innerHTML = `
    <div class="table-scroll">
      <table class="pb-compare-table">
        <thead><tr><th scope="col">Feature</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="pb-muted pb-small">To change your plan, contact your Novatech Digital account manager.</p>`;
}

export async function loadPlanBilling() {
  const summary = await getPlanSummary(true);
  if (!summary) {
    const el = document.getElementById('pb-current');
    if (el) el.innerHTML = `<p class="text-muted">${esc(ctx.loadErrorText)}</p>`;
    return;
  }
  renderCurrent(summary);
  renderUsage(summary);
  renderSections(summary);
  renderCompare(summary);
  renderSidebarPlan(summary);
}
