// Hubs (new view): several existing pages behind one sidebar item with sub-tabs.
// Ads, Marketing and Settings each group pages that used to be separate sidebar items.
// The pages themselves are unchanged; this draws the tab bar and remembers the last tab.
// app.js passes in its helpers via initHubs().

/** feature: the entitlement a tab needs (null = always available). */
export const HUBS = {
  ads: [
    { target: 'meta-ads', feature: 'meta_ads', label: 'Performance' },
    { target: 'ads-explorer', feature: 'ads_explorer', label: 'Creatives library' },
    { target: 'ad-creative-studio', feature: 'ad_creative', label: 'Create with AI' },
    { target: 'ad-intelligence', feature: 'ad_intelligence', label: 'Attribution' },
  ],
  marketing: [
    { target: 'email-automation', feature: 'email_automation', label: 'Email recovery' },
    { target: 'reorder-reminders', feature: 'smart_reorder', label: 'Smart reorder' },
    { target: 'whatsapp-growth', feature: 'whatsapp', label: 'WhatsApp' },
  ],
  settings: [
    { target: 'shopify-connection', feature: null, label: 'Shopify connection' },
    { target: 'plan-billing', feature: null, label: 'Plan & billing' },
  ],
};

const HUB_LABELS = { ads: 'Ads sections', marketing: 'Marketing sections', settings: 'Settings sections' };
const lastTabKey = (hub) => `hub_tab_${hub}`;
let ctx = null;

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (_) { return null; }
}
function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (_) { /* storage unavailable */ }
}

export function isHub(id) {
  return Object.prototype.hasOwnProperty.call(HUBS, id);
}

/** The hub a page belongs to, or null. */
export function hubOf(target) {
  for (const [hub, tabs] of Object.entries(HUBS)) {
    if (tabs.some((t) => t.target === target)) return hub;
  }
  return null;
}

export function hubTabFeature(target) {
  const hub = hubOf(target);
  const tab = hub ? HUBS[hub].find((t) => t.target === target) : null;
  return tab ? tab.feature : null;
}

/** Entitlements behind a hub's tabs; the hub is locked only when all of them are off. */
export function hubFeatureKeys(hub) {
  return (HUBS[hub] || []).map((t) => t.feature).filter(Boolean);
}

function tabOpen(tab) {
  return !tab.feature || ctx.isFeatureOn(tab.feature);
}

/** Tab to open: the requested one, else the last used, else the first the plan includes. */
export function pickHubTab(hub, requested) {
  const tabs = HUBS[hub] || [];
  if (requested && tabs.some((t) => t.target === requested)) return requested;
  const last = storageGet(lastTabKey(hub));
  const lastTab = tabs.find((t) => t.target === last);
  if (lastTab && tabOpen(lastTab)) return last;
  const open = tabs.find(tabOpen);
  return open ? open.target : null;
}

export function rememberHubTab(target) {
  const hub = hubOf(target);
  if (hub) storageSet(lastTabKey(hub), target);
}

/** Shows the tab bar above a hub page in the new view, hides it everywhere else. */
export function syncHubTabs(activeSection) {
  const bar = document.getElementById('hub-tabs');
  if (!bar || !ctx) return;
  const hub = hubOf(activeSection);
  const show = ctx.isNewLayout() && !!hub;
  bar.hidden = !show;
  if (!show) return;
  bar.setAttribute('aria-label', HUB_LABELS[hub]);
  bar.innerHTML = HUBS[hub].map((t) => {
    const selected = t.target === activeSection;
    const locked = !tabOpen(t);
    const plan = locked ? ctx.planNameFor(t.feature) : null;
    return `<button type="button" role="tab" class="hub-tab${selected ? ' active' : ''}${locked ? ' locked' : ''}"
      aria-selected="${selected}" data-hub-tab="${t.target}">${ctx.escapeHtml(t.label)}${locked ? `<span class="hub-lock">${ctx.escapeHtml(plan || 'Locked')}</span>` : ''}</button>`;
  }).join('');
}

export function initHubs(options) {
  ctx = options;
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-hub-tab]');
    if (tab) ctx.openTab(tab.getAttribute('data-hub-tab'));
  });
}
