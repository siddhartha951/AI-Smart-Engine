// Growth Copilot → "Your plan for this goal": the AI's three moves for the Primary Goal,
// grounded in the store's real numbers, plus what happened after actions marked done.
// app.js passes in its auth/state helpers via initGoalBrief().

let ctx = null;
let seq = 0;

function $(id) {
  return document.getElementById(id);
}

function esc(value) {
  return ctx.escapeHtml(value == null ? '' : String(value));
}

function changeText(pct) {
  if (pct === null || pct === undefined) return 'no earlier sales to compare';
  const n = Number(pct);
  return `${n > 0 ? '▲' : n < 0 ? '▼' : ''} ${Math.abs(n).toFixed(1)}% revenue`;
}

function render(brief) {
  const body = $('copilot-brief-body');
  if (!body) return;
  const priorities = (brief.priorities || []).map((p, i) => `
    <li class="copilot-brief-item">
      <span class="copilot-brief-rank">${i + 1}</span>
      <div>
        <strong>${esc(p.title)}</strong>
        <p><span class="copilot-brief-label">Why:</span> ${esc(p.why)}</p>
        <p><span class="copilot-brief-label">How:</span> ${esc(p.how)}</p>
        ${p.expected_impact ? `<p class="copilot-brief-impact">${esc(p.expected_impact)}</p>` : ''}
        ${p.action_key ? `<button type="button" class="home-link" data-brief-action="${esc(p.action_key)}">See this action ↓</button>` : ''}
      </div>
    </li>`).join('');
  const watch = (brief.watch_out || []).length
    ? `<div class="copilot-brief-watch"><strong>Watch out:</strong><ul>${brief.watch_out.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : '';
  const results = (brief.results || []).length
    ? `<div class="copilot-brief-results"><strong>Results of actions you completed</strong> <span class="copilot-brief-note">(7 days after vs 7 days before; other things like sales or seasons also move numbers)</span><ul>${
      brief.results.map((r) => `<li>${esc(r.title)}: ${esc(changeText(r.revenue_change_pct))}</li>`).join('')}</ul></div>`
    : '';
  const source = brief.source === 'ai'
    ? `AI analysis · ${new Date(brief.generated_at).toLocaleString()}`
    : 'Ranked from your data (AI analysis unavailable right now)';
  body.innerHTML = `
    <p class="copilot-brief-headline">${esc(brief.headline)}</p>
    <p class="copilot-brief-summary">${esc(brief.summary)}</p>
    <ol class="copilot-brief-list">${priorities}</ol>
    ${watch}
    ${results}
    <p class="copilot-brief-note">${esc(source)}</p>`;
}

export async function loadGoalBrief(refresh = false) {
  if (!ctx || !ctx.getStoreId() || !$('copilot-brief-body')) return;
  const mine = ++seq;
  const body = $('copilot-brief-body');
  const btn = $('copilot-brief-refresh');
  if (refresh || !body.dataset.loaded) body.textContent = refresh ? 'Re-analysing your store…' : 'Loading your plan…';
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/api/v1/dashboard/${ctx.getStoreId()}/growth/goal-brief${refresh ? '?refresh=1' : ''}`, {
      headers: { 'Authorization': `Bearer ${ctx.getToken()}` },
    });
    const json = await res.json().catch(() => ({}));
    if (mine !== seq) return;
    if (!res.ok || !json.success) throw new Error(json.error?.message || 'Could not load the plan');
    render(json.data);
    body.dataset.loaded = '1';
  } catch (err) {
    if (mine === seq) body.textContent = err.message || 'Could not load the plan right now.';
  } finally {
    if (btn && mine === seq) btn.disabled = false;
  }
}

export function initGoalBrief(options) {
  ctx = options;
  $('copilot-brief-refresh')?.addEventListener('click', () => loadGoalBrief(true));
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-brief-action]');
    if (btn) ctx.openAction(btn.getAttribute('data-brief-action'));
  });
}
