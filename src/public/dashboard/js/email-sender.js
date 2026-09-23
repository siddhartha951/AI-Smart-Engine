// Email Automation → Sending identity & custom sender domain (DKIM / SPF / DMARC) panel.
// Kept separate from app.js; app.js passes in its auth/state helpers via initEmailSenderPanel().

let ctx = null;
let lastStatus = null;

const STATUS_BADGES = {
  verified: { cls: 'badge--success', label: 'Verified' },
  pending: { cls: 'badge--warning', label: 'Pending DNS' },
  not_started: { cls: 'badge--warning', label: 'Pending DNS' },
  temporary_failure: { cls: 'badge--warning', label: 'Retrying' },
  failed: { cls: 'badge--danger', label: 'Failed' },
  not_found: { cls: 'badge--warning', label: 'Not found' },
  unknown: { cls: 'badge--neutral', label: 'Could not check' },
};

function esc(value) {
  return ctx.escapeHtml(value == null ? '' : String(value));
}

function badge(status) {
  const b = STATUS_BADGES[status] || { cls: 'badge--neutral', label: status || 'Unknown' };
  return `<span class="badge ${b.cls}">${esc(b.label)}</span>`;
}

async function api(path, options = {}) {
  const res = await fetch(`/api/v1/dashboard/${ctx.getStoreId()}/email${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.getToken()}`,
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = json.message || (typeof json.error === 'string' ? json.error : json.error?.message) || 'Request failed';
    throw new Error(msg);
  }
  return json;
}

function renderIdentity(data) {
  const summary = document.getElementById('email-sender-summary');
  const modeBadge = document.getElementById('email-sender-mode-badge');
  if (!summary || !modeBadge) return;

  const id = data.identity;
  const pending = (data.domains || []).find(d => d.status !== 'verified');

  if (id.mode === 'verified_domain') {
    modeBadge.className = 'badge badge--success';
    modeBadge.textContent = 'White-label active';
  } else if (pending) {
    modeBadge.className = 'badge badge--warning';
    modeBadge.textContent = 'Default sender · domain pending';
  } else {
    modeBadge.className = 'badge badge--neutral';
    modeBadge.textContent = 'Default sender';
  }

  const replyLine = id.reply_to
    ? `Replies go to <strong>${esc(id.reply_to)}</strong>`
    : `<span style="color: var(--color-warning);">No reply-to set. Add a Support Email in My Agent so customer replies reach your inbox.</span>`;

  const recoveryLine = id.mode === 'verified_domain'
    ? 'Support tickets, receipts and abandoned-cart recovery emails all send from your domain.'
    : 'Support tickets and receipts are active now. Abandoned-cart recovery emails start once your domain is verified.';

  const providerNote = data.provider !== 'resend'
    ? `<div style="margin-top: 8px; font-size: 12px; color: var(--color-warning);">Email delivery is in "${esc(data.provider)}" mode on this server, so emails are recorded but not delivered.</div>`
    : '';

  summary.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; font-size: 13px;">
      <div>
        <small style="display: block; color: var(--color-text-secondary);">Emails are sent from</small>
        <code style="font-family: var(--font-mono, monospace); font-size: 12.5px;">${esc(id.from_address)}</code>
      </div>
      <div>
        <small style="display: block; color: var(--color-text-secondary);">Customer replies</small>
        ${replyLine}
      </div>
    </div>
    <p style="margin: 10px 0 0 0; font-size: 12px; color: var(--color-text-secondary);">${esc(recoveryLine)}</p>
    ${providerNote}
  `;
}

function renderDnsRows(domain) {
  const rows = (Array.isArray(domain.dns_records) ? domain.dns_records : []).map(r => ({
    purpose: r.record || '',
    type: r.type || '',
    name: r.name || '',
    value: r.value || '',
    priority: r.priority != null ? r.priority : '',
    status: r.status || 'pending',
    recommended: false,
  }));
  if (domain.dmarc) {
    rows.push({
      purpose: 'DMARC',
      type: 'TXT',
      name: domain.dmarc.name,
      value: domain.dmarc.value,
      priority: '',
      status: domain.dmarc.status,
      recommended: true,
    });
  }

  return rows.map(r => `
    <tr style="border-bottom: 1px solid var(--color-border-subtle, var(--color-border)); font-size: 12.5px;">
      <td style="padding: 10px 12px; white-space: nowrap;">${esc(r.purpose)}${r.recommended ? ' <span class="badge badge--info" style="font-size: 10px;">Recommended</span>' : ''}</td>
      <td style="padding: 10px 12px;">${esc(r.type)}</td>
      <td style="padding: 10px 12px; max-width: 220px;">
        <code style="word-break: break-all; font-size: 12px;">${esc(r.name)}</code>
        <button type="button" class="btn btn-ghost btn-sm email-dns-copy" data-copy="${esc(r.name)}" style="padding: 2px 6px; font-size: 11px;">Copy</button>
      </td>
      <td style="padding: 10px 12px; max-width: 320px;">
        <code style="word-break: break-all; font-size: 12px;">${esc(r.value)}</code>
        <button type="button" class="btn btn-ghost btn-sm email-dns-copy" data-copy="${esc(r.value)}" style="padding: 2px 6px; font-size: 11px;">Copy</button>
      </td>
      <td style="padding: 10px 12px; text-align: right;">${esc(r.priority)}</td>
      <td style="padding: 10px 12px;">${badge(r.status)}</td>
    </tr>
  `).join('');
}

function renderDomains(data) {
  const list = document.getElementById('email-domain-list');
  const form = document.getElementById('email-domain-form');
  if (!list || !form) return;

  const domains = data.domains || [];
  // One sending domain per store keeps the setup simple; remove it to switch domains
  form.classList.toggle('hidden', domains.length > 0);

  if (domains.length === 0) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = domains.map(d => `
    <div class="email-domain-card" data-domain-id="${esc(d.id)}" style="border: 1px solid var(--color-border); border-radius: 8px; padding: 16px; margin-top: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <strong style="font-size: 14px;">${esc(d.domain_name)}</strong>
          ${badge(d.status)}
          ${d.verified_at ? `<small style="color: var(--color-text-secondary);">Verified ${esc(new Date(d.verified_at).toLocaleDateString())}</small>` : ''}
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn btn-primary btn-sm email-domain-verify">${d.status === 'verified' ? 'Re-check DNS' : 'Verify DNS'}</button>
          <button type="button" class="btn btn-secondary btn-sm email-domain-remove" style="color: var(--color-danger);">Remove</button>
        </div>
      </div>

      <div style="display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-top: 14px;">
        <div class="form-group" style="margin: 0; flex: 1; min-width: 180px;">
          <label style="font-size: 12px;">Sender name</label>
          <input type="text" class="form-control email-sender-name" maxlength="120" value="${esc(d.sender_name || '')}" placeholder="e.g. Aniwell Support">
        </div>
        <div class="form-group" style="margin: 0; flex: 1; min-width: 200px;">
          <label style="font-size: 12px;">Sender email</label>
          <input type="email" class="form-control email-sender-email" maxlength="255" value="${esc(d.sender_email || '')}" placeholder="help@${esc(d.domain_name)}">
        </div>
        <button type="button" class="btn btn-secondary btn-sm email-sender-save">Save sender</button>
      </div>

      <div style="margin-top: 16px;">
        <div style="font-size: 13px; font-weight: 600; margin-bottom: 4px;">DNS records</div>
        <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0 0 8px 0;">
          Add these at your domain provider (GoDaddy, Cloudflare, Namecheap or Shopify → Settings → Domains → Manage DNS), then click Verify DNS. Changes usually take 5–30 minutes, occasionally up to 48 hours.
        </p>
        <div class="table-responsive" style="border: 1px solid var(--color-border); border-radius: 8px; overflow-x: auto;">
          <table class="data-table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align: left; font-size: 12px; color: var(--color-text-secondary); background: var(--color-surface-subtle);">
                <th style="padding: 10px 12px;">Purpose</th><th style="padding: 10px 12px;">Type</th><th style="padding: 10px 12px;">Name / Host</th>
                <th style="padding: 10px 12px;">Value</th><th style="padding: 10px 12px; text-align: right;">Priority</th><th style="padding: 10px 12px;">Status</th>
              </tr>
            </thead>
            <tbody>${renderDnsRows(d)}</tbody>
          </table>
        </div>
        ${d.dmarc && d.dmarc.status !== 'verified' ? `<p style="font-size: 11.5px; color: var(--color-text-secondary); margin: 8px 0 0 0;">DMARC is optional but recommended: Gmail and Yahoo expect it for bulk senders. This monitoring-only policy (<code>p=none</code>) never blocks your existing mail.</p>` : ''}
      </div>
    </div>
  `).join('');
}

export async function loadEmailSenderPanel() {
  if (!ctx || !ctx.getStoreId()) return;
  const summary = document.getElementById('email-sender-summary');
  try {
    const json = await api('/sender-status');
    lastStatus = json.data;
    renderIdentity(json.data);
    renderDomains(json.data);
  } catch (err) {
    if (summary) summary.innerHTML = `<span style="color: var(--color-danger); font-size: 13px;">Could not load sender settings: ${esc(err.message)}</span>`;
  }
}

async function withButton(btn, busyText, fn) {
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = busyText; }
  try {
    await fn();
  } catch (err) {
    ctx.showToast(err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    ctx.showToast('Copied to clipboard');
  } catch (_) {
    ctx.showToast('Copy failed. Select the text and copy it manually.', true);
  }
}

export function initEmailSenderPanel(helpers) {
  ctx = helpers;

  const form = document.getElementById('email-domain-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      withButton(btn, 'Adding domain...', async () => {
        await api('/domains', {
          method: 'POST',
          body: JSON.stringify({
            domain_name: document.getElementById('email-domain-name').value,
            sender_name: document.getElementById('email-domain-sender-name').value,
            sender_email: document.getElementById('email-domain-sender-email').value,
          }),
        });
        ctx.showToast('Domain added. Now add the DNS records shown below.');
        form.reset();
        await loadEmailSenderPanel();
      });
    });
  }

  const list = document.getElementById('email-domain-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const target = e.target.closest('button');
      if (!target) return;
      if (target.classList.contains('email-dns-copy')) {
        copyText(target.getAttribute('data-copy') || '');
        return;
      }

      const card = target.closest('.email-domain-card');
      const domainId = card && card.getAttribute('data-domain-id');
      if (!domainId) return;

      if (target.classList.contains('email-domain-verify')) {
        withButton(target, 'Checking DNS...', async () => {
          const json = await api(`/domains/${domainId}/verify`, { method: 'POST' });
          const status = json.data?.status;
          ctx.showToast(status === 'verified'
            ? 'Domain verified! Emails now send from your domain.'
            : 'DNS not verified yet. It can take up to 48 hours to propagate; try again shortly.', status !== 'verified');
          await loadEmailSenderPanel();
        });
      } else if (target.classList.contains('email-domain-remove')) {
        const domain = (lastStatus?.domains || []).find(d => d.id === domainId);
        if (!confirm(`Remove ${domain ? domain.domain_name : 'this domain'}? Emails will go back to the default sender and abandoned-cart recovery emails will pause.`)) return;
        withButton(target, 'Removing...', async () => {
          await api(`/domains/${domainId}`, { method: 'DELETE' });
          ctx.showToast('Domain removed. Using the default sender.');
          await loadEmailSenderPanel();
        });
      } else if (target.classList.contains('email-sender-save')) {
        withButton(target, 'Saving...', async () => {
          await api(`/domains/${domainId}`, {
            method: 'PUT',
            body: JSON.stringify({
              sender_name: card.querySelector('.email-sender-name').value,
              sender_email: card.querySelector('.email-sender-email').value,
            }),
          });
          ctx.showToast('Sender details saved.');
          await loadEmailSenderPanel();
        });
      }
    });
  }
}
