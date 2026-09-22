// Application State
let state = {
  token: localStorage.getItem('auth_token'),
  user: null,
  activeStoreId: null,
  activeStoreCurrency: 'INR',
  stores: []
};

// Global Currency Symbol Helper
function getCurrencySymbol(curr) {
  const c = String(curr || state.activeStoreCurrency || 'INR').trim().toUpperCase();
  if (c === 'INR') return '₹';
  if (c === 'USD') return '$';
  if (c === 'GBP') return '£';
  if (c === 'EUR') return '€';
  if (c === 'AED') return 'AED ';
  if (c === 'CAD') return 'C$';
  if (c === 'AUD') return 'A$';
  return c + ' ';
}

// 3D Avatar Presets Gallery for AI Assistant
const AVATAR_PRESETS = [
  {
    id: 'mira-female-3d',
    persona: 'female',
    name: 'Mira (3D Female)',
    role: 'Fashion & Style',
    url: '/assets/avatars/mira-3d.jpg',
  },
  {
    id: 'arjun-male-3d',
    persona: 'male',
    name: 'Arjun (3D Male)',
    role: 'Tech & Products',
    url: '/assets/avatars/arjun-3d.jpg',
  },
  {
    id: 'cosmo-robot-3d',
    persona: 'bot',
    name: 'Cosmo (3D Robot)',
    role: 'AI Concierge',
    url: '/assets/avatars/cosmo-3d.jpg',
  },
  {
    id: 'cyber-nova',
    persona: 'bot',
    name: 'Nova (3D Bot)',
    role: 'Smart Assistant',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Nova&backgroundColor=6366f1,818cf8',
  },
  {
    id: 'neon-sparkle',
    persona: 'bot',
    name: 'Sparkle (3D Bot)',
    role: 'Friendly Bot',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Sparkle&backgroundColor=ec4899,d946ef',
  },
  {
    id: 'zenith-bot',
    persona: 'bot',
    name: 'Zenith (3D Bot)',
    role: 'Power Bot',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Zenith&backgroundColor=7c3aed,a855f7',
  },
];

// DOM Elements
const views = {
  login: document.getElementById('login-view'),
  dashboard: document.getElementById('dashboard-view')
};

const sections = {
  'growth-copilot': document.getElementById('growth-copilot'),
  'overview': document.getElementById('overview'),
  'live-analytics': document.getElementById('live-analytics'),
  'my-agent': document.getElementById('my-agent'),
  'leads-optins': document.getElementById('leads-optins'),
  'widget-settings': document.getElementById('widget-settings'),
  'shopify-connection': document.getElementById('shopify-connection'),
  'ad-creative-studio': document.getElementById('ad-creative-studio'),
  'whatsapp-growth': document.getElementById('whatsapp-growth'),
  'email-automation': document.getElementById('email-automation'),
  'reorder-reminders': document.getElementById('reorder-reminders'),
  'ad-intelligence': document.getElementById('ad-intelligence'),
  'meta-ads': document.getElementById('meta-ads'),
  'ads-explorer': document.getElementById('ads-explorer'),
  'ai-agent': document.getElementById('ai-agent')
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

  // Support URL query params auto-login (e.g. ?email=...&password=...)
  try {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    const passParam = params.get('password');

    if (emailParam && passParam) {
      const emailInput = document.getElementById('email');
      const passInput = document.getElementById('password');
      if (emailInput && passInput) {
        emailInput.value = emailParam;
        passInput.value = passParam;
      }
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (_) {}

      const loginForm = document.getElementById('login-form');
      if (loginForm) {
        loginForm.dispatchEvent(new Event('submit', { cancelable: true }));
        return;
      }
    }
  } catch (e) {
    console.warn('Could not parse login query params:', e);
  }

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

  // Smart Reorder Reminders controls (Phase 14)
  setupReorderRemindersEventListeners();

  // Multi-Touch Ad Intelligence controls (Phase 15)
  setupAdIntelligenceEventListeners();

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

    // Extract quick action pills configuration
    const pillDefinitions = [
      { id: 'track_order', group: 'support', defaultLabel: 'Track My Order', icon: '📦' },
      { id: 'return_policy', group: 'support', defaultLabel: 'Return & Exchange Policy', icon: '🔄' },
      { id: 'shipping_delivery', group: 'support', defaultLabel: 'Shipping & Delivery', icon: '🚚' },
      { id: 'whatsapp_support', group: 'support', defaultLabel: 'WhatsApp / Human Support', icon: '💬' },
      { id: 'current_offers', group: 'sales', defaultLabel: 'Current Offers & Discounts', icon: '🏷️' },
      { id: 'best_sellers', group: 'sales', defaultLabel: 'Best Sellers / Trending', icon: '🔥' },
      { id: 'size_guide', group: 'sales', defaultLabel: 'Size Guide & Fit Help', icon: '📏' },
      { id: 'gift_ideas', group: 'sales', defaultLabel: 'Gift Ideas & Collections', icon: '🎁' }
    ];

    const quickActionPills = pillDefinitions.map(def => {
      const enableEl = document.getElementById(`pill-enable-${def.id}`);
      const nameEl = document.getElementById(`pill-name-${def.id}`);
      const urlEl = document.getElementById(`pill-url-${def.id}`);
      const imgEl = def.id === 'size_guide' ? document.getElementById('pill-image-size_guide') : null;

      return {
        id: def.id,
        group: def.group,
        label: nameEl && nameEl.value.trim() ? nameEl.value.trim() : def.defaultLabel,
        enabled: enableEl ? enableEl.checked : true,
        url: urlEl ? urlEl.value.trim() : '',
        ...(imgEl ? { image_url: imgEl.value.trim() } : {}),
        icon: def.icon
      };
    });
    
    const faqEl = document.getElementById('store-faq');
    const payload = {
      assistant: {
        is_active: isActive,
        assistant_name: document.getElementById('agent-name').value,
        welcome_message: document.getElementById('agent-welcome').value,
        tone: document.getElementById('agent-tone').value,
        support_contact: document.getElementById('agent-support').value,
        custom_prompt: document.getElementById('agent-custom-prompt') ? document.getElementById('agent-custom-prompt').value : '',
        knowledge_base: document.getElementById('agent-knowledge-base') ? document.getElementById('agent-knowledge-base').value : '',
        quick_action_pills: quickActionPills
      },
      policies: {
        faq_content: faqEl ? faqEl.value : ''
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
        country_code: document.getElementById('widget-country-code') ? document.getElementById('widget-country-code').value : 'IN',
        avatar_persona: document.getElementById('widget-avatar-persona') ? document.getElementById('widget-avatar-persona').value : 'female',
        avatar_url: document.getElementById('widget-avatar-url') ? document.getElementById('widget-avatar-url').value.trim() : '',
        header_title: document.getElementById('widget-header-title') ? document.getElementById('widget-header-title').value : '',
        custom_css: document.getElementById('widget-custom-css') ? document.getElementById('widget-custom-css').value : '',
        offer_code: document.getElementById('widget-offer-code') ? document.getElementById('widget-offer-code').value.trim().toUpperCase() : '',
        offer_discount_percent: document.getElementById('widget-offer-percent') ? (parseFloat(document.getElementById('widget-offer-percent').value) || 0) : 0,
        offer_text: document.getElementById('widget-offer-text') ? document.getElementById('widget-offer-text').value.trim() : '',
        proactive_nudge_enabled: document.getElementById('widget-nudge-enabled') ? document.getElementById('widget-nudge-enabled').checked : true,
        proactive_nudge_interval_seconds: 60,
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
  ['widget-btn-text', 'widget-header-title', 'widget-primary-color', 'widget-secondary-color', 'widget-position', 'widget-country-code', 'widget-avatar-persona', 'widget-avatar-url', 'widget-offer-code', 'widget-offer-percent', 'widget-offer-text', 'widget-nudge-enabled'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(evt, () => {
        if (id === 'widget-avatar-url') {
          updateAvatarPresetSelection(el.value.trim());
        }
        if (id === 'widget-avatar-persona') {
          const persona = el.value;
          const match = AVATAR_PRESETS.find(p => p.persona === persona);
          if (match) {
            const avatarInput = document.getElementById('widget-avatar-url');
            if (avatarInput) avatarInput.value = match.url;
            updateAvatarPresetSelection(match.url);
          }
        }
        updateLivePreview();
      });
    }
  });

  // Reset / Clear Avatar Button
  const clearAvatarBtn = document.getElementById('btn-clear-avatar');
  if (clearAvatarBtn) {
    clearAvatarBtn.addEventListener('click', () => {
      const avatarInput = document.getElementById('widget-avatar-url');
      if (avatarInput) avatarInput.value = '/assets/avatars/mira-3d.jpg';
      const personaSelect = document.getElementById('widget-avatar-persona');
      if (personaSelect) personaSelect.value = 'female';
      updateAvatarPresetSelection('/assets/avatars/mira-3d.jpg');
      updateLivePreview();
      showToast('Reset avatar to default Mira 3D model.');
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

  // 3a. Shopify Health Check actions
  const recheckHealthBtn = document.getElementById('btn-recheck-shopify-health');
  if (recheckHealthBtn) recheckHealthBtn.addEventListener('click', runShopifyHealthCheck);
  const dismissScopeBannerBtn = document.getElementById('btn-dismiss-shopify-banner');
  if (dismissScopeBannerBtn) dismissScopeBannerBtn.addEventListener('click', () => {
    try { localStorage.setItem('shopifyHealthBannerDismissed:' + state.activeStoreId, '1'); } catch (_) {}
    const banner = document.getElementById('shopify-scope-banner');
    if (banner) banner.classList.add('hidden');
  });
  const gotoHealthBtn = document.getElementById('btn-goto-shopify-health');
  if (gotoHealthBtn) gotoHealthBtn.addEventListener('click', () => {
    const link = document.querySelector('.nav-links a[data-target="shopify-connection"]');
    if (link) { link.click(); } else { showSection('shopify-connection'); loadSectionData('shopify-connection'); }
    // The banner means the token needs attention — open the reconnect modal directly.
    setTimeout(openShopifyReconnectModal, 150);
  });

  // 3b. Shopify token reconnect / disconnect actions
  const shopifyReconnectBtn = document.getElementById('btn-shopify-reconnect');
  if (shopifyReconnectBtn) shopifyReconnectBtn.addEventListener('click', openShopifyReconnectModal);
  const shopifyDisconnectBtn = document.getElementById('btn-shopify-disconnect');
  if (shopifyDisconnectBtn) shopifyDisconnectBtn.addEventListener('click', disconnectShopify);
  const shopifyReconnectForm = document.getElementById('shopify-reconnect-form');
  if (shopifyReconnectForm) shopifyReconnectForm.addEventListener('submit', submitShopifyReconnect);
  const closeReconnectBtn = document.getElementById('close-shopify-reconnect-modal');
  if (closeReconnectBtn) closeReconnectBtn.addEventListener('click', closeShopifyReconnectModal);
  const cancelReconnectBtn = document.getElementById('cancel-shopify-reconnect');
  if (cancelReconnectBtn) cancelReconnectBtn.addEventListener('click', closeShopifyReconnectModal);

  // Store Currency Update Handler
  const btnSaveCurrency = document.getElementById('btn-save-currency');
  if (btnSaveCurrency) {
    btnSaveCurrency.addEventListener('click', async () => {
      const curSelect = document.getElementById('store-currency-select');
      const statusEl = document.getElementById('currency-save-status');
      if (!curSelect || !state.activeStoreId) return;
      const newCurrency = curSelect.value;
      const originalText = btnSaveCurrency.textContent;
      try {
        btnSaveCurrency.disabled = true;
        btnSaveCurrency.textContent = 'Updating...';
        if (statusEl) statusEl.textContent = 'Saving...';

        const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/currency`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.token}`
          },
          body: JSON.stringify({ currency: newCurrency })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update currency');

        state.activeStoreCurrency = newCurrency;
        if (statusEl) {
          statusEl.textContent = 'Saved!';
          statusEl.style.color = '#10b981';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
        }
        showToast(`Store currency successfully updated to ${newCurrency}!`);
        // Refresh overview and tables with the updated currency symbol
        if (typeof loadGrowthCopilotData === 'function') {
          loadGrowthCopilotData();
        }
        if (typeof loadProductsTable === 'function') {
          loadProductsTable();
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = 'Failed';
          statusEl.style.color = '#ef4444';
        }
        showToast('Error updating currency: ' + err.message, true);
      } finally {
        btnSaveCurrency.disabled = false;
        btnSaveCurrency.textContent = originalText;
      }
    });
  }

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

function updatePillVisualState(pillId, isEnabled) {
  const card = document.getElementById(`pill-card-${pillId}`);
  const statusBadge = document.getElementById(`pill-status-${pillId}`);
  const enableEl = document.getElementById(`pill-enable-${pillId}`);
  if (enableEl) {
    enableEl.checked = Boolean(isEnabled);
  }
  if (statusBadge) {
    if (isEnabled) {
      statusBadge.textContent = 'Enabled';
      statusBadge.style.background = 'rgba(34, 197, 94, 0.15)';
      statusBadge.style.color = '#22c55e';
    } else {
      statusBadge.textContent = 'Disabled';
      statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
      statusBadge.style.color = '#ef4444';
    }
  }
  if (card) {
    card.style.opacity = isEnabled ? '1' : '0.65';
    card.style.filter = isEnabled ? 'none' : 'grayscale(25%)';
  }
}

async function saveAgentSettings(payload) {
  const saveBtn = document.getElementById('btn-save-agent') || document.querySelector('#agent-form button[type="submit"]');
  const origBtnText = saveBtn ? saveBtn.textContent : 'Save Agent Settings';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving Settings...';
  }

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/agent`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || errJson?.message || 'Failed to save settings');
    }
    showToast('Agent settings & Quick Action Pills saved successfully!');
    
    // Refresh overview to update badges
    if (!document.getElementById('overview').classList.contains('hidden')) {
      loadSectionData('overview');
    }
    // Also re-fetch agent settings to ensure UI toggles strictly match saved database state
    await loadSectionData('my-agent');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = origBtnText;
    }
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
  const isAdmin = ['super_admin', 'ops_admin', 'platform_admin'].includes(state.user.role);
  document.getElementById('user-role-badge').textContent = isAdmin ? 'Admin' : 'Merchant';
  
  try {
    const res = await fetch('/api/v1/dashboard/stores', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const { data: stores } = await res.json();
      state.stores = stores || [];
      
      const selectorContainer = document.getElementById('store-selector-container');
      const selector = document.getElementById('store-selector');

      if (isAdmin && state.stores.length > 0) {
        selectorContainer.classList.remove('hidden');
        selector.innerHTML = state.stores
          .map(s => `<option value="${s.id}">${s.brand_name || s.shop_domain} (${s.shop_domain})</option>`)
          .join('');

        const savedStoreId = localStorage.getItem('ai_active_store_id');
        const matchedStore = savedStoreId && state.stores.find(s => s.id === savedStoreId);
        selector.value = matchedStore ? matchedStore.id : (state.activeStoreId || state.stores[0].id);
        state.activeStoreId = selector.value;
        try { localStorage.setItem('ai_active_store_id', state.activeStoreId); } catch (_) {}

        selector.onchange = (e) => {
          state.activeStoreId = e.target.value;
          try { localStorage.setItem('ai_active_store_id', state.activeStoreId); } catch (_) {}
          updateActiveStoreUI();
        };
      } else {
        selectorContainer.classList.add('hidden');
        state.activeStoreId = state.user.store_id || (state.stores[0]?.id || null);
        try { if (state.activeStoreId) localStorage.setItem('ai_active_store_id', state.activeStoreId); } catch (_) {}
      }
    }
  } catch (err) {
    console.error('Failed to load stores', err);
    state.activeStoreId = state.user.store_id;
  }

  if ((!state.activeStoreId || state.activeStoreId === 'null') && state.stores && state.stores.length > 0) {
    const savedStoreId = localStorage.getItem('ai_active_store_id');
    const matchedStore = savedStoreId && state.stores.find(s => s.id === savedStoreId);
    state.activeStoreId = matchedStore ? matchedStore.id : state.stores[0].id;
  }

  updateActiveStoreUI();
}

async function updateActiveStoreUI() {
  if (state.activeStoreId && state.activeStoreId !== 'null') {
    await fetchStoreFeatures();
    const activeSectionEl = document.querySelector('.nav-links a.active');
    const activeSection = activeSectionEl ? activeSectionEl.getAttribute('data-target') : 'overview';
    loadSectionData(activeSection);
    refreshShopifyScopeBanner();
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
    <div class="avatar-preset-card" data-url="${preset.url}" data-persona="${preset.persona}" title="${preset.name}">
      <img src="${preset.url}" alt="${preset.name}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.15);">
      <span style="font-weight: 600; font-size: 11px; margin-top: 4px;">${preset.name}</span>
      <small style="font-size: 10px; color: var(--color-accent); font-weight: 500; display: block;">${preset.role || ''}</small>
    </div>
  `).join('');

  grid.querySelectorAll('.avatar-preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const url = card.getAttribute('data-url');
      const persona = card.getAttribute('data-persona');
      const avatarInput = document.getElementById('widget-avatar-url');
      const personaSelect = document.getElementById('widget-avatar-persona');
      if (avatarInput) avatarInput.value = url;
      if (personaSelect && persona) personaSelect.value = persona;
      updateAvatarPresetSelection(url);
      updateLivePreview();
      showToast(`Selected ${card.querySelector('span').textContent}! Save settings to apply.`);
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
  const avatarUrl = document.getElementById('widget-avatar-url')?.value?.trim() || '/assets/avatars/mira-3d.jpg';
  const countryCode = document.getElementById('widget-country-code')?.value || 'IN';
  const offerCode = (document.getElementById('widget-offer-code')?.value || '').trim().toUpperCase();
  const offerPercent = parseFloat(document.getElementById('widget-offer-percent')?.value || '0') || 10;
  const offerText = (document.getElementById('widget-offer-text')?.value || '').trim();
  const nudgeEnabled = document.getElementById('widget-nudge-enabled') ? document.getElementById('widget-nudge-enabled').checked : true;

  // 1. Proactive Nudge Preview
  const nudgeBubble = document.getElementById('preview-nudge-bubble');
  const nudgeText = document.getElementById('preview-nudge-text');
  if (nudgeBubble) {
    nudgeBubble.style.display = nudgeEnabled ? 'block' : 'none';
  }
  if (nudgeText) {
    const personaName = headerTitle.replace(/(Shopping|Concierge|Assistant|AI)/gi, '').trim() || 'Mira';
    nudgeText.textContent = `👋 Hi! I'm ${personaName}, your personal shopping concierge. Looking for recommendations?`;
  }

  // 2. Button Preview
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

  // 3. Header Preview
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

  // 4. Offer Badge Preview
  const offerBadgeEl = document.getElementById('preview-offer-badge');
  const offerTextEl = document.getElementById('preview-offer-text-el');
  if (offerBadgeEl && offerTextEl) {
    if (offerCode) {
      offerBadgeEl.style.display = 'flex';
      const label = offerText || `AI Special ${offerPercent ? offerPercent + '% OFF' : ''}`.trim();
      offerTextEl.innerHTML = `🏷️ ${label}: ₹1,584 (Code: <strong>${offerCode}</strong>)`;
    } else {
      offerBadgeEl.style.display = 'none';
    }
  }

  // 5. Country Phone Preview
  const phoneValEl = document.getElementById('preview-phone-val');
  if (phoneValEl) {
    if (countryCode === 'IN') {
      phoneValEl.textContent = '🇮🇳 +91 98765 43210';
    } else if (countryCode === 'US') {
      phoneValEl.textContent = '🇺🇸 +1 (555) 000-0000';
    } else if (countryCode === 'GB') {
      phoneValEl.textContent = '🇬🇧 +44 7911 123456';
    } else {
      phoneValEl.textContent = '🌐 +1 234 567 8900';
    }
  }
}

function showView(viewName) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  if(views[viewName]) views[viewName].classList.remove('hidden');
}

// ---- Shopify Connection Health (badge, details panel, scope banner) ----
function shopifyHealthBadgeClass(status) {
  if (status === 'healthy') return 'badge badge--success';
  if (status === 'degraded') return 'badge badge--warning';
  if (status === 'down') return 'badge badge--danger';
  return 'badge badge--neutral';
}

function shopifyHealthLabel(status) {
  if (status === 'healthy') return 'Healthy';
  if (status === 'degraded') return 'Needs attention';
  if (status === 'down') return 'Down';
  return 'Not checked';
}

async function fetchShopifyHealth() {
  const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/shopify/health`, {
    headers: { 'Authorization': `Bearer ${state.token}` }
  });
  if (!res.ok) throw new Error('Health fetch failed');
  const { data } = await res.json();
  return data;
}

async function loadShopifyHealth() {
  const badge = document.getElementById('shopify-health-badge');
  const checkedAt = document.getElementById('shopify-health-checked-at');
  const panel = document.getElementById('shopify-health-panel');
  if (!badge || !panel) return;
  badge.textContent = 'Checking…';
  badge.className = 'badge badge--neutral';
  try {
    const data = await fetchShopifyHealth();
    renderShopifyHealth(data);
  } catch (err) {
    badge.textContent = 'Check failed';
    badge.className = 'badge badge--danger';
    if (checkedAt) checkedAt.textContent = '';
    panel.innerHTML = '<p style="font-size:13px;color:var(--color-text-secondary);">Could not load the health check. Press Re-check to try again.</p>';
  }
}

function renderShopifyHealth(data) {
  const badge = document.getElementById('shopify-health-badge');
  const checkedAt = document.getElementById('shopify-health-checked-at');
  const panel = document.getElementById('shopify-health-panel');
  if (!badge || !panel) return;
  if (!data || data.checked === false) {
    badge.textContent = 'Not checked';
    badge.className = 'badge badge--neutral';
    if (checkedAt) checkedAt.textContent = '';
    panel.innerHTML = '<p style="font-size:13px;color:var(--color-text-secondary);">No health check has run yet. Press <strong>Re-check</strong> to diagnose the token and API scopes.</p>';
    return;
  }
  badge.textContent = shopifyHealthLabel(data.overall_status);
  badge.className = shopifyHealthBadgeClass(data.overall_status);
  if (checkedAt) checkedAt.textContent = data.checked_at ? ('· checked ' + new Date(data.checked_at).toLocaleString()) : '';

  const scopeIcon = (s) => s === 'ok' ? '✅' : (s === 'missing' ? '❌' : (s === 'error' ? '⚠️' : '➖'));
  let html = '<div style="display:grid;gap:8px;">';
  if (data.shop_name || data.store_match === false) {
    const matchBadge = data.store_match === false
      ? '<span class="badge badge--danger">wrong store</span>'
      : (data.store_match ? '<span class="badge badge--success">domain match</span>' : '');
    html += `<div style="font-size:13px;">Store: <strong>${escapeHtml(data.shop_name || '—')}</strong> ${matchBadge}</div>`;
  }
  for (const s of (data.scopes || [])) {
    html += `<div style="display:flex;gap:10px;align-items:flex-start;font-size:13px;padding:8px 10px;border:1px solid var(--color-border-default);border-radius:8px;">`
      + `<span style="font-size:15px;">${scopeIcon(s.status)}</span>`
      + `<div><div style="font-weight:600;">${escapeHtml(s.scope)} <span style="font-weight:400;color:var(--color-text-muted);font-size:12px;">${escapeHtml(s.tested_endpoint || '')}</span></div>`
      + `<div style="color:var(--color-text-secondary);font-size:12px;">Unlocks: ${escapeHtml(s.unlocks || '')}</div>`
      + (s.detail ? `<div style="color:var(--color-danger);font-size:12px;">${escapeHtml(s.detail)}</div>` : '')
      + `</div></div>`;
  }
  html += '</div>';
  if (data.rate_limit) {
    html += `<p style="font-size:12px;color:var(--color-text-muted);margin:8px 0 0;">Shopify API call limit: ${escapeHtml(data.rate_limit)}</p>`;
  }
  if (data.fix_steps && data.fix_steps.length > 0) {
    html += `<div class="callout-box" style="margin-top:10px;"><div style="font-weight:600;margin-bottom:6px;">How to fix</div><ol style="margin:0;padding-left:18px;display:grid;gap:4px;">`
      + data.fix_steps.map(st => `<li>${escapeHtml(st)}</li>`).join('')
      + `</ol></div>`;
  }
  panel.innerHTML = html;

  updateShopifyScopeBanner(data);
}

async function runShopifyHealthCheck() {
  const btn = document.getElementById('btn-recheck-shopify-health');
  const original = btn ? btn.textContent : 'Re-check';
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/shopify/health/check`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const body = await res.json();
    if (!res.ok) throw new Error((body && (body.message || (body.error && body.error.message))) || 'Health check failed');
    renderShopifyHealth(body.data);
    showToast('Health check complete: ' + shopifyHealthLabel(body.data.overall_status));
  } catch (err) {
    showToast(err.message || 'Health check failed', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

// Dismissible, non-blocking banner shown when the Shopify connection is down
// or the critical read_orders scope is missing.
async function refreshShopifyScopeBanner() {
  const banner = document.getElementById('shopify-scope-banner');
  if (!banner || !state.activeStoreId) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem('shopifyHealthBannerDismissed:' + state.activeStoreId) === '1'; } catch (_) {}
  if (dismissed) { banner.classList.add('hidden'); return; }
  try {
    const data = await fetchShopifyHealth();
    updateShopifyScopeBanner(data);
  } catch (_) { /* banner stays hidden when the check can't load */ }
}

function updateShopifyScopeBanner(data) {
  const banner = document.getElementById('shopify-scope-banner');
  const text = document.getElementById('shopify-scope-banner-text');
  if (!banner || !text || !state.activeStoreId) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem('shopifyHealthBannerDismissed:' + state.activeStoreId) === '1'; } catch (_) {}
  if (dismissed || !data || data.checked === false || data.overall_status === 'healthy') {
    banner.classList.add('hidden');
    return;
  }
  const ordersScope = (data.scopes || []).find(s => s.scope === 'read_orders');
  let msg;
  if (data.overall_status === 'down') {
    msg = '⚠️ Shopify connection is down — sales data and AI sales answers are unavailable. Open Connections → Shopify for the exact fix.';
  } else if (ordersScope && ordersScope.status !== 'ok') {
    msg = '⚠️ Your Shopify token is missing the read_orders scope — the revenue timeline and AI sales answers are disabled until you reconnect with that scope granted.';
  } else {
    msg = '⚠️ Your Shopify connection needs attention — some features are limited. Open Connections → Shopify for details.';
  }
  text.textContent = msg;
  banner.classList.remove('hidden');
}

// ---- Shopify token reconnect / disconnect ----
function openShopifyReconnectModal() {
  const modal = document.getElementById('shopify-reconnect-modal');
  if (!modal) return;
  const input = document.getElementById('shopify-reconnect-token');
  if (input) input.value = '';
  setShopifyReconnectError(null);
  modal.classList.remove('hidden');
  if (input) input.focus();
}

function closeShopifyReconnectModal() {
  const modal = document.getElementById('shopify-reconnect-modal');
  if (modal) modal.classList.add('hidden');
  const input = document.getElementById('shopify-reconnect-token');
  if (input) input.value = ''; // never keep the raw token in the DOM
  setShopifyReconnectError(null);
}

function setShopifyReconnectError(msg) {
  const err = document.getElementById('shopify-reconnect-error');
  if (!err) return;
  if (msg) { err.textContent = msg; err.classList.remove('hidden'); }
  else { err.textContent = ''; err.classList.add('hidden'); }
}

async function submitShopifyReconnect(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('shopify-reconnect-token');
  const saveBtn = document.getElementById('btn-save-shopify-token');
  const token = (input && input.value ? input.value : '').trim();
  if (!token) { setShopifyReconnectError('Please paste your Admin API access token.'); return; }
  setShopifyReconnectError(null);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Verifying…'; }
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/shopify/reconnect`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_token: token }),
    });
    const body = await res.json().catch(() => ({}));
    if (input) input.value = ''; // clear the raw token from the DOM immediately
    if (!res.ok) throw new Error((body && body.error && body.error.message) || 'Reconnect failed');
    closeShopifyReconnectModal();
    if (body.data && body.data.health) {
      renderShopifyHealth(body.data.health);
    } else {
      loadShopifyHealth();
    }
    loadSectionData('shopify-connection'); // refresh status line (credentials configured etc.)
    showToast('Shopify token updated and verified ✓');
  } catch (err) {
    setShopifyReconnectError(err.message || 'Reconnect failed. Please try again.');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save & Verify'; }
  }
}

async function disconnectShopify() {
  showConfirmModal('Disconnect Shopify?', 'This removes the stored Shopify token for this store. Sales sync, product sync and AI sales answers will stop until you reconnect. Your existing store data stays untouched.', async () => {
    try {
      const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/shopify/connection`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${state.token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body && body.error && body.error.message) || 'Disconnect failed');
      const pill = document.getElementById('shopify-status');
      if (pill) { pill.textContent = 'Disconnected'; pill.className = 'badge badge--neutral'; }
      const creds = document.getElementById('shopify-creds');
      if (creds) creds.textContent = 'No';
      renderShopifyHealth({ checked: false });
      showToast('Shopify disconnected');
    } catch (err) {
      showToast(err.message || 'Disconnect failed', true);
    }
  });
}

function showSection(sectionName) {
  const featKey = NAV_FEATURE_MAP[sectionName];
  if (featKey && state.features && state.features[featKey] === false) {
    showToast('This feature is not enabled for your store. Contact your administrator.', true);
    return;
  }

  Object.values(sections).forEach(s => { 
    if (s) {
      s.classList.add('hidden');
      s.classList.remove('active');
    }
  });
  const targetSection = sections[sectionName];
  if (targetSection) {
    targetSection.classList.remove('hidden');
    targetSection.classList.add('active');
    if (window.gsap) {
      const animTargets = targetSection.querySelectorAll('.stat-card, .mini-stat-card, .glass-card, .panel, .live-pulse-hero-card, .table-container, form');
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
  if (!state.activeStoreId || state.activeStoreId === 'null') {
    if (state.stores && state.stores.length > 0) {
      state.activeStoreId = state.stores[0].id;
    } else {
      return;
    }
  }

  try {
    if (section === 'growth-copilot') {
      await loadGrowthCopilotData();
      return;
    }

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

    if (section === 'reorder-reminders') {
      await loadReorderRemindersData();
      return;
    }

    if (section === 'ad-intelligence') {
      await loadAdIntelligenceData();
      return;
    }

    if (section === 'meta-ads') {
      await loadMetaAdsData();
      return;
    }

    if (section === 'ads-explorer') {
      await loadExplorerData();
      return;
    }

    if (section === 'ai-agent') {
      await loadAiAgentData();
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

      loadOverviewInsights();
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

        // Populate Quick Action Pills
        try {
          const rawPills = data.assistant.quick_action_pills;
          const pills = Array.isArray(rawPills)
            ? rawPills
            : (typeof rawPills === 'string' ? JSON.parse(rawPills || '[]') : []);

          const pillMap = new Map((pills || []).map(p => [p.id, p]));
          const allPillIds = ['track_order', 'return_policy', 'shipping_delivery', 'whatsapp_support', 'current_offers', 'best_sellers', 'size_guide', 'gift_ideas'];

          allPillIds.forEach(id => {
            const pill = pillMap.get(id);
            const isEnabled = pill
              ? (pill.enabled !== false && pill.enabled !== 'false' && pill.enabled !== 0 && pill.enabled !== '0')
              : true;
            updatePillVisualState(id, isEnabled);

            const nameEl = document.getElementById(`pill-name-${id}`);
            const urlEl = document.getElementById(`pill-url-${id}`);
            const previewEl = document.getElementById(`label-preview-${id}`);

            if (pill) {
              if (nameEl && pill.label) {
                nameEl.value = pill.label;
                if (previewEl) previewEl.textContent = pill.label;
              }
              if (urlEl && pill.url !== undefined) urlEl.value = pill.url || '';
              if (id === 'size_guide') {
                const imgEl = document.getElementById('pill-image-size_guide');
                if (imgEl && pill.image_url !== undefined) imgEl.value = pill.image_url || '';
              }
            }
          });
        } catch (e) {
          console.warn('[Dashboard] Could not parse quick action pills:', e);
        }

        // Add live preview listeners and toggle change listeners
        const pillIds = ['track_order', 'return_policy', 'shipping_delivery', 'whatsapp_support', 'current_offers', 'best_sellers', 'size_guide', 'gift_ideas'];
        pillIds.forEach(id => {
          const nameInput = document.getElementById(`pill-name-${id}`);
          const previewEl = document.getElementById(`label-preview-${id}`);
          if (nameInput && previewEl && !nameInput.dataset.previewBound) {
            nameInput.dataset.previewBound = 'true';
            nameInput.addEventListener('input', (e) => {
              previewEl.textContent = e.target.value.trim() || previewEl.dataset.defaultLabel || e.target.placeholder;
            });
          }

          const enableEl = document.getElementById(`pill-enable-${id}`);
          if (enableEl && !enableEl.dataset.listenerBound) {
            enableEl.dataset.listenerBound = 'true';
            enableEl.addEventListener('change', () => {
              updatePillVisualState(id, enableEl.checked);
            });
          }
        });
      }
      if (data.policies && document.getElementById('store-faq')) {
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
        if (document.getElementById('widget-country-code')) {
          document.getElementById('widget-country-code').value = data.widget.country_code || 'IN';
        }
        if (document.getElementById('widget-avatar-persona')) {
          document.getElementById('widget-avatar-persona').value = data.widget.avatar_persona || 'female';
        }
        if (document.getElementById('widget-avatar-url')) {
          document.getElementById('widget-avatar-url').value = data.widget.avatar_url || '';
        }
        if (document.getElementById('widget-custom-css')) {
          document.getElementById('widget-custom-css').value = data.widget.custom_css || '';
        }
        if (document.getElementById('widget-offer-code')) {
          document.getElementById('widget-offer-code').value = data.widget.offer_code || '';
        }
        if (document.getElementById('widget-offer-percent')) {
          document.getElementById('widget-offer-percent').value = (data.widget.offer_discount_percent !== undefined && data.widget.offer_discount_percent !== null) ? data.widget.offer_discount_percent : '';
        }
        if (document.getElementById('widget-offer-text')) {
          document.getElementById('widget-offer-text').value = data.widget.offer_text || '';
        }
        if (document.getElementById('widget-nudge-enabled')) {
          document.getElementById('widget-nudge-enabled').checked = (data.widget.proactive_nudge_enabled !== undefined && data.widget.proactive_nudge_enabled !== null) ? data.widget.proactive_nudge_enabled : true;
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
      if (data.currency) {
        state.activeStoreCurrency = data.currency;
        const curSelect = document.getElementById('store-currency-select');
        if (curSelect) curSelect.value = data.currency;
      }
      loadProductsTable();
      loadShopifyHealth();
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
    console.warn(`[Dashboard] Non-critical error loading ${section} data:`, err);
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

function getProductFallbackImageUrl(category = '', title = '') {
  const combined = `${category || ''} ${title || ''}`.toLowerCase();
  if (combined.includes('seed') || combined.includes('plant') || combined.includes('organic') || combined.includes('herb') || combined.includes('fusion')) {
    return 'https://images.unsplash.com/photo-1509358271058-acd22cc93898?w=600&auto=format&fit=crop&q=80';
  }
  if (combined.includes('earbud') || combined.includes('audio') || combined.includes('speaker') || combined.includes('sound')) {
    return 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80';
  }
  if (combined.includes('headphone')) {
    return 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80';
  }
  if (combined.includes('watch') || combined.includes('wearable') || combined.includes('band')) {
    return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80';
  }
  if (combined.includes('shoe') || combined.includes('sneaker') || combined.includes('footwear') || combined.includes('boot')) {
    return 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80';
  }
  if (combined.includes('cloth') || combined.includes('shirt') || combined.includes('pant') || combined.includes('dress') || combined.includes('apparel') || combined.includes('fashion') || combined.includes('jacket')) {
    return 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600&auto=format&fit=crop&q=80';
  }
  if (combined.includes('decor') || combined.includes('vase') || combined.includes('ceramic') || combined.includes('pot') || combined.includes('home')) {
    return 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600&auto=format&fit=crop&q=80';
  }
  if (combined.includes('bed') || combined.includes('blanket') || combined.includes('linen') || combined.includes('pillow')) {
    return 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=600&auto=format&fit=crop&q=80';
  }
  if (combined.includes('beauty') || combined.includes('skin') || combined.includes('serum') || combined.includes('cosmetic') || combined.includes('lotion')) {
    return 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&auto=format&fit=crop&q=80';
  }
  return 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop&q=80';
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

      const fallbackImg = getProductFallbackImageUrl(p.category, p.title);
      const rawImg = (p.image_url && !p.image_url.includes('example.com')) ? p.image_url : fallbackImg;
      const imgHtml = `
        <div style="width: 44px; height: 44px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); background: #1e293b; display: flex; align-items: center; justify-content: center; position: relative;">
          <img src="${escapeHtml(rawImg)}" 
               alt="${escapeHtml(p.title)}" 
               loading="lazy" 
               onerror="this.onerror=null; this.src='${fallbackImg}';" 
               style="width: 100%; height: 100%; object-fit: cover; display: block;">
        </div>
      `;

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
          <td style="padding: 10px; text-align: right;">
            ${linkHtml}
            <button class="btn-secondary btn-sm" style="margin-left: 6px; padding: 3px 8px; font-size: 11px; border-color: rgba(99,102,241,0.4);" onclick="window.improveProductWithAi('${p.id}')">✨ Improve</button>
          </td>
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
      const fallbackImg = getProductFallbackImageUrl('', p.title);
      const rawImg = (p.image_url && !p.image_url.includes('example.com')) ? p.image_url : fallbackImg;
      const imgHtml = `
        <div style="width: 38px; height: 38px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); background: #1e293b; display: flex; align-items: center; justify-content: center;">
          <img src="${escapeHtml(rawImg)}" 
               alt="${escapeHtml(p.title)}" 
               loading="lazy"
               onerror="this.onerror=null; this.src='${fallbackImg}';" 
               style="width: 100%; height: 100%; object-fit: cover; display: block;">
        </div>
      `;

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

  // Download Ad Image button (Toolbar)
  const btnDownloadImg = document.getElementById('btn-download-ad-image');
  if (btnDownloadImg) {
    btnDownloadImg.addEventListener('click', downloadActiveAdImage);
  }

  // Quick Download Button (Media Box overlay)
  const btnQuickDownload = document.getElementById('btn-quick-download-ad-img');
  if (btnQuickDownload) {
    btnQuickDownload.addEventListener('click', downloadActiveAdImage);
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

  const fallbackImg = getProductFallbackImageUrl(product.category, product.title);
  const effectiveImg = (product.image_url && !product.image_url.includes('example.com')) ? product.image_url : fallbackImg;

  if (thumbEl && noThumbEl) {
    thumbEl.src = effectiveImg;
    thumbEl.style.display = 'block';
    noThumbEl.style.display = 'none';
    thumbEl.onerror = () => {
      thumbEl.src = fallbackImg;
    };
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
  const prodFallback = prod ? getProductFallbackImageUrl(prod.category, prod.title) : '';
  const activeMediaUrl = adStudioState.generatedImageUrl || (prod?.image_url && !prod.image_url.includes('example.com') ? prod.image_url : prodFallback);
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

  const quickDlBtn = document.getElementById('btn-quick-download-ad-img');
  const toolbarDlBtn = document.getElementById('btn-download-ad-image');

  if (activeMediaUrl && imgEl && fallbackEl) {
    imgEl.src = activeMediaUrl;
    imgEl.style.display = 'block';
    fallbackEl.style.display = 'none';
    if (quickDlBtn) quickDlBtn.classList.remove('hidden');
    if (toolbarDlBtn) toolbarDlBtn.disabled = false;
    imgEl.onerror = () => {
      if (prodFallback && imgEl.src !== prodFallback) {
        imgEl.src = prodFallback;
      } else {
        imgEl.style.display = 'none';
        fallbackEl.style.display = 'flex';
        if (fallbackTitleEl && prod) fallbackTitleEl.textContent = prod.title;
        if (badgeElMedia) badgeElMedia.classList.add('hidden');
        if (quickDlBtn) quickDlBtn.classList.add('hidden');
      }
    };
  } else if (imgEl && fallbackEl) {
    imgEl.style.display = 'none';
    fallbackEl.style.display = 'flex';
    if (fallbackTitleEl && prod) fallbackTitleEl.textContent = prod.title;
    if (badgeElMedia) badgeElMedia.classList.add('hidden');
    if (quickDlBtn) quickDlBtn.classList.add('hidden');
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
    if (data.data?.notice) {
      showToast(data.data.notice);
    } else {
      showToast('✨ AI Ad visual generated via OpenAI!');
    }
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

async function downloadImageFile(url, filename = 'ad_creative.jpg') {
  if (!url) {
    showToast('No image URL available to download.', true);
    return;
  }

  try {
    showToast('Preparing image download...');
    // If base64 or blob URL, trigger instant direct download
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('Image downloaded successfully!');
      return;
    }

    // Try fetching image as blob for authentic browser download without opening external tab
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    showToast('Image downloaded successfully!');
  } catch (err) {
    console.warn('Direct blob fetch failed, falling back to direct anchor download:', err);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Opened image in tab for saving.');
  }
}

function downloadActiveAdImage() {
  const imgEl = document.getElementById('ad-mockup-img');
  const prod = adStudioState.selectedProduct;
  const prodFallback = prod ? getProductFallbackImageUrl(prod.category, prod.title) : '';
  const currentUrl = adStudioState.generatedImageUrl || (prod?.image_url && !prod.image_url.includes('example.com') ? prod.image_url : prodFallback) || (imgEl && imgEl.src);

  if (!currentUrl || (imgEl && imgEl.style.display === 'none')) {
    showToast('No image available to download. Please select a product or generate an AI visual first.', true);
    return;
  }

  const safeTitle = (prod?.title || 'ad_creative').toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
  const isPng = currentUrl.startsWith('data:image/png') || currentUrl.endsWith('.png');
  const ext = isPng ? 'png' : 'jpg';
  downloadImageFile(currentUrl, `${safeTitle}_creative.${ext}`);
}

function copyFullAdAction() {
  const current = adStudioState.variations[adStudioState.activeVariationIndex];
  if (!current) {
    showToast('Please generate ad copy first', true);
    return;
  }

  const fullText = `[HOOK / PATTERN INTERRUPT]\n${current.hook}\n\n[PRIMARY AD TEXT]\n${current.primary_text}\n\n[HEADLINE]\n${current.headline}\n\n[CALL TO ACTION]\n${current.cta}`;
  copyTextToClipboard(fullText, 'Full Ad Copy');
}

function copyElementTextAction(e) {
  const btn = e.currentTarget;
  const targetId = btn.getAttribute('data-target-text');
  const el = document.getElementById(targetId);
  if (el) {
    copyTextToClipboard(el.textContent.trim(), 'Ad Element');
  }
}

async function saveCurrentCreativeAction() {
  if (!state.activeStoreId) return;

  const current = adStudioState.variations[adStudioState.activeVariationIndex];
  if (!current) {
    showToast('Please generate ad copy first', true);
    return;
  }

  const prod = adStudioState.selectedProduct;
  const prodFallback = prod ? getProductFallbackImageUrl(prod.category, prod.title) : '';
  const mediaUrl = adStudioState.generatedImageUrl || (prod?.image_url && !prod.image_url.includes('example.com') ? prod.image_url : prodFallback) || '';

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
        productId: prod?.id,
        productTitle: prod?.title || 'Featured Product',
        platform: adStudioState.platform,
        objective: adStudioState.objective,
        hook: current.hook,
        primaryText: current.primary_text,
        headline: current.headline,
        cta: current.cta,
        imageUrl: mediaUrl
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(getErrorMessage(data, 'Failed to save creative'));
    }

    showToast('Saved to your creative library!');
    await loadSavedCreativesTable();
  } catch (err) {
    console.error('Failed to save creative:', err);
    showToast(err.message || 'Failed to save creative', true);
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

      const mediaFallback = getProductFallbackImageUrl('', c.product_title);
      const mediaUrl = (c.image_url && !c.image_url.includes('example.com')) ? c.image_url : mediaFallback;
      const mediaHtml = `<img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(c.product_title)}" class="saved-creative-thumb" onerror="this.onerror=null; this.src='${mediaFallback}';">`;

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td class="media-cell" style="width: 56px; min-width: 56px; max-width: 56px; padding: 8px 10px; vertical-align: middle;">${mediaHtml}</td>
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
            <button class="btn-sm btn-secondary btn-download-saved" data-url="${escapeHtml(mediaUrl)}" data-title="${escapeHtml(c.product_title || 'creative')}" style="margin-right: 6px;" title="Download Creative Image">⬇️ Image</button>
            <button class="btn-sm btn-secondary btn-copy-saved" data-id="${c.id}" style="margin-right: 6px;" title="Copy Full Ad">📋 Copy</button>
            <button class="btn-sm btn-secondary outline btn-delete-saved" data-id="${c.id}" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.4);" title="Delete Creative">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach download, copy & delete event handlers
    tbody.querySelectorAll('.btn-download-saved').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        const title = btn.getAttribute('data-title') || 'saved-creative';
        const safeTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
        downloadImageFile(url, `${safeTitle}_creative.jpg`);
      });
    });

    tbody.querySelectorAll('.btn-copy-saved').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const c = creatives.find(item => item.id === id);
        if (c) {
          const fullText = `[HOOK / PATTERN INTERRUPT]\n${c.hook}\n\n[PRIMARY AD TEXT]\n${c.primary_text}\n\n[HEADLINE]\n${c.headline}\n\n[CALL TO ACTION]\n${c.cta}`;
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

// =======================================================
// Phase 14: Auto Replenishment & Reorder Reminders Logic
// =======================================================

function setupReorderRemindersEventListeners() {
  const btnRunWorker = document.getElementById('btn-run-reorder-worker');
  if (btnRunWorker) {
    btnRunWorker.addEventListener('click', runReplenishmentWorkerNow);
  }

  const btnSaveChannels = document.getElementById('btn-save-rep-channels');
  if (btnSaveChannels) {
    btnSaveChannels.addEventListener('click', saveReplenishmentChannels);
  }

  const searchInput = document.getElementById('rep-product-search');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        loadReplenishableProducts(e.target.value);
      }, 300);
    });
  }

  const statusFilter = document.getElementById('rep-schedule-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      loadReplenishmentSchedules();
    });
  }
}

async function loadReorderRemindersData() {
  if (!state.activeStoreId) return;
  await Promise.all([
    loadReplenishmentAnalytics(),
    loadReplenishmentChannelSettings(),
    loadReplenishableProducts(),
    loadReplenishmentSchedules(),
  ]);
}

async function loadReplenishmentAnalytics() {
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/replenishment/analytics`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();

    const elActive = document.getElementById('stat-rep-active');
    const elUpcoming = document.getElementById('stat-rep-upcoming');
    const elSent = document.getElementById('stat-rep-sent');
    const elReordered = document.getElementById('stat-rep-reordered');
    const elConversion = document.getElementById('stat-rep-conversion');

    if (elActive) elActive.textContent = data.activeSchedules || 0;
    if (elUpcoming) elUpcoming.textContent = data.upcomingReminders || 0;
    if (elSent) elSent.textContent = data.remindersSent || 0;
    if (elReordered) elReordered.textContent = data.reordersCompleted || 0;
    if (elConversion) elConversion.textContent = `${data.conversionRate || 0}%`;
  } catch (err) {
    console.error('Failed to load replenishment analytics:', err);
  }
}

async function loadReplenishmentChannelSettings() {
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/replenishment/channel-settings`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();

    const elEmail = document.getElementById('rep-email-toggle');
    const elWa = document.getElementById('rep-whatsapp-toggle');
    const elDiscount = document.getElementById('rep-discount-code');

    if (elEmail) elEmail.checked = data.email_enabled ?? true;
    if (elWa) elWa.checked = data.whatsapp_enabled ?? false;
    if (elDiscount) elDiscount.value = data.discount_code || '';
  } catch (err) {
    console.error('Failed to load replenishment channel settings:', err);
  }
}

async function saveReplenishmentChannels() {
  const btn = document.getElementById('btn-save-rep-channels');
  if (btn) btn.disabled = true;

  try {
    const emailEnabled = document.getElementById('rep-email-toggle')?.checked ?? true;
    const whatsappEnabled = document.getElementById('rep-whatsapp-toggle')?.checked ?? false;
    const discountCode = document.getElementById('rep-discount-code')?.value?.trim() || '';

    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/replenishment/channel-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ emailEnabled, whatsappEnabled, discountCode })
    });

    if (!res.ok) throw new Error('Failed to save channel settings');
    showToast('Reorder channel settings saved successfully!');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadReplenishableProducts(search = '') {
  const tbody = document.getElementById('rep-products-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/replenishment/products`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();

    let list = data.products || [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => (p.title || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
    }

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 25px; color: var(--text-muted);">
            No products found matching your filter.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(p => {
      const isReplenishable = p.replenishment?.replenishable ? 'checked' : '';
      const cycleDays = p.replenishment?.cycle_days || 30;
      const reminderDays = p.replenishment?.reminder_days_before || 5;
      const priceFormatted = `${p.currency || 'GBP'} ${Number(p.price || 0).toFixed(2)}`;

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);" data-product-id="${p.id}">
          <td style="padding: 12px; font-weight: 600; color: var(--text-main);">
            <div style="display: flex; align-items: center; gap: 10px;">
              ${p.image_url ? `<img src="${escapeHtml(p.image_url)}" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;"/>` : ''}
              <span>${escapeHtml(p.title)}</span>
            </div>
          </td>
          <td style="padding: 12px; color: var(--text-muted); font-size: 13px;">${escapeHtml(p.category || 'General')}</td>
          <td style="padding: 12px; color: var(--text-main); font-weight: 600;">${priceFormatted}</td>
          <td style="padding: 12px; text-align: center;">
            <input type="checkbox" class="rep-prod-toggle" style="width: 18px; height: 18px; cursor: pointer;" ${isReplenishable}/>
          </td>
          <td style="padding: 12px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <input type="number" class="input-field rep-prod-cycle" value="${cycleDays}" min="1" max="365" style="width: 70px; padding: 4px 8px;"/>
              <span style="font-size: 12px; color: var(--text-muted);">days</span>
            </div>
          </td>
          <td style="padding: 12px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <input type="number" class="input-field rep-prod-reminder" value="${reminderDays}" min="0" max="90" style="width: 60px; padding: 4px 8px;"/>
              <span style="font-size: 12px; color: var(--text-muted);">days before</span>
            </div>
          </td>
          <td style="padding: 12px; text-align: right;">
            <button class="btn-sm btn-primary btn-save-product-rep" style="padding: 5px 12px; font-size: 12px;">Save</button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row save listeners
    tbody.querySelectorAll('.btn-save-product-rep').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tr = e.target.closest('tr');
        const productId = tr.getAttribute('data-product-id');
        const replenishable = tr.querySelector('.rep-prod-toggle')?.checked ?? false;
        const cycleDays = parseInt(tr.querySelector('.rep-prod-cycle')?.value, 10) || 30;
        const reminderDays = parseInt(tr.querySelector('.rep-prod-reminder')?.value, 10) || 5;

        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
          const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/replenishment/products/${productId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ replenishable, cycleDays, reminderDaysBefore: reminderDays })
          });
          const resData = await res.json();
          if (!res.ok) throw new Error(resData.error || 'Failed to update product');
          showToast('Product replenishment settings saved!');
        } catch (err) {
          showToast(err.message, true);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save';
        }
      });
    });
  } catch (err) {
    console.error('Failed to load replenishable products:', err);
  }
}

async function loadReplenishmentSchedules() {
  const tbody = document.getElementById('rep-schedules-tbody');
  if (!tbody) return;

  try {
    const status = document.getElementById('rep-schedule-status-filter')?.value || '';
    const queryUrl = status
      ? `/api/v1/dashboard/${state.activeStoreId}/replenishment/schedules?status=${status}`
      : `/api/v1/dashboard/${state.activeStoreId}/replenishment/schedules`;

    const res = await fetch(queryUrl, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();

    const schedules = data.schedules || [];
    if (schedules.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 25px; color: var(--text-muted);">
            No replenishment schedules found.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = schedules.map(s => {
      const customerStr = s.customer_email ? escapeHtml(s.customer_email) : (s.customer_phone ? escapeHtml(s.customer_phone) : 'Anonymous');
      const purchasedDate = s.purchased_at ? new Date(s.purchased_at).toLocaleDateString() : '--';
      const expectedDate = s.expected_reorder_at ? new Date(s.expected_reorder_at).toLocaleDateString() : '--';
      const reminderDate = s.reminder_at ? new Date(s.reminder_at).toLocaleDateString() : '--';

      let statusBadge = '<span class="status-badge"><span class="dot"></span> Pending</span>';
      if (s.status === 'sent') {
        statusBadge = '<span class="status-badge" style="color:#10b981;"><span class="dot active"></span> Sent</span>';
      } else if (s.status === 'repurchased') {
        statusBadge = '<span class="status-badge" style="color:#3b82f6;"><span class="dot" style="background:#3b82f6;"></span> Repurchased</span>';
      } else if (s.status === 'cancelled') {
        statusBadge = '<span class="status-badge" style="color:#ef4444;"><span class="dot inactive"></span> Cancelled</span>';
      }

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 12px; font-weight: 500; color: var(--text-main); font-family: var(--font-mono); font-size: 13px;">${customerStr}</td>
          <td style="padding: 12px; color: var(--text-muted); font-size: 12px;">#${escapeHtml(s.order_number || s.order_id)}</td>
          <td style="padding: 12px; color: var(--text-main); font-weight: 500;">${escapeHtml(s.product_title)}</td>
          <td style="padding: 12px; font-size: 12px; color: var(--text-muted);">${purchasedDate}</td>
          <td style="padding: 12px; font-size: 12px; color: var(--text-main);">${s.cycle_days}d</td>
          <td style="padding: 12px; font-size: 12px; color: var(--text-muted);">${expectedDate}</td>
          <td style="padding: 12px; font-size: 12px; color: var(--warning); font-weight: 500;">${reminderDate}</td>
          <td style="padding: 12px;">${statusBadge}</td>
          <td style="padding: 12px; font-size: 12px; color: var(--text-muted); text-transform: capitalize;">${escapeHtml(s.sent_channel || s.channel || 'email')}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load replenishment schedules:', err);
  }
}

async function runReplenishmentWorkerNow() {
  const btn = document.getElementById('btn-run-reorder-worker');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Processing...';
  }

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/replenishment/process-due`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to process reminders');

    const d = data.data || {};
    showToast(`Worker processed ${d.processed || 0} schedules (${d.sent || 0} sent, ${d.suppressed || 0} suppressed, ${d.cancelled || 0} skipped).`);

    await Promise.all([
      loadReplenishmentAnalytics(),
      loadReplenishmentSchedules(),
    ]);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">⚡</span> Run Due Reminders Now';
    }
  }
}

// ==========================================
// Phase 15: Multi-Touch Ad Intelligence & Attribution Engine
// ==========================================

let attributionState = {
  activeModel: 'last_touch',
  fromDate: '',
  toDate: '',
};

function setupAdIntelligenceEventListeners() {
  // 1. Model Switcher buttons
  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const model = btn.getAttribute('data-model');
      if (!model || model === attributionState.activeModel) return;

      attributionState.activeModel = model;

      // Update UI active states
      document.querySelectorAll('.model-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted)';
      });
      btn.classList.add('active');
      btn.style.background = 'var(--primary, #6366f1)';
      btn.style.color = '#fff';

      // Update explanatory pill
      const explEl = document.getElementById('attr-model-explanation');
      const modelLabelEl = document.getElementById('attr-stat-model-label');

      if (model === 'first_touch') {
        if (explEl) explEl.innerHTML = '✨ <strong>First-Touch</strong>: Attributes 100% of order revenue to the earliest discovery ad click or campaign touchpoint.';
        if (modelLabelEl) modelLabelEl.textContent = 'Via First-Touch model';
      } else if (model === 'linear') {
        if (explEl) explEl.innerHTML = '✨ <strong>Linear Multi-Touch</strong>: Distributes order revenue evenly (1/N) across all touchpoints in the customer journey.';
        if (modelLabelEl) modelLabelEl.textContent = 'Via Linear Multi-Touch model';
      } else {
        if (explEl) explEl.innerHTML = '✨ <strong>Last-Touch</strong>: Attributes 100% of order revenue to the latest marketing touchpoint prior to checkout.';
        if (modelLabelEl) modelLabelEl.textContent = 'Via Last-Touch model';
      }

      // Reload attribution views with the selected model
      await Promise.all([
        loadAttributionOverview(),
        loadChannelPerformance(),
        loadCampaignPerformance(),
      ]);
    });
  });

  // 2. Ad Spend Modal controls
  const openSpendBtn = document.getElementById('btn-open-ad-spend-modal');
  const closeSpendBtn = document.getElementById('close-ad-spend-modal');
  const spendModal = document.getElementById('ad-spend-modal');

  if (openSpendBtn && spendModal) {
    openSpendBtn.addEventListener('click', () => {
      const dateInput = document.getElementById('spend-date');
      if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
      }
      spendModal.classList.remove('hidden');
      loadAdSpendList();
    });
  }

  if (closeSpendBtn && spendModal) {
    closeSpendBtn.addEventListener('click', () => {
      spendModal.classList.add('hidden');
    });
  }

  // 3. Ad Spend Form Submit
  const spendForm = document.getElementById('ad-spend-form');
  if (spendForm) {
    spendForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-spend');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }

      try {
        const spendDate = document.getElementById('spend-date')?.value;
        const platform = document.getElementById('spend-platform')?.value;
        const campaign = document.getElementById('spend-campaign')?.value;
        const spendAmount = parseFloat(document.getElementById('spend-amount')?.value || '0');
        const notes = document.getElementById('spend-notes')?.value || '';

        const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/attribution/spend`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.token}`
          },
          body: JSON.stringify({ spendDate, platform, campaign, spendAmount, notes })
        });

        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || 'Failed to save ad spend');

        showToast('Ad spend entry saved successfully!');
        document.getElementById('spend-amount').value = '';
        document.getElementById('spend-notes').value = '';

        await Promise.all([
          loadAdSpendList(),
          loadAttributionOverview(),
          loadChannelPerformance(),
          loadCampaignPerformance(),
        ]);
      } catch (err) {
        showToast(err.message, true);
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Spend Entry';
        }
      }
    });
  }

  // 4. Customer Journey Modal Close
  const closeJourneyBtn = document.getElementById('close-journey-modal');
  const journeyModal = document.getElementById('customer-journey-modal');
  if (closeJourneyBtn && journeyModal) {
    closeJourneyBtn.addEventListener('click', () => {
      journeyModal.classList.add('hidden');
    });
  }
}

async function loadAdIntelligenceData() {
  await Promise.all([
    loadAttributionOverview(),
    loadChannelPerformance(),
    loadCampaignPerformance(),
    loadAttributedOrders(),
  ]);
}

async function loadAttributionOverview() {
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/attribution/overview?model=${attributionState.activeModel}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();

    const curr = data.currency || 'GBP';
    const sym = curr === 'GBP' ? '£' : (curr === 'USD' ? '$' : (curr === 'INR' ? '₹' : curr + ' '));

    const spendEl = document.getElementById('attr-stat-spend');
    const revEl = document.getElementById('attr-stat-revenue');
    const roasEl = document.getElementById('attr-stat-roas');
    const ordersEl = document.getElementById('attr-stat-orders');
    const aiRevEl = document.getElementById('attr-stat-ai-rev');

    if (spendEl) spendEl.textContent = `${sym}${Number(data.total_spend || 0).toFixed(2)}`;
    if (revEl) revEl.textContent = `${sym}${Number(data.attributed_revenue || 0).toFixed(2)}`;
    if (roasEl) {
      roasEl.textContent = `${Number(data.roas || 0).toFixed(2)}x`;
      roasEl.style.color = data.roas >= 3.0 ? '#10b981' : (data.roas >= 1.0 ? '#6366f1' : '#f59e0b');
    }
    if (ordersEl) ordersEl.textContent = String(data.total_orders || 0);
    if (aiRevEl) aiRevEl.textContent = `${sym}${Number(data.ai_assisted_revenue || 0).toFixed(2)}`;
  } catch (err) {
    console.error('Failed to load attribution overview:', err);
  }
}

async function loadChannelPerformance() {
  const tbody = document.getElementById('attr-channels-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/attribution/channels?model=${attributionState.activeModel}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();
    const channels = data.channels || [];

    if (channels.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 25px; color: var(--text-muted);">
            No channel attribution recorded yet.
          </td>
        </tr>
      `;
      return;
    }

    const platformIcons = {
      'facebook': '🟦 Meta Ads',
      'instagram': '🟪 Instagram',
      'google': '🔴 Google Ads',
      'tiktok': '⬛ TikTok Ads',
      'email': '✉️ Email Marketing',
      'direct': '🌐 Direct / Storefront',
      'other': '🔗 Other / Referral'
    };

    tbody.innerHTML = channels.map(ch => {
      const label = platformIcons[ch.channel.toLowerCase()] || `📢 ${escapeHtml(ch.channel)}`;
      const roasColor = ch.roas >= 3.0 ? '#10b981' : (ch.roas >= 1.0 ? '#6366f1' : 'var(--text-muted)');

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 12px; font-weight: 600; color: var(--text-main);">${label}</td>
          <td style="padding: 12px; color: #f59e0b; font-weight: 500;">${getCurrencySymbol(state.activeStoreCurrency)}${Number(ch.spend).toFixed(2)}</td>
          <td style="padding: 12px; color: var(--text-main); font-weight: 500;">${ch.orders}</td>
          <td style="padding: 12px; color: #10b981; font-weight: 600;">${getCurrencySymbol(state.activeStoreCurrency)}${Number(ch.attributed_revenue).toFixed(2)}</td>
          <td style="padding: 12px;">
            <span style="font-weight: 700; color: ${roasColor}; background: rgba(255,255,255,0.05); padding: 4px 10px; border-radius: 6px;">
              ${Number(ch.roas).toFixed(2)}x
            </span>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load channel performance:', err);
  }
}

async function loadCampaignPerformance() {
  const tbody = document.getElementById('attr-campaigns-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/attribution/campaigns?model=${attributionState.activeModel}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();
    const campaigns = data.campaigns || [];

    if (campaigns.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 25px; color: var(--text-muted);">
            No campaign attribution data recorded yet.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = campaigns.map(c => {
      const roasColor = c.roas >= 3.0 ? '#10b981' : (c.roas >= 1.0 ? '#6366f1' : 'var(--text-muted)');

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 12px; font-weight: 600; color: var(--text-main);">${escapeHtml(c.campaign)}</td>
          <td style="padding: 12px; color: var(--text-muted); font-size: 13px; text-transform: capitalize;">${escapeHtml(c.source)}</td>
          <td style="padding: 12px; color: #f59e0b; font-weight: 500;">${getCurrencySymbol(state.activeStoreCurrency)}${Number(c.spend).toFixed(2)}</td>
          <td style="padding: 12px; color: var(--text-main); font-weight: 500;">${c.orders}</td>
          <td style="padding: 12px; color: #10b981; font-weight: 600;">${getCurrencySymbol(state.activeStoreCurrency)}${Number(c.attributed_revenue).toFixed(2)}</td>
          <td style="padding: 12px;">
            <span style="font-weight: 700; color: ${roasColor}; background: rgba(255,255,255,0.05); padding: 4px 10px; border-radius: 6px;">
              ${Number(c.roas).toFixed(2)}x
            </span>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load campaign performance:', err);
  }
}

async function loadAttributedOrders() {
  const tbody = document.getElementById('attr-orders-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/overview`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;

    // Fetch list of recent orders from events
    const eventsRes = await fetch(`/api/v1/dashboard/${state.activeStoreId}/live/activity?limit=20`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!eventsRes.ok) return;
    const eventsData = await eventsRes.json();
    const purchaseEvents = (eventsData.data?.feed || []).filter(item => item.type === 'purchase_completed');

    if (purchaseEvents.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 25px; color: var(--text-muted);">
            No connected purchases yet. When customers buy from Shopify, their multi-touch attribution journeys will appear here.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = purchaseEvents.map(p => {
      const orderId = p.metadata?.order_id || p.id;
      const orderNum = p.metadata?.order_number ? `#${p.metadata.order_number}` : 'Order';
      const rev = p.metadata?.total_price ? `${getCurrencySymbol(state.activeStoreCurrency)}${Number(p.metadata.total_price).toFixed(2)}` : '--';
      const firstTouch = p.metadata?.utm_source || 'direct';
      const lastTouch = p.metadata?.utm_campaign || 'storefront';
      const isAi = p.metadata?.session_id ? '✨ Yes' : 'No';

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 12px; font-weight: 600; color: var(--text-main); font-family: var(--font-mono);">${orderNum}</td>
          <td style="padding: 12px; color: #10b981; font-weight: 600;">${rev}</td>
          <td style="padding: 12px; color: var(--text-main); text-transform: capitalize;">${escapeHtml(firstTouch)}</td>
          <td style="padding: 12px; color: var(--text-muted);">${escapeHtml(lastTouch)}</td>
          <td style="padding: 12px;">${isAi}</td>
          <td style="padding: 12px; color: var(--text-muted);">Connected</td>
          <td style="padding: 12px;">
            <button class="btn-secondary btn-sm" onclick="openCustomerJourneyModal('${orderId}')" style="padding: 4px 10px; font-size: 12px;">
              View Journey 🔍
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load attributed orders:', err);
  }
}

window.openCustomerJourneyModal = async function(orderId) {
  const modal = document.getElementById('customer-journey-modal');
  const titleEl = document.getElementById('journey-modal-title');
  const metaEl = document.getElementById('journey-modal-meta');
  const timelineEl = document.getElementById('journey-timeline-container');

  if (!modal || !timelineEl) return;

  modal.classList.remove('hidden');
  timelineEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">Loading customer journey timeline...</div>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/attribution/journey/${orderId}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Customer journey not found');
    const { data } = await res.json();

    if (titleEl) {
      titleEl.textContent = `Customer Journey: #${data.order_number || data.order_id}`;
    }

    if (metaEl) {
      metaEl.innerHTML = `
        <div><strong>Revenue:</strong> ${getCurrencySymbol(state.activeStoreCurrency)}${Number(data.order_revenue).toFixed(2)}</div>
        <div><strong>First Touch:</strong> ${escapeHtml(data.first_touch.source)} (${escapeHtml(data.first_touch.campaign)})</div>
        <div><strong>Last Touch:</strong> ${escapeHtml(data.last_touch.source)} (${escapeHtml(data.last_touch.campaign)})</div>
        <div><strong>AI-Assisted:</strong> ${data.is_ai_assisted ? '✨ Yes (' + getCurrencySymbol(state.activeStoreCurrency) + Number(data.ai_assisted_revenue).toFixed(2) + ')' : 'No'}</div>
      `;
    }

    const timeline = data.timeline || [];
    if (timeline.length === 0) {
      timelineEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">No journey events recorded.</div>';
      return;
    }

    const iconMap = {
      'touchpoint': '📢',
      'ai_session': '🤖',
      'cart_add': '🛒',
      'order': '🎉'
    };

    timelineEl.innerHTML = timeline.map((step, idx) => {
      const icon = iconMap[step.type] || '📍';
      const timeStr = new Date(step.timestamp).toLocaleString();
      const isLast = idx === timeline.length - 1;
      const borderLeft = isLast ? 'none' : '2px solid rgba(255,255,255,0.15)';

      return `
        <div style="display: flex; gap: 14px; position: relative;">
          <div style="display: flex; flex-direction: column; align-items: center;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: rgba(99, 102, 241, 0.2); border: 1px solid #6366f1; display: flex; align-items: center; justify-content: center; font-size: 14px; z-index: 2;">
              ${icon}
            </div>
            <div style="flex: 1; width: 2px; background: ${borderLeft}; min-height: 24px; margin: 4px 0;"></div>
          </div>
          <div style="padding-bottom: 20px; flex: 1;">
            <div style="font-weight: 600; color: var(--text-main); font-size: 14px;">${escapeHtml(step.title)}</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(step.subtitle)}</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 4px; font-family: var(--font-mono);">${timeStr}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    timelineEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">${err.message}</div>`;
  }
};

async function loadAdSpendList() {
  const tbody = document.getElementById('ad-spend-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/attribution/spend`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();
    const spendItems = data.spend || [];

    if (spendItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">
            No spend entries recorded yet.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = spendItems.map(s => {
      const dateStr = s.spend_date ? new Date(s.spend_date).toLocaleDateString() : '--';
      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 8px;">${dateStr}</td>
          <td style="padding: 8px; text-transform: capitalize;">${escapeHtml(s.platform)}</td>
          <td style="padding: 8px;">${escapeHtml(s.campaign)}</td>
          <td style="padding: 8px; font-weight: 600; color: #f59e0b;">${getCurrencySymbol(state.activeStoreCurrency)}${Number(s.spend_amount).toFixed(2)}</td>
          <td style="padding: 8px;">
            <button class="btn-secondary" onclick="deleteAdSpendEntry('${s.id}')" style="padding: 2px 8px; font-size: 11px; color: #ef4444; border-color: rgba(239,68,68,0.3);">
              Delete
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load ad spend list:', err);
  }
}

window.deleteAdSpendEntry = async function(id) {
  if (!confirm('Are you sure you want to delete this spend entry?')) return;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/attribution/spend/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to delete spend entry');
    showToast('Spend entry deleted');

    await Promise.all([
      loadAdSpendList(),
      loadAttributionOverview(),
      loadChannelPerformance(),
      loadCampaignPerformance(),
    ]);
  } catch (err) {
    showToast(err.message, true);
  }
};

// ============================================================
// Phase 16: AI Merchant Growth Copilot & Action Center Handlers
// ============================================================

async function loadGrowthCopilotData() {
  if (!state.activeStoreId) return;

  try {
    const [overviewRes, actionsRes, goalRes, summaryRes, historyRes] = await Promise.all([
      fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/overview`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      }),
      fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/actions`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      }),
      fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/goal`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      }),
      fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/weekly-summary`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      }),
      fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/history`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      }),
    ]);

    // 1. Overview KPIs
    if (overviewRes.ok) {
      const { data: o } = await overviewRes.json();
      if (o.currency) {
        state.activeStoreCurrency = o.currency;
      }
      const sym = getCurrencySymbol(o.currency || state.activeStoreCurrency);
      const oppEl = document.getElementById('copilot-estimated-opp');
      const revEl = document.getElementById('copilot-revenue');
      const ordersEl = document.getElementById('copilot-orders');
      const roasEl = document.getElementById('copilot-roas');
      const spendEl = document.getElementById('copilot-spend');
      const convEl = document.getElementById('copilot-conv-rate');
      const aiRevEl = document.getElementById('copilot-ai-revenue');

      if (oppEl) oppEl.textContent = `+${sym}${Number(o.estimated_growth_opportunity || 0).toFixed(2)}`;
      if (revEl) revEl.textContent = `${sym}${Number(o.total_revenue || 0).toFixed(2)}`;
      if (ordersEl) ordersEl.textContent = `${o.total_orders || 0} orders (AOV: ${sym}${Number(o.average_order_value || 0).toFixed(2)})`;
      if (roasEl) roasEl.textContent = `${Number(o.blended_roas || 0).toFixed(2)}x`;
      if (spendEl) spendEl.textContent = `on ${sym}${Number(o.total_ad_spend || 0).toFixed(2)} spend`;
      if (convEl) convEl.textContent = `${Number(o.conversion_rate || 0).toFixed(1)}%`;
      if (aiRevEl) aiRevEl.textContent = `${sym}${Number(o.ai_assisted_revenue || 0).toFixed(2)}`;
    }

    // 2. Merchant Goal
    if (goalRes.ok) {
      const { data: g } = await goalRes.json();
      const goalSelect = document.getElementById('merchant-goal-select');
      if (goalSelect && g?.primary_goal) {
        goalSelect.value = g.primary_goal;
      }
    }

    // 3. Growth Actions
    if (actionsRes.ok) {
      const { data: actions } = await actionsRes.json();
      const actionsContainer = document.getElementById('copilot-actions-container');
      const countEl = document.getElementById('copilot-actions-count');

      const activeActions = (actions || []).filter(a => a.status === 'pending' || a.status === 'in_progress');
      if (countEl) countEl.textContent = `${activeActions.length} Action${activeActions.length === 1 ? '' : 's'}`;

      if (actionsContainer) {
        if (activeActions.length === 0) {
          actionsContainer.innerHTML = `
            <div style="text-align: center; padding: 24px; color: var(--text-muted); background: rgba(0,0,0,0.15); border-radius: 8px;">
              <span style="font-size: 24px;">✨</span>
              <p style="margin: 8px 0 0 0; font-weight: 500;">All growth signals healthy! No immediate critical actions required.</p>
            </div>
          `;
        } else {
          const priorityColors = {
            critical: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.4)' },
            high: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.4)' },
            medium: { bg: 'rgba(99, 102, 241, 0.15)', text: '#818cf8', border: 'rgba(99, 102, 241, 0.4)' },
            low: { bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8', border: 'rgba(100, 116, 139, 0.4)' }
          };

          const actSym = getCurrencySymbol(state.activeStoreCurrency);
          actionsContainer.innerHTML = activeActions.map(action => {
            const colors = priorityColors[action.priority] || priorityColors.medium;
            const oppBadge = Number(action.estimated_opportunity) > 0
              ? `<span style="font-size: 11px; padding: 3px 8px; border-radius: 4px; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">+${actSym}${Number(action.estimated_opportunity).toFixed(2)} Potential</span>`
              : '';

            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); gap: 16px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 260px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: ${colors.bg}; color: ${colors.text}; border: 1px solid ${colors.border};">
                      ${action.priority}
                    </span>
                    <strong style="color: var(--text-main); font-size: 14px;">${escapeHtml(action.title)}</strong>
                    ${oppBadge}
                  </div>
                  <p style="margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.4;">${escapeHtml(action.reason)}</p>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <button class="btn-primary btn-sm" onclick="executeGrowthAction('${action.id}', '${action.target_module}', '${action.target_id || ''}')" style="padding: 6px 12px; font-size: 12px;">
                    Open ${escapeHtml(action.target_module.replace('-', ' '))} ➔
                  </button>
                  <button class="btn-secondary btn-sm" onclick="dismissGrowthAction('${action.id}')" style="padding: 6px 10px; font-size: 12px; color: var(--text-muted);">
                    Dismiss
                  </button>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }

    // 4. Weekly Summary
    if (summaryRes.ok) {
      const { data: s } = await summaryRes.json();
      const revEl = document.getElementById('summary-rev');
      const ordersEl = document.getElementById('summary-orders');
      const roasEl = document.getElementById('summary-roas');
      const convEl = document.getElementById('summary-conv');
      const whatChangedEl = document.getElementById('copilot-what-changed');

      const sumSym = getCurrencySymbol(s.metrics?.currency || state.activeStoreCurrency);
      if (revEl) revEl.textContent = `${sumSym}${Number(s.metrics?.revenue || 0).toFixed(2)}`;
      if (ordersEl) ordersEl.textContent = `${s.metrics?.orders || 0}`;
      if (roasEl) roasEl.textContent = `${Number(s.metrics?.roas || 0).toFixed(2)}x`;
      if (convEl) convEl.textContent = `${Number(s.metrics?.conversion_rate || 0).toFixed(1)}%`;

      if (whatChangedEl && Array.isArray(s.what_changed)) {
        whatChangedEl.innerHTML = s.what_changed.length > 0
          ? s.what_changed.map(item => `<li>${escapeHtml(item)}</li>`).join('')
          : '<li>Telemetry steady across storefront channels.</li>';
      }
    }

    // 5. Action History Table
    if (historyRes.ok) {
      const { data: history } = await historyRes.json();
      const tbody = document.getElementById('copilot-history-tbody');
      if (tbody) {
        if (!history || history.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">No action history recorded yet.</td></tr>`;
        } else {
          tbody.innerHTML = history.map(h => `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
              <td style="padding: 8px;">${new Date(h.created_at).toLocaleDateString()}</td>
              <td style="padding: 8px; font-weight: 500;">${escapeHtml(h.action_key)}</td>
              <td style="padding: 8px; color: var(--text-muted);">${escapeHtml(h.action_type)}</td>
              <td style="padding: 8px;"><span class="badge">${escapeHtml(h.status)}</span></td>
              <td style="padding: 8px; color: var(--text-muted);">${escapeHtml(h.notes || '--')}</td>
            </tr>
          `).join('');
        }
      }
    }
  } catch (err) {
    console.error('Failed to load growth copilot data:', err);
  }
}

window.executeGrowthAction = async function(actionId, targetModule, _targetId) {
  try {
    await fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/actions/${actionId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ status: 'in_progress', notes: `Action initiated: navigated to ${targetModule}` })
    });
  } catch (_) {}

  const navLink = document.querySelector(`.nav-links a[data-target="${targetModule}"]`);
  if (navLink) {
    document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
    navLink.classList.add('active');
    showSection(targetModule);
    loadSectionData(targetModule);
    showToast(`Navigating to ${targetModule.replace('-', ' ')} ➔`);
  }
};

window.dismissGrowthAction = async function(actionId) {
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/actions/${actionId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ status: 'dismissed', notes: 'Dismissed by merchant' })
    });
    if (!res.ok) throw new Error('Failed to dismiss action');
    showToast('Action dismissed');
    await loadGrowthCopilotData();
  } catch (err) {
    showToast(err.message, true);
  }
};

async function askGrowthCopilotAi() {
  const box = document.getElementById('copilot-ai-explanation-box');
  const takeaways = document.getElementById('copilot-ai-takeaways');
  const btn = document.getElementById('copilot-ask-ai-btn');

  if (box) box.innerHTML = '<span style="color:var(--text-muted);">Analyzing store telemetry and verified growth signals...</span>';
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/explain`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      }
    });
    if (!res.ok) throw new Error('Failed to generate AI explanation');
    const { data } = await res.json();

    if (box && data?.explanation) {
      box.textContent = data.explanation;
    }
    if (takeaways && Array.isArray(data?.key_takeaways)) {
      takeaways.innerHTML = data.key_takeaways.map(t => `<li>${escapeHtml(t)}</li>`).join('');
    }
  } catch (err) {
    if (box) box.innerHTML = `<span style="color:#ef4444;">${escapeHtml(err.message)}</span>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Wire Event Listeners for Growth Copilot
document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refresh-growth-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      showToast('Refreshing growth copilot...');
      loadGrowthCopilotData();
    });
  }

  const goalSelect = document.getElementById('merchant-goal-select');
  if (goalSelect) {
    goalSelect.addEventListener('change', async (e) => {
      const newGoal = e.target.value;
      try {
        const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/goal`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.token}`
          },
          body: JSON.stringify({ primary_goal: newGoal })
        });
        if (!res.ok) throw new Error('Failed to update primary goal');
        showToast('Primary goal updated & actions re-prioritized!');
        await loadGrowthCopilotData();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }

  const askAiBtn = document.getElementById('copilot-ask-ai-btn');
  if (askAiBtn) {
    askAiBtn.addEventListener('click', openCopilotAskModal);
  }

  // Phase 17 Event Listeners
  setupAiIntelligenceListeners();
});

// =========================================================================
// PHASE 17: AI INTELLIGENCE LAYER & MERCHANT ANALYTICS MODULE
// =========================================================================

const NAV_FEATURE_MAP = {
  'growth-copilot': 'growth_copilot',
  'overview': 'overview',
  'live-analytics': 'live_pulse',
  'my-agent': 'widget',
  'leads-optins': 'leads',
  'widget-settings': 'widget',
  'shopify-connection': 'catalogue',
  'ad-creative-studio': 'ad_creative',
  'whatsapp-growth': 'whatsapp',
  'email-automation': 'email_automation',
  'reorder-reminders': 'smart_reorder',
  'ad-intelligence': 'ad_intelligence',
  'meta-ads': 'ad_intelligence',
  'ads-explorer': 'ad_intelligence',
  'ai-agent': 'growth_copilot',
};

async function fetchStoreFeatures() {
  if (!state.activeStoreId) return;
  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/features`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const json = await res.json();
    state.features = json.data?.features || {};
    if (json.data?.currency) {
      state.activeStoreCurrency = json.data.currency;
      const curSelect = document.getElementById('store-currency-select');
      if (curSelect) curSelect.value = json.data.currency;
    }

    // Hide or show nav links based on entitlements
    document.querySelectorAll('.nav-links li').forEach(li => {
      const a = li.querySelector('a');
      if (!a) return;
      const target = a.getAttribute('data-target');
      const featKey = NAV_FEATURE_MAP[target];
      if (featKey && state.features[featKey] === false) {
        li.style.display = 'none';
      } else {
        li.style.display = '';
      }
    });

    // If currently active tab is disabled, redirect to first visible
    const activeLink = document.querySelector('.nav-links a.active');
    if (activeLink) {
      const curTarget = activeLink.getAttribute('data-target');
      const curFeat = NAV_FEATURE_MAP[curTarget];
      if (curFeat && state.features[curFeat] === false) {
        const firstVisible = Array.from(document.querySelectorAll('.nav-links li'))
          .find(li => li.style.display !== 'none')
          ?.querySelector('a');
        if (firstVisible) {
          firstVisible.click();
        }
      }
    }
  } catch (err) {
    console.warn('Could not fetch store feature entitlements', err);
  }
}

window.copyText = function(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const val = el.value || el.textContent;
  navigator.clipboard.writeText(val).then(() => {
    showToast('Copied to clipboard!');
  }).catch(() => {
    showToast('Failed to copy text', true);
  });
};

// 1. Overview AI Store Insights
async function loadOverviewInsights(forceRefresh = false) {
  const happeningEl = document.getElementById('overview-ai-happening');
  const whyEl = document.getElementById('overview-ai-why');
  const actionsEl = document.getElementById('overview-ai-actions');
  if (!happeningEl || !whyEl || !actionsEl || !state.activeStoreId) return;

  if (forceRefresh) {
    happeningEl.textContent = 'Refreshing store insights...';
    whyEl.textContent = 'Re-analyzing store telemetry...';
  }

  try {
    const url = `/api/v1/dashboard/${state.activeStoreId}/ai/overview-insights${forceRefresh ? '?refresh=true' : ''}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();

    if (data?.what_is_happening) happeningEl.textContent = data.what_is_happening;
    if (data?.why_it_is_happening) whyEl.textContent = data.why_it_is_happening;
    if (Array.isArray(data?.top_recommended_actions)) {
      actionsEl.innerHTML = data.top_recommended_actions.map(action => `
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
          <div>
            <div style="font-weight: 500; font-size: 13px; color: var(--text-main);">${escapeHtml(action.title)}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(action.why)}</div>
          </div>
          <button class="btn-secondary btn-sm" style="font-size: 11px; padding: 4px 10px;" onclick="window.navigateToModule('${action.target_module}')">Go →</button>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading overview insights:', err);
  }
}

window.navigateToModule = function(moduleName) {
  const targetMap = {
    'funnel': 'live-analytics',
    'catalogue': 'shopify-connection',
    'ad_creative': 'ad-creative-studio',
    'whatsapp': 'whatsapp-growth',
    'email': 'email-automation',
    'replenishment': 'reorder-reminders',
    'attribution': 'ad-intelligence',
    'growth': 'growth-copilot',
  };
  const target = targetMap[moduleName] || moduleName;
  const link = document.querySelector(`.nav-links a[data-target="${target}"]`);
  if (link && link.closest('li').style.display !== 'none') {
    link.click();
  } else {
    showToast(`Navigated to ${moduleName}`);
  }
};

// 2. Full AI Store Audit
async function openStoreAuditModal() {
  const modal = document.getElementById('store-audit-modal');
  if (!modal || !state.activeStoreId) return;
  modal.classList.remove('hidden');

  const summaryEl = document.getElementById('audit-summary-text');
  const frictionList = document.getElementById('audit-friction-list');
  const recList = document.getElementById('audit-rec-list');
  summaryEl.textContent = 'Running comprehensive multi-vector AI audit (Conversion, Catalog, Traffic, Retention)...';
  frictionList.innerHTML = '<li>Analyzing potential bottlenecks...</li>';
  recList.innerHTML = '<div>Evaluating optimization roadmap...</div>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ai/store-analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ forceRefresh: true })
    });
    if (!res.ok) throw new Error(`Failed to run store audit (HTTP ${res.status})`);
    const { data } = await res.json();

    // Backend StoreAnalysisSchema fields: health_score, summary, strengths,
    // problems, opportunities, priority_actions, catalogue_issues,
    // conversion_issues, marketing_issues, revenue_opportunities.
    const healthScore = typeof data.health_score === 'number' ? data.health_score : null;
    document.getElementById('audit-overall-score').textContent = healthScore !== null ? `${healthScore}/100` : 'N/A';

    const convIssues = Array.isArray(data.conversion_issues) ? data.conversion_issues : [];
    const catalogueIssues = Array.isArray(data.catalogue_issues) ? data.catalogue_issues : [];
    const marketingIssues = Array.isArray(data.marketing_issues) ? data.marketing_issues : [];
    const problems = Array.isArray(data.problems) ? data.problems : [];

    document.getElementById('audit-conv-score').textContent = `${convIssues.length}`;
    document.getElementById('audit-listing-score').textContent = `${catalogueIssues.length}`;
    document.getElementById('audit-ad-score').textContent = `${marketingIssues.length}`;

    summaryEl.textContent = data.summary || 'No summary available.';

    const frictionPoints = [...problems, ...convIssues, ...catalogueIssues, ...marketingIssues];
    frictionList.innerHTML = frictionPoints.length
      ? frictionPoints.map(f => `<li>${escapeHtml(String(f))}</li>`).join('')
      : '<li>No friction points detected.</li>';

    const priorityActions = Array.isArray(data.priority_actions) ? data.priority_actions : [];
    const opportunities = Array.isArray(data.opportunities) ? data.opportunities : [];
    const revenueOpps = Array.isArray(data.revenue_opportunities) ? data.revenue_opportunities : [];

    const cards = [];
    priorityActions.forEach((a, i) => {
      cards.push(`
        <div style="background: rgba(255,255,255,0.03); padding: 10px 14px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong style="font-size: 13px; color: #34d399;">Step ${i + 1}: ${escapeHtml(a.title || 'Recommended action')}</strong>
            <span class="badge" style="font-size: 10px; text-transform: uppercase;">${escapeHtml(a.impact || a.priority || '')}</span>
          </div>
          <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(a.explanation || '')}</div>
          ${a.suggested_action ? `<div style="font-size: 11px; color: #818cf8; margin-top: 2px;">Next: ${escapeHtml(a.suggested_action)}</div>` : ''}
          ${a.supporting_metric ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Metric: ${escapeHtml(a.supporting_metric)}</div>` : ''}
        </div>`);
    });
    opportunities.forEach(o => {
      cards.push(`
        <div style="background: rgba(255,255,255,0.03); padding: 10px 14px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 6px;">
          <strong style="font-size: 13px; color: #34d399;">Opportunity</strong>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(String(o))}</div>
        </div>`);
    });
    revenueOpps.forEach(o => {
      cards.push(`
        <div style="background: rgba(255,255,255,0.03); padding: 10px 14px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong style="font-size: 13px; color: #34d399;">${escapeHtml(o.title || 'Revenue opportunity')}</strong>
            ${o.estimated_monthly_impact_usd ? `<span class="badge" style="font-size: 10px;">+$${escapeHtml(String(o.estimated_monthly_impact_usd))}/mo</span>` : ''}
          </div>
          <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(o.rationale || '')}</div>
          ${o.action ? `<div style="font-size: 11px; color: #818cf8; margin-top: 2px;">Action: ${escapeHtml(o.action)}</div>` : ''}
        </div>`);
    });
    recList.innerHTML = cards.length ? cards.join('') : '<div>No recommendations available.</div>';
  } catch (err) {
    summaryEl.innerHTML = `<span style="color: var(--danger);">${escapeHtml(err.message)}</span>`;
  }
}

// 3. Catalogue AI Audit & Product Optimization
async function auditCatalogue() {
  const banner = document.getElementById('catalogue-ai-banner');
  const scoreEl = document.getElementById('catalogue-quality-score');
  const summaryEl = document.getElementById('catalogue-ai-summary');
  if (!banner || !state.activeStoreId) return;

  banner.classList.remove('hidden');
  summaryEl.textContent = 'Auditing catalog titles, descriptions, and conversion risk...';
  scoreEl.textContent = '...';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ai/catalogue-analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ forceRefresh: false })
    });
    if (!res.ok) throw new Error('Failed to audit catalogue');
    const { data } = await res.json();

    scoreEl.textContent = data.average_listing_score;
    summaryEl.textContent = data.overview_summary;
  } catch (err) {
    summaryEl.innerHTML = `<span style="color: var(--danger);">${escapeHtml(err.message)}</span>`;
  }
}

window.improveProductWithAi = async function(productId) {
  const modal = document.getElementById('product-improvement-modal');
  if (!modal || !state.activeStoreId) return;
  modal.classList.remove('hidden');

  document.getElementById('improve-title-val').value = 'Generating AI listing improvements...';
  document.getElementById('improve-desc-val').value = 'Analyzing product attributes...';
  document.getElementById('improve-selling-points').innerHTML = '<li>Generating selling points...</li>';
  document.getElementById('improve-faq-list').innerHTML = '<div>Generating FAQs...</div>';
  document.getElementById('improve-tags-list').innerHTML = '<span>Generating tags...</span>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ai/product-improvements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ productId })
    });
    if (!res.ok) throw new Error('Failed to generate product improvements');
    const { data } = await res.json();

    document.getElementById('improve-title-val').value = data.improved_title || '';
    document.getElementById('improve-desc-val').value = data.improved_description || '';

    if (Array.isArray(data.selling_points)) {
      document.getElementById('improve-selling-points').innerHTML = data.selling_points.map(sp => `<li>${escapeHtml(sp)}</li>`).join('');
    }

    if (Array.isArray(data.faq_suggestions)) {
      document.getElementById('improve-faq-list').innerHTML = data.faq_suggestions.map(faq => `
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 4px;">
          <strong style="font-size: 12px; color: #a5b4fc;">Q: ${escapeHtml(faq.question)}</strong>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: var(--text-muted);">A: ${escapeHtml(faq.answer)}</p>
        </div>
      `).join('');
    }

    if (Array.isArray(data.recommendation_tags)) {
      document.getElementById('improve-tags-list').innerHTML = data.recommendation_tags.map(tag => `
        <span class="badge" style="background: rgba(99,102,241,0.15); color: #818cf8; border: 1px solid rgba(99,102,241,0.3); font-size: 11px;">#${escapeHtml(tag)}</span>
      `).join('');
    }
  } catch (err) {
    document.getElementById('improve-title-val').value = 'Failed to generate improvements: ' + err.message;
  }
};

// 4. Live Funnel Drop-off Deep Dive & Ask AI
async function runFunnelDeepDive() {
  const contentEl = document.getElementById('funnel-insights-content');
  if (!contentEl || !state.activeStoreId) return;

  contentEl.innerHTML = '<div class="insight-placeholder">Analyzing visitor drop-offs and stage friction...</div>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ai/funnel-analysis`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to load funnel analysis');
    const { data } = await res.json();

    contentEl.innerHTML = `
      <div style="margin-bottom: 12px; font-size: 13px; line-height: 1.5; color: var(--text-main);">
        <strong>Executive Summary:</strong> ${escapeHtml(data.executive_summary)}
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${(data.top_bottlenecks || []).map(b => `
          <div style="background: rgba(255,255,255,0.03); padding: 10px 14px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <strong style="color: #f87171; font-size: 13px;">${escapeHtml(b.stage)}: ${b.drop_off_rate_percent}% Drop-off</strong>
              <span class="badge" style="font-size: 10px; text-transform: uppercase;">${b.priority} Priority</span>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;"><strong>Likely Cause:</strong> ${escapeHtml(b.hypothesized_cause)}</div>
            <div style="font-size: 12px; color: #34d399;"><strong>Fix:</strong> ${escapeHtml(b.recommended_fix)}</div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    contentEl.innerHTML = `<div style="color: var(--danger); font-size: 12px;">${escapeHtml(err.message)}</div>`;
  }
}

async function askFunnelAi() {
  const input = document.getElementById('funnel-ai-question');
  const answerBox = document.getElementById('funnel-ai-answer-box');
  if (!input || !answerBox || !state.activeStoreId) return;

  const question = input.value.trim();
  if (!question) {
    showToast('Please type a question about your funnel', true);
    return;
  }

  answerBox.classList.remove('hidden');
  answerBox.innerHTML = '<span style="color: var(--text-muted);">Consulting AI with current funnel telemetry...</span>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ai/funnel-ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ question })
    });
    if (!res.ok) throw new Error('Failed to ask AI');
    const { data } = await res.json();

    answerBox.innerHTML = `
      <div style="color: var(--text-main); margin-bottom: 8px;">${escapeHtml(data.answer)}</div>
      ${Array.isArray(data.suggested_actions) && data.suggested_actions.length > 0 ? `
        <div style="font-size: 11px; color: #818cf8; margin-top: 8px;">
          <strong>Suggested Next Steps:</strong>
          <ul style="margin: 4px 0 0 0; padding-left: 18px;">
            ${data.suggested_actions.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `;
  } catch (err) {
    answerBox.innerHTML = `<span style="color: var(--danger);">${escapeHtml(err.message)}</span>`;
  }
}

// 5. Create Email with AI
function openAiEmailModal() {
  const modal = document.getElementById('ai-email-modal');
  if (modal) modal.classList.remove('hidden');
}

async function handleGenerateAiEmail(e) {
  e.preventDefault();
  const resultBox = document.getElementById('ai-email-result');
  const btn = document.getElementById('btn-generate-ai-email');
  if (!resultBox || !state.activeStoreId) return;

  const emailType = document.getElementById('ai-email-type').value;
  const tone = document.getElementById('ai-email-tone').value;
  const goal = document.getElementById('ai-email-goal').value;
  const length = document.getElementById('ai-email-length').value;
  const customContext = document.getElementById('ai-email-context').value.trim();

  if (btn) btn.disabled = true;
  btn.textContent = 'Generating Draft...';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ai/email-generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ emailType, tone, goal, length, customContext })
    });
    if (!res.ok) throw new Error('Failed to generate email');
    const { data } = await res.json();

    resultBox.classList.remove('hidden');
    document.getElementById('ai-email-subject').textContent = data.subject || '';
    document.getElementById('ai-email-preview').textContent = data.preview_text || '';
    document.getElementById('ai-email-body').textContent = data.body || '';
    document.getElementById('ai-email-cta-btn').textContent = data.call_to_action?.text || 'Shop Now';
    document.getElementById('ai-email-cta-url').textContent = `Target: ${data.call_to_action?.url || '/'}`;

    const altList = document.getElementById('ai-email-alt-subjects');
    if (Array.isArray(data.alternative_subjects)) {
      altList.innerHTML = data.alternative_subjects.map(s => `<li>${escapeHtml(s)}</li>`).join('');
    }
    showToast('Email draft generated successfully!');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btn) btn.disabled = false;
    btn.textContent = '⚡ Generate Email Draft';
  }
}

// 6. Smart Reorder Manual Add & AI Consumables
async function openReorderAddModal() {
  const modal = document.getElementById('reorder-add-modal');
  if (!modal || !state.activeStoreId) return;
  modal.classList.remove('hidden');

  const select = document.getElementById('reorder-select-product');
  select.innerHTML = '<option value="">Loading products...</option>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/products`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const { data } = await res.json();

    const products = data?.products || [];
    select.innerHTML = '<option value="">Choose a product from catalog...</option>' + 
      products.map(p => `<option value="${p.id}">${escapeHtml(p.title)} (${p.currency || 'GBP'} ${Number(p.price || 0).toFixed(2)})</option>`).join('');
  } catch (err) {
    select.innerHTML = '<option value="">Failed to load products</option>';
  }
}

async function loadAiConsumableSuggestions() {
  const box = document.getElementById('reorder-ai-suggestions-box');
  const list = document.getElementById('reorder-ai-suggestions-list');
  if (!box || !list || !state.activeStoreId) return;

  const modal = document.getElementById('reorder-add-modal');
  if (modal) modal.classList.remove('hidden');

  box.classList.remove('hidden');
  list.innerHTML = '<div style="font-size: 12px; color: var(--text-muted);">AI is scanning catalog for consumable patterns...</div>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/replenishment/ai-recommendations`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to get suggestions');
    const { data } = await res.json();

    const recs = data?.recommendations || [];
    if (recs.length === 0) {
      list.innerHTML = '<div style="font-size: 12px; color: var(--text-muted);">No consumable patterns detected yet.</div>';
      return;
    }

    list.innerHTML = recs.map(r => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 6px;">
        <div>
          <div style="font-weight: 500; font-size: 13px; color: var(--text-main);">${escapeHtml(r.title)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(r.reasoning)} • Recommended Cycle: ${r.suggested_cycle_days}d</div>
        </div>
        <button type="button" class="btn-primary btn-sm" style="font-size: 11px; padding: 4px 10px;" onclick="window.applyConsumableSuggestion('${r.product_id}', ${r.suggested_cycle_days})">Select</button>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div style="color: var(--danger); font-size: 12px;">${escapeHtml(err.message)}</div>`;
  }
}

window.applyConsumableSuggestion = function(productId, cycleDays) {
  const select = document.getElementById('reorder-select-product');
  if (select) select.value = productId;
  const cycleInput = document.getElementById('reorder-cycle-days');
  if (cycleInput) cycleInput.value = cycleDays;
  showToast('Product & cycle selected! Click Save to confirm.');
};

async function handleSaveReorderSettings(e) {
  e.preventDefault();
  const productId = document.getElementById('reorder-select-product').value;
  const cycleDays = parseInt(document.getElementById('reorder-cycle-days').value, 10);
  const reminderDays = parseInt(document.getElementById('reorder-reminder-days').value, 10);
  const isReplenishable = document.getElementById('reorder-is-active-toggle').checked;

  if (!productId) {
    showToast('Please select a product', true);
    return;
  }

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/replenishment/product-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        productId,
        cycleDays,
        reminderDaysBefore: reminderDays,
        replenishable: isReplenishable
      })
    });
    if (!res.ok) throw new Error('Failed to save settings');
    showToast('Product replenishment settings saved!');
    document.getElementById('reorder-add-modal')?.classList.add('hidden');
    loadReplenishableProducts();
  } catch (err) {
    showToast(err.message, true);
  }
}

// 7. Multi-Touch Ad Intelligence AI
async function runAdAiAnalysis() {
  const placeholder = document.getElementById('ad-ai-placeholder');
  const resultsGrid = document.getElementById('ad-ai-results-grid');
  if (!placeholder || !resultsGrid || !state.activeStoreId) return;

  placeholder.textContent = 'Running AI multi-touch attribution analysis across campaigns...';
  placeholder.classList.remove('hidden');
  resultsGrid.classList.add('hidden');

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ai/ad-analysis`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to run ad analysis');
    const { data } = await res.json();

    placeholder.classList.add('hidden');
    resultsGrid.classList.remove('hidden');

    const fillList = (id, items) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = (items || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
    };

    fillList('ad-ai-working', data.what_is_working);
    fillList('ad-ai-not-working', data.what_is_not);
    fillList('ad-ai-why', data.why_it_happens);
    fillList('ad-ai-test-next', data.what_to_test_next);
  } catch (err) {
    placeholder.innerHTML = `<span style="color: var(--danger);">${escapeHtml(err.message)}</span>`;
  }
}

async function askAdAi() {
  const input = document.getElementById('ad-ai-question-input');
  const answerBox = document.getElementById('ad-ai-question-answer');
  if (!input || !answerBox || !state.activeStoreId) return;

  const question = input.value.trim();
  if (!question) {
    showToast('Please type a question about your ads', true);
    return;
  }

  answerBox.classList.remove('hidden');
  answerBox.innerHTML = '<span style="color: var(--text-muted);">Consulting AI with current ad attribution metrics...</span>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/ai/ad-ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ question })
    });
    if (!res.ok) throw new Error('Failed to ask AI');
    const { data } = await res.json();

    answerBox.innerHTML = `
      <div style="color: var(--text-main); margin-bottom: 8px;">${escapeHtml(data.answer)}</div>
      ${Array.isArray(data.suggested_actions) && data.suggested_actions.length > 0 ? `
        <div style="font-size: 11px; color: #818cf8; margin-top: 8px;">
          <strong>Suggested Testing Actions:</strong>
          <ul style="margin: 4px 0 0 0; padding-left: 18px;">
            ${data.suggested_actions.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `;
  } catch (err) {
    answerBox.innerHTML = `<span style="color: var(--danger);">${escapeHtml(err.message)}</span>`;
  }
}

// 8. Growth Copilot Interactive Q&A Modal
function openCopilotAskModal() {
  const modal = document.getElementById('copilot-ask-modal');
  if (modal) modal.classList.remove('hidden');
}

async function submitCopilotAsk(customQuestion = '') {
  const input = document.getElementById('copilot-ask-input');
  const resultBox = document.getElementById('copilot-ask-result-box');
  if (!input || !resultBox || !state.activeStoreId) return;

  const question = customQuestion || input.value.trim();
  if (!question) {
    showToast('Please enter a question for Copilot', true);
    return;
  }

  input.value = question;
  resultBox.classList.remove('hidden');
  resultBox.innerHTML = '<span style="color: var(--text-muted);">Copilot is synthesizing store metrics and formulating growth response...</span>';

  try {
    const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/growth/copilot/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ question })
    });
    if (!res.ok) throw new Error('Failed to ask Copilot');
    const { data } = await res.json();

    resultBox.innerHTML = `
      <div style="color: var(--text-main); margin-bottom: 12px; font-size: 13px; line-height: 1.6;">${escapeHtml(data.answer)}</div>
      ${Array.isArray(data.suggested_actions) && data.suggested_actions.length > 0 ? `
        <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px; margin-top: 10px;">
          <strong style="font-size: 12px; color: #818cf8; text-transform: uppercase;">Prioritized Actions:</strong>
          <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
            ${data.suggested_actions.map(act => `
              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 6px 10px; border-radius: 6px;">
                <span style="font-size: 12px; color: var(--text-main);">${escapeHtml(act.title)}</span>
                <button class="btn-secondary btn-sm" style="font-size: 10px; padding: 2px 8px;" onclick="window.navigateToModule('${act.target_module}')">Execute →</button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
  } catch (err) {
    resultBox.innerHTML = `<span style="color: var(--danger); font-size: 12px;">${escapeHtml(err.message)}</span>`;
  }
}

function setupAiIntelligenceListeners() {
  // Overview AI
  document.getElementById('btn-refresh-store-insights')?.addEventListener('click', () => loadOverviewInsights(true));
  document.getElementById('btn-run-full-audit')?.addEventListener('click', openStoreAuditModal);
  document.getElementById('close-store-audit-modal')?.addEventListener('click', () => {
    document.getElementById('store-audit-modal')?.classList.add('hidden');
  });

  // Catalogue AI
  document.getElementById('btn-audit-catalogue')?.addEventListener('click', auditCatalogue);
  document.getElementById('btn-close-catalogue-ai')?.addEventListener('click', () => {
    document.getElementById('catalogue-ai-banner')?.classList.add('hidden');
  });
  document.getElementById('close-product-improvement-modal')?.addEventListener('click', () => {
    document.getElementById('product-improvement-modal')?.classList.add('hidden');
  });

  // Funnel AI
  document.getElementById('btn-run-funnel-ai')?.addEventListener('click', runFunnelDeepDive);
  document.getElementById('btn-ask-funnel-ai')?.addEventListener('click', askFunnelAi);
  document.getElementById('funnel-ai-question')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); askFunnelAi(); }
  });

  // Email Studio AI
  document.getElementById('btn-open-email-ai-modal')?.addEventListener('click', openAiEmailModal);
  document.getElementById('close-ai-email-modal')?.addEventListener('click', () => {
    document.getElementById('ai-email-modal')?.classList.add('hidden');
  });
  document.getElementById('ai-email-form')?.addEventListener('submit', handleGenerateAiEmail);

  // Smart Reorder AI
  document.getElementById('btn-open-add-rep-modal')?.addEventListener('click', openReorderAddModal);
  document.getElementById('btn-ai-consumable-suggestions')?.addEventListener('click', loadAiConsumableSuggestions);
  document.getElementById('close-reorder-add-modal')?.addEventListener('click', () => {
    document.getElementById('reorder-add-modal')?.classList.add('hidden');
  });
  document.getElementById('reorder-add-form')?.addEventListener('submit', handleSaveReorderSettings);

  // Ad Intelligence AI
  document.getElementById('btn-run-ad-ai-analysis')?.addEventListener('click', runAdAiAnalysis);
  document.getElementById('btn-ask-ad-ai')?.addEventListener('click', askAdAi);
  document.getElementById('ad-ai-question-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); askAdAi(); }
  });

  // Meta Ads Integration
  document.getElementById('btn-meta-test')?.addEventListener('click', testMetaToken);
  document.getElementById('btn-meta-connect')?.addEventListener('click', connectMetaAds);
  document.getElementById('btn-meta-disconnect')?.addEventListener('click', disconnectMetaAds);
  document.getElementById('btn-meta-refresh')?.addEventListener('click', () => refreshMetaInsights(true));
  document.getElementById('meta-date-preset')?.addEventListener('change', onMetaDatePresetChange);
  document.getElementById('meta-level-select')?.addEventListener('change', () => refreshMetaInsights(false));
  document.getElementById('meta-ad-account-select')?.addEventListener('change', () => refreshMetaInsights(false));

  // Ads Explorer
  setupExplorerEventListeners();

  // Growth Copilot Ask Modal
  document.getElementById('close-copilot-ask-modal')?.addEventListener('click', () => {
    document.getElementById('copilot-ask-modal')?.classList.add('hidden');
  });
  document.getElementById('btn-submit-copilot-ask')?.addEventListener('click', () => submitCopilotAsk());
  document.getElementById('copilot-ask-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitCopilotAsk(); }
  });
  document.querySelectorAll('.copilot-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.getAttribute('data-q');
      if (q) submitCopilotAsk(q);
    });
  });

  // Modal Backdrop Click-to-Close (clicking dark overlay outside modal closes it)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });
}

// ============================================================================
// Meta Ads Integration (live Meta Marketing API performance)
// ============================================================================

const META_API_BASE = () => `/api/v1/dashboard/${state.activeStoreId}/meta-ads`;

async function metaApi(path, options = {}) {
  const res = await fetch(`${META_API_BASE()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `Request failed (${res.status})`);
  }
  return body.data;
}

function setMetaMessage(elId, text, isError = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!text) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `<span style="color: ${isError ? 'var(--danger)' : 'var(--color-success)'};">${escapeHtml(text)}</span>`;
}

function metaMoney(value, currency) {
  const num = Number(value || 0);
  const sym = getCurrencySymbol(currency || state.activeStoreCurrency);
  return `${sym}${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadMetaAdsData() {
  if (!state.activeStoreId) return;
  try {
    const status = await metaApi('/config');
    renderMetaStatus(status);
    if (status.connected) {
      await refreshMetaInsights(false);
    } else {
      renderMetaInsightsEmpty();
    }
  } catch (err) {
    setMetaMessage('meta-connection-message', err.message, true);
  }
}

function renderMetaStatus(status) {
  const pill = document.getElementById('meta-ads-connection-pill');
  if (pill) {
    if (status.connected) {
      pill.className = 'badge badge--success';
      pill.textContent = status.adAccountName ? `Connected · ${status.adAccountName}` : 'Connected';
    } else if (status.status === 'error') {
      pill.className = 'badge badge--danger';
      pill.textContent = 'Connection Error';
    } else {
      pill.className = 'badge badge--danger';
      pill.textContent = 'Disconnected';
    }
  }

  const disconnectBtn = document.getElementById('btn-meta-disconnect');
  if (disconnectBtn) disconnectBtn.classList.toggle('hidden', !status.connected);

  const select = document.getElementById('meta-ad-account-select');
  if (select && status.connected && status.adAccountId) {
    select.innerHTML = `<option value="${escapeHtml(status.adAccountId)}">${escapeHtml(status.adAccountName || status.adAccountId)}${status.accountCurrency ? ` (${escapeHtml(status.accountCurrency)})` : ''}</option>`;
    select.value = status.adAccountId;
  }

  const warnBox = document.getElementById('meta-ads-expiry-warning');
  if (warnBox) {
    if (status.tokenExpiryNote) {
      warnBox.classList.remove('hidden');
      warnBox.innerHTML = `<span style="color: var(--color-warning);">⚠️ ${escapeHtml(status.tokenExpiryNote)}</span>`;
    } else if (status.lastError) {
      warnBox.classList.remove('hidden');
      warnBox.innerHTML = `<span style="color: var(--danger);">⚠️ ${escapeHtml(status.lastError)}</span>`;
    } else {
      warnBox.classList.add('hidden');
      warnBox.innerHTML = '';
    }
  }

  const lastSync = document.getElementById('meta-last-sync');
  if (lastSync) {
    lastSync.textContent = status.lastSyncAt ? `Last synced ${new Date(status.lastSyncAt).toLocaleString()}` : '';
  }

  if (status.lastError && !status.connected) {
    setMetaMessage('meta-connection-message', status.lastError, true);
  }
}

function renderMetaInsightsEmpty() {
  ['meta-stat-spend', 'meta-stat-impressions', 'meta-stat-clicks', 'meta-stat-ctr', 'meta-stat-cpc', 'meta-stat-conversions', 'meta-stat-roas']
    .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  const tbody = document.getElementById('meta-ads-table-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--color-text-secondary);">Connect your Meta account to load live ad performance.</td></tr>';
  const sub = document.getElementById('meta-table-subtitle');
  if (sub) sub.textContent = 'Connect your Meta account to load live ad performance.';
}

function onMetaDatePresetChange() {
  const preset = document.getElementById('meta-date-preset')?.value;
  const custom = document.getElementById('meta-custom-dates');
  if (custom) custom.classList.toggle('hidden', preset !== 'custom');
  if (preset !== 'custom') refreshMetaInsights(false);
}

async function testMetaToken() {
  const tokenInput = document.getElementById('meta-access-token');
  const token = tokenInput?.value.trim();
  if (!token) {
    showToast('Please paste a Meta access token first', true);
    return;
  }
  setMetaMessage('meta-connection-message', 'Testing token against the Meta API…');
  try {
    const result = await metaApi('/test', { method: 'POST', body: JSON.stringify({ access_token: token }) });
    const names = result.accounts.map(a => `${a.name} (${a.currency || '—'})`).join(', ') || 'none';
    setMetaMessage('meta-connection-message', `✓ Token valid for ${result.userName}. Ad accounts: ${names}. Click “Connect & Save” to store it.`);
    const select = document.getElementById('meta-ad-account-select');
    if (select && result.accounts.length > 0) {
      select.innerHTML = result.accounts
        .map(a => `<option value="${escapeHtml(a.accountId)}">${escapeHtml(a.name)}${a.currency ? ` (${escapeHtml(a.currency)})` : ''}</option>`)
        .join('');
    }
    showToast('Meta token is valid');
  } catch (err) {
    setMetaMessage('meta-connection-message', err.message, true);
    showToast(err.message, true);
  }
}

async function connectMetaAds() {
  const tokenInput = document.getElementById('meta-access-token');
  const accountSelect = document.getElementById('meta-ad-account-select');
  const token = tokenInput?.value.trim();
  if (!token) {
    showToast('Please paste a Meta access token first', true);
    return;
  }
  setMetaMessage('meta-connection-message', 'Validating with Meta and saving…');
  try {
    const status = await metaApi('/config', {
      method: 'POST',
      body: JSON.stringify({ access_token: token, ad_account_id: accountSelect?.value || null }),
    });
    if (tokenInput) tokenInput.value = ''; // never keep the raw token in the DOM
    renderMetaStatus(status);
    setMetaMessage('meta-connection-message', `✓ Connected to ${status.adAccountName || 'Meta Ads'}. Loading live performance…`);
    showToast('Meta Ads connected');
    await refreshMetaInsights(false);
  } catch (err) {
    setMetaMessage('meta-connection-message', err.message, true);
    showToast(err.message, true);
  }
}

async function disconnectMetaAds() {
  showConfirmModal('Disconnect Meta Ads?', 'This removes the stored Meta access token for this store. Live ad data will no longer load.', async () => {
    try {
      await metaApi('/config', { method: 'DELETE' });
      const tokenInput = document.getElementById('meta-access-token');
      if (tokenInput) tokenInput.value = '';
      const select = document.getElementById('meta-ad-account-select');
      if (select) select.innerHTML = '<option value="">— connect a token first —</option>';
      renderMetaStatus({ connected: false, status: 'disconnected' });
      renderMetaInsightsEmpty();
      setMetaMessage('meta-connection-message', 'Disconnected. Token removed.');
      showToast('Meta Ads disconnected');
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

async function refreshMetaInsights(manual) {
  const status = await metaApi('/config').catch(() => null);
  if (!status || !status.connected) {
    renderMetaInsightsEmpty();
    return;
  }
  renderMetaStatus(status);

  const level = document.getElementById('meta-level-select')?.value || 'campaign';
  const preset = document.getElementById('meta-date-preset')?.value || 'last_30d';
  const accountId = document.getElementById('meta-ad-account-select')?.value || '';

  const params = new URLSearchParams({ level, limit: '100' });
  if (preset === 'custom') {
    const since = document.getElementById('meta-since')?.value;
    const until = document.getElementById('meta-until')?.value;
    if (!since || !until) {
      showToast('Pick both From and To dates for a custom range', true);
      return;
    }
    params.set('since', since);
    params.set('until', until);
  } else {
    params.set('date_preset', preset);
  }
  if (accountId) params.set('ad_account_id', accountId);

  setMetaMessage('meta-insights-message', manual ? 'Fetching live data from Meta…' : '');
  try {
    const data = await metaApi(`/insights?${params.toString()}`);
    renderMetaInsights(data, level);
    const lastSync = document.getElementById('meta-last-sync');
    if (lastSync) lastSync.textContent = `Last synced ${new Date().toLocaleString()}`;
    if (manual) showToast('Meta Ads data refreshed');
  } catch (err) {
    setMetaMessage('meta-insights-message', err.message, true);
    if (manual) showToast(err.message, true);
    // Re-render status in case the token was flagged as expired
    const fresh = await metaApi('/config').catch(() => null);
    if (fresh) renderMetaStatus(fresh);
  }
}

function renderMetaInsights(data, level) {
  const t = data.totals || {};
  const currency = data.accountCurrency || state.activeStoreCurrency;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('meta-stat-spend', metaMoney(t.spend, currency));
  set('meta-stat-impressions', Number(t.impressions || 0).toLocaleString());
  set('meta-stat-clicks', Number(t.clicks || 0).toLocaleString());
  set('meta-stat-ctr', `${Number(t.ctr || 0).toFixed(2)}%`);
  set('meta-stat-cpc', metaMoney(t.cpc, currency));
  set('meta-stat-conversions', Number(t.conversions || 0).toLocaleString());
  set('meta-stat-roas', `${Number(t.roas || 0).toFixed(2)}x`);

  const labelMap = { campaign: 'Campaigns', adset: 'Ad Sets', ad: 'Ads', account: 'Account' };
  const sub = document.getElementById('meta-table-subtitle');
  if (sub) sub.textContent = `Live ${labelMap[level] || level} performance · ${data.rows.length} rows · ${currency}`;

  const attributionByCampaign = {};
  (data.attribution || []).forEach(a => { attributionByCampaign[String(a.campaignName).toLowerCase()] = a; });

  const nameFor = (r) => {
    if (level === 'ad') return r.adName || r.adId || '—';
    if (level === 'adset') return r.adsetName || r.adsetId || '—';
    return r.campaignName || r.campaignId || '—';
  };

  const tbody = document.getElementById('meta-ads-table-body');
  if (tbody) {
    if (!data.rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--color-text-secondary);">No ads data for this period.</td></tr>';
    } else {
      tbody.innerHTML = data.rows.map(r => {
        const name = nameFor(r);
        const attr = level === 'campaign' ? attributionByCampaign[name.toLowerCase()] : null;
        return `<tr>
          <td style="max-width: 260px; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(name)}">${escapeHtml(name)}</td>
          <td>${metaMoney(r.spend, currency)}</td>
          <td>${Number(r.impressions || 0).toLocaleString()}</td>
          <td>${Number(r.clicks || 0).toLocaleString()}</td>
          <td>${Number(r.ctr || 0).toFixed(2)}%</td>
          <td>${metaMoney(r.cpc, currency)}</td>
          <td>${Number(r.conversions || 0)}</td>
          <td>${Number(r.roas || 0).toFixed(2)}x</td>
          <td>${attr ? metaMoney(attr.storeAttributedRevenue, currency) : '—'}</td>
        </tr>`;
      }).join('');
    }
  }
}

// ============================================================================
// Ads Explorer (Meta creative explorer, served from cache)
// ============================================================================

const EXPLORER_API_BASE = () => `/api/v1/dashboard/${state.activeStoreId}/meta-ads/explorer`;

async function explorerApi(path, options = {}) {
  const res = await fetch(`${EXPLORER_API_BASE()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `Request failed (${res.status})`);
  }
  return body.data;
}

const explorerState = {
  ads: [],
  accountId: '',
  lastSyncAt: null,
  synced: false,
  filters: { search: '', campaign: '', adset: '', status: '', missingCreative: false, missingUrl: false },
};

function setExplorerMessage(text, isError = false) {
  const el = document.getElementById('explorer-message');
  if (!el) return;
  if (!text) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `<span style="color: ${isError ? 'var(--danger)' : 'var(--color-success)'};">${escapeHtml(text)}</span>`;
}

function explorerRelativeTime(iso) {
  if (!iso) return 'Never synced';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return 'Just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderExplorerConnection(status) {
  const pill = document.getElementById('explorer-connection-pill');
  if (!pill) return;
  if (status && status.connected) {
    pill.className = 'badge badge--success';
    pill.textContent = 'Connected';
  } else if (status && status.status === 'error') {
    pill.className = 'badge badge--warning';
    pill.textContent = 'Needs attention';
  } else {
    pill.className = 'badge badge--danger';
    pill.textContent = 'Disconnected';
  }
}

async function loadExplorerData() {
  if (!state.activeStoreId) return;
  try {
    setExplorerMessage('');
    const status = await metaApi('/config');
    renderExplorerConnection(status);
    if (status.connected) {
      const accounts = await metaApi('/accounts').catch(() => []);
      const sel = document.getElementById('explorer-account-select');
      if (sel) {
        sel.innerHTML = accounts.length
          ? accounts.map(a => `<option value="${escapeHtml(a.accountId)}">${escapeHtml(a.name)} (${escapeHtml(a.accountId)})</option>`).join('')
          : '<option value="">— no ad accounts —</option>';
        const preferred = status.adAccountId || (accounts[0] && accounts[0].accountId) || '';
        if (preferred) sel.value = preferred;
      }
      await refreshExplorerAds();
    } else {
      renderExplorerEmpty();
    }
  } catch (err) {
    setExplorerMessage(err.message, true);
  }
}

async function refreshExplorerAds() {
  const accountId = document.getElementById('explorer-account-select')?.value || '';
  const q = accountId ? `?ad_account_id=${encodeURIComponent(accountId)}` : '';
  const data = await explorerApi(`/ads${q}`);
  explorerState.ads = data.ads || [];
  explorerState.accountId = data.adAccountId || accountId;
  explorerState.lastSyncAt = data.lastSyncAt;
  explorerState.synced = !!data.synced;

  const lastSyncEl = document.getElementById('explorer-last-sync');
  if (lastSyncEl) lastSyncEl.textContent = explorerRelativeTime(data.lastSyncAt);

  buildExplorerFilterOptions();
  renderExplorerGrid();
}

async function syncExplorerAds() {
  const btn = document.getElementById('btn-explorer-sync');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  setExplorerMessage('Syncing ads from Meta — this may take a few seconds…');
  try {
    const accountId = document.getElementById('explorer-account-select')?.value || null;
    const data = await explorerApi('/sync', {
      method: 'POST',
      body: JSON.stringify({ ad_account_id: accountId }),
    });
    setExplorerMessage(`Synced ${data.adsFetched} ads from Meta.`, false);
    await refreshExplorerAds();
  } catch (err) {
    setExplorerMessage(err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#8635; Sync Ads'; }
  }
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(v => v && String(v).trim() !== ''))).sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

function buildExplorerFilterOptions() {
  const ads = explorerState.ads;
  const fill = (id, values, allLabel) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      uniqueSorted(values).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (current && uniqueSorted(values).includes(current)) sel.value = current;
  };
  fill('explorer-campaign-filter', ads.map(a => a.campaign_name), 'Campaign: all');
  fill('explorer-adset-filter', ads.map(a => a.adset_name), 'Ad Set: all');
  fill('explorer-status-filter', ads.map(a => a.status), 'Status: all');
}

function readExplorerFilters() {
  explorerState.filters.search = (document.getElementById('explorer-search')?.value || '').trim().toLowerCase();
  explorerState.filters.campaign = document.getElementById('explorer-campaign-filter')?.value || '';
  explorerState.filters.adset = document.getElementById('explorer-adset-filter')?.value || '';
  explorerState.filters.status = document.getElementById('explorer-status-filter')?.value || '';
}

function getFilteredExplorerAds() {
  const f = explorerState.filters;
  return explorerState.ads.filter(ad => {
    if (f.search) {
      const hay = `${ad.name || ''} ${ad.ad_id || ''}`.toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    if (f.campaign && ad.campaign_name !== f.campaign) return false;
    if (f.adset && ad.adset_name !== f.adset) return false;
    if (f.status && ad.status !== f.status) return false;
    if (f.missingCreative && ad.thumbnail_url) return false;
    if (f.missingUrl && ad.destination_url) return false;
    return true;
  });
}

function explorerStatusBadge(status) {
  const s = (status || 'UNKNOWN').toUpperCase();
  const cls = s === 'ACTIVE' ? 'badge--success' : (s === 'PAUSED' ? 'badge--warning' : 'badge--neutral');
  return `<span class="badge ${cls}">${escapeHtml(s)}</span>`;
}

function renderExplorerEmpty() {
  const grid = document.getElementById('explorer-grid');
  const empty = document.getElementById('explorer-empty');
  const count = document.getElementById('explorer-count');
  if (grid) grid.innerHTML = '';
  if (count) count.textContent = '';
  if (empty) empty.classList.remove('hidden');
}

function renderExplorerGrid() {
  const grid = document.getElementById('explorer-grid');
  const empty = document.getElementById('explorer-empty');
  const count = document.getElementById('explorer-count');
  if (!grid) return;

  const filtered = getFilteredExplorerAds();
  const total = explorerState.ads.length;

  if (count) {
    count.textContent = total === 0
      ? ''
      : (filtered.length === total ? `${total} ads found` : `${filtered.length} of ${total} ads`);
  }

  if (total === 0) {
    renderExplorerEmpty();
    return;
  }
  if (empty) empty.classList.add('hidden');

  grid.innerHTML = filtered.map(ad => {
    const title = ad.name || ad.ad_id || 'Untitled ad';
    const media = ad.thumbnail_url
      ? `<img loading="lazy" src="${escapeHtml(ad.thumbnail_url)}" alt="${escapeHtml(title)}" onerror="this.closest('.explorer-card-media').innerHTML='<span class=&quot;media-placeholder&quot;>&#128444;</span>'">`
      : '<span class="media-placeholder">&#128444;</span>';
    const linkBtn = ad.destination_url
      ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(ad.destination_url)}" target="_blank" rel="noopener" title="Open destination URL">&#8599;</a>`
      : '';
    return `<div class="explorer-card" data-ad-id="${escapeHtml(ad.ad_id)}">
      <div class="explorer-card-media">
        ${media}
        <span class="explorer-card-status">${explorerStatusBadge(ad.status)}</span>
      </div>
      <div class="explorer-card-body">
        <div class="explorer-card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <div class="explorer-card-tags">
          ${ad.campaign_name ? `<span class="tag-row">&#10003; ${escapeHtml(ad.campaign_name)}</span>` : ''}
          ${ad.adset_name ? `<span class="tag-row">&#10003; ${escapeHtml(ad.adset_name)}</span>` : ''}
          <span class="tag-row" style="color: var(--color-text-tertiary);">ID ${escapeHtml(ad.ad_id || '')}</span>
        </div>
        <div class="explorer-card-actions">
          <button class="btn btn-secondary btn-sm" data-explorer-download="${escapeHtml(ad.ad_id)}" ${ad.thumbnail_url ? '' : 'disabled'}>&#8681; Creative</button>
          ${linkBtn}
        </div>
      </div>
    </div>`;
  }).join('') || '<p class="section-subtitle" style="grid-column: 1 / -1; text-align: center; padding: 24px;">No ads match these filters.</p>';

  grid.querySelectorAll('[data-explorer-download]').forEach(btn => {
    btn.addEventListener('click', () => downloadExplorerCreative(btn.getAttribute('data-explorer-download')));
  });
}

function triggerBrowserDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'creative';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function downloadExplorerCreative(adId) {
  const ad = explorerState.ads.find(a => String(a.ad_id) === String(adId));
  if (!ad || !ad.thumbnail_url) return;
  const filename = `meta-ad-${ad.ad_id}.jpg`;
  try {
    const res = await fetch(ad.thumbnail_url, { mode: 'cors' });
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(objectUrl, filename);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  } catch (err) {
    // CORS-blocked CDN: fall back to opening the creative in a new tab.
    window.open(ad.thumbnail_url, '_blank', 'noopener');
  }
}

async function downloadAllExplorerCreatives() {
  const ads = getFilteredExplorerAds().filter(a => a.thumbnail_url);
  if (!ads.length) {
    setExplorerMessage('No creatives to download for the current filters.', true);
    return;
  }
  setExplorerMessage(`Downloading ${ads.length} creatives…`, false);
  for (const ad of ads) {
    await downloadExplorerCreative(ad.ad_id);
    await new Promise(r => setTimeout(r, 400));
  }
}

function clearExplorerFilters() {
  const search = document.getElementById('explorer-search');
  if (search) search.value = '';
  const campaign = document.getElementById('explorer-campaign-filter');
  if (campaign) campaign.value = '';
  const adset = document.getElementById('explorer-adset-filter');
  if (adset) adset.value = '';
  const status = document.getElementById('explorer-status-filter');
  if (status) status.value = '';
  explorerState.filters.missingCreative = false;
  explorerState.filters.missingUrl = false;
  document.getElementById('explorer-chip-missing-creative')?.classList.remove('active');
  document.getElementById('explorer-chip-missing-url')?.classList.remove('active');
  readExplorerFilters();
  renderExplorerGrid();
}

function setupExplorerEventListeners() {
  document.getElementById('btn-explorer-sync')?.addEventListener('click', syncExplorerAds);
  document.getElementById('btn-explorer-download')?.addEventListener('click', downloadAllExplorerCreatives);
  document.getElementById('explorer-account-select')?.addEventListener('change', () => {
    refreshExplorerAds().catch(err => setExplorerMessage(err.message, true));
  });
  document.getElementById('explorer-search')?.addEventListener('input', () => {
    readExplorerFilters();
    renderExplorerGrid();
  });
  ['explorer-campaign-filter', 'explorer-adset-filter', 'explorer-status-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      readExplorerFilters();
      renderExplorerGrid();
    });
  });
  document.getElementById('explorer-chip-missing-creative')?.addEventListener('click', (e) => {
    explorerState.filters.missingCreative = !explorerState.filters.missingCreative;
    e.currentTarget.classList.toggle('active', explorerState.filters.missingCreative);
    renderExplorerGrid();
  });
  document.getElementById('explorer-chip-missing-url')?.addEventListener('click', (e) => {
    explorerState.filters.missingUrl = !explorerState.filters.missingUrl;
    e.currentTarget.classList.toggle('active', explorerState.filters.missingUrl);
    renderExplorerGrid();
  });
  document.getElementById('explorer-clear-filters')?.addEventListener('click', clearExplorerFilters);
}

// ============================================================
// Merchant AI Agent (in-dashboard chat assistant + doc verdicts)
// ============================================================
const AI_AGENT_API_BASE = () => `/api/v1/dashboard/${state.activeStoreId}/ai-agent`;

const aiAgentState = {
  history: [], // {role, content} — sent back to the server each turn
  busy: false,
  listenersBound: false,
};

function agentApi(path, options = {}) {
  return fetch(`${AI_AGENT_API_BASE()}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function agentScrollDown() {
  const box = document.getElementById('ai-agent-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

function agentAddMessage(kind, html, rawText) {
  const box = document.getElementById('ai-agent-messages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `agent-msg agent-msg--${kind}`;
  div.innerHTML = html;
  box.appendChild(div);
  agentScrollDown();
  return div;
}

function agentAddUserMessage(text) {
  agentAddMessage('user', escapeHtml(text));
  aiAgentState.history.push({ role: 'user', content: text });
}

function agentAddAssistantMessage(text) {
  agentAddMessage('assistant', escapeHtml(text));
  aiAgentState.history.push({ role: 'assistant', content: text });
  // Keep history bounded (server also caps at 20).
  if (aiAgentState.history.length > 20) {
    aiAgentState.history = aiAgentState.history.slice(-20);
  }
}

function agentAddError(text) {
  agentAddMessage('error', escapeHtml(text));
}

function agentAddVerdict(data) {
  const box = document.getElementById('ai-agent-messages');
  if (!box) return;
  const v = data.verdict || {};
  const list = (items) => (items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  const div = document.createElement('div');
  div.className = 'agent-verdict';
  div.innerHTML = `
    <h4>Document: ${escapeHtml(data.fileName || 'upload')}</h4>
    <p>${escapeHtml(v.summary || '')}</p>
    <h4>Key findings</h4>
    <ul>${list(v.key_findings)}</ul>
    ${(v.risks_and_flags && v.risks_and_flags.length) ? `<h4>Risks &amp; flags</h4><ul>${list(v.risks_and_flags)}</ul>` : ''}
    <div class="agent-verdict-callout"><strong>Final verdict:</strong> ${escapeHtml(v.final_verdict || '')}</div>
    ${(v.recommended_actions && v.recommended_actions.length) ? `<h4>Recommended actions</h4><ul>${list(v.recommended_actions)}</ul>` : ''}
    ${data.truncated ? `<p style="font-size:12px;color:var(--color-text-secondary);margin-top:8px;">Note: very long document — analysis used the first portion.</p>` : ''}
  `;
  box.appendChild(div);
  agentScrollDown();
  aiAgentState.history.push({ role: 'assistant', content: `[Verdict for ${data.fileName}] ${v.final_verdict || ''}` });
}

function agentSetBusy(busy) {
  aiAgentState.busy = busy;
  document.getElementById('ai-agent-typing')?.classList.toggle('hidden', !busy);
  const input = document.getElementById('ai-agent-input');
  const send = document.getElementById('btn-agent-send');
  if (input) input.disabled = busy;
  if (send) send.disabled = busy;
  if (busy) agentScrollDown();
}

async function agentSendMessage() {
  const input = document.getElementById('ai-agent-input');
  const text = (input?.value || '').trim();
  if (!text || aiAgentState.busy) return;
  input.value = '';
  agentAddUserMessage(text);
  agentSetBusy(true);
  try {
    const res = await agentApi('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: aiAgentState.history.slice(0, -1) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      const msg = json?.error?.message || 'Something went wrong. Please try again.';
      agentAddError(msg);
      // Drop the user message from history on failure so a retry stays clean.
      aiAgentState.history.pop();
      return;
    }
    agentAddAssistantMessage(json.data?.answer || 'No answer returned.');
  } catch (err) {
    agentAddError('Could not reach the AI agent. Check your connection and try again.');
    aiAgentState.history.pop();
  } finally {
    agentSetBusy(false);
  }
}

async function agentUploadDocument(file) {
  if (!file || aiAgentState.busy) return;
  agentAddMessage('system', `Uploading <strong>${escapeHtml(file.name)}</strong> for analysis&hellip;`);
  agentSetBusy(true);
  try {
    const form = new FormData();
    form.append('document', file);
    const res = await agentApi('/upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      agentAddError(json?.error?.message || 'Document analysis failed. Please try again.');
      return;
    }
    agentAddVerdict(json.data);
  } catch (err) {
    agentAddError('Could not upload the document. Check your connection and try again.');
  } finally {
    agentSetBusy(false);
    const picker = document.getElementById('ai-agent-file');
    if (picker) picker.value = '';
  }
}

function bindAiAgentListeners() {
  if (aiAgentState.listenersBound) return;
  aiAgentState.listenersBound = true;
  document.getElementById('btn-agent-send')?.addEventListener('click', agentSendMessage);
  document.getElementById('ai-agent-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      agentSendMessage();
    }
  });
  document.getElementById('btn-agent-upload')?.addEventListener('click', () => {
    document.getElementById('ai-agent-file')?.click();
  });
  document.getElementById('ai-agent-file')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) agentUploadDocument(file);
  });
}

async function loadAiAgentData() {
  bindAiAgentListeners();
  const pill = document.getElementById('ai-agent-status-pill');
  const offline = document.getElementById('ai-agent-offline');
  const chatWrap = document.getElementById('ai-agent-chat-wrap');
  try {
    const res = await agentApi('/status');
    const json = await res.json().catch(() => ({}));
    const configured = Boolean(json?.data?.configured);
    if (pill) {
      pill.textContent = configured ? 'Ready' : 'Not configured';
      pill.className = `badge ${configured ? 'badge--success' : 'badge--danger'}`;
    }
    offline?.classList.toggle('hidden', configured);
    chatWrap?.classList.toggle('hidden', !configured);
    if (configured && document.getElementById('ai-agent-messages')?.children.length === 0) {
      agentAddMessage('system', 'Ask me anything about your store — I answer from your live Shopify + Meta data. You can also attach a document for an AI verdict.');
    }
  } catch (err) {
    if (pill) {
      pill.textContent = 'Unavailable';
      pill.className = 'badge badge--danger';
    }
  }
}
