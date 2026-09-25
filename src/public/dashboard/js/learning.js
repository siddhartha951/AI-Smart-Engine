// My Agent → Teach your AI: questions the assistants could not answer (or got a 👎),
// the answers the merchant approved, and free-form notes. Approved answers are what the
// storefront assistant and Ask AI use; nothing is learned without the merchant.
// app.js passes in its auth/state helpers via initLearning().

let ctx = null;
let tab = 'open';

const SOURCE_LABEL = {
  unanswered: 'Assistant was not sure',
  thumbs_down: 'Marked 👎',
  merchant_note: 'Added by you',
};
const SURFACE_LABEL = { shopper: 'Storefront assistant', merchant: 'Ask AI' };

function $(id) {
  return document.getElementById(id);
}

function esc(value) {
  return ctx.escapeHtml(value == null ? '' : String(value));
}

async function request(path, options = {}) {
  const res = await fetch(`/api/v1/dashboard/${ctx.getStoreId()}/learning${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${ctx.getToken()}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.error?.message || 'Request failed');
  return json.data;
}

function renderStats(feedback, openCount) {
  const el = $('learn-stats');
  if (!el || !feedback) return;
  const s = feedback.shopper || { up: 0, down: 0 };
  const m = feedback.merchant || { up: 0, down: 0 };
  el.innerHTML = `
    <span><strong>${esc(openCount)}</strong> to teach</span>
    <span>Storefront, last 30 days: <strong>👍 ${esc(s.up)}</strong> · <strong>👎 ${esc(s.down)}</strong></span>
    <span>Ask AI: <strong>👍 ${esc(m.up)}</strong> · <strong>👎 ${esc(m.down)}</strong></span>`;
}

function renderItems(items) {
  const list = $('learn-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = tab === 'open'
      ? '<p class="section-subtitle">Nothing to teach right now. Questions your assistant could not answer will appear here.</p>'
      : '<p class="section-subtitle">No approved answers yet.</p>';
    return;
  }
  list.innerHTML = items.map((it) => `
    <div class="learn-item" data-learn-id="${esc(it.id)}">
      <div class="learn-item-q">${esc(it.question)}</div>
      <div class="learn-item-meta">${esc(SURFACE_LABEL[it.surface] || it.surface)} · ${esc(SOURCE_LABEL[it.source] || it.source)}${it.occurrences > 1 ? ` · asked ${esc(it.occurrences)} times` : ''}</div>
      ${it.bot_answer && tab === 'open' ? `<div class="learn-item-bot">Assistant said: ${esc(it.bot_answer.slice(0, 300))}</div>` : ''}
      ${tab === 'open'
        ? `<textarea rows="2" maxlength="2000" placeholder="Write the correct answer">${esc(it.correct_answer || '')}</textarea>
           <div class="learn-item-actions">
             <button type="button" class="btn btn-primary btn-sm" data-learn-approve>Approve answer</button>
             <button type="button" class="btn btn-ghost btn-sm" data-learn-dismiss>Dismiss</button>
           </div>`
        : `<div>${esc(it.correct_answer || '')}</div>
           <div class="learn-item-actions"><button type="button" class="btn btn-ghost btn-sm" data-learn-dismiss>Remove</button></div>`}
    </div>`).join('');
}

export async function loadLearning() {
  if (!ctx || !ctx.getStoreId() || !$('learning-panel')) return;
  try {
    const [current, open] = await Promise.all([
      request(`?status=${tab}`),
      tab === 'open' ? null : request('?status=open'),
    ]);
    renderItems(current.items || []);
    renderStats(current.feedback, (open || current).items.length);
  } catch (err) {
    const list = $('learn-list');
    if (list) list.innerHTML = `<p class="section-subtitle">${esc(err.message || 'Could not load')}</p>`;
  }
}

async function approve(card) {
  const answer = (card.querySelector('textarea')?.value || '').trim();
  if (answer.length < 2) {
    ctx.showToast('Write the correct answer first.', true);
    return;
  }
  try {
    await request(`/${card.getAttribute('data-learn-id')}/approve`, { method: 'POST', body: JSON.stringify({ answer }) });
    ctx.showToast('Approved. Your AI will use this answer from now on ✓');
    loadLearning();
  } catch (err) {
    ctx.showToast(err.message || 'Could not save', true);
  }
}

async function dismiss(card) {
  try {
    await request(`/${card.getAttribute('data-learn-id')}/dismiss`, { method: 'POST', body: '{}' });
    loadLearning();
  } catch (err) {
    ctx.showToast(err.message || 'Could not update', true);
  }
}

async function saveNote(e) {
  e.preventDefault();
  const status = $('learn-note-status');
  const answer = ($('learn-note-answer')?.value || '').trim();
  if (answer.length < 2) {
    if (status) status.textContent = 'Write what the AI should know.';
    return;
  }
  try {
    await request('/notes', {
      method: 'POST',
      body: JSON.stringify({ surface: $('learn-note-surface')?.value || 'shopper', question: ($('learn-note-question')?.value || '').trim(), answer }),
    });
    $('learn-note-question').value = '';
    $('learn-note-answer').value = '';
    if (status) status.textContent = 'Saved ✓';
    if (tab === 'approved') loadLearning();
  } catch (err) {
    if (status) status.textContent = err.message || 'Could not save';
  }
}

export function initLearning(options) {
  ctx = options;
  const panel = $('learning-panel');
  if (!panel) return;
  $('learn-refresh')?.addEventListener('click', () => loadLearning());
  $('learn-note-form')?.addEventListener('submit', saveNote);
  panel.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-learn-tab]');
    if (tabBtn) {
      tab = tabBtn.getAttribute('data-learn-tab');
      panel.querySelectorAll('[data-learn-tab]').forEach((b) => b.classList.toggle('active', b === tabBtn));
      loadLearning();
      return;
    }
    const card = e.target.closest('[data-learn-id]');
    if (!card) return;
    if (e.target.closest('[data-learn-approve]')) approve(card);
    else if (e.target.closest('[data-learn-dismiss]')) dismiss(card);
  });
}
