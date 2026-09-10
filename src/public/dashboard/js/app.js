// Application State
let state = {
  token: localStorage.getItem('auth_token'),
  user: null,
  activeStoreId: null,
  stores: []
};

// DOM Elements
const views = {
  login: document.getElementById('login-view'),
  dashboard: document.getElementById('dashboard-view')
};

const sections = {
  'overview': document.getElementById('overview'),
  'my-agent': document.getElementById('my-agent'),
  'widget-settings': document.getElementById('widget-settings'),
  'shopify-connection': document.getElementById('shopify-connection'),
  'email-automation': document.getElementById('email-automation')
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  if (state.token) {
    verifySession();
  } else {
    showView('login');
  }
});

function setupEventListeners() {
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
    showView('login');
  });

  // Navigation
  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
      e.target.classList.add('active');
      
      const target = e.target.getAttribute('data-target');
      showSection(target);
      loadSectionData(target);
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
        support_contact: document.getElementById('agent-support').value
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

  // 2. Widget Settings Save
  document.getElementById('widget-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      widget: {
        button_text: document.getElementById('widget-btn-text').value,
        primary_colour: document.getElementById('widget-primary-color').value,
        secondary_colour: document.getElementById('widget-secondary-color').value,
        position: document.getElementById('widget-position').value
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
  ['widget-btn-text', 'widget-primary-color', 'widget-secondary-color', 'widget-position'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateLivePreview);
  });

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
    showConfirmModal('Sync Products?', 'This will re-sync your entire catalog.', async () => {
      try {
        const res = await fetch(`/api/v1/dashboard/${state.activeStoreId}/shopify/sync`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Sync failed');
        showToast(data.message);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

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

function updateLivePreview() {
  const btn = document.getElementById('preview-widget-btn');
  if (btn) {
    btn.querySelector('span').textContent = document.getElementById('widget-btn-text').value || 'Ask our shopping assistant';
    btn.style.backgroundColor = document.getElementById('widget-primary-color').value || '#1a1a1a';
    btn.style.color = document.getElementById('widget-secondary-color').value || '#ffffff';
    
    const pos = document.getElementById('widget-position').value;
    if (pos === 'bottom-left') {
      btn.style.right = 'auto';
      btn.style.left = '20px';
    } else {
      btn.style.left = 'auto';
      btn.style.right = '20px';
    }
  }
}

function showView(viewName) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  if(views[viewName]) views[viewName].classList.remove('hidden');
}

function showSection(sectionName) {
  Object.values(sections).forEach(s => s.classList.add('hidden'));
  if(sections[sectionName]) sections[sectionName].classList.remove('hidden');
}

async function loadSectionData(section) {
  if (!state.activeStoreId) return;

  try {
    const endpoints = {
      'overview': 'overview',
      'my-agent': 'agent',
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
        document.getElementById('agent-name').value = data.assistant.assistant_name;
        document.getElementById('agent-welcome').value = data.assistant.welcome_message;
        document.getElementById('agent-tone').value = data.assistant.tone;
        document.getElementById('agent-support').value = data.assistant.support_contact;
      }
      if (data.policies) {
        document.getElementById('store-faq').value = data.policies.faq_content;
      }
    }
    else if (section === 'widget-settings') {
      if (data.widget) {
        document.getElementById('widget-btn-text').value = data.widget.button_text;
        document.getElementById('widget-primary-color').value = data.widget.primary_colour;
        document.getElementById('widget-secondary-color').value = data.widget.secondary_colour;
        document.getElementById('widget-position').value = data.widget.position;
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

// UI Utilities
function animateValue(id, target, duration = 1000) {
  const obj = document.getElementById(id);
  if (!obj) return;
  const start = parseInt(obj.textContent) || 0;
  target = parseInt(target) || 0;
  const range = target - start;
  let current = start;
  const increment = target > start ? 1 : -1;
  const stepTime = Math.abs(Math.floor(duration / Math.max(range, 1)));
  
  if (range === 0) {
    obj.textContent = target;
    return;
  }
  
  const timer = setInterval(() => {
    current += increment;
    obj.textContent = current;
    if (current === target) {
      clearInterval(timer);
    }
  }, stepTime);
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? 'var(--danger)' : 'var(--primary)';
  toast.classList.remove('hidden');
  
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
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
