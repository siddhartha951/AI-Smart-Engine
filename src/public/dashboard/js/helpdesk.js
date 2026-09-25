// Settings → Helpdesk: where support tickets go (built-in inbox or the store's Freshdesk).
// app.js passes in its auth/state helpers via initHelpdesk().

let ctx = null;
let current = null; // last settings view from the server

function $(id) {
  return document.getElementById(id);
}

function baseUrl() {
  return `/api/v1/dashboard/${ctx.getStoreId()}/helpdesk`;
}

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${ctx.getToken()}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (typeof json.error === 'string' ? json.error : json.error?.message) || json.message || 'Request failed';
    throw new Error(msg);
  }
  return json;
}

function selectedProvider() {
  const checked = document.querySelector('input[name="hd-provider"]:checked');
  return checked ? checked.value : 'built_in';
}

function setMessage(text, tone) {
  const el = $('hd-message');
  if (!el) return;
  el.textContent = text || '';
  el.dataset.tone = tone || 'neutral';
}

function setBusy(busy) {
  ['hd-save', 'hd-test', 'hd-disconnect', 'hd-retry'].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = busy;
  });
}

function toggleFields() {
  const freshdesk = selectedProvider() === 'freshdesk';
  $('hd-freshdesk-fields')?.classList.toggle('hidden', !freshdesk);
  $('hd-test')?.classList.toggle('hidden', !freshdesk);
}

function render(view) {
  current = view;
  const radio = document.querySelector(`input[name="hd-provider"][value="${view.provider === 'freshdesk' ? 'freshdesk' : 'built_in'}"]`);
  if (radio) radio.checked = true;
  $('hd-domain').value = view.freshdesk_domain || '';
  $('hd-api-key').value = '';
  $('hd-api-key').placeholder = view.has_api_key
    ? `Saved key ending in ${view.api_key_last4 || '····'} (leave empty to keep it)`
    : 'Paste your Freshdesk API key';
  $('hd-tickets-off')?.classList.toggle('hidden', view.tickets_enabled !== false);

  const status = $('hd-status');
  if (view.active) {
    status.textContent = `Connected to ${view.freshdesk_domain}`;
    status.dataset.tone = 'success';
  } else if (view.provider === 'freshdesk' && view.status === 'error') {
    status.textContent = 'Freshdesk needs attention';
    status.dataset.tone = 'danger';
  } else if (view.has_api_key && view.provider !== 'freshdesk') {
    status.textContent = 'Freshdesk saved, not in use';
    status.dataset.tone = 'neutral';
  } else {
    status.textContent = 'Using the AI Smart Engine inbox';
    status.dataset.tone = 'neutral';
  }
  if (view.status === 'error' && view.last_error) setMessage(view.last_error, 'danger');

  $('hd-disconnect')?.classList.toggle('hidden', !view.has_api_key);
  const sync = view.sync || { synced: 0, failed: 0, pending: 0 };
  const showSync = view.has_api_key || sync.synced + sync.failed + sync.pending > 0;
  $('hd-sync-panel')?.classList.toggle('hidden', !showSync);
  $('hd-synced').textContent = String(sync.synced);
  $('hd-pending').textContent = String(sync.pending);
  $('hd-failed').textContent = String(sync.failed);
  $('hd-retry')?.classList.toggle('hidden', !(view.active && sync.failed + sync.pending > 0));
  toggleFields();
}

function freshdeskBody() {
  const body = { domain: $('hd-domain').value.trim() };
  const key = $('hd-api-key').value.trim();
  if (key) body.api_key = key;
  return body;
}

async function save() {
  setBusy(true);
  setMessage('Saving...', 'neutral');
  try {
    const provider = selectedProvider();
    const body = provider === 'freshdesk' ? { provider, ...freshdeskBody() } : { provider };
    const json = await request('', { method: 'PUT', body: JSON.stringify(body) });
    render(json.data);
    setMessage(json.message || 'Saved.', 'success');
    ctx.onChanged();
  } catch (err) {
    setMessage(err.message, 'danger');
  } finally {
    setBusy(false);
  }
}

async function test() {
  setBusy(true);
  setMessage('Checking Freshdesk...', 'neutral');
  try {
    const typed = freshdeskBody();
    const useTyped = typed.api_key || (current && typed.domain !== (current.freshdesk_domain || ''));
    const json = await request('/test', { method: 'POST', body: JSON.stringify(useTyped ? typed : {}) });
    const who = json.data.agent_name ? ` as ${json.data.agent_name}` : '';
    setMessage(`Connection works${who}. Press Save to send new tickets to Freshdesk.`, 'success');
  } catch (err) {
    setMessage(err.message, 'danger');
  } finally {
    setBusy(false);
  }
}

async function retry() {
  setBusy(true);
  setMessage('Sending...', 'neutral');
  try {
    const json = await request('/retry', { method: 'POST', body: '{}' });
    render(json.data);
    setMessage(`${json.data.synced} of ${json.data.attempted} tickets sent to Freshdesk.`, json.data.failed ? 'danger' : 'success');
  } catch (err) {
    setMessage(err.message, 'danger');
  } finally {
    setBusy(false);
  }
}

async function disconnect() {
  if (!window.confirm('Disconnect Freshdesk? New tickets will go to your AI Smart Engine inbox.')) return;
  setBusy(true);
  try {
    const json = await request('', { method: 'DELETE' });
    render(json.data);
    setMessage(json.message || 'Freshdesk disconnected.', 'success');
    ctx.onChanged();
  } catch (err) {
    setMessage(err.message, 'danger');
  } finally {
    setBusy(false);
  }
}

export async function loadHelpdesk() {
  if (!ctx || !ctx.getStoreId()) return;
  setMessage('', 'neutral');
  try {
    const json = await request('');
    render(json.data);
  } catch (err) {
    setMessage(err.message || ctx.loadErrorText, 'danger');
  }
}

export function initHelpdesk(options) {
  ctx = options;
  document.querySelectorAll('input[name="hd-provider"]').forEach((r) => r.addEventListener('change', () => {
    toggleFields();
    setMessage('', 'neutral');
  }));
  $('hd-save')?.addEventListener('click', save);
  $('hd-test')?.addEventListener('click', test);
  $('hd-retry')?.addEventListener('click', retry);
  $('hd-disconnect')?.addEventListener('click', disconnect);
}
