// ===== Plans: catalogue page + per-store plan assignment =====
// Loaded after admin.js; uses its globals: state, apiFetch, showToast, toggleModal.

const planUi = {
  cycle: 'monthly',
  currency: 'INR',
  plans: [],
  sections: [],
  store: null, // { storeId, container, view, pendingPlanId }
};

const STATUS_LABELS = { trial: 'Trial', active: 'Active', past_due: 'Past due', paused: 'Paused', cancelled: 'Cancelled' };
const BADGE_LABELS = { in_plan: 'In plan', addon: 'Add-on', removed: 'Removed', on: 'On', off: '' };

function escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSuperAdmin() {
  return !!state.user && (state.user.role === 'super_admin' || state.user.role === 'platform_admin');
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return 'Custom';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return (currency === 'INR' ? '₹' : '$') + Number(amount).toLocaleString(locale, { maximumFractionDigits: 2 });
}

function monthlyPrice(plan, currency) {
  return currency === 'USD' ? plan.price_usd_monthly : plan.price_inr_monthly;
}

function priceFor(plan, currency, cycle) {
  const monthly = monthlyPrice(plan, currency);
  if (monthly === null || monthly === undefined) return null;
  return cycle === 'yearly' ? monthly * 10 : monthly;
}

// ---------- Plans page ----------
window.loadPlansPage = async function () {
  try {
    const res = await apiFetch('/api/v1/admin/plans');
    planUi.plans = res.data.plans || [];
    planUi.sections = res.data.sections || [];
    renderPlanCards();
    renderPlanMatrix();
  } catch (err) {
    document.getElementById('plans-cards').innerHTML = `<p class="empty-state">Could not load plans: ${escAttr(err.message)}</p>`;
  }
};

function renderPlanCards() {
  const el = document.getElementById('plans-cards');
  if (!el) return;
  const canEdit = isSuperAdmin();
  el.innerHTML = planUi.plans.map((p) => {
    const price = priceFor(p, planUi.currency, planUi.cycle);
    const per = price === null ? 'quoted per client' : planUi.cycle === 'yearly' ? '/ year' : '/ month';
    const limits = [
      p.ai_budget_usd !== null ? `AI usage up to $${Number(p.ai_budget_usd)} / month` : 'Custom AI usage limit',
      p.knowledge_doc_limit !== null ? `${p.knowledge_doc_limit} knowledge documents` : 'Custom document limit',
      `${p.features.length} of ${planUi.sections.reduce((n, s) => n + s.features.length, 0)} features`,
    ];
    return `
      <article class="plan-card${p.is_active ? '' : ' plan-card--inactive'}">
        <div class="plan-card-head">
          <h3>${escAttr(p.name)}</h3>
          <span class="plan-card-stores">${p.store_count} ${p.store_count === 1 ? 'store' : 'stores'}</span>
        </div>
        <p class="plan-card-tagline">${escAttr(p.tagline || '')}</p>
        <div class="plan-card-price"><strong>${price === null ? 'Custom' : formatMoney(price, planUi.currency)}</strong><span>${per}</span></div>
        <p class="plan-card-saving">${price !== null && planUi.cycle === 'yearly' ? '2 months free' : '&nbsp;'}</p>
        <ul class="plan-card-limits">${limits.map((l) => `<li>${escAttr(l)}</li>`).join('')}</ul>
        ${p.is_active ? '' : '<p class="plan-card-note">Hidden from new assignments</p>'}
        <button type="button" class="btn-secondary btn-sm" data-edit-plan="${escAttr(p.id)}" ${canEdit ? '' : 'disabled title="Super Admin required"'}>Edit plan</button>
      </article>`;
  }).join('');
}

function renderPlanMatrix() {
  const el = document.getElementById('plans-matrix');
  if (!el) return;
  const head = planUi.plans.map((p) => `<th scope="col" class="matrix-plan">${escAttr(p.name)}</th>`).join('');
  const body = planUi.sections.map((section) => `
      <tr class="matrix-section"><th scope="rowgroup" colspan="${planUi.plans.length + 2}">${escAttr(section.name)}</th></tr>
      ${section.features.map((f) => `
        <tr>
          <th scope="row">${escAttr(f.label)}</th>
          <td class="matrix-key">${escAttr(f.key)}</td>
          ${planUi.plans.map((p) => p.features.includes(f.key)
            ? '<td class="matrix-yes"><span aria-hidden="true">&#10003;</span><span class="sr-only">Included</span></td>'
            : '<td class="matrix-no"><span aria-hidden="true">&mdash;</span><span class="sr-only">Not included</span></td>').join('')}
        </tr>`).join('')}`).join('');
  el.innerHTML = `
    <table class="data-table plans-matrix-table">
      <thead><tr><th scope="col">Feature</th><th scope="col">Feature key</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function openPlanEditor(planId) {
  const plan = planUi.plans.find((p) => p.id === planId);
  if (!plan) return;
  document.getElementById('plan-edit-title').textContent = `Edit ${plan.name} plan`;
  document.getElementById('plan-edit-id').value = plan.id;
  document.getElementById('plan-edit-name').value = plan.name;
  document.getElementById('plan-edit-tagline').value = plan.tagline || '';
  document.getElementById('plan-edit-inr').value = plan.price_inr_monthly ?? '';
  document.getElementById('plan-edit-usd').value = plan.price_usd_monthly ?? '';
  document.getElementById('plan-edit-ai').value = plan.ai_budget_usd ?? '';
  document.getElementById('plan-edit-docs').value = plan.knowledge_doc_limit ?? '';
  document.getElementById('plan-edit-active').checked = plan.is_active;
  document.getElementById('plan-edit-features').innerHTML = planUi.sections.map((section) => `
    <fieldset class="plan-feature-group">
      <legend>${escAttr(section.name)}</legend>
      ${section.features.map((f) => `
        <label class="checkbox-row">
          <input type="checkbox" name="plan-feature" value="${escAttr(f.key)}" ${plan.features.includes(f.key) ? 'checked' : ''}>
          ${escAttr(f.label)}
        </label>`).join('')}
    </fieldset>`).join('');
  toggleModal('plan-edit-modal', true);
}

function numberOrNull(id) {
  const raw = document.getElementById(id).value.trim();
  return raw === '' ? null : Number(raw);
}

async function savePlanEditor(e) {
  e.preventDefault();
  const planId = document.getElementById('plan-edit-id').value;
  const btn = document.getElementById('plan-edit-save');
  const body = {
    name: document.getElementById('plan-edit-name').value.trim(),
    tagline: document.getElementById('plan-edit-tagline').value.trim() || null,
    price_inr_monthly: numberOrNull('plan-edit-inr'),
    price_usd_monthly: numberOrNull('plan-edit-usd'),
    ai_budget_usd: numberOrNull('plan-edit-ai'),
    knowledge_doc_limit: numberOrNull('plan-edit-docs'),
    is_active: document.getElementById('plan-edit-active').checked,
    features: Array.from(document.querySelectorAll('#plan-edit-features input[name="plan-feature"]:checked')).map((i) => i.value),
  };
  btn.disabled = true;
  try {
    await apiFetch(`/api/v1/admin/plans/${encodeURIComponent(planId)}`, { method: 'PUT', body: JSON.stringify(body) });
    toggleModal('plan-edit-modal', false);
    showToast(`${body.name} plan saved. Stores on it were updated.`, 'success');
    await window.loadPlansPage();
  } catch (err) {
    showToast('Could not save plan: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function setSegment(attr, value) {
  document.querySelectorAll(`[${attr}]`).forEach((b) => {
    const on = b.getAttribute(attr) === value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

// ---------- Store detail: Plan & features ----------
window.renderStorePlanPanel = async function (storeId, container) {
  container.innerHTML = '<p class="empty-state">Loading plan...</p>';
  try {
    const res = await apiFetch(`/api/v1/admin/stores/${storeId}/plan`);
    planUi.store = { storeId, container, view: res.data, pendingPlanId: res.data.plan ? res.data.plan.id : null };
    drawStorePlanPanel();
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Could not load the plan: ${escAttr(err.message)}</p>`;
  }
};

function drawStorePlanPanel() {
  const { container, view, pendingPlanId } = planUi.store;
  const sub = view.subscription;
  const canEdit = isSuperAdmin();
  const lock = canEdit ? '' : 'disabled';
  const plans = (view.plans || []).filter((p) => p.is_active || p.id === (view.plan && view.plan.id));
  const pending = plans.find((p) => p.id === pendingPlanId) || null;
  const currency = sub ? sub.currency : 'INR';
  const cycle = sub ? sub.billing_cycle : 'monthly';
  const listPrice = pending ? priceFor(pending, currency, cycle) : null;
  const planChanges = pending && (!view.plan || view.plan.id !== pending.id);

  const planChoices = plans.map((p) => `
    <button type="button" class="plan-choice${p.id === pendingPlanId ? ' active' : ''}" role="radio"
      aria-checked="${p.id === pendingPlanId}" data-pick-plan="${escAttr(p.id)}" ${lock}>
      <strong>${escAttr(p.name)}</strong>
      <span>${monthlyPrice(p, 'INR') === null ? 'Custom price' : formatMoney(monthlyPrice(p, 'INR'), 'INR') + ' / month'}</span>
    </button>`).join('');

  const statusOptions = Object.entries(STATUS_LABELS).map(([v, l]) =>
    `<option value="${v}" ${(sub ? sub.status : 'active') === v ? 'selected' : ''}>${l}</option>`).join('');

  const sections = view.sections.map((section) => `
    <div class="plan-section-card">
      <h4>${escAttr(section.name)}</h4>
      ${section.features.map((f) => `
        <div class="plan-feature-row">
          <label class="switch" title="${escAttr(f.label)}">
            <input type="checkbox" data-feature-toggle="${escAttr(f.key)}" ${f.enabled ? 'checked' : ''} aria-label="${escAttr(f.label)}">
            <span class="slider"></span>
          </label>
          <span class="plan-feature-name">${escAttr(f.label)}</span>
          ${BADGE_LABELS[f.badge] ? `<span class="plan-badge plan-badge--${f.badge}">${BADGE_LABELS[f.badge]}</span>` : ''}
        </div>`).join('')}
    </div>`).join('');

  container.innerHTML = `
    <div class="store-plan">
      ${view.plan ? '' : '<p class="plan-notice">No plan assigned yet. The store keeps its current features and the platform AI budget until you assign one.</p>'}
      ${canEdit ? '' : '<p class="plan-notice">Only a Super Admin can change the plan or price. You can still switch single features.</p>'}
      <form id="store-plan-form" class="store-plan-form">
        <div class="plan-choices" role="radiogroup" aria-label="Plan">${planChoices}</div>
        <p id="sp-plan-change" class="plan-notice plan-notice--accent${planChanges ? '' : ' hidden'}">${planChanges ? `Saving switches this store's features to the ${escAttr(pending.name)} plan.` : ''}</p>
        <div class="form-grid-4">
          <div class="form-group">
            <label for="sp-cycle">Billing cycle</label>
            <select id="sp-cycle" ${lock}>
              <option value="monthly" ${cycle === 'monthly' ? 'selected' : ''}>Monthly</option>
              <option value="yearly" ${cycle === 'yearly' ? 'selected' : ''}>Yearly (2 months free)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="sp-currency">Currency</label>
            <select id="sp-currency" ${lock}>
              <option value="INR" ${currency === 'INR' ? 'selected' : ''}>INR (&#8377;)</option>
              <option value="USD" ${currency === 'USD' ? 'selected' : ''}>USD ($)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="sp-price">Price charged</label>
            <input type="number" id="sp-price" min="0" step="0.01" value="${sub && sub.price_amount !== null ? escAttr(sub.price_amount) : ''}"
              placeholder="${listPrice === null ? 'Enter the agreed price' : 'Plan price: ' + escAttr(formatMoney(listPrice, currency))}" ${lock}>
          </div>
          <div class="form-group">
            <label for="sp-status">Status</label>
            <select id="sp-status" ${lock}>${statusOptions}</select>
          </div>
          <div class="form-group">
            <label for="sp-started">Started on</label>
            <input type="date" id="sp-started" value="${escAttr(sub ? sub.started_at || '' : '')}" ${lock}>
          </div>
          <div class="form-group">
            <label for="sp-renews">Renews on</label>
            <input type="date" id="sp-renews" value="${escAttr(sub ? sub.renews_at || '' : '')}" ${lock}>
          </div>
          <div class="form-group">
            <label for="sp-trial">Trial ends on</label>
            <input type="date" id="sp-trial" value="${escAttr(sub ? sub.trial_ends_at || '' : '')}" ${lock}>
          </div>
          <div class="form-group">
            <label for="sp-ai">AI usage limit ($ / month)</label>
            <input type="number" id="sp-ai" min="0" step="0.01" value="${sub && sub.ai_budget_usd !== null ? escAttr(sub.ai_budget_usd) : ''}"
              placeholder="${pending && pending.ai_budget_usd !== null ? 'Plan: $' + escAttr(pending.ai_budget_usd) : 'Plan value'}" ${lock}>
          </div>
          <div class="form-group">
            <label for="sp-docs">Knowledge documents</label>
            <input type="number" id="sp-docs" min="0" max="500" step="1" value="${sub && sub.knowledge_doc_limit !== null ? escAttr(sub.knowledge_doc_limit) : ''}"
              placeholder="${pending && pending.knowledge_doc_limit !== null ? 'Plan: ' + escAttr(pending.knowledge_doc_limit) : 'Plan value'}" ${lock}>
          </div>
          <div class="form-group form-group--span3">
            <label for="sp-notes">Internal notes (not shown to the merchant)</label>
            <input type="text" id="sp-notes" maxlength="1000" value="${escAttr(sub ? sub.notes || '' : '')}" ${lock}>
          </div>
        </div>
        <div class="store-plan-actions">
          <span class="store-plan-summary">
            AI usage this month: <strong>$${Number(view.usage.ai_cost_usd).toFixed(2)} of $${Number(view.limits.ai_budget_usd)}</strong>
            &middot; Knowledge documents: <strong>${view.usage.knowledge_documents} of ${view.limits.knowledge_doc_limit}</strong>
            &middot; Features on: <strong>${view.enabled_count} of ${view.total_features}</strong>
          </span>
          <button type="button" class="btn-secondary btn-sm" id="sp-reset" ${canEdit && view.plan ? '' : 'disabled'}>Reset to plan defaults</button>
          <button type="submit" class="btn-primary btn-sm" id="sp-save" ${canEdit && pending ? '' : 'disabled'}>${view.plan ? 'Save changes' : 'Assign plan'}</button>
        </div>
      </form>
      <div class="plan-legend">
        <span class="plan-badge plan-badge--in_plan">In plan</span>
        <span class="plan-badge plan-badge--addon">Add-on</span>
        <span class="plan-badge plan-badge--removed">Removed</span>
        <span>A switch overrides the plan for this store only.</span>
      </div>
      <div class="plan-sections-grid">${sections}</div>
    </div>`;
}

// Updates the chosen plan in place so values already typed into the form are kept
function pickStorePlan(planId) {
  const ctx = planUi.store;
  const plan = (ctx.view.plans || []).find((p) => p.id === planId);
  if (!plan) return;
  ctx.pendingPlanId = planId;
  ctx.container.querySelectorAll('[data-pick-plan]').forEach((b) => {
    const on = b.getAttribute('data-pick-plan') === planId;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const changes = !ctx.view.plan || ctx.view.plan.id !== planId;
  const notice = document.getElementById('sp-plan-change');
  if (notice) {
    notice.textContent = changes ? `Saving switches this store's features to the ${plan.name} plan.` : '';
    notice.classList.toggle('hidden', !changes);
  }
  const currency = document.getElementById('sp-currency').value;
  const cycle = document.getElementById('sp-cycle').value;
  const list = priceFor(plan, currency, cycle);
  document.getElementById('sp-price').placeholder = list === null ? 'Enter the agreed price' : 'Plan price: ' + formatMoney(list, currency);
  document.getElementById('sp-ai').placeholder = plan.ai_budget_usd !== null ? 'Plan: $' + plan.ai_budget_usd : 'Plan value';
  document.getElementById('sp-docs').placeholder = plan.knowledge_doc_limit !== null ? 'Plan: ' + plan.knowledge_doc_limit : 'Plan value';
  const save = document.getElementById('sp-save');
  if (save && isSuperAdmin()) save.disabled = false;
}

async function saveStorePlan(e) {
  e.preventDefault();
  const ctx = planUi.store;
  if (!ctx || !ctx.pendingPlanId) return;
  const val = (id) => document.getElementById(id).value.trim();
  const num = (id) => (val(id) === '' ? null : Number(val(id)));
  const body = {
    plan_id: ctx.pendingPlanId,
    billing_cycle: val('sp-cycle'),
    currency: val('sp-currency'),
    price_amount: num('sp-price'),
    status: val('sp-status'),
    started_at: val('sp-started') || null,
    renews_at: val('sp-renews') || null,
    trial_ends_at: val('sp-trial') || null,
    ai_budget_usd: num('sp-ai'),
    knowledge_doc_limit: num('sp-docs'),
    notes: val('sp-notes') || null,
  };
  const btn = document.getElementById('sp-save');
  btn.disabled = true;
  try {
    const res = await apiFetch(`/api/v1/admin/stores/${ctx.storeId}/plan`, { method: 'PUT', body: JSON.stringify(body) });
    showToast(res.data.features_reset ? 'Plan assigned. Features now match the plan.' : 'Plan details saved.', 'success');
    await window.renderStorePlanPanel(ctx.storeId, ctx.container);
  } catch (err) {
    showToast('Could not save the plan: ' + err.message, 'error');
    btn.disabled = false;
  }
}

async function resetStoreFeatures() {
  const ctx = planUi.store;
  if (!ctx) return;
  confirmAction('Reset features', 'Switch every feature back to what the plan includes? Add-ons and removals for this store will be cleared.', async () => {
    await apiFetch(`/api/v1/admin/stores/${ctx.storeId}/plan/reset-features`, { method: 'POST' });
    showToast('Features reset to the plan.', 'success');
    await window.renderStorePlanPanel(ctx.storeId, ctx.container);
  });
}

async function toggleStoreFeature(input) {
  const ctx = planUi.store;
  const key = input.getAttribute('data-feature-toggle');
  input.disabled = true;
  try {
    await apiFetch(`/api/v1/admin/stores/${ctx.storeId}/features/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: input.checked }),
    });
    showToast(`Feature ${input.checked ? 'switched on' : 'switched off'} for this store`, 'success');
    await window.renderStorePlanPanel(ctx.storeId, ctx.container);
  } catch (err) {
    input.checked = !input.checked;
    input.disabled = false;
    showToast('Could not update the feature: ' + err.message, 'error');
  }
}

// ---------- Wiring (event delegation, CSP-safe) ----------
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('plan-edit-form')?.addEventListener('submit', savePlanEditor);

  document.addEventListener('click', (e) => {
    const cycleBtn = e.target.closest('[data-plan-cycle]');
    if (cycleBtn) {
      planUi.cycle = cycleBtn.getAttribute('data-plan-cycle');
      setSegment('data-plan-cycle', planUi.cycle);
      renderPlanCards();
      return;
    }
    const currencyBtn = e.target.closest('[data-plan-currency]');
    if (currencyBtn) {
      planUi.currency = currencyBtn.getAttribute('data-plan-currency');
      setSegment('data-plan-currency', planUi.currency);
      renderPlanCards();
      return;
    }
    const editBtn = e.target.closest('[data-edit-plan]');
    if (editBtn && !editBtn.disabled) {
      openPlanEditor(editBtn.getAttribute('data-edit-plan'));
      return;
    }
    const pick = e.target.closest('[data-pick-plan]');
    if (pick && !pick.disabled && planUi.store) {
      pickStorePlan(pick.getAttribute('data-pick-plan'));
      return;
    }
    if (e.target.closest('#sp-reset')) resetStoreFeatures();
  });

  document.addEventListener('change', (e) => {
    const toggle = e.target.closest('[data-feature-toggle]');
    if (toggle && planUi.store) {
      toggleStoreFeature(toggle);
      return;
    }
    // Keep the "Plan price" hint in step with the chosen cycle and currency
    if (planUi.store && planUi.store.pendingPlanId && (e.target.id === 'sp-cycle' || e.target.id === 'sp-currency')) {
      pickStorePlan(planUi.store.pendingPlanId);
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'store-plan-form') saveStorePlan(e);
  });
});
