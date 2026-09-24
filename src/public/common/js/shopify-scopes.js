// Renders the Shopify custom-app permission list (required / recommended / optional + Storefront)
// into every element with [data-shopify-scopes]. Source of truth: GET /api/v1/shopify/required-scopes.
(function () {
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const LEVELS = [
    { key: 'required', title: 'Required' },
    { key: 'recommended', title: 'Recommended' },
    { key: 'optional', title: 'Optional' },
  ];

  function copyButton(text, label) {
    return `<button type="button" class="scopes-copy" data-copy="${esc(text)}">${esc(label)}</button>`;
  }

  function render(el, data) {
    const admin = Array.isArray(data.admin) ? data.admin : [];
    const groups = LEVELS.map(level => {
      const items = admin.filter(s => s.level === level.key);
      if (!items.length) return '';
      return `
        <div class="scopes-group">
          <div class="scopes-group-head"><strong>${level.title}</strong>${copyButton(items.map(s => s.scope).join(', '), 'Copy')}</div>
          <ul>${items.map(s => `<li><code>${esc(s.scope)}</code><span>${esc(s.unlocks)}</span></li>`).join('')}</ul>
        </div>`;
    }).join('');
    const storefront = Array.isArray(data.storefront) ? data.storefront : [];
    el.innerHTML = `
      <div class="scopes-box">
        <div class="scopes-intro">Tick these in your Shopify custom app (all are read-only), then install the app and copy the tokens.
          ${copyButton([...admin.filter(s => s.level !== 'optional').map(s => s.scope)].join(', '), 'Copy required + recommended')}</div>
        ${groups}
        ${storefront.length ? `
          <div class="scopes-group">
            <div class="scopes-group-head"><strong>Storefront API</strong>${copyButton(storefront.join(', '), 'Copy')}</div>
            <ul>${storefront.map(s => `<li><code>${esc(s)}</code></li>`).join('')}</ul>
          </div>` : ''}
      </div>`;
  }

  function wireCopy(root) {
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('.scopes-copy');
      if (!btn) return;
      try {
        await navigator.clipboard.writeText(btn.getAttribute('data-copy') || '');
        const original = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (_) { /* clipboard blocked: the list stays visible to copy by hand */ }
    });
  }

  async function init() {
    const targets = document.querySelectorAll('[data-shopify-scopes]');
    if (!targets.length) return;
    let data = null;
    try {
      const res = await fetch('/api/v1/shopify/required-scopes');
      const json = await res.json();
      data = json && json.data;
    } catch (_) { data = null; }
    targets.forEach(el => {
      if (data) {
        render(el, data);
        wireCopy(el);
      } else {
        el.textContent = 'Required permissions: read_products, read_orders, read_customers, read_inventory.';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
