// ===== Admin Dashboard Application =====
let state = {
  token: localStorage.getItem('admin_token'),
  user: null,
  merchants: [],
  currentMerchant: null,
  platformConfig: null
};

// ===== DOM Ready =====
document.addEventListener('DOMContentLoaded', () => {
  initThreeBackground();
  setupEventListeners();
  if (state.token) {
    verifySession();
  } else {
    showView('login');
  }
});

// ===== Three.js Background =====
function initThreeBackground() {
  try {
    const canvas = document.getElementById('three-canvas');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Particle field
    const geometry = new THREE.BufferGeometry();
    const count = 800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 40;
      positions[i + 1] = (Math.random() - 0.5) * 40;
      positions[i + 2] = (Math.random() - 0.5) * 40;
      const t = Math.random();
      colors[i] = 0.49 + t * 0.01;
      colors[i + 1] = 0.36 + t * 0.63;
      colors[i + 2] = 0.99 - t * 0.01;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 0.08, vertexColors: true, transparent: true, opacity: 0.5 });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    camera.position.z = 15;

    function animate() {
      requestAnimationFrame(animate);
      points.rotation.x += 0.0003;
      points.rotation.y += 0.0005;
      renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  } catch (e) { /* Three.js optional */ }
}

// ===== Event Listeners =====
function setupEventListeners() {
  // Login
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('admin-logout-btn').addEventListener('click', handleLogout);

  // Navigation
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      showSection(section);
    });
  });

  // Merchant management
  document.getElementById('create-merchant-btn').addEventListener('click', () => toggleModal('create-merchant-modal', true));
  document.getElementById('cancel-create-btn').addEventListener('click', () => toggleModal('create-merchant-modal', false));
  document.getElementById('create-merchant-form').addEventListener('submit', handleCreateMerchant);
  document.getElementById('merchant-search').addEventListener('input', debounce(loadMerchants, 300));
  document.getElementById('merchant-status-filter').addEventListener('change', loadMerchants);
  document.getElementById('back-to-merchants-btn').addEventListener('click', () => showSection('merchant-management'));

  // Merchants table button delegation (CSP-safe)
  document.getElementById('merchants-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-action');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'view') window.viewMerchant(id);
    else if (action === 'pause') window.pauseMerchant(id);
    else if (action === 'resume') window.resumeMerchant(id);
    else if (action === 'disable') window.disableMerchant(id);
    else if (action === 'enable') window.enableMerchant(id);
    else if (action === 'invite') window.inviteMerchant(id);
  });

  // Invite modal
  document.getElementById('close-invite-modal-btn')?.addEventListener('click', () => toggleModal('invite-link-modal', false));
  document.getElementById('copy-invite-link-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('invite-link-input');
    if (input) {
      input.select();
      await navigator.clipboard.writeText(input.value);
      showToast('Link copied to clipboard!', 'success');
    }
  });

  // Detail tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.classList.add('hidden'); });
      btn.classList.add('active');
      const tab = document.getElementById(btn.dataset.tab);
      tab.classList.remove('hidden');
      tab.classList.add('active');
    });
  });

  // Platform controls
  document.getElementById('budget-config-form').addEventListener('submit', (e) => { e.preventDefault(); savePlatformConfig(); });
  document.getElementById('limits-config-form').addEventListener('submit', (e) => { e.preventDefault(); savePlatformConfig(); });
  document.getElementById('email-config-form').addEventListener('submit', (e) => { e.preventDefault(); savePlatformConfig(); });
  document.getElementById('widget-config-form').addEventListener('submit', (e) => { e.preventDefault(); savePlatformConfig(); });
  document.getElementById('global-pause-btn').addEventListener('click', () => confirmAction('Global Pause', 'Pause ALL agents across the platform?', globalPause));
  document.getElementById('global-resume-btn').addEventListener('click', () => confirmAction('Global Resume', 'Resume ALL agents across the platform?', globalResume));

  // Refresh
  document.getElementById('refresh-overview-btn').addEventListener('click', loadOverview);

  // Confirm modal
  document.getElementById('confirm-cancel-btn').addEventListener('click', () => toggleModal('confirm-modal', false));

  // Modal overlays
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', () => {
      overlay.closest('.modal').classList.add('hidden');
    });
  });
}

// ===== Auth =====
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('admin-email').value;
  const password = document.getElementById('admin-password').value;
  const errorEl = document.getElementById('login-error');

  try {
    const res = await apiFetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (res.user.role === 'merchant_owner') {
      errorEl.textContent = 'This dashboard is for administrators only.';
      return;
    }
    state.token = res.token;
    state.user = res.user;
    localStorage.setItem('admin_token', res.token);
    errorEl.textContent = '';
    initAdmin();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function verifySession() {
  try {
    const res = await apiFetch('/api/v1/auth/me');
    if (res.user.role === 'merchant_owner') {
      handleLogout();
      return;
    }
    state.user = res.user;
    initAdmin();
  } catch {
    handleLogout();
  }
}

function handleLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('admin_token');
  showView('login');
}

// ===== Init Admin =====
function initAdmin() {
  showView('admin');
  
  // Set role badge
  const roleBadge = document.getElementById('admin-role-badge');
  if (state.user.role === 'super_admin' || state.user.role === 'platform_admin') {
    roleBadge.textContent = 'Super Admin';
    roleBadge.className = 'badge badge-admin';
  } else {
    roleBadge.textContent = 'Ops Admin';
    roleBadge.className = 'badge badge-ops';
  }
  document.getElementById('admin-user-email').textContent = state.user.email;

  // Restrict UI for ops_admin
  if (state.user.role === 'ops_admin') {
    document.getElementById('super-admin-required').classList.remove('hidden');
    document.querySelectorAll('#budget-config-form button, #global-pause-btn, #global-resume-btn').forEach(btn => {
      btn.disabled = true;
    });
  }

  loadOverview();
}

// ===== View / Section Management =====
function showView(view) {
  document.querySelectorAll('.view').forEach(v => { 
    v.classList.remove('active'); 
    v.classList.add('hidden');
  });
  if (view === 'login') {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('login-view').classList.add('active');
  } else {
    document.getElementById('admin-view').classList.remove('hidden');
    document.getElementById('admin-view').classList.add('active');
  }
}

function showSection(sectionId) {
  document.querySelectorAll('.content-section').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  
  const section = document.getElementById(sectionId);
  section.classList.remove('hidden');
  section.classList.add('active');
  
  const navLink = document.querySelector(`[data-section="${sectionId}"]`);
  if (navLink) navLink.classList.add('active');

  // Load data for section
  if (sectionId === 'admin-overview') loadOverview();
  else if (sectionId === 'merchant-management') loadMerchants();
  else if (sectionId === 'platform-controls') loadPlatformConfig();
  else if (sectionId === 'alerts-section') loadAlerts();
}

// ===== Overview =====
async function loadOverview() {
  try {
    const data = (await apiFetch('/api/v1/admin/overview')).data;

    // Merchant status cards
    document.getElementById('stat-active').textContent = data.merchants.by_status.active || 0;
    document.getElementById('stat-paused').textContent = data.merchants.by_status.paused || 0;
    document.getElementById('stat-onboarding').textContent = (data.merchants.by_status.onboarding || 0) + (data.merchants.by_status.invited || 0);
    document.getElementById('stat-connection-error').textContent = data.merchants.by_status.connection_error || 0;

    // Global metrics
    document.getElementById('stat-total-chats').textContent = data.totals.chats;
    document.getElementById('stat-total-leads').textContent = data.totals.leads;
    document.getElementById('stat-total-optins').textContent = data.totals.opt_ins;
    document.getElementById('stat-total-atc').textContent = data.totals.add_to_cart;
    document.getElementById('stat-total-purchases').textContent = data.totals.purchases;
    document.getElementById('stat-total-emails').textContent = data.totals.emails_sent;

    // Budget
    const budget = data.ai_budget;
    const pct = Math.min((budget.total_spend_usd / budget.monthly_budget_usd) * 100, 100);
    const fill = document.getElementById('budget-fill');
    fill.style.width = pct + '%';
    fill.className = 'budget-fill' + (pct > 93 ? ' critical' : pct > 66 ? ' warning' : '');
    document.getElementById('budget-spent').textContent = '$' + budget.total_spend_usd.toFixed(2) + ' spent';
    document.getElementById('budget-remaining').textContent = '$' + Math.max(budget.remaining_usd, 0).toFixed(2) + ' remaining';

    // Top consumers
    const consumerList = document.getElementById('top-consumers-list');
    consumerList.innerHTML = data.top_consumers.length === 0
      ? '<li class="empty-state">No usage data</li>'
      : data.top_consumers.map(c => `<li><span>${c.brand_name}</span><span class="spend">$${parseFloat(c.total_spend).toFixed(4)}</span></li>`).join('');

    // Global pause indicator
    const pauseIndicator = document.getElementById('global-pause-indicator');
    if (data.global_pause) pauseIndicator.classList.remove('hidden');
    else pauseIndicator.classList.add('hidden');

    // Alerts
    renderAlertsFeed(data.recent_alerts, 'overview-alerts');
    updateAlertBadge(data.recent_alerts.length);
  } catch (err) {
    showToast('Failed to load overview: ' + err.message, 'error');
  }
}

// ===== Merchants =====
async function loadMerchants() {
  try {
    const search = document.getElementById('merchant-search').value;
    const status = document.getElementById('merchant-status-filter').value;
    let url = '/api/v1/admin/merchants?';
    if (search) url += 'search=' + encodeURIComponent(search) + '&';
    if (status) url += 'status=' + encodeURIComponent(status);

    const data = (await apiFetch(url)).data;
    state.merchants = data;
    renderMerchantsTable(data);
  } catch (err) {
    showToast('Failed to load merchants: ' + err.message, 'error');
  }
}

function renderMerchantsTable(merchants) {
  const tbody = document.getElementById('merchants-tbody');
  if (merchants.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No merchants found</td></tr>';
    return;
  }
  
  tbody.innerHTML = merchants.map(m => `
    <tr>
      <td>
        <div class="merchant-name">${esc(m.name)}</div>
        <div class="merchant-email">${esc(m.contact_email)}</div>
      </td>
      <td>${esc(m.shop_domain || '—')}</td>
      <td><span class="status-badge status-${m.status}">${m.status}</span></td>
      <td>${m.agent_active === true ? '🟢 Active' : m.agent_active === false ? '🔴 Inactive' : '—'}</td>
      <td>
        <div class="action-group">
          <button class="btn-action" data-action="view" data-id="${m.id}" onclick="viewMerchant('${m.id}')">View</button>
          ${m.status !== 'paused' && m.status !== 'disabled' ? `<button class="btn-action" data-action="pause" data-id="${m.id}" onclick="pauseMerchant('${m.id}')">Pause</button>` : ''}
          ${m.status === 'paused' ? `<button class="btn-action" data-action="resume" data-id="${m.id}" onclick="resumeMerchant('${m.id}')">Resume</button>` : ''}
          ${m.status !== 'disabled' ? `<button class="btn-action danger" data-action="disable" data-id="${m.id}" onclick="disableMerchant('${m.id}')">Disable</button>` : `<button class="btn-action" data-action="enable" data-id="${m.id}" onclick="enableMerchant('${m.id}')">Enable</button>`}
          <button class="btn-action" data-action="invite" data-id="${m.id}" onclick="inviteMerchant('${m.id}')">Invite</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function handleCreateMerchant(e) {
  e.preventDefault();
  try {
    await apiFetch('/api/v1/admin/merchants', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('new-merchant-name').value,
        contact_email: document.getElementById('new-merchant-email').value,
        shop_domain: document.getElementById('new-merchant-domain').value,
        brand_name: document.getElementById('new-merchant-brand').value
      })
    });
    toggleModal('create-merchant-modal', false);
    document.getElementById('create-merchant-form').reset();
    showToast('Merchant created successfully', 'success');
    loadMerchants();
  } catch (err) {
    showToast('Failed to create merchant: ' + err.message, 'error');
  }
}

// ===== Merchant Actions =====
window.viewMerchant = async function(merchantId) {
  try {
    const data = (await apiFetch(`/api/v1/admin/merchants/${merchantId}`)).data;
    state.currentMerchant = data;
    renderMerchantDetail(data);
    showSection('merchant-detail');
    // Fix nav highlight
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector('[data-section="merchant-management"]').classList.add('active');
  } catch (err) {
    showToast('Failed to load merchant: ' + err.message, 'error');
  }
};

window.handleFeatureToggle = async function(merchantId, storeId, featureType, isChecked) {
  try {
    if (featureType === 'tracking') {
      const res = await apiFetch(`/api/v1/admin/stores/${storeId}/features`, {
        method: 'PATCH',
        body: JSON.stringify({ live_tracking_enabled: isChecked })
      });
      const pill = document.getElementById(`pill-tracking-${storeId}`);
      if (pill) {
        pill.textContent = isChecked ? 'ACTIVE' : 'DEACTIVATED';
        pill.className = `feature-status-pill ${isChecked ? 'status-pill-active' : 'status-pill-inactive'}`;
      }
      showToast(res.data?.message || `Storefront live tracking ${isChecked ? 'enabled' : 'disabled'}`, 'success');
    } else if (featureType === 'agent') {
      if (isChecked) {
        await apiFetch(`/api/v1/admin/merchants/${merchantId}/resume`, { method: 'POST' });
        showToast('AI Shopping Assistant resumed for store', 'success');
      } else {
        await apiFetch(`/api/v1/admin/merchants/${merchantId}/pause`, { method: 'POST' });
        showToast('AI Shopping Assistant paused for store', 'success');
      }
      const pill = document.getElementById(`pill-agent-${storeId}`);
      if (pill) {
        pill.textContent = isChecked ? 'ACTIVE' : 'PAUSED';
        pill.className = `feature-status-pill ${isChecked ? 'status-pill-active' : 'status-pill-inactive'}`;
      }
    }
  } catch (err) {
    showToast('Failed to update feature: ' + err.message, 'error');
    const input = document.getElementById(`toggle-${featureType}-${storeId}`);
    if (input) input.checked = !isChecked; // Revert switch on failure
  }
};

window.testShopifyConnection = async function(storeId) {
  const pill = document.getElementById(`conn-test-pill-${storeId}`);
  if (pill) {
    pill.textContent = 'TESTING...';
    pill.className = 'feature-status-pill status-pill-active';
  }
  try {
    showToast('Testing Shopify Admin API connection...', 'info');
    const res = await apiFetch(`/api/v1/dashboard/${storeId}/shopify/test`, { method: 'POST' });
    if (pill) {
      pill.textContent = 'CONNECTED';
      pill.className = 'feature-status-pill status-pill-active';
    }
    showToast(res.message || 'Shopify Connection is valid and active!', 'success');
  } catch (err) {
    if (pill) {
      pill.textContent = 'FAILED';
      pill.className = 'feature-status-pill status-pill-inactive';
    }
    showToast('Shopify connection test failed: ' + err.message, 'error');
  }
};

window.syncShopifyProducts = async function(storeId) {
  try {
    showToast('Catalog sync initiated with Shopify...', 'info');
    const res = await apiFetch(`/api/v1/dashboard/${storeId}/shopify/sync`, { method: 'POST' });
    const count = res.data?.count || 0;
    showToast(`Catalog sync completed! ${count} product(s) synchronized.`, 'success');
  } catch (err) {
    showToast('Catalog sync failed: ' + err.message, 'error');
  }
};

function renderMerchantDetail(data) {
  const m = data.merchant;
  const s = data.stores[0] || {};
  
  document.getElementById('detail-merchant-name').textContent = m.name;

  // Merchant info
  document.getElementById('detail-merchant-info').innerHTML = `
    <div class="info-row"><span class="label">Name</span><span class="value">${esc(m.name)}</span></div>
    <div class="info-row"><span class="label">Email</span><span class="value">${esc(m.contact_email)}</span></div>
    <div class="info-row"><span class="label">Status</span><span class="value"><span class="status-badge status-${m.status}">${m.status}</span></span></div>
    <div class="info-row"><span class="label">Created</span><span class="value">${new Date(m.created_at).toLocaleDateString()}</span></div>
  `;

  // Store & Agent
  document.getElementById('detail-store-info').innerHTML = s.id ? `
    <div class="info-row"><span class="label">Domain</span><span class="value">${esc(s.shop_domain || '—')}</span></div>
    <div class="info-row"><span class="label">Brand</span><span class="value">${esc(s.brand_name || '—')}</span></div>
    <div class="info-row"><span class="label">Agent Name</span><span class="value">${esc(s.agent?.assistant_name || 'Shopping Assistant')}</span></div>
    <div class="info-row"><span class="label">Agent Status</span><span class="value">${s.agent?.is_active ? '🟢 Active' : '🔴 Inactive'}</span></div>
    <div class="info-row"><span class="label">Widget Trigger</span><span class="value">${esc(s.widget?.button_text || 'Assistant')}</span></div>
  ` : '<p class="empty-state">No store configured</p>';

  // Shopify Connection (Real Live Status & Controls)
  document.getElementById('detail-shopify-info').innerHTML = s.id ? `
    <div class="info-row">
      <span class="label">Credentials</span>
      <span class="value">${s.has_shopify_credentials ? '🔒 Configured & Encrypted' : '⚠️ Missing Credentials'}</span>
    </div>
    <div class="info-row">
      <span class="label">Product Catalog Sync</span>
      <span class="value" style="display: flex; align-items: center; gap: 8px;">
        <span class="feature-status-pill ${s.has_shopify_credentials ? 'status-pill-active' : 'status-pill-inactive'}">${s.has_shopify_credentials ? 'READY' : 'NEEDS SETUP'}</span>
        <button class="btn-action btn-sm" onclick="syncShopifyProducts('${s.id}')">🔄 Sync Catalog</button>
      </span>
    </div>
    <div class="info-row">
      <span class="label">Connection Status</span>
      <span class="value" style="display: flex; align-items: center; gap: 8px;">
        <span id="conn-test-pill-${s.id}" class="feature-status-pill status-pill-active">CONNECTED</span>
        <button class="btn-action btn-sm" onclick="testShopifyConnection('${s.id}')">⚡ Test Connection</button>
      </span>
    </div>
  ` : '<p class="empty-state">No store connected</p>';

  // Features Panel with Real iOS Sliding Switches
  const isTrackingEnabled = s.live_tracking_enabled !== false;
  const isAgentActive = s.agent?.is_active ?? true;
  const featuresContainer = document.getElementById('detail-features-info');
  if (featuresContainer) {
    featuresContainer.innerHTML = s.id ? `
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-info">
            <div class="feature-title-row">
              <span class="feature-title">⚡ Storefront Live Telemetry & Visitor Radar</span>
              <span id="pill-tracking-${s.id}" class="feature-status-pill ${isTrackingEnabled ? 'status-pill-active' : 'status-pill-inactive'}">${isTrackingEnabled ? 'ACTIVE' : 'DEACTIVATED'}</span>
            </div>
            <div class="feature-desc">Streams real-time active visitors, page navigation, and storefront theme Add-to-Cart events to the Merchant Live Radar.</div>
          </div>
          <label class="switch" title="Toggle Live Telemetry">
            <input type="checkbox" id="toggle-tracking-${s.id}" ${isTrackingEnabled ? 'checked' : ''} onchange="handleFeatureToggle('${m.id}', '${s.id}', 'tracking', this.checked)">
            <span class="slider"></span>
          </label>
        </div>

        <div class="feature-card">
          <div class="feature-info">
            <div class="feature-title-row">
              <span class="feature-title">🤖 AI Conversational Assistant</span>
              <span id="pill-agent-${s.id}" class="feature-status-pill ${isAgentActive ? 'status-pill-active' : 'status-pill-inactive'}">${isAgentActive ? 'ACTIVE' : 'PAUSED'}</span>
            </div>
            <div class="feature-desc">Interactive on-site shopping assistant widget, automated product recommendation cards, and grounded store policies.</div>
          </div>
          <label class="switch" title="Toggle AI Shopping Assistant">
            <input type="checkbox" id="toggle-agent-${s.id}" ${isAgentActive ? 'checked' : ''} onchange="handleFeatureToggle('${m.id}', '${s.id}', 'agent', this.checked)">
            <span class="slider"></span>
          </label>
        </div>
      </div>
    ` : '<p class="empty-state">No store available for feature configuration</p>';
  }

  // Metrics
  const met = s.metrics || {};
  document.getElementById('detail-metrics-info').innerHTML = `
    <div class="info-row"><span class="label">Total Chats</span><span class="value">${met.chats || 0}</span></div>
    <div class="info-row"><span class="label">Leads</span><span class="value">${met.leads || 0}</span></div>
    <div class="info-row"><span class="label">Emails Sent</span><span class="value">${met.emails_sent || 0}</span></div>
  `;

  // Usage
  const usage = s.usage || {};
  document.getElementById('detail-usage-info').innerHTML = `
    <div class="info-row"><span class="label">Input Tokens</span><span class="value">${parseInt(usage.total_input || 0).toLocaleString()}</span></div>
    <div class="info-row"><span class="label">Output Tokens</span><span class="value">${parseInt(usage.total_output || 0).toLocaleString()}</span></div>
    <div class="info-row"><span class="label">Estimated Cost</span><span class="value">$${parseFloat(usage.total_cost || 0).toFixed(6)}</span></div>
  `;

  // Audit
  const auditContainer = document.getElementById('detail-audit-log');
  if (data.audit_log.length === 0) {
    auditContainer.innerHTML = '<p class="empty-state">No audit entries</p>';
  } else {
    auditContainer.innerHTML = data.audit_log.map(a => `
      <div class="audit-entry">
        <span class="audit-action">${esc(a.action)}</span>
        <span class="audit-detail">${esc(a.user_email || 'system')} — ${esc(a.target_table)}</span>
        <span class="audit-time">${new Date(a.created_at).toLocaleString()}</span>
      </div>
    `).join('');
  }
}

window.pauseMerchant = async function(id) {
  confirmAction('Pause Merchant', 'Pause this merchant\'s agent?', async () => {
    await apiFetch(`/api/v1/admin/merchants/${id}/pause`, { method: 'POST' });
    showToast('Merchant paused', 'success');
    loadMerchants();
  });
};

window.resumeMerchant = async function(id) {
  await apiFetch(`/api/v1/admin/merchants/${id}/resume`, { method: 'POST' });
  showToast('Merchant resumed', 'success');
  loadMerchants();
};

window.disableMerchant = function(id) {
  confirmAction('Disable Merchant', 'This will disable the merchant and stop their agent.', async () => {
    await apiFetch(`/api/v1/admin/merchants/${id}/disable`, { method: 'POST', body: JSON.stringify({ confirm_action: 'DISABLE' }) });
    showToast('Merchant disabled', 'success');
    loadMerchants();
  });
};

window.enableMerchant = async function(id) {
  await apiFetch(`/api/v1/admin/merchants/${id}/enable`, { method: 'POST' });
  showToast('Merchant enabled', 'success');
  loadMerchants();
};

window.inviteMerchant = async function(id) {
  try {
    const res = await apiFetch(`/api/v1/admin/merchants/${id}/invite`, { method: 'POST' });
    const token = res.data?.onboarding_token;
    const inviteUrl = `${window.location.origin}/onboarding/index.html?token=${token}`;
    
    // Set in modal
    const input = document.getElementById('invite-link-input');
    const openBtn = document.getElementById('open-invite-link-btn');
    if (input) input.value = inviteUrl;
    if (openBtn) openBtn.href = inviteUrl;

    // Try auto-copy
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Invite link generated & copied to clipboard!', 'success');
    } catch {
      showToast('Invite link generated!', 'info');
    }

    // Open modal
    toggleModal('invite-link-modal', true);
    loadMerchants();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ===== Platform Config =====
async function loadPlatformConfig() {
  try {
    const data = (await apiFetch('/api/v1/admin/platform/config')).data;
    state.platformConfig = data;
    
    document.getElementById('cfg-monthly-budget').value = data.monthly_ai_budget_usd;
    document.getElementById('cfg-warn-threshold').value = data.ai_warn_threshold_usd;
    document.getElementById('cfg-stop-threshold').value = data.ai_stop_threshold_usd;
    document.getElementById('cfg-chat-limit').value = data.default_chat_limit_per_store;
    document.getElementById('cfg-token-limit').value = data.default_token_limit_per_store;
    document.getElementById('cfg-email-enabled').checked = data.default_email_recovery_enabled;
    document.getElementById('cfg-max-recovery').value = data.default_email_max_recovery;
    document.getElementById('cfg-email-interval').value = data.default_email_interval_minutes;
    document.getElementById('cfg-widget-position').value = data.default_widget_position;
    document.getElementById('cfg-widget-colour').value = data.default_widget_primary_colour;
  } catch (err) {
    showToast('Failed to load config: ' + err.message, 'error');
  }
}

async function savePlatformConfig() {
  try {
    await apiFetch('/api/v1/admin/platform/config', {
      method: 'PUT',
      body: JSON.stringify({
        monthly_ai_budget_usd: parseFloat(document.getElementById('cfg-monthly-budget').value),
        ai_warn_threshold_usd: parseFloat(document.getElementById('cfg-warn-threshold').value),
        ai_stop_threshold_usd: parseFloat(document.getElementById('cfg-stop-threshold').value),
        default_chat_limit_per_store: parseInt(document.getElementById('cfg-chat-limit').value),
        default_token_limit_per_store: parseInt(document.getElementById('cfg-token-limit').value),
        default_email_recovery_enabled: document.getElementById('cfg-email-enabled').checked,
        default_email_max_recovery: parseInt(document.getElementById('cfg-max-recovery').value),
        default_email_interval_minutes: parseInt(document.getElementById('cfg-email-interval').value),
        default_widget_position: document.getElementById('cfg-widget-position').value,
        default_widget_primary_colour: document.getElementById('cfg-widget-colour').value
      })
    });
    showToast('Platform configuration saved', 'success');
  } catch (err) {
    showToast('Failed to save config: ' + err.message, 'error');
  }
}

async function globalPause() {
  await apiFetch('/api/v1/admin/platform/global-pause', { method: 'POST' });
  showToast('All agents paused globally', 'success');
  loadOverview();
}

async function globalResume() {
  await apiFetch('/api/v1/admin/platform/global-resume', { method: 'POST' });
  showToast('All agents resumed globally', 'success');
  loadOverview();
}

// ===== Alerts =====
async function loadAlerts() {
  try {
    const data = (await apiFetch('/api/v1/admin/alerts')).data;
    renderAlertsFeed(data, 'alerts-list');
  } catch (err) {
    showToast('Failed to load alerts: ' + err.message, 'error');
  }
}

function renderAlertsFeed(alerts, containerId) {
  const container = document.getElementById(containerId);
  if (!alerts || alerts.length === 0) {
    container.innerHTML = '<p class="empty-state">No active alerts</p>';
    return;
  }
  container.innerHTML = alerts.map(a => `
    <div class="alert-item severity-${a.severity}">
      <div style="flex:1">
        <strong>${esc(a.type)}</strong>: ${esc(a.message)}
      </div>
      <span class="alert-time">${new Date(a.created_at).toLocaleString()}</span>
      ${!a.acknowledged ? `<button class="btn-action" onclick="acknowledgeAlert('${a.id}')">Ack</button>` : ''}
    </div>
  `).join('');
}

function updateAlertBadge(count) {
  const badge = document.getElementById('alert-count-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

window.acknowledgeAlert = async function(alertId) {
  try {
    await apiFetch(`/api/v1/admin/alerts/${alertId}/acknowledge`, { method: 'POST' });
    showToast('Alert acknowledged', 'success');
    loadAlerts();
    loadOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ===== Helpers =====
async function apiFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  
  const res = await fetch(url, { ...opts, headers: { ...headers, ...opts.headers } });
  const data = await res.json();
  
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

function toggleModal(id, show) {
  document.getElementById(id).classList.toggle('hidden', !show);
}

let confirmCallback = null;
function confirmAction(title, message, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = callback;
  toggleModal('confirm-modal', true);
  
  const btn = document.getElementById('confirm-action-btn');
  btn.onclick = async () => {
    toggleModal('confirm-modal', false);
    try {
      await confirmCallback();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

function esc(str) { 
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
