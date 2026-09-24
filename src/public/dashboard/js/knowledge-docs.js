// My Agent → Knowledge Documents: server-side upload (real PDF text extraction), list and remove.
// app.js passes in its auth/state helpers via initKnowledgeDocs().

let ctx = null;

function esc(value) {
  return ctx.escapeHtml(value == null ? '' : String(value));
}

function baseUrl() {
  return `/api/v1/dashboard/${ctx.getStoreId()}/agent/knowledge`;
}

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${ctx.getToken()}`, ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = json.message || (typeof json.error === 'string' ? json.error : json.error?.message) || 'Request failed';
    throw new Error(msg);
  }
  return json;
}

function setStatus(text, tone) {
  const el = document.getElementById('agent-doc-upload-status');
  if (!el) return;
  el.style.display = text ? 'block' : 'none';
  el.style.color = tone === 'error' ? '#dc2626' : tone === 'success' ? '#059669' : 'var(--color-text-secondary)';
  el.textContent = text || '';
}

function formatChars(n) {
  const count = Number(n) || 0;
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k characters` : `${count} characters`;
}

function renderDocs(docs) {
  const list = document.getElementById('agent-knowledge-docs');
  if (!list) return;
  if (!docs.length) {
    list.innerHTML = '<li class="form-hint" style="margin: 0;">No documents yet. Your agent currently learns from the website scan and the knowledge base text below.</li>';
    return;
  }
  list.innerHTML = docs.map(doc => `
    <li style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 10px 12px; border: 1px solid var(--color-border-default); border-radius: 8px;">
      <div style="min-width: 0;">
        <strong style="display: block; font-size: 13px; overflow-wrap: anywhere;">📄 ${esc(doc.file_name)}</strong>
        <small class="form-hint" style="display: block; margin: 2px 0 0;">${esc(formatChars(doc.char_count))}${doc.truncated ? ' · trimmed to the first 60k' : ''} · added ${esc(new Date(doc.created_at).toLocaleDateString())}</small>
        <small style="display: block; margin-top: 4px; color: var(--color-text-secondary); font-size: 12px; overflow-wrap: anywhere;">${esc((doc.preview || '').slice(0, 160))}${(doc.preview || '').length > 160 ? '…' : ''}</small>
      </div>
      <button type="button" class="btn btn-secondary btn-sm btn-remove-knowledge-doc" data-id="${esc(doc.id)}" data-name="${esc(doc.file_name)}">Remove</button>
    </li>`).join('');
}

export async function loadKnowledgeDocs() {
  if (!ctx || !ctx.getStoreId()) return;
  try {
    const json = await request('/documents');
    renderDocs(json.data || []);
  } catch (err) {
    setStatus(`Could not load documents: ${err.message}`, 'error');
  }
}

async function uploadFile(file) {
  const input = document.getElementById('agent-doc-upload');
  setStatus(`Reading ${file.name}…`);
  if (input) input.disabled = true;
  try {
    const form = new FormData();
    form.append('document', file);
    const json = await request('/documents', { method: 'POST', body: form });
    setStatus(`✅ ${json.message}`, 'success');
    ctx.showToast(json.message || `${file.name} added`);
    await loadKnowledgeDocs();
  } catch (err) {
    setStatus(`❌ ${err.message}`, 'error');
    ctx.showToast(`Upload failed: ${err.message}`);
  } finally {
    if (input) {
      input.disabled = false;
      input.value = '';
    }
  }
}

export function initKnowledgeDocs(helpers) {
  ctx = helpers;
  const input = document.getElementById('agent-doc-upload');
  if (input) {
    input.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        setStatus('❌ File is too large. Maximum size is 10MB.', 'error');
        input.value = '';
        return;
      }
      uploadFile(file);
    });
  }

  document.getElementById('agent-knowledge-docs')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-remove-knowledge-doc');
    if (!btn) return;
    if (!window.confirm(`Remove "${btn.dataset.name}" from your agent's knowledge?`)) return;
    btn.disabled = true;
    try {
      await request(`/documents/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
      ctx.showToast('Document removed');
      await loadKnowledgeDocs();
    } catch (err) {
      btn.disabled = false;
      ctx.showToast(`Could not remove: ${err.message}`);
    }
  });
}
