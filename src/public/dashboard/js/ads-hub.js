// Ads hub (new view): the four ad pages behind one "Ads" sidebar item with sub-tabs.
// The pages themselves are unchanged; this only draws the tab bar and remembers the last tab.
// app.js passes in its helpers via initAdsHub().

export const ADS_TABS = [
  { target: 'meta-ads', feature: 'meta_ads', label: 'Performance' },
  { target: 'ads-explorer', feature: 'ads_explorer', label: 'Creatives library' },
  { target: 'ad-creative-studio', feature: 'ad_creative', label: 'Create with AI' },
  { target: 'ad-intelligence', feature: 'ad_intelligence', label: 'Attribution' },
];

const LAST_TAB_KEY = 'ads_hub_tab';
let ctx = null;

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (_) { return null; }
}
function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (_) { /* storage unavailable */ }
}

export function isAdsTab(target) {
  return ADS_TABS.some((t) => t.target === target);
}

export function adsTabFeature(target) {
  const tab = ADS_TABS.find((t) => t.target === target);
  return tab ? tab.feature : null;
}

export function adsFeatureKeys() {
  return ADS_TABS.map((t) => t.feature);
}

/** Tab to open: the requested one, else the last used, else the first the plan includes. */
export function pickAdsTab(requested) {
  if (requested && isAdsTab(requested)) return requested;
  const last = storageGet(LAST_TAB_KEY);
  if (last && isAdsTab(last) && ctx.isFeatureOn(adsTabFeature(last))) return last;
  const open = ADS_TABS.find((t) => ctx.isFeatureOn(t.feature));
  return open ? open.target : null;
}

export function rememberAdsTab(target) {
  if (isAdsTab(target)) storageSet(LAST_TAB_KEY, target);
}

/** Shows the tab bar above an ads page in the new view, hides it everywhere else. */
export function syncAdsTabs(activeSection) {
  const bar = document.getElementById('ads-hub-tabs');
  if (!bar || !ctx) return;
  const show = ctx.isNewLayout() && isAdsTab(activeSection);
  bar.hidden = !show;
  if (!show) return;
  bar.innerHTML = ADS_TABS.map((t) => {
    const selected = t.target === activeSection;
    const locked = !ctx.isFeatureOn(t.feature);
    const plan = locked ? ctx.planNameFor(t.feature) : null;
    return `<button type="button" role="tab" class="ads-hub-tab${selected ? ' active' : ''}${locked ? ' locked' : ''}"
      aria-selected="${selected}" data-ads-tab="${t.target}">${ctx.escapeHtml(t.label)}${locked ? `<span class="ads-hub-lock">${ctx.escapeHtml(plan || 'Locked')}</span>` : ''}</button>`;
  }).join('');
}

export function initAdsHub(options) {
  ctx = options;
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ads-tab]');
    if (tab) ctx.openTab(tab.getAttribute('data-ads-tab'));
  });
}
