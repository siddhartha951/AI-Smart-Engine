// ===== Onboarding Application State =====
let state = {
  token: null,
  storeId: null,
  currentStep: 'loading'
};

// ===== DOM Ready =====
document.addEventListener('DOMContentLoaded', () => {
  initThreeBackground();
  
  // Get token from URL
  const urlParams = new URLSearchParams(window.location.search);
  state.token = urlParams.get('token');
  
  if (!state.token) {
    showStep('error');
    return;
  }
  
  setupEventListeners();
  verifyInvite();
});

// ===== Three.js Background =====
function initThreeBackground() {
  try {
    const canvas = document.getElementById('three-canvas');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    const geometry = new THREE.BufferGeometry();
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 40;
      positions[i + 1] = (Math.random() - 0.5) * 40;
      positions[i + 2] = (Math.random() - 0.5) * 40;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ size: 0.05, color: 0x7c5cfc, transparent: true, opacity: 0.5 });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    camera.position.z = 10;
    
    function animate() {
      requestAnimationFrame(animate);
      points.rotation.y += 0.0005;
      points.rotation.x += 0.0002;
      renderer.render(scene, camera);
    }
    animate();
    
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  } catch(e) {}
}

// ===== API Helper =====
async function apiPost(path, data = {}) {
  const res = await fetch('/api/v1/onboarding' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + state.token
    },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || json.details?.[0]?.message || 'Request failed');
  return json;
}

// ===== State Machine =====
function showStep(stepId) {
  state.currentStep = stepId;
  document.querySelectorAll('.wizard-step').forEach(el => {
    el.classList.remove('active');
    el.classList.add('hidden');
  });
  const current = document.getElementById('step-' + stepId);
  if (current) {
    current.classList.remove('hidden');
    current.classList.add('active');
  }
  
  // Update progress bar
  const stepNum = parseInt(stepId);
  if (!isNaN(stepNum)) {
    const pct = ((stepNum - 1) / 5) * 100;
    document.getElementById('onboarding-progress').style.width = pct + '%';
  }
}

// ===== Flow Logic =====
async function verifyInvite() {
  try {
    const res = await fetch('/api/v1/onboarding/verify', {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    
    // Pre-fill Step 1 if we have data
    if (json.data) {
      if (json.data.name) document.getElementById('b-merchant-name').value = json.data.name;
      if (json.data.contact_email) document.getElementById('b-email').value = json.data.contact_email;
    }
    showStep('1');
  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    showStep('error');
  }
}

function setupEventListeners() {
  // Step 1
  document.getElementById('form-step-1').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = {
        merchant_name: document.getElementById('b-merchant-name').value,
        brand_name: document.getElementById('b-brand-name').value,
        shop_domain: document.getElementById('b-domain').value,
        contact_email: document.getElementById('b-email').value,
        currency: document.getElementById('b-currency').value,
        timezone: document.getElementById('b-timezone').value,
        password: document.getElementById('b-password').value
      };
      const support = document.getElementById('b-support-email').value;
      if (support) data.support_email = support;
      
      const res = await apiPost('/step1-business', data);
      state.storeId = res.store_id;
      showToast('Account secured and store created!', 'success');
      showStep('2');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Step 2
  const sForm = document.getElementById('form-step-2');
  const sBtn = document.getElementById('btn-test-connection');
  const sNext = document.getElementById('btn-step-2-next');
  const sStatus = document.getElementById('shopify-status');
  
  sBtn.addEventListener('click', async () => {
    try {
      const adminToken = document.getElementById('s-admin-token').value;
      const sfToken = document.getElementById('s-storefront-token').value;
      if (!adminToken || !sfToken) throw new Error('Please fill out both tokens');
      
      sStatus.className = 'status-msg';
      sStatus.textContent = 'Testing connection...';
      sStatus.classList.remove('hidden');
      
      await apiPost('/step2-shopify', {
        store_id: state.storeId,
        admin_token: adminToken,
        storefront_token: sfToken
      });
      
      sStatus.className = 'status-msg success';
      sStatus.textContent = '✓ Connection successful!';
      sNext.disabled = false;
    } catch (err) {
      sStatus.className = 'status-msg error';
      sStatus.textContent = '❌ ' + err.message;
    }
  });
  
  sForm.addEventListener('submit', (e) => { e.preventDefault(); showStep('3'); });

  // Step 3
  document.getElementById('form-step-3').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPost('/step3-assistant', {
        store_id: state.storeId,
        assistant_name: document.getElementById('a-name').value,
        tone: document.getElementById('a-tone').value,
        welcome_message: document.getElementById('a-welcome').value,
        allowed_categories: document.getElementById('a-categories').value.split(',').map(s=>s.trim()),
        delivery_policy: document.getElementById('a-delivery').value,
        returns_policy: document.getElementById('a-returns').value,
        faq_content: document.getElementById('a-faq').value
      });
      showStep('4');
    } catch(err) { showToast(err.message, 'error'); }
  });

  // Step 4
  document.getElementById('form-step-4').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPost('/step4-email', {
        store_id: state.storeId,
        sender_name: document.getElementById('e-sender-name').value,
        sender_email: document.getElementById('e-sender-email').value,
        recovery_enabled: document.getElementById('e-recovery-enabled').checked,
        marketing_consent_wording: document.getElementById('e-consent').value
      });
      showStep('5');
    } catch(err) { showToast(err.message, 'error'); }
  });

  // Step 5
  document.getElementById('btn-trigger-sync').addEventListener('click', async () => {
    const panel = document.querySelector('.sync-panel');
    const title = document.getElementById('sync-status-title');
    const detail = document.getElementById('sync-status-detail');
    const btnNext = document.getElementById('btn-step-5-next');
    
    panel.classList.add('syncing');
    title.textContent = 'Syncing Products...';
    
    try {
      const res = await apiPost('/step5-sync', { store_id: state.storeId });
      // Fake delay for UX
      setTimeout(() => {
        panel.classList.remove('syncing');
        document.getElementById('sync-status-icon').textContent = '✅';
        title.textContent = 'Sync Complete!';
        detail.textContent = `Synced ${res.synced_products} products across ${res.categories.length} categories.`;
        btnNext.classList.remove('hidden');
      }, 1500);
    } catch (err) {
      panel.classList.remove('syncing');
      document.getElementById('sync-status-icon').textContent = '❌';
      title.textContent = 'Sync Failed';
      detail.textContent = err.message;
    }
  });

  document.getElementById('btn-step-5-next').addEventListener('click', async () => {
    try {
      const res = await apiPost('/step6-finish', { store_id: state.storeId });
      document.getElementById('w-snippet').textContent = res.embed_script;
      showStep('6');
      document.getElementById('onboarding-progress').style.width = '100%';
    } catch(err) { showToast(err.message, 'error'); }
  });

  // Step 6
  document.getElementById('btn-copy-snippet').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('w-snippet').textContent);
    showToast('Copied to clipboard!', 'success');
  });

  document.getElementById('btn-finish').addEventListener('click', () => {
    window.location.href = '/dashboard/login.html';
  });
}

// ===== Toast =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}
