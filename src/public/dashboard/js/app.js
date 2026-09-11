// Application State
let state = {
  token: localStorage.getItem('auth_token'),
  user: null,
  activeStoreId: null,
  stores: []
};

// 3D Avatar Presets Gallery for AI Assistant
const AVATAR_PRESETS = [
  {
    id: 'cyber-nova',
    name: '3D Nova',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Nova&backgroundColor=6366f1,818cf8',
  },
  {
    id: 'quantum-apex',
    name: '3D Apex',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Apex&backgroundColor=0284c7,38bdf8',
  },
  {
    id: 'neon-sparkle',
    name: '3D Sparkle',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Sparkle&backgroundColor=ec4899,d946ef',
  },
  {
    id: 'emerald-aura',
    name: '3D Aura',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Emerald&backgroundColor=059669,34d399',
  },
  {
    id: 'solar-cosmo',
    name: '3D Cosmo',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Cosmo&backgroundColor=f59e0b,fbbf24',
  },
  {
    id: 'zenith-bot',
    name: '3D Zenith',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Zenith&backgroundColor=7c3aed,a855f7',
  },
];

// DOM Elements
const views = {
  login: document.getElementById('login-view'),
  dashboard: document.getElementById('dashboard-view')
};

const sections = {
  'overview': document.getElementById('overview'),
  'live-analytics': document.getElementById('live-analytics'),
  'my-agent': document.getElementById('my-agent'),
  'leads-optins': document.getElementById('leads-optins'),
  'widget-settings': document.getElementById('widget-settings'),
  'shopify-connection': document.getElementById('shopify-connection'),
  'ad-creative-studio': document.getElementById('ad-creative-studio'),
  'whatsapp-growth': document.getElementById('whatsapp-growth'),
  'email-automation': document.getElementById('email-automation')
};

let adStudioState = {
  products: [],
  selectedProduct: null,
  variations: [],
  activeVariationIndex: 0,
  platform: 'facebook',
  objective: 'product_sales',
  savedCreatives: [],
  generatedImageUrl: null,
};

let liveAnalyticsTimer = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  initAvatarPresets();
  setupEventListeners();
  if (state.token) {
    verifySession();
  } else {
    showView('login');
  }
});

function setupEventListeners() {
  // Mobile drawer navigation controls
  const menuToggle = document.getElementById('mobile-menu-toggle');
  const sidebarClose = document.getElementById('mobile-sidebar-close');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (menuToggle) menuToggle.addEventListener('click', openMobileSidebar);
  if (sidebarClose) sidebarClose.addEventListener('click', closeMobileSidebar);
  if (backdrop) backdrop.addEventListener('click', closeMobileSidebar);

  // Live Analytics controls
  const btnRefreshLive = document.getElementById('btn-refresh-live');
  if (btnRefreshLive) {
    btnRefreshLive.addEventListener('click', () => {
      loadLiveAnalytics();
      const timeframe = parseInt(document.getElementById('funnel-timeframe')?.value || '7', 10);
      loadConversionFunnel(timeframe);
      loadProductPerformance();
      showToast('Live telemetry refreshed');
    });
  }

  const funnelSelect = document.getElementById('funnel-timeframe');
  if (funnelSelect) {
    funnelSelect.addEventListener('change', (e) => {
      loadConversionFunnel(parseInt(e.target.value, 10));
    });
  }

  // AI Ad Creative Studio controls
  setupAdStudioEventListeners();

  // WhatsApp Growth Engine controls
  setupWhatsAppEventListeners();

  // Login
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');
    
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('auth_token', data.token);
      
      errorEl.textContent = '';
      initDashboard();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    state = { token: null, user: null, activeStoreId: null, stores: [] };
    localStorage.removeItem('auth_token');
    stopLiveAnalyticsPolling();
    showView('login');
  });

  // Navigation
  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const a = e.target.closest('a');
      if (!a) return;
      document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
      a.classList.add('active');
      
      const target = a.getAttribute('data-target');
      showSection(target);
      loadSectionData(target);
      closeMobileSidebar();
    });
  });

  // 1. Agent Settings Save
  document.getElementById('agent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const isActive = document.getElementById('agent-is-active').checked;
    
    const payload = {
      assistant: {
        is_active: isActive,
        assistant_name: document.getElementById('agent-name').value,
        welcome_message: document.getElementById('agent-welcome').value,
        tone: document.getElementById('agent-tone').value,
        support_contact: document.getElementById('agent-support').value,
        custom_prompt: document.getElementById('agent-custom-prompt') ? document.getElementById('agent-custom-prompt').value : '',
        knowledge_base: document.getElementById('agent-knowledge-base') ? document.getElementById('agent-knowledge-base').value : ''
      },
      policies: {
        faq_content: document.getElementById('store-faq').value
      }
    };

    if (!isActive) {
      showConfirmModal('Disable Assistant?', 'Your assistant will stop answering chats immediately.', () => saveAgentSettings(payload));
    } else {
      saveAgentSettings(payload);
    }
  });

  // Document Upload for Agent Knowledge Base
  const docUploadInput = document.getElementById('agent-doc-upload');
  if (docUploadInput) {
    docUploadInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const fileName = file.name;
      const ext = fileName.split('.').pop().toLowerCase();
      showToast(`Loading document: ${fileName}...`);

      const reader = new FileReader();
      reader.onload = () => {
        let extracted = '';
        const raw = reader.result;
        if (ext === 'pdf') {
          if (typeof raw === 'string') {
            const matches = raw.match(/\(([^()]+)\)/g);
            if (matches && matches.length > 5) {
              extracted = matches.map(m => m.slice(1, -1)).join(' ');
            } else {
              extracted = raw.replace(/[^\x20-\x7E\t\n\r]/g, ' ').replace(/\s+/g, ' ');
            }
          }
          if (!extracted || extracted.trim().length < 20) {
            extracted = `Brand & product notes extracted from ${fileName}.`;
          }
        } else {
          extracted = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        }

        const kbEl = document.getElementById('agent-knowledge-base');
        if (kbEl) {
          const existing = kbEl.value.trim();
          const header = `\n--- Document: ${fileName} ---\n`;
          kbEl.value = existing ? (existing + '\n' + header + extracted).trim() : (header + extracted).trim();
          showToast(`Loaded ${fileName}! Click "Save Agent Settings" to persist.`);
        }
      };

      if (ext === 'pdf' && reader.readAsBinaryString) {
        reader.readAsBinaryString(file);
      } else {
        reader.readAsText(file);
      }
    });
  }

  // 2. Widget Settings Save
  document.getElementById('widget-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      widget: {
        button_text: document.getElementById('widget-btn-text').value,
        primary_colour: document.getElementById('widget-primary-color').value,
        secondary_colour: document.getElementById('widget-secondary-color').value,
        position: document.getElementById('widget-position').value,
        header_title: document.getElementById('widget-header-title') ? document.getElementById('widget-header-title').value : '',
        avatar_url: document.getElementById('widget-avatar-url') ? document.getElementById('widget-avatar-url').value.trim() : '',
        custom_css: document.getElementById('widget-custom-css') ? document.getElementById('widget-custom-css').value : '',
      }
    };

    try {
      const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/widget`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to save widget settings');
      showToast('Widget settings saved successfully!');
      updateLivePreview();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Widget preview auto-update
  ['widget-btn-text', 'widget-header-title', 'widget-primary-color', 'widget-secondary-color', 'widget-position', 'widget-avatar-url'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        if (id === 'widget-avatar-url') {
          updateAvatarPresetSelection(el.value.trim());
        }
        updateLivePreview();
      });
    }
  });

  // Clear Avatar Button
  const clearAvatarBtn = document.getElementById('btn-clear-avatar');
  if (clearAvatarBtn) {
    clearAvatarBtn.addEventListener('click', () => {
      const avatarInput = document.getElementById('widget-avatar-url');
      if (avatarInput) avatarInput.value = '';
      updateAvatarPresetSelection('');
      updateLivePreview();
      showToast('Avatar cleared. Default bag icon will be used.');
    });
  }

  // Export Leads (CSV)
  const exportLeadsBtn = document.getElementById('btn-export-leads');
  if (exportLeadsBtn) {
    exportLeadsBtn.addEventListener('click', async () => {
      if (!state.activeStoreId) return;
      const originalText = exportLeadsBtn.innerHTML;
      exportLeadsBtn.disabled = true;
      exportLeadsBtn.innerHTML = '<span>⏳</span> Exporting...';
      showToast('Preparing leads export...');

      try {
        const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/leads/export`, {
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (!res.ok) throw new Error('Failed to export leads');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `leads_${state.activeStoreId.substring(0, 8)}_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('Leads CSV downloaded successfully!');
      } catch (err) {
        showToast(err.message, true);
      } finally {
        exportLeadsBtn.disabled = false;
        exportLeadsBtn.innerHTML = originalText;
      }
    });
  }

  // Regenerate Key
  document.getElementById('regenerate-key-btn').addEventListener('click', () => {
    showConfirmModal('Regenerate Key?', 'This instantly invalidates the current snippet. You MUST update Shopify.', async () => {
      try {
        const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/widget/regenerate-key`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (!res.ok) throw new Error('Failed to regenerate key');
        const { data } = await res.json();
        updateSnippetCode(data.widget_key);
        showToast('Widget key regenerated! Update your Shopify theme.');
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  // Copy Snippet
  document.getElementById('copy-snippet-btn').addEventListener('click', () => {
    const code = document.getElementById('snippet-code').innerText;
    navigator.clipboard.writeText(code);
    showToast('Snippet copied to clipboard!');
  });

  // 3. Shopify Actions
  document.getElementById('test-connection-btn').addEventListener('click', async () => {
    try {
      const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/shopify/test`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const data = await res.json();
      showToast(data.message);
    } catch (err) {
      showToast('Connection test failed', true);
    }
  });

  document.getElementById('sync-products-btn').addEventListener('click', () => {
    showConfirmModal('Sync Products?', 'This will re-sync your entire catalog from Shopify.', async () => {
      const btn = document.getElementById('sync-products-btn');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Syncing Catalog...';
      try {
        const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/shopify/sync`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Sync failed');
        showToast(data.message || 'Catalog synced successfully!');
        loadSectionData('shopify-connection');
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });

  // Product Catalog Search & Refresh
  const searchInput = document.getElementById('product-search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadProductsTable(e.target.value);
      }, 300);
    });
  }

  const refreshProductsBtn = document.getElementById('refresh-products-btn');
  if (refreshProductsBtn) {
    refreshProductsBtn.addEventListener('click', () => {
      const q = searchInput ? searchInput.value : '';
      loadProductsTable(q);
      showToast('Product catalog refreshed');
    });
  }

  // 4. Email Settings
  document.getElementById('email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      settings: {
        is_enabled: document.getElementById('email-is-enabled').checked,
        follow_up_interval_minutes: parseInt(document.getElementById('email-interval').value, 10),
        max_recovery_emails: parseInt(document.getElementById('email-max').value, 10),
        consent_wording: document.getElementById('email-consent').value
      }
    };

    try {
      const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/email`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to save email settings');
      showToast('Email settings saved successfully!');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Test Email
  document.getElementById('send-test-email-btn').addEventListener('click', async () => {
    const email = document.getElementById('test-email-input').value;
    if (!email) return showToast('Please enter an email address', true);
    try {
      const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/email/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send test email');
      showToast(data.message);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

async function saveAgentSettings(payload) {
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/agent`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) throw new Error('Failed to save settings');
    showToast('Agent settings saved successfully!');
    
    // Refresh overview to update badges
    if (!document.getElementById('overview').classList.contains('hidden')) {
      loadSectionData('overview');
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function verifySession() {
  try {
    const res = await fetch('/api/v1/auth/me', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Session expired');
    const data = await res.json();
    state.user = data.user;
    initDashboard();
  } catch (err) {
    state.token = null;
    localStorage.removeItem('auth_token');
    showView('login');
  }
}

async function initDashboard() {
  showView('dashboard');
  document.getElementById('user-role-badge').textContent = 
    state.user.role === 'platform_admin' ? 'Admin' : 'Merchant';
  
  try {
    const res = await fetch('/api/v1/dashboard/stores', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const { data: stores } = await res.json();
      state.stores = stores || [];
      
      const selectorContainer = document.getElementById('store-selector-container');
      const selector = document.getElementById('store-selector');

      if (state.user.role === 'platform_admin' && state.stores.length > 0) {
        selectorContainer.classList.remove('hidden');
        selector.innerHTML = state.stores
          .map(s => `<option value="${s.id}">${s.brand_name || s.shop_domain} (${s.shop_domain})</option>`)
          .join('');
        selector.value = state.activeStoreId || state.stores[0].id;
        state.activeStoreId = selector.value;

        selector.onchange = (e) => {
          state.activeStoreId = e.target.value;
          updateActiveStoreUI();
        };
      } else {
        selectorContainer.classList.add('hidden');
        state.activeStoreId = state.user.store_id || (state.stores[0]?.id || null);
      }
    }
  } catch (err) {
    console.error('Failed to load stores', err);
    state.activeStoreId = state.user.store_id;
  }

  updateActiveStoreUI();
}

function updateActiveStoreUI() {
  if (state.activeStoreId) {
    const activeSectionEl = document.querySelector('.nav-links a.active');
    const activeSection = activeSectionEl ? activeSectionEl.getAttribute('data-target') : 'overview';
    loadSectionData(activeSection);
  }
}

function updateSnippetCode(widgetKey) {
  const snippetEl = document.getElementById('snippet-code');
  if (snippetEl && widgetKey) {
    snippetEl.innerText = `<script src="${window.location.origin}/widget.js" data-widget-key="${widgetKey}" defer></script>`;
  }
}

function initAvatarPresets() {
  const grid = document.getElementById('avatar-presets-grid');
  if (!grid) return;
  grid.innerHTML = AVATAR_PRESETS.map(preset => `
    <div class="avatar-preset-card" data-url="${preset.url}" title="${preset.name}">
      <img src="${preset.url}" alt="${preset.name}">
      <span>${preset.name}</span>
    </div>
  `).join('');

  grid.querySelectorAll('.avatar-preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const url = card.getAttribute('data-url');
      const avatarInput = document.getElementById('widget-avatar-url');
      if (avatarInput) avatarInput.value = url;
      updateAvatarPresetSelection(url);
      updateLivePreview();
      showToast(`Selected ${card.querySelector('span').textContent} avatar! Save settings to apply.`);
    });
  });
}

function updateAvatarPresetSelection(selectedUrl = '') {
  const grid = document.getElementById('avatar-presets-grid');
  if (!grid) return;
  const cleanSelected = (selectedUrl || '').trim();
  grid.querySelectorAll('.avatar-preset-card').forEach(card => {
    if (cleanSelected && card.getAttribute('data-url') === cleanSelected) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });
}

function updateLivePreview() {
  const btn = document.getElementById('preview-widget-btn');
  const primaryColor = document.getElementById('widget-primary-color')?.value || '#1a1a1a';
  const secondaryColor = document.getElementById('widget-secondary-color')?.value || '#ffffff';
  const btnText = document.getElementById('widget-btn-text')?.value || 'Ask our shopping assistant';
  const headerTitle = document.getElementById('widget-header-title')?.value || 'AI Shopping Assistant';
  const avatarUrl = document.getElementById('widget-avatar-url')?.value?.trim() || '';

  if (btn) {
    btn.querySelector('span').textContent = btnText;
    btn.style.backgroundColor = primaryColor;
    btn.style.color = secondaryColor;
    
    let btnThumb = btn.querySelector('.preview-btn-avatar');
    if (avatarUrl) {
      if (!btnThumb) {
        btnThumb = document.createElement('img');
        btnThumb.className = 'preview-btn-avatar';
        btnThumb.style.width = '24px';
        btnThumb.style.height = '24px';
        btnThumb.style.borderRadius = '50%';
        btnThumb.style.marginRight = '8px';
        btnThumb.style.objectFit = 'cover';
        btn.prepend(btnThumb);
      }
      btnThumb.src = avatarUrl;
      btnThumb.style.display = 'inline-block';
    } else if (btnThumb) {
      btnThumb.style.display = 'none';
    }

    const pos = document.getElementById('widget-position')?.value;
    if (pos === 'bottom-left') {
      btn.style.right = 'auto';
      btn.style.left = '20px';
    } else {
      btn.style.left = 'auto';
      btn.style.right = '20px';
    }
  }

  // Header Preview
  const chatHeader = document.getElementById('preview-chat-header');
  const headerTitleText = document.getElementById('preview-header-title-text');
  const previewAvatarImg = document.getElementById('preview-avatar-img');
  const previewAvatarFallback = document.getElementById('preview-avatar-fallback');

  if (chatHeader) {
    chatHeader.style.backgroundColor = primaryColor;
    chatHeader.style.color = secondaryColor;
  }
  if (headerTitleText) {
    headerTitleText.textContent = headerTitle;
  }
  if (previewAvatarImg && previewAvatarFallback) {
    if (avatarUrl) {
      previewAvatarImg.src = avatarUrl;
      previewAvatarImg.style.display = 'block';
      previewAvatarFallback.style.display = 'none';
    } else {
      previewAvatarImg.style.display = 'none';
      previewAvatarFallback.style.display = 'flex';
    }
  }
}

function showView(viewName) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  if(views[viewName]) views[viewName].classList.remove('hidden');
}

function showSection(sectionName) {
  Object.values(sections).forEach(s => { if (s) s.classList.add('hidden'); });
  const targetSection = sections[sectionName];
  if (targetSection) {
    targetSection.classList.remove('hidden');
    if (window.gsap) {
      const animTargets = targetSection.querySelectorAll('.stat-card, .mini-stat-card, .glass-card, .live-pulse-hero-card, .table-container, form');
      if (animTargets.length > 0) {
        window.gsap.fromTo(animTargets, 
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.4, stagger: 0.04, ease: 'power2.out' }
        );
      }
    }
  }

  // Manage live telemetry polling
  if (sectionName === 'live-analytics') {
    startLiveAnalyticsPolling();
  } else {
    stopLiveAnalyticsPolling();
  }
}

async function loadSectionData(section) {
  if (!state.activeStoreId) return;

  try {
    if (section === 'live-analytics') {
      await Promise.all([
        loadLiveAnalytics(),
        loadConversionFunnel(parseInt(document.getElementById('funnel-timeframe')?.value || '7', 10)),
        loadProductPerformance(),
      ]);
      return;
    }

    if (section === 'ad-creative-studio') {
      await Promise.all([
        loadAdStudioProducts(),
        loadSavedCreativesTable()
      ]);
      return;
    }

    if (section === 'whatsapp-growth') {
      await loadWhatsAppGrowthData();
      return;
    }

    const endpoints = {
      'overview': 'overview',
      'my-agent': 'agent',
      'leads-optins': 'leads',
      'widget-settings': 'widget',
      'shopify-connection': 'shopify',
      'email-automation': 'email'
    };

    const endpoint = endpoints[section];
    if (!endpoint) return;

    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/${endpoint}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    if (!res.ok) throw new Error(`Failed to load ${section} data`);
    const { data } = await res.json();

    if (section === 'overview') {
      loadLiveShoppersPill();
      animateValue('stat-chats', data.chats);
      animateValue('stat-leads', data.leads);
      animateValue('stat-optins', data.opt_ins);
      animateValue('stat-recs', data.recommendations);
      animateValue('stat-carts', data.add_to_carts);
      animateValue('stat-purchases', data.purchases);
      animateValue('stat-emails-sent', data.emails_sent);
      animateValue('stat-emails-opened', data.emails_opened);
      animateValue('stat-emails-unsub', data.emails_unsubscribed);
      
      animateValue('stat-ai-input', data.ai_usage.total_input);
      animateValue('stat-ai-output', data.ai_usage.total_output);
      const cost = parseFloat(data.ai_usage.total_cost || 0);
      document.getElementById('stat-ai-cost').textContent = `$${cost.toFixed(2)}`;
      
      const budgetPct = Math.min((cost / 14.0) * 100, 100);
      document.getElementById('ai-budget-progress').style.width = `${budgetPct}%`;
      if (budgetPct >= 100) document.getElementById('ai-budget-progress').style.backgroundColor = 'var(--danger)';
      else if (budgetPct >= 70) document.getElementById('ai-budget-progress').style.backgroundColor = 'var(--warning)';
      else document.getElementById('ai-budget-progress').style.backgroundColor = 'var(--primary)';

      const agentBadge = document.getElementById('agent-status-badge');
      if (data.agent_active) {
        agentBadge.innerHTML = `<span class="dot active"></span> Agent Status: Active`;
      } else {
        agentBadge.innerHTML = `<span class="dot inactive"></span> Agent Status: Paused`;
      }
      
      const widgetBadge = document.getElementById('widget-status-badge');
      widgetBadge.innerHTML = `<span class="dot active"></span> Widget Status: Online`;
    } 
    else if (section === 'my-agent') {
      if (data.assistant) {
        document.getElementById('agent-is-active').checked = data.assistant.is_active;
        document.getElementById('agent-name').value = data.assistant.assistant_name || '';
        document.getElementById('agent-welcome').value = data.assistant.welcome_message || '';
        document.getElementById('agent-tone').value = data.assistant.tone || 'friendly and helpful';
        document.getElementById('agent-support').value = data.assistant.support_contact || '';
        if (document.getElementById('agent-custom-prompt')) {
          document.getElementById('agent-custom-prompt').value = data.assistant.custom_prompt || '';
        }
        if (document.getElementById('agent-knowledge-base')) {
          document.getElementById('agent-knowledge-base').value = data.assistant.knowledge_base || '';
        }
      }
      if (data.policies) {
        document.getElementById('store-faq').value = data.policies.faq_content || '';
      }
    }
    else if (section === 'leads-optins') {
      const summary = data.summary || { total_leads: 0, opted_in: 0, converted: 0, conversion_rate: '0%' };
      const totalEl = document.getElementById('stat-leads-total');
      const optedEl = document.getElementById('stat-leads-opted');
      const convEl = document.getElementById('stat-leads-converted');
      const rateEl = document.getElementById('stat-leads-rate');

      if (totalEl) totalEl.textContent = summary.total_leads;
      if (optedEl) optedEl.textContent = summary.opted_in;
      if (convEl) convEl.textContent = summary.converted;
      if (rateEl) rateEl.textContent = summary.conversion_rate;

      const tbody = document.getElementById('leads-table-body');
      if (tbody) {
        const leads = data.leads || [];
        if (leads.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">
                No marketing leads captured yet. Leads will automatically appear here when visitors interact with your storefront assistant.
              </td>
            </tr>
          `;
        } else {
          tbody.innerHTML = leads.map(lead => {
            const dateStr = lead.captured_at ? new Date(lead.captured_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }) : '—';
            
            const statusBadge = lead.opted_in
              ? `<span class="badge success">Opted-In</span>`
              : `<span class="badge neutral">No Consent</span>`;
              
            const conversionBadge = lead.converted
              ? `<span class="badge success">✓ Converted ${lead.order_total ? `($${Number(lead.order_total).toFixed(2)})` : ''}</span>`
              : `<span class="badge pending">Pending</span>`;

            return `
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding: 12px 10px; font-weight: 500;">${escapeHtml(lead.email)}</td>
                <td style="padding: 12px 10px; color: var(--text-muted);">${escapeHtml(lead.phone || '—')}</td>
                <td style="padding: 12px 10px;">${statusBadge}</td>
                <td style="padding: 12px 10px; color: var(--text-muted); font-size: 12px;">${dateStr}</td>
                <td style="padding: 12px 10px; color: var(--text-muted); font-size: 12px;">${escapeHtml(lead.source || 'widget_chat')}</td>
                <td style="padding: 12px 10px;">${conversionBadge}</td>
              </tr>
            `;
          }).join('');
        }
      }
    }
    else if (section === 'widget-settings') {
      if (data.widget) {
        document.getElementById('widget-btn-text').value = data.widget.button_text || '';
        document.getElementById('widget-primary-color').value = data.widget.primary_colour || '#1a1a1a';
        document.getElementById('widget-secondary-color').value = data.widget.secondary_colour || '#ffffff';
        document.getElementById('widget-position').value = data.widget.position || 'bottom-right';
        if (document.getElementById('widget-header-title')) {
          document.getElementById('widget-header-title').value = data.widget.header_title || '';
        }
        if (document.getElementById('widget-avatar-url')) {
          document.getElementById('widget-avatar-url').value = data.widget.avatar_url || '';
        }
        if (document.getElementById('widget-custom-css')) {
          document.getElementById('widget-custom-css').value = data.widget.custom_css || '';
        }
        updateAvatarPresetSelection(data.widget.avatar_url || '');
        updateLivePreview();
      }
      if (data.widget_key) {
        updateSnippetCode(data.widget_key);
      }
    }
    else if (section === 'shopify-connection') {
      document.getElementById('shopify-domain').textContent = data.shop_domain || '--';
      document.getElementById('shopify-status').textContent = data.status === 'active' ? 'Active' : 'Attention Needed';
      if (data.status === 'active') {
        document.getElementById('shopify-status').className = 'badge success';
      } else {
        document.getElementById('shopify-status').className = 'badge danger';
      }
      document.getElementById('shopify-last-sync').textContent = data.last_sync ? new Date(data.last_sync).toLocaleString() : 'Never';
      document.getElementById('shopify-creds').textContent = data.credentials_configured ? 'Yes (Encrypted)' : 'No';
      loadProductsTable();
    }
    else if (section === 'email-automation') {
      if (data.settings) {
        document.getElementById('email-is-enabled').checked = data.settings.is_enabled;
        document.getElementById('email-interval').value = data.settings.follow_up_interval_minutes;
        document.getElementById('email-max').value = data.settings.max_recovery_emails;
        document.getElementById('email-consent').value = data.settings.consent_wording;
      }
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getProductFallbackBadgeHtml(category = '') {
  const cat = (category || '').toLowerCase();
  let icon = '🛍️';
  let gradient = 'linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(147, 51, 234, 0.25))';
  let borderColor = 'rgba(147, 51, 234, 0.35)';

  if (cat.includes('audio') || cat.includes('earbud') || cat.includes('headphone')) {
    icon = '🎧';
    gradient = 'linear-gradient(135deg, rgba(236, 72, 153, 0.25), rgba(139, 92, 246, 0.25))';
    borderColor = 'rgba(236, 72, 153, 0.35)';
  } else if (cat.includes('wearable') || cat.includes('watch')) {
    icon = '⌚';
    gradient = 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(6, 182, 212, 0.25))';
    borderColor = 'rgba(16, 185, 129, 0.35)';
  } else if (cat.includes('decor') || cat.includes('vase') || cat.includes('home')) {
    icon = '🏺';
    gradient = 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(239, 68, 68, 0.25))';
    borderColor = 'rgba(245, 158, 11, 0.35)';
  } else if (cat.includes('bed') || cat.includes('blanket')) {
    icon = '🛏️';
    gradient = 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))';
    borderColor = 'rgba(99, 102, 241, 0.35)';
  } else if (cat.includes('apparel') || cat.includes('cloth') || cat.includes('fashion')) {
    icon = '👕';
    gradient = 'linear-gradient(135deg, rgba(14, 165, 233, 0.25), rgba(99, 102, 241, 0.25))';
    borderColor = 'rgba(14, 165, 233, 0.35)';
  }

  return `<div class="product-cat-badge" style="background: ${gradient}; border-color: ${borderColor};">${icon}</div>`;
}

async function loadProductsTable(search = '') {
  if (!state.activeStoreId) return;
  const tbody = document.getElementById('products-table-body');
  if (!tbody) return;

  try {
    const url = `/api/v1/dashboard/${state.activeStoreId}/products${search ? `?q=${encodeURIComponent(search)}` : ''}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to load products');
    const { data } = await res.json();

    const summary = data.summary || { total: 0, in_stock: 0, categories_count: 0 };
    const statTotal = document.getElementById('stat-products-total');
    const statInStock = document.getElementById('stat-products-instock');
    const statCats = document.getElementById('stat-products-categories');

    if (statTotal) statTotal.textContent = summary.total;
    if (statInStock) statInStock.textContent = summary.in_stock;
    if (statCats) statCats.textContent = summary.categories_count;

    const products = data.products || [];
    if (products.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 25px; color: var(--text-muted);">
            ${search ? 'No products match your search keyword.' : 'No products synced yet. Click "Sync Products" above to import your Shopify catalog.'}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = products.map(p => {
      const price = parseFloat(p.price || 0).toFixed(2);
      const currencySymbol = p.currency === 'INR' ? '₹' : (p.currency === 'USD' ? '$' : (p.currency === 'GBP' ? '£' : p.currency));
      const stockBadge = p.in_stock
        ? `<span class="badge success">In Stock</span>`
        : `<span class="badge danger">Out of Stock</span>`;

      const fallbackBadge = getProductFallbackBadgeHtml(p.category);
      const imgHtml = p.image_url
        ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}" onerror="this.onerror=null; this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" style="width: 44px; height: 44px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); background: #1e293b;"><div style="display: none;">${fallbackBadge}</div>`
        : fallbackBadge;

      const linkHtml = p.product_url
        ? `<a href="${escapeHtml(p.product_url)}" target="_blank" rel="noopener noreferrer" style="color: var(--primary); text-decoration: none; font-size: 12px; font-weight: 500;">View ↗</a>`
        : `—`;

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 10px;">${imgHtml}</td>
          <td style="padding: 10px;">
            <div style="font-weight: 500; color: var(--text-main); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(p.title)}</div>
            ${p.handle ? `<div style="font-size: 11px; color: var(--text-muted);">/${escapeHtml(p.handle)}</div>` : ''}
          </td>
          <td style="padding: 10px; color: var(--text-muted); font-size: 13px;">${escapeHtml(p.category || 'General')}</td>
          <td style="padding: 10px; font-weight: 600;">${currencySymbol}${price}</td>
          <td style="padding: 10px;">${stockBadge}</td>
          <td style="padding: 10px; text-align: right;">${linkHtml}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading products table:', err);
  }
}

// UI Utilities
function animateValue(id, target, duration = 0.8) {
  const obj = document.getElementById(id);
  if (!obj) return;
  const rawText = obj.textContent || '';
  const start = parseFloat(rawText.replace(/[^0-9.-]/g, '')) || 0;
  const end = parseFloat(target) || 0;

  if (window.gsap && typeof window.gsap.to === 'function') {
    const tracker = { val: start };
    window.gsap.to(tracker, {
      val: end,
      duration: Math.min(duration, 1.2),
      ease: 'power2.out',
      onUpdate: () => {
        obj.textContent = Math.round(tracker.val).toLocaleString();
      }
    });
  } else {
    obj.textContent = end.toLocaleString();
  }
}

// Mobile Sidebar Drawer
function openMobileSidebar() {
  const sidebar = document.getElementById('dashboard-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('mobile-open');
  if (backdrop) backdrop.classList.add('active');
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('dashboard-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
}

// Live Analytics Telemetry & Real-Time Polling (Phase 2)
function startLiveAnalyticsPolling() {
  stopLiveAnalyticsPolling();
  liveAnalyticsTimer = setInterval(() => {
    if (!document.hidden && state.activeStoreId) {
      loadLiveAnalytics(true);
    }
  }, 6000);
}

function stopLiveAnalyticsPolling() {
  if (liveAnalyticsTimer) {
    clearInterval(liveAnalyticsTimer);
    liveAnalyticsTimer = null;
  }
}

async function loadLiveShoppersPill() {
  if (!state.activeStoreId) return;
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/analytics/live`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const { success, data } = await res.json();
    if (success && data) {
      const shoppers = data.active_shoppers || 0;
      const pill = document.getElementById('sidebar-live-count');
      const mobPill = document.getElementById('mobile-live-count');
      if (pill) pill.textContent = shoppers;
      if (mobPill) mobPill.textContent = shoppers;
    }
  } catch (_) {}
}

async function loadLiveAnalytics(isBackground = false) {
  if (!state.activeStoreId) return;
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/analytics/live`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const { success, data } = await res.json();
    if (!success || !data) return;

    const shoppers = data.active_shoppers || 0;
    animateValue('live-active-shoppers-count', shoppers);
    const pill = document.getElementById('sidebar-live-count');
    const mobPill = document.getElementById('mobile-live-count');
    if (pill) pill.textContent = shoppers;
    if (mobPill) mobPill.textContent = shoppers;

    // Admin Deactivation Banner check
    const deactBanner = document.getElementById('live-tracking-deactivated-banner');
    if (deactBanner) {
      if (data.live_tracking_enabled === false) {
        deactBanner.classList.remove('hidden');
      } else {
        deactBanner.classList.add('hidden');
      }
    }

    renderLiveActivityFeed(data.feed || []);
  } catch (err) {
    if (!isBackground) console.error('Failed to load live analytics:', err);
  }
}

function renderLiveActivityFeed(feed) {
  const container = document.getElementById('live-activity-feed');
  if (!container) return;

  if (!feed || feed.length === 0) {
    container.innerHTML = `<div class="feed-empty-state">No customer activity recorded yet. Explore your storefront or open the widget to see live events.</div>`;
    return;
  }

  container.innerHTML = feed.map(item => {
    const timeStr = formatRelativeTime(new Date(item.created_at));
    const badgeColor = item.badge_color || '#64748b';

    let channelTag = 'Storefront';
    let channelClass = 'source-storefront';
    if (item.type === 'purchase_completed') {
      channelTag = 'Shopify Order';
      channelClass = 'source-shopify';
    } else if (item.type === 'add_to_cart') {
      channelTag = 'Cart Add';
      channelClass = 'source-cart';
    } else if (item.type === 'email_submitted' || item.type === 'marketing_opted_in') {
      channelTag = 'Lead Capture';
      channelClass = 'source-lead';
    } else if (item.type === 'widget_opened' || item.type === 'product_click') {
      channelTag = 'AI Assistant';
      channelClass = 'source-assistant';
    } else if (item.type === 'heartbeat') {
      channelTag = 'Live Pulse';
      channelClass = 'source-pulse';
    }

    return `
      <div class="feed-item" data-id="${item.id}">
        <div class="feed-icon-box" style="border-left: 3px solid ${badgeColor};">
          <span>${item.icon || '👀'}</span>
        </div>
        <div class="feed-body">
          <div class="feed-top-row">
            <div class="feed-label-wrap">
              <span class="feed-label" style="color: ${badgeColor};">${escapeHtml(item.label)}</span>
              <span class="source-tag ${channelClass}">${channelTag}</span>
            </div>
            <span class="feed-time">${timeStr}</span>
          </div>
          <div class="feed-detail" title="${escapeHtml(item.detail)}">${escapeHtml(item.detail)}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadConversionFunnel(days = 7) {
  if (!state.activeStoreId) return;
  const container = document.getElementById('funnel-stages-list');
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/analytics/funnel?days=${days}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const { success, data } = await res.json();
    if (!success || !data) throw new Error('Funnel data unavailable');

    const totalVisitors = data.total_visitors || 0;
    const visitorsEl = document.getElementById('funnel-visitors-count');
    if (visitorsEl) visitorsEl.textContent = `${totalVisitors.toLocaleString()} Visitors`;

    const convEl = document.getElementById('live-overall-conversion');
    if (convEl) convEl.textContent = `${data.overall_conversion_rate}%`;

    const stages = data.stages || [];
    if (!container) return;

    if (stages.length === 0) {
      container.innerHTML = `<div class="funnel-loading">No funnel data available for the selected timeframe.</div>`;
      renderFunnelInsights([], 0);
      return;
    }

    container.innerHTML = stages.map((stage, idx) => {
      const dropoffHtml = (idx > 0 && stage.dropoff_rate > 0)
        ? `<span class="dropoff-tag">-${stage.dropoff_rate}% drop-off</span>`
        : '';

      return `
        <div class="funnel-stage-item">
          <div class="funnel-stage-header">
            <div class="funnel-stage-title-wrap">
              <span class="funnel-stage-step">${idx + 1}</span>
              <span class="funnel-stage-name">${escapeHtml(stage.stage)}</span>
              ${dropoffHtml}
            </div>
            <div class="funnel-stage-metrics">
              <span class="funnel-stage-count">${stage.count.toLocaleString()}</span>
              <span class="funnel-stage-pct">${stage.percentage}%</span>
            </div>
          </div>
          <div class="funnel-progress-track">
            <div class="funnel-progress-fill" style="width: 0%;" data-target-width="${stage.percentage}%"></div>
          </div>
        </div>
      `;
    }).join('');

    // Render actionable funnel diagnostics & insights
    renderFunnelInsights(stages, data.overall_conversion_rate || 0);

    // Update chats today and carts today in top mini stats
    const chatStage = stages.find(s => s.stage.includes('Chats'));
    const cartStage = stages.find(s => s.stage.includes('Cart'));
    if (chatStage) animateValue('live-chats-today', chatStage.count);
    if (cartStage) animateValue('live-carts-today', cartStage.count);

    // Animate progress bars using GSAP or CSS
    setTimeout(() => {
      container.querySelectorAll('.funnel-progress-fill').forEach(fill => {
        const targetWidth = fill.getAttribute('data-target-width') || '0%';
        if (window.gsap && typeof window.gsap.to === 'function') {
          window.gsap.to(fill, { width: targetWidth, duration: 0.85, ease: 'power2.out' });
        } else {
          fill.style.width = targetWidth;
        }
      });
    }, 50);
  } catch (err) {
    if (container) container.innerHTML = `<div class="funnel-loading">Failed to load funnel data.</div>`;
  }
}

function renderFunnelInsights(stages, overallConvRate) {
  const container = document.getElementById('funnel-insights-content');
  if (!container) return;

  if (!stages || stages.length === 0) {
    container.innerHTML = '<div class="insight-placeholder">Complete at least 1 storefront action to generate real-time diagnostics.</div>';
    return;
  }

  const visitors = stages[0]?.count || 0;
  const assistantOpened = stages.find(s => s.stage.toLowerCase().includes('assistant'))?.count || 0;
  const cartAdds = stages.find(s => s.stage.toLowerCase().includes('cart'))?.count || 0;
  const purchases = stages.find(s => s.stage.toLowerCase().includes('purchase'))?.count || 0;

  const insights = [];

  // 1. Cart to Purchase Drop-Off Diagnosis
  if (cartAdds > 0) {
    const cartToPurchaseConv = ((purchases / cartAdds) * 100).toFixed(1);
    const cartDropoff = (100 - parseFloat(cartToPurchaseConv)).toFixed(1);
    if (parseFloat(cartDropoff) > 50) {
      insights.push({
        type: 'warning',
        icon: '🛒',
        title: `High Cart Abandonment: ${cartDropoff}% Drop-off`,
        detail: `${cartAdds} shopper(s) added products to cart, but only ${purchases} completed purchase.`,
        action: `👉 Action: Go to Email Automation to confirm your Abandoned Cart Recovery Sequence is enabled with high-converting reminders.`
      });
    } else {
      insights.push({
        type: 'success',
        icon: '🎉',
        title: `High Checkout Velocity: ${cartToPurchaseConv}% Completion`,
        detail: `Excellent transition from Cart to Purchase. Your checkout funnel has low friction.`,
        action: `👉 Status: Keep cart recovery thresholds active for edge cases.`
      });
    }
  }

  // 2. Visitors to Assistant Engagement Diagnosis
  if (visitors > 0) {
    const engRate = ((assistantOpened / visitors) * 100).toFixed(1);
    if (parseFloat(engRate) < 15 && visitors >= 5) {
      insights.push({
        type: 'info',
        icon: '💡',
        title: `Engagement Growth: ${engRate}% Assistant Open Rate`,
        detail: `Most visitors browse without clicking your AI assistant bubble.`,
        action: `👉 Action: Go to Widget Settings and update Greeting to an irresistible offer (e.g. "Ask for your 10% Welcome Discount!").`
      });
    } else if (parseFloat(engRate) >= 15) {
      insights.push({
        type: 'success',
        icon: '💬',
        title: `Strong Assistant Engagement: ${engRate}% Open Rate`,
        detail: `Shoppers actively use the shopping assistant for product recommendations and assistance.`,
        action: `👉 Status: Grounding policies and quick responses are driving shopper curiosity.`
      });
    }
  }

  // 3. Overall Conversion Health
  if (overallConvRate >= 2.5) {
    insights.push({
      type: 'success',
      icon: '🚀',
      title: `Top-Tier Conversion: ${overallConvRate}% Overall Rate`,
      detail: `Your store conversion rate outperforms standard e-commerce benchmarks (~2.2%).`,
      action: `👉 Result: AI-assisted shoppers are completing checkouts at high velocity.`
    });
  } else if (visitors > 0 && purchases === 0) {
    insights.push({
      type: 'neutral',
      icon: '📈',
      title: `Live Funnel Calibrating (${visitors} Shoppers)`,
      detail: `Telemetry is streaming live from your storefront.`,
      action: `👉 Tip: Browse your store or test an Add-to-Cart action in another tab to observe real-time funnel progression.`
    });
  }

  container.innerHTML = insights.map(i => `
    <div class="insight-row ${i.type}">
      <div class="insight-icon-col">${i.icon}</div>
      <div class="insight-content-col">
        <div class="insight-title">${escapeHtml(i.title)}</div>
        <div class="insight-detail">${escapeHtml(i.detail)}</div>
        <div class="insight-action">${escapeHtml(i.action)}</div>
      </div>
    </div>
  `).join('');
}

async function loadProductPerformance() {
  if (!state.activeStoreId) return;
  const tbody = document.getElementById('rec-performance-table-body');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/analytics/products?limit=10`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const { success, data } = await res.json();
    if (!success || !data || data.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 25px; color: var(--text-muted);">
            No recommended product interactions yet. When your assistant suggests products in chat, real-time conversion metrics appear here.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.map(p => {
      const imgHtml = p.image_url
        ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}" style="width: 38px; height: 38px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); background: #1e293b;">`
        : `<div style="width: 38px; height: 38px; border-radius: 6px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; font-size: 14px;">📦</div>`;

      const currencySymbol = p.currency === 'GBP' ? '£' : (p.currency === 'USD' ? '$' : '₹');
      const convBadgeColor = p.conversion_rate > 10 ? '#10b981' : (p.conversion_rate > 0 ? '#3b82f6' : '#94a3b8');

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 10px;">${imgHtml}</td>
          <td style="padding: 10px; font-weight: 500; color: var(--text-main); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${escapeHtml(p.title)}
          </td>
          <td style="padding: 10px; font-weight: 600;">${currencySymbol}${parseFloat(p.price || 0).toFixed(2)}</td>
          <td style="padding: 10px; text-align: center; font-weight: 600;">${p.recommendations_count}</td>
          <td style="padding: 10px; text-align: center;">${p.clicks_count}</td>
          <td style="padding: 10px; text-align: center; color: #10b981; font-weight: 600;">${p.cart_adds_count}</td>
          <td style="padding: 10px; text-align: center; color: #22c55e; font-weight: 700;">${p.purchases_count}</td>
          <td style="padding: 10px; text-align: right;">
            <span style="font-weight: 700; color: ${convBadgeColor}; font-size: 12.5px;">${p.conversion_rate}%</span>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--danger);">Failed to load product performance metrics.</td></tr>`;
  }
}

function formatRelativeTime(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function getErrorMessage(data, fallback = 'Operation failed') {
  if (!data) return fallback;
  if (typeof data === 'string') {
    return (data === '[object Object]' || data === 'Error: [object Object]') ? fallback : data;
  }
  if (data instanceof Error) {
    const msg = data.message;
    return (msg && msg !== '[object Object]' && msg !== 'Error: [object Object]') ? msg : fallback;
  }
  if (data.error) {
    if (typeof data.error === 'string') {
      return data.error === '[object Object]' ? fallback : data.error;
    }
    if (data.error.message && typeof data.error.message === 'string') {
      return data.error.message;
    }
    if (data.error.code && typeof data.error.code === 'string') {
      return `${data.error.code}: ${data.error.message || fallback}`;
    }
  }
  if (typeof data.message === 'string') return data.message;
  try {
    const serialized = JSON.stringify(data);
    return serialized !== '{}' ? serialized : fallback;
  } catch {
    return fallback;
  }
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  const displayMsg = getErrorMessage(message, isError ? 'An unexpected error occurred.' : 'Operation completed.');

  toast.textContent = displayMsg;
  toast.style.background = isError ? 'var(--danger)' : 'var(--primary)';
  toast.classList.remove('hidden');
  
  if (window._toastTimeout) clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

function showConfirmModal(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-message').textContent = message;
  modal.querySelector('h3').textContent = title;
  modal.classList.remove('hidden');
  
  const handleConfirm = () => {
    modal.classList.add('hidden');
    cleanup();
    onConfirm();
  };
  
  const handleCancel = () => {
    modal.classList.add('hidden');
    cleanup();
  };
  
  const btnConfirm = document.getElementById('modal-confirm');
  const btnCancel = document.getElementById('modal-cancel');
  
  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
  
  function cleanup() {
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
  }
}

// ==========================================
// Phase 12: AI Ad Creative Studio Handlers
// ==========================================

function setupAdStudioEventListeners() {
  // Platform pills toggle
  const platformRadios = document.querySelectorAll('input[name="ad-platform"]');
  platformRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      adStudioState.platform = e.target.value;
      const fbPill = document.getElementById('pill-platform-facebook');
      const instaPill = document.getElementById('pill-platform-instagram');
      if (fbPill && instaPill) {
        fbPill.classList.toggle('active', adStudioState.platform === 'facebook');
        instaPill.classList.toggle('active', adStudioState.platform === 'instagram');
      }
      if (adStudioState.variations.length > 0) {
        renderActiveAdVariation();
      }
    });
  });

  // Objective selector
  const objSelect = document.getElementById('ad-objective-select');
  if (objSelect) {
    objSelect.addEventListener('change', (e) => {
      adStudioState.objective = e.target.value;
    });
  }

  // Product selector
  const prodSelect = document.getElementById('ad-product-select');
  if (prodSelect) {
    prodSelect.addEventListener('change', onAdProductSelected);
  }

  // Refresh catalogue button
  const btnRefresh = document.getElementById('btn-refresh-products');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      await loadAdStudioProducts();
      showToast('Product catalogue refreshed');
    });
  }

  // Generate button
  const btnGenerate = document.getElementById('btn-generate-creatives');
  if (btnGenerate) {
    btnGenerate.addEventListener('click', generateAdCreativesAction);
  }

  // Variation tabs
  const variationTabs = document.querySelectorAll('.variation-tab');
  variationTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-variation') || '0', 10);
      adStudioState.activeVariationIndex = idx;
      renderActiveAdVariation();
    });
  });

  // Copy element buttons
  const copyBtns = document.querySelectorAll('.btn-copy-elem');
  copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target-text');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        const label = targetId.includes('hook') ? 'Hook' : 'Primary Text';
        copyTextToClipboard(targetEl.innerText || targetEl.textContent, label);
      }
    });
  });

  // Copy Full Ad button
  const btnCopyFull = document.getElementById('btn-copy-full-ad');
  if (btnCopyFull) {
    btnCopyFull.addEventListener('click', copyFullAdAction);
  }

  // Save Creative button
  const btnSave = document.getElementById('btn-save-creative');
  if (btnSave) {
    btnSave.addEventListener('click', saveCurrentCreativeAction);
  }

  // Regenerate button
  const btnRegen = document.getElementById('btn-regenerate-ad');
  if (btnRegen) {
    btnRegen.addEventListener('click', generateAdCreativesAction);
  }

  // Generate AI Image button
  const btnGenImg = document.getElementById('btn-generate-ai-image');
  if (btnGenImg) {
    btnGenImg.addEventListener('click', generateAiAdImageAction);
  }
}

async function loadAdStudioProducts() {
  if (!state.activeStoreId) return;
  const select = document.getElementById('ad-product-select');
  if (!select) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ad-creatives/products`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to load catalogue products');

    const { data } = await res.json();
    adStudioState.products = data.products || [];

    if (adStudioState.products.length === 0) {
      select.innerHTML = '<option value="">No products found (Sync catalog in Shopify tab)</option>';
      return;
    }

    const options = [
      '<option value="">-- Choose a product from catalogue --</option>',
      ...adStudioState.products.map(p => {
        const price = parseFloat(p.price || 0).toFixed(2);
        const currency = p.currency === 'INR' ? '₹' : (p.currency === 'USD' ? '$' : '£');
        return `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${currency}${price})</option>`;
      })
    ];

    select.innerHTML = options.join('');

    // If product was previously selected, restore or reset preview
    if (adStudioState.selectedProduct) {
      const stillExists = adStudioState.products.find(p => p.id === adStudioState.selectedProduct.id);
      if (stillExists) {
        select.value = stillExists.id;
        updateSelectedProductPreview(stillExists);
      } else {
        adStudioState.selectedProduct = null;
        updateSelectedProductPreview(null);
      }
    }
  } catch (err) {
    console.error('Failed to load ad studio products:', err);
    showToast(err.message, true);
  }
}

function onAdProductSelected(e) {
  const pId = e.target.value;
  const product = adStudioState.products.find(p => p.id === pId) || null;
  adStudioState.selectedProduct = product;
  adStudioState.generatedImageUrl = null;
  updateSelectedProductPreview(product);
  if (adStudioState.variations.length > 0) {
    renderActiveAdVariation();
  }
}

function updateSelectedProductPreview(product) {
  const card = document.getElementById('ad-selected-product-card');
  if (!card) return;

  if (!product) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');

  const titleEl = document.getElementById('ad-prod-title');
  const priceEl = document.getElementById('ad-prod-price');
  const catEl = document.getElementById('ad-prod-category');
  const stockEl = document.getElementById('ad-prod-stock');
  const thumbEl = document.getElementById('ad-prod-thumb');
  const noThumbEl = document.getElementById('ad-prod-no-thumb');

  const price = parseFloat(product.price || 0).toFixed(2);
  const currency = product.currency === 'INR' ? '₹' : (product.currency === 'USD' ? '$' : '£');

  if (titleEl) titleEl.textContent = product.title;
  if (priceEl) priceEl.textContent = `${currency}${price}`;
  if (catEl) catEl.textContent = product.category || 'General';
  if (stockEl) {
    stockEl.textContent = product.in_stock ? 'In Stock' : 'Out of Stock';
    stockEl.className = product.in_stock ? 'tag-stock' : 'tag-stock out';
  }

  if (product.image_url && thumbEl && noThumbEl) {
    thumbEl.src = product.image_url;
    thumbEl.style.display = 'block';
    noThumbEl.style.display = 'none';
    thumbEl.onerror = () => {
      thumbEl.style.display = 'none';
      noThumbEl.style.display = 'flex';
    };
  } else if (thumbEl && noThumbEl) {
    thumbEl.style.display = 'none';
    noThumbEl.style.display = 'flex';
  }
}

async function generateAdCreativesAction() {
  if (!adStudioState.selectedProduct) {
    showToast('Please select a product from your catalogue first.', true);
    return;
  }

  const emptyState = document.getElementById('ad-empty-state');
  const loadingState = document.getElementById('ad-loading-state');
  const mockupContainer = document.getElementById('ad-mockup-container');
  const variationsNav = document.getElementById('ad-variations-nav');
  const btnGenerate = document.getElementById('btn-generate-creatives');

  if (emptyState) emptyState.classList.add('hidden');
  if (mockupContainer) mockupContainer.classList.add('hidden');
  if (variationsNav) variationsNav.classList.add('hidden');
  if (loadingState) loadingState.classList.remove('hidden');
  if (btnGenerate) btnGenerate.disabled = true;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ad-creatives/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        productId: adStudioState.selectedProduct.id,
        platform: adStudioState.platform,
        objective: adStudioState.objective
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(getErrorMessage(data, 'Ad creative generation failed'));
    }

    adStudioState.variations = data.data?.variations || [];
    adStudioState.activeVariationIndex = 0;
    adStudioState.model = data.data?.model || 'gpt-4o-mini';

    if (loadingState) loadingState.classList.add('hidden');
    if (mockupContainer) mockupContainer.classList.remove('hidden');
    if (variationsNav) variationsNav.classList.remove('hidden');

    renderActiveAdVariation();
    showToast('✨ Generated 3 high-converting ad variations!');
  } catch (err) {
    if (loadingState) loadingState.classList.add('hidden');
    if (adStudioState.variations.length > 0) {
      if (mockupContainer) mockupContainer.classList.remove('hidden');
      if (variationsNav) variationsNav.classList.remove('hidden');
    } else {
      if (emptyState) emptyState.classList.remove('hidden');
    }
    showToast(err.message, true);
  } finally {
    if (btnGenerate) btnGenerate.disabled = false;
  }
}

function renderActiveAdVariation() {
  const variations = adStudioState.variations;
  if (!variations || variations.length === 0) return;

  const current = variations[adStudioState.activeVariationIndex] || variations[0];

  // Update variation tabs
  document.querySelectorAll('.variation-tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === adStudioState.activeVariationIndex);
  });

  // Mockup elements
  const hookEl = document.getElementById('ad-mockup-hook');
  const primaryEl = document.getElementById('ad-mockup-primary');
  const headlineEl = document.getElementById('ad-mockup-headline');
  const ctaEl = document.getElementById('ad-mockup-cta');
  const badgeEl = document.getElementById('ad-platform-badge');
  const brandNameEl = document.getElementById('ad-brand-name');
  const avatarEl = document.getElementById('ad-brand-avatar');
  const domainEl = document.getElementById('ad-domain-tag');
  const imgEl = document.getElementById('ad-mockup-img');
  const fallbackEl = document.getElementById('ad-media-fallback');
  const fallbackTitleEl = document.getElementById('ad-media-fallback-title');

  const badgeElMedia = document.getElementById('ad-media-badge');
  const badgeIcon = document.getElementById('ad-media-badge-icon');
  const badgeText = document.getElementById('ad-media-badge-text');

  if (hookEl) hookEl.textContent = current.hook;
  if (primaryEl) primaryEl.textContent = current.primary_text;
  if (headlineEl) headlineEl.textContent = current.headline;
  if (ctaEl) ctaEl.textContent = current.cta;

  // Platform badge & brand info
  const isInsta = adStudioState.platform === 'instagram';
  if (badgeEl) {
    badgeEl.textContent = isInsta ? '📸 Instagram Feed' : '🌐 Meta / Facebook';
    badgeEl.className = isInsta ? 'ad-platform-badge instagram' : 'ad-platform-badge';
  }

  // Active store brand
  const currentStore = state.stores?.find(s => s.id === state.activeStoreId);
  const brandName = currentStore?.brand_name || currentStore?.shop_domain || 'Official Store';
  if (brandNameEl) brandNameEl.textContent = brandName;
  if (avatarEl) avatarEl.textContent = brandName.substring(0, 2).toUpperCase();

  const domain = (currentStore?.shop_domain || 'shop.myshopify.com').replace(/^https?:\/\//, '').toUpperCase();
  if (domainEl) domainEl.textContent = domain;

  // Product media handling
  const prod = adStudioState.selectedProduct;
  const activeMediaUrl = adStudioState.generatedImageUrl || prod?.image_url;
  const isAiGenerated = Boolean(adStudioState.generatedImageUrl);

  if (badgeElMedia && activeMediaUrl) {
    badgeElMedia.classList.remove('hidden');
    if (isAiGenerated) {
      badgeElMedia.className = 'ad-media-badge ai-badge';
      if (badgeIcon) badgeIcon.textContent = '✨';
      if (badgeText) badgeText.textContent = 'OpenAI DALL-E 3';
    } else {
      badgeElMedia.className = 'ad-media-badge';
      if (badgeIcon) badgeIcon.textContent = '📸';
      if (badgeText) badgeText.textContent = 'Catalogue Image';
    }
  } else if (badgeElMedia) {
    badgeElMedia.classList.add('hidden');
  }

  if (activeMediaUrl && imgEl && fallbackEl) {
    imgEl.src = activeMediaUrl;
    imgEl.style.display = 'block';
    fallbackEl.style.display = 'none';
    imgEl.onerror = () => {
      imgEl.style.display = 'none';
      fallbackEl.style.display = 'flex';
      if (fallbackTitleEl && prod) fallbackTitleEl.textContent = prod.title;
      if (badgeElMedia) badgeElMedia.classList.add('hidden');
    };
  } else if (imgEl && fallbackEl) {
    imgEl.style.display = 'none';
    fallbackEl.style.display = 'flex';
    if (fallbackTitleEl && prod) fallbackTitleEl.textContent = prod.title;
    if (badgeElMedia) badgeElMedia.classList.add('hidden');
  }
}

async function generateAiAdImageAction() {
  if (!adStudioState.selectedProduct) {
    showToast('Please choose a product from the catalogue first.', true);
    return;
  }

  const prod = adStudioState.selectedProduct;
  const currentVariation = adStudioState.variations[adStudioState.activeVariationIndex] || {};
  const styleSelect = document.getElementById('ad-ai-image-style');
  const selectedStyle = styleSelect ? styleSelect.value : 'commercial_studio';

  const overlay = document.getElementById('ad-media-generating-overlay');
  const btnGen = document.getElementById('btn-generate-ai-image');

  if (overlay) overlay.classList.remove('hidden');
  if (btnGen) btnGen.disabled = true;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ad-creatives/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        productId: prod.id,
        platform: adStudioState.platform,
        style: selectedStyle,
        hook: currentVariation.hook,
        headline: currentVariation.headline,
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(getErrorMessage(data, 'AI ad image generation failed'));
    }

    const imageUrl = data.data?.image_url;
    if (!imageUrl) {
      throw new Error('No image URL returned by AI generator');
    }

    adStudioState.generatedImageUrl = imageUrl;
    renderActiveAdVariation();
    showToast('✨ AI Ad visual generated via OpenAI DALL-E 3!');
  } catch (err) {
    console.error('Failed to generate AI ad image:', err);
    showToast(err.message || 'Image generation failed', true);
  } finally {
    if (overlay) overlay.classList.add('hidden');
    if (btnGen) btnGen.disabled = false;
  }
}

function copyTextToClipboard(text, label = 'Content') {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Copied ${label} to clipboard!`);
    }).catch(() => {
      fallbackCopyText(text, label);
    });
  } else {
    fallbackCopyText(text, label);
  }
}

function fallbackCopyText(text, label) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    showToast(`Copied ${label} to clipboard!`);
  } catch {
    showToast('Failed to copy to clipboard', true);
  }
  document.body.removeChild(textArea);
}

function copyFullAdAction() {
  const current = adStudioState.variations[adStudioState.activeVariationIndex];
  if (!current) {
    showToast('No active creative to copy', true);
    return;
  }

  const fullText = `[HOOK]\n${current.hook}\n\n[PRIMARY TEXT]\n${current.primary_text}\n\n[HEADLINE]\n${current.headline}\n\n[CALL TO ACTION]\n${current.cta}`;
  copyTextToClipboard(fullText, 'Complete Ad Copy');
}

async function saveCurrentCreativeAction() {
  const current = adStudioState.variations[adStudioState.activeVariationIndex];
  const prod = adStudioState.selectedProduct;

  if (!current || !prod) {
    showToast('No active ad variation to save', true);
    return;
  }

  const btnSave = document.getElementById('btn-save-creative');
  if (btnSave) btnSave.disabled = true;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ad-creatives/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        productId: prod.id,
        productTitle: prod.title,
        platform: adStudioState.platform,
        objective: adStudioState.objective,
        hook: current.hook,
        primaryText: current.primary_text,
        headline: current.headline,
        cta: current.cta,
        imageUrl: adStudioState.generatedImageUrl || prod.image_url || '',
        metadata: {
          variation_index: adStudioState.activeVariationIndex,
          model: adStudioState.model || 'gpt-4o-mini',
          ai_generated_image: Boolean(adStudioState.generatedImageUrl)
        }
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(getErrorMessage(data, 'Failed to save creative'));

    showToast('💾 Creative saved to library!');
    await loadSavedCreativesTable();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btnSave) btnSave.disabled = false;
  }
}

async function loadSavedCreativesTable() {
  if (!state.activeStoreId) return;
  const tbody = document.getElementById('saved-creatives-tbody');
  const countEl = document.getElementById('saved-creatives-count');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ad-creatives/saved`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to load saved creatives');

    const { data } = await res.json();
    const creatives = data.creatives || [];
    const total = data.total || creatives.length;

    if (countEl) countEl.textContent = `${total} saved`;

    if (creatives.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 25px; color: var(--text-muted);">
            No saved creatives yet. Generate ad copy above and click "Save Creative" to build your library.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = creatives.map(c => {
      const dateStr = new Date(c.created_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      const isInsta = c.platform === 'instagram';
      const platformPill = isInsta
        ? `<span class="badge" style="background: rgba(225, 48, 108, 0.2); color: #f472b6; border: 1px solid rgba(225, 48, 108, 0.4);">📸 Instagram</span>`
        : `<span class="badge" style="background: rgba(24, 119, 242, 0.2); color: #60a5fa; border: 1px solid rgba(24, 119, 242, 0.4);">🌐 Meta / FB</span>`;

      const objLabel = c.objective.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

      const mediaHtml = c.image_url
        ? `<img src="${escapeHtml(c.image_url)}" alt="${escapeHtml(c.product_title)}" class="saved-creative-thumb" onerror="this.onerror=null; this.outerHTML='<div class=\\'product-cat-badge\\' style=\\'width:44px;height:44px;font-size:18px;\\'>🛍️</div>';">`
        : `<div class="product-cat-badge" style="width:44px;height:44px;font-size:18px;">🛍️</div>`;

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 10px;">${mediaHtml}</td>
          <td style="padding: 12px; font-weight: 600; color: var(--text-main); max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${escapeHtml(c.product_title)}
          </td>
          <td style="padding: 12px;">${platformPill}</td>
          <td style="padding: 12px; font-size: 12px; color: var(--text-muted); text-transform: capitalize;">${escapeHtml(objLabel)}</td>
          <td style="padding: 12px; max-width: 300px;">
            <div style="font-weight: 500; font-size: 13px; color: var(--text-main); margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(c.headline)}</div>
            <div style="font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(c.hook)}</div>
          </td>
          <td style="padding: 12px;"><span class="badge primary" style="font-size: 11px;">${escapeHtml(c.cta)}</span></td>
          <td style="padding: 12px; font-size: 12px; color: var(--text-muted);">${dateStr}</td>
          <td style="padding: 12px; text-align: right; white-space: nowrap;">
            <button class="btn-sm btn-secondary btn-copy-saved" data-id="${c.id}" style="margin-right: 6px;" title="Copy Full Ad">📋 Copy</button>
            <button class="btn-sm btn-secondary outline btn-delete-saved" data-id="${c.id}" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.4);" title="Delete Creative">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach copy & delete event handlers
    tbody.querySelectorAll('.btn-copy-saved').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const c = creatives.find(item => item.id === id);
        if (c) {
          const fullText = `[HOOK]\n${c.hook}\n\n[PRIMARY TEXT]\n${c.primary_text}\n\n[HEADLINE]\n${c.headline}\n\n[CALL TO ACTION]\n${c.cta}`;
          copyTextToClipboard(fullText, 'Saved Creative Copy');
        }
      });
    });

    tbody.querySelectorAll('.btn-delete-saved').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        showConfirmModal('Delete Saved Creative?', 'This creative will be permanently removed from your library.', async () => {
          await deleteSavedCreativeAction(id);
        });
      });
    });
  } catch (err) {
    console.error('Error loading saved creatives:', err);
  }
}

async function deleteSavedCreativeAction(creativeId) {
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ad-creatives/saved/${creativeId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to delete creative');

    showToast('Creative deleted');
    await loadSavedCreativesTable();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ==========================================
// Phase 13: WhatsApp Growth Engine Handlers
// ==========================================

let waState = {
  config: null,
  conversations: [],
  selectedConvId: null,
  consents: []
};

function setupWhatsAppEventListeners() {
  // Save WhatsApp configuration
  const configForm = document.getElementById('wa-config-form');
  if (configForm) {
    configForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveWhatsAppConfig();
    });
  }

  // Copy Webhook URL button (Meta)
  const btnCopyWebhook = document.getElementById('btn-copy-wa-webhook');
  if (btnCopyWebhook) {
    btnCopyWebhook.addEventListener('click', () => {
      const urlInput = document.getElementById('wa-webhook-url');
      if (urlInput && urlInput.value) {
        copyTextToClipboard(urlInput.value, 'Meta Webhook Callback URL');
      }
    });
  }

  // Copy Webhook URL button (WATI)
  const btnCopyWati = document.getElementById('btn-copy-wati-webhook');
  if (btnCopyWati) {
    btnCopyWati.addEventListener('click', () => {
      const urlInput = document.getElementById('wa-wati-webhook-url');
      if (urlInput && urlInput.value) {
        copyTextToClipboard(urlInput.value, 'WATI Webhook Callback URL');
      }
    });
  }

  // Provider Select listener
  const providerSelect = document.getElementById('wa-provider-select');
  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      updateWhatsAppProviderUI(providerSelect.value);
    });
  }

  // Send Test Message button
  const btnSendTest = document.getElementById('btn-send-wa-test');
  if (btnSendTest) {
    btnSendTest.addEventListener('click', async () => {
      await sendWhatsAppTestMessage();
    });
  }
}

function updateWhatsAppProviderUI(provider) {
  const metaFields = document.getElementById('wa-meta-fields');
  const watiFields = document.getElementById('wa-wati-fields');
  const mockFields = document.getElementById('wa-mock-fields');

  if (metaFields) metaFields.classList.toggle('hidden', provider !== 'meta');
  if (watiFields) watiFields.classList.toggle('hidden', provider !== 'wati');
  if (mockFields) mockFields.classList.toggle('hidden', provider !== 'mock');

  // Update dynamic WATI webhook URL
  const watiWebhookUrl = document.getElementById('wa-wati-webhook-url');
  if (watiWebhookUrl && state.activeStoreId) {
    const token = document.getElementById('wa-wati-verify-token')?.value || '';
    watiWebhookUrl.value = `${window.location.origin}/api/v1/webhooks/whatsapp/wati/${state.activeStoreId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  }
}

async function loadWhatsAppGrowthData() {
  if (!state.activeStoreId) return;

  // Pre-populate webhook URLs with current origin
  const webhookUrlInput = document.getElementById('wa-webhook-url');
  if (webhookUrlInput && !webhookUrlInput.value) {
    webhookUrlInput.value = `${window.location.origin}/api/v1/webhooks/whatsapp`;
  }
  const watiWebhookUrl = document.getElementById('wa-wati-webhook-url');
  if (watiWebhookUrl && !watiWebhookUrl.value) {
    watiWebhookUrl.value = `${window.location.origin}/api/v1/webhooks/whatsapp/wati/${state.activeStoreId}`;
  }

  await Promise.all([
    loadWhatsAppAnalytics(),
    loadWhatsAppConfig(),
    loadWhatsAppConversations(),
    loadWhatsAppConsents()
  ]);
}

async function loadWhatsAppAnalytics() {
  if (!state.activeStoreId) return;
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/whatsapp/analytics`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();
    if (!data) return;

    animateValue('wa-stat-conversations', data.active_conversations || 0);
    animateValue('wa-stat-inbound', data.inbound_messages || 0);
    animateValue('wa-stat-outbound', data.outbound_messages || 0);
    animateValue('wa-stat-recovered', data.recovered_carts || 0);
    animateValue('wa-stat-consents', data.consented_contacts || 0);
  } catch (err) {
    console.error('Failed to load WhatsApp analytics:', err);
  }
}

async function loadWhatsAppConfig() {
  if (!state.activeStoreId) return;
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/whatsapp/config`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();
    waState.config = data;

    const providerSelect = document.getElementById('wa-provider-select');
    if (providerSelect && data.provider) {
      providerSelect.value = data.provider;
    }
    updateWhatsAppProviderUI(data?.provider || 'meta');

    const pill = document.getElementById('wa-connection-pill');
    const phoneInput = document.getElementById('wa-phone-number-id');
    const wabaInput = document.getElementById('wa-waba-id');
    const displayPhoneInput = document.getElementById('wa-display-phone');
    const verifyTokenInput = document.getElementById('wa-verify-token');
    const webhookUrlInput = document.getElementById('wa-webhook-url');
    const accessTokenInput = document.getElementById('wa-access-token');

    // WATI fields
    const watiEndpointInput = document.getElementById('wa-wati-endpoint');
    const watiTokenInput = document.getElementById('wa-wati-token');
    const watiPhoneInput = document.getElementById('wa-wati-phone');
    const watiVerifyTokenInput = document.getElementById('wa-wati-verify-token');
    const watiWebhookUrlInput = document.getElementById('wa-wati-webhook-url');

    if (data && data.configured) {
      if (pill) {
        pill.textContent = `● Connected (${(data.provider || 'meta').toUpperCase()})`;
        pill.style.background = 'rgba(16, 185, 129, 0.2)';
        pill.style.color = '#34d399';
        pill.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      }
    } else {
      if (pill) {
        pill.textContent = '● Disconnected';
        pill.style.background = 'rgba(239, 68, 68, 0.2)';
        pill.style.color = '#f87171';
        pill.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      }
    }

    // Populate Meta inputs
    if (phoneInput) phoneInput.value = data?.phone_number_id || '';
    if (wabaInput) wabaInput.value = data?.waba_id || '';
    if (displayPhoneInput) displayPhoneInput.value = data?.display_phone_number || '';
    if (verifyTokenInput) verifyTokenInput.value = data?.webhook_verify_token || '';
    if (webhookUrlInput) webhookUrlInput.value = `${window.location.origin}/api/v1/webhooks/whatsapp`;
    if (accessTokenInput) {
      accessTokenInput.value = '';
      accessTokenInput.placeholder = data?.has_access_token ? '•••••••••••••••••••• (Active)' : '••••••••••••••••••••';
    }

    // Populate WATI inputs
    if (watiEndpointInput) watiEndpointInput.value = data?.wati_api_endpoint || '';
    if (watiPhoneInput) watiPhoneInput.value = data?.display_phone_number || '';
    if (watiVerifyTokenInput) watiVerifyTokenInput.value = data?.webhook_verify_token || '';
    if (watiWebhookUrlInput) {
      const tokenQuery = data?.webhook_verify_token ? `?token=${encodeURIComponent(data.webhook_verify_token)}` : '';
      watiWebhookUrlInput.value = `${window.location.origin}/api/v1/webhooks/whatsapp/wati/${state.activeStoreId}${tokenQuery}`;
    }
    if (watiTokenInput) {
      watiTokenInput.value = '';
      watiTokenInput.placeholder = data?.has_wati_token ? '•••••••••••••••••••• (Active)' : '••••••••••••••••••••';
    }
  } catch (err) {
    console.error('Failed to load WhatsApp config:', err);
  }
}

async function saveWhatsAppConfig() {
  if (!state.activeStoreId) return;
  const btnSave = document.getElementById('btn-save-wa-config');
  if (btnSave) btnSave.disabled = true;

  try {
    const provider = document.getElementById('wa-provider-select')?.value || 'meta';
    const payload = { provider };

    if (provider === 'meta') {
      const phoneNumberId = document.getElementById('wa-phone-number-id')?.value.trim();
      const wabaId = document.getElementById('wa-waba-id')?.value.trim();
      const displayPhoneNumber = document.getElementById('wa-display-phone')?.value.trim();
      const accessToken = document.getElementById('wa-access-token')?.value.trim();
      const webhookVerifyToken = document.getElementById('wa-verify-token')?.value.trim();

      if (!phoneNumberId && !waState.config?.phone_number_id) {
        showToast('Phone Number ID is required for Meta WhatsApp', true);
        return;
      }

      payload.phoneNumberId = phoneNumberId;
      payload.wabaId = wabaId;
      payload.displayPhoneNumber = displayPhoneNumber;
      payload.webhookVerifyToken = webhookVerifyToken;
      if (accessToken) payload.accessToken = accessToken;
    } else if (provider === 'wati') {
      const watiApiEndpoint = document.getElementById('wa-wati-endpoint')?.value.trim();
      const displayPhoneNumber = document.getElementById('wa-wati-phone')?.value.trim();
      const watiAccessToken = document.getElementById('wa-wati-token')?.value.trim();
      const webhookVerifyToken = document.getElementById('wa-wati-verify-token')?.value.trim();

      if (!watiApiEndpoint && !waState.config?.wati_api_endpoint) {
        showToast('WATI API Endpoint URL is required', true);
        return;
      }

      payload.watiApiEndpoint = watiApiEndpoint;
      payload.displayPhoneNumber = displayPhoneNumber;
      payload.webhookVerifyToken = webhookVerifyToken;
      if (watiAccessToken) payload.watiAccessToken = watiAccessToken;
    }

    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/whatsapp/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = getErrorMessage(result, 'Failed to save WhatsApp config');
      throw new Error(msg);
    }

    showToast(`WhatsApp (${provider.toUpperCase()}) configuration saved successfully!`);
    await loadWhatsAppConfig();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btnSave) btnSave.disabled = false;
  }
}

async function sendWhatsAppTestMessage() {
  if (!state.activeStoreId) return;
  const toPhone = document.getElementById('wa-test-phone')?.value.trim();
  if (!toPhone) {
    showToast('Enter recipient phone number with country code (e.g. +44...)', true);
    return;
  }

  const btn = document.getElementById('btn-send-wa-test');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending...';
  }

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/whatsapp/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ toPhone })
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = getErrorMessage(result, 'Test dispatch failed');
      throw new Error(msg);
    }

    showToast(`Test message dispatched! WAMID: ${result.data?.wamid || 'OK'}`);
    await Promise.all([
      loadWhatsAppConversations(),
      loadWhatsAppAnalytics()
    ]);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Send Test';
    }
  }
}

async function loadWhatsAppConversations() {
  if (!state.activeStoreId) return;
  const listContainer = document.getElementById('wa-conversation-list');
  const countEl = document.getElementById('wa-conv-count');
  if (!listContainer) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/whatsapp/conversations?limit=20`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to load conversations');

    const { data } = await res.json();
    waState.conversations = data.conversations || [];
    const total = data.total || waState.conversations.length;

    if (countEl) countEl.textContent = `${total} conversation${total === 1 ? '' : 's'}`;

    if (waState.conversations.length === 0) {
      listContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 25px 8px;">No active conversations yet. Inbound customer chats and recovery conversations will appear here.</div>';
      return;
    }

    listContainer.innerHTML = waState.conversations.map(c => {
      const isSelected = c.id === waState.selectedConvId;
      const dateStr = c.last_message_at ? formatRelativeTime(new Date(c.last_message_at)) : 'New';
      const statusBadge = c.status === 'active'
        ? '<span style="color: #34d399; font-size: 10px; font-weight: 700;">● LIVE</span>'
        : '<span style="color: var(--text-muted); font-size: 10px;">CLOSED</span>';

      return `
        <div class="wa-conv-item ${isSelected ? 'active' : ''}" data-id="${c.id}" style="padding: 10px; border-radius: 8px; margin-bottom: 6px; cursor: pointer; transition: background 0.15s ease; border: 1px solid ${isSelected ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.04)'}; background: ${isSelected ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.02)'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
            <span style="font-weight: 600; font-size: 12.5px; color: var(--text-main); font-family: var(--font-mono);">${escapeHtml(c.customer_phone)}</span>
            ${statusBadge}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
            <span>${c.message_count || 0} msgs</span>
            <span>${dateStr}</span>
          </div>
        </div>
      `;
    }).join('');

    // Attach click handlers
    listContainer.querySelectorAll('.wa-conv-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        selectWhatsAppConversation(id);
      });
    });

    // If no conversation is currently selected, select the first one automatically
    if (!waState.selectedConvId && waState.conversations.length > 0) {
      selectWhatsAppConversation(waState.conversations[0].id);
    }
  } catch (err) {
    console.error('Error loading WhatsApp conversations:', err);
  }
}

async function selectWhatsAppConversation(convId) {
  waState.selectedConvId = convId;

  // Highlight active in list
  const listContainer = document.getElementById('wa-conversation-list');
  if (listContainer) {
    listContainer.querySelectorAll('.wa-conv-item').forEach(el => {
      const isSel = el.getAttribute('data-id') === convId;
      el.classList.toggle('active', isSel);
      el.style.border = isSel ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(255, 255, 255, 0.04)';
      el.style.background = isSel ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.02)';
    });
  }

  await loadWhatsAppMessages(convId);
}

async function loadWhatsAppMessages(convId) {
  if (!state.activeStoreId || !convId) return;
  const container = document.getElementById('wa-messages-container');
  if (!container) return;

  container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px 0; font-size: 12px;">Loading messages...</div>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/whatsapp/messages?conversationId=${convId}&limit=50`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to load messages');

    const { data } = await res.json();
    const messages = data.messages || [];

    if (messages.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0; font-size: 13px;">No messages recorded in this conversation yet.</div>';
      return;
    }

    container.innerHTML = messages.map(m => {
      const isInbound = m.direction === 'inbound';
      const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const senderLabel = isInbound ? '👤 Customer' : '🤖 AI Assistant';

      return `
        <div style="display: flex; flex-direction: column; align-items: ${isInbound ? 'flex-start' : 'flex-end'}; margin-bottom: 8px;">
          <div style="font-size: 10.5px; color: var(--text-muted); margin-bottom: 2px; padding: 0 4px;">
            ${senderLabel} • ${timeStr}
          </div>
          <div class="wa-bubble ${isInbound ? 'inbound' : 'outbound'}" style="max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.45; word-break: break-word; background: ${isInbound ? 'rgba(30, 41, 59, 0.9)' : 'linear-gradient(135deg, #059669 0%, #047857 100%)'}; color: #ffffff; border: 1px solid ${isInbound ? 'rgba(255,255,255,0.08)' : 'rgba(52, 211, 153, 0.3)'}; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
            ${escapeHtml(m.body_text)}
          </div>
        </div>
      `;
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    container.innerHTML = `<div style="text-align: center; color: var(--danger); padding: 20px 0; font-size: 12px;">Failed to load messages: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadWhatsAppConsents() {
  if (!state.activeStoreId) return;
  const tbody = document.getElementById('wa-consents-tbody');
  const countEl = document.getElementById('wa-consents-count');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/whatsapp/consents?limit=20`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to load consents');

    const { data } = await res.json();
    waState.consents = data.consents || [];
    const total = data.total || waState.consents.length;

    if (countEl) countEl.textContent = `${total} contact${total === 1 ? '' : 's'}`;

    if (waState.consents.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 25px; color: var(--text-muted);">
            No opted-in WhatsApp contacts recorded yet. Shoppers opt in via storefront widget or affirmative keyword.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = waState.consents.map(c => {
      const isActive = c.status === 'active';
      const dateStr = new Date(c.captured_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      const statusBadge = isActive
        ? '<span class="badge" style="background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 11px;">Active Opt-In</span>'
        : '<span class="badge" style="background: rgba(239, 68, 68, 0.18); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-size: 11px;">Revoked</span>';

      const actionHtml = isActive
        ? `<button class="btn-sm btn-secondary outline btn-revoke-consent" data-id="${c.id}" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.4); font-size: 11px; padding: 4px 10px;">Revoke</button>`
        : '<span style="font-size: 11px; color: var(--text-muted);">Revoked</span>';

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 12px; font-weight: 600; color: var(--text-main); font-family: var(--font-mono);">${escapeHtml(c.phone_number)}</td>
          <td style="padding: 12px;">${statusBadge}</td>
          <td style="padding: 12px; font-size: 12px; color: var(--text-muted); text-transform: capitalize;">${escapeHtml(c.source || 'storefront_widget')}</td>
          <td style="padding: 12px; font-size: 12px; color: var(--text-dim); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(c.consent_wording)}</td>
          <td style="padding: 12px; font-size: 12px; color: var(--text-muted);">${dateStr}</td>
          <td style="padding: 12px; text-align: right;">${actionHtml}</td>
        </tr>
      `;
    }).join('');

    // Attach revoke buttons
    tbody.querySelectorAll('.btn-revoke-consent').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        showConfirmModal('Revoke WhatsApp Opt-In?', 'The customer will immediately stop receiving WhatsApp cart reminders and notifications.', async () => {
          await revokeWhatsAppConsent(id);
        });
      });
    });
  } catch (err) {
    console.error('Error loading WhatsApp consents:', err);
  }
}

async function revokeWhatsAppConsent(consentId) {
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/whatsapp/consents/${consentId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to revoke consent');

    showToast('WhatsApp consent revoked');
    await Promise.all([
      loadWhatsAppConsents(),
      loadWhatsAppAnalytics()
    ]);
  } catch (err) {
    showToast(err.message, true);
  }
}

