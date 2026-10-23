// Admin page: invite codes, waitlist, flags, members. Everything is guarded by the admin key on the server.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
const date = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' });
let KEY = sessionStorage.getItem('adminKey') || '';
let tab = 'invites';
let notice = '';
const TABS = [['invites', 'Invite codes'], ['waitlist', 'Waitlist'], ['flags', 'Flagged totals'], ['members', 'Members']];

async function api(method, path, body) {
  const res = await fetch('/api/admin' + path, { method, headers: { 'content-type': 'application/json', 'x-admin-key': KEY }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 403 ? 'Wrong or missing admin key' : data.error || 'Something went wrong');
  return data;
}
const say = (m) => { notice = m; };
async function run(fn) { try { await fn(); } catch (e) { say(`Error: ${e.message}`); } render(); }

const views = {
  async invites() {
    const { invites, publicCode } = await api('GET', '/invites');
    return `<h3>Public founders code</h3>
      <p class="muted">Anyone with this code can join and starts a new caravan. Switch it off once your launch period ends.</p>
      <div class="inline"><div><div class="code2">${esc(publicCode.code || 'not set')}</div>${publicCode.enabled ? '<span class="pillbox ok">ON</span>' : '<span class="pillbox bad">OFF</span>'}</div>
        <button class="chip solid" data-a="pub" data-v="${publicCode.enabled ? '0' : '1'}">${publicCode.enabled ? 'Switch off' : 'Switch on'}</button>
        <button class="chip" data-a="pubnew">New random code</button></div>
      <div class="inline"><div><label>Set your own code</label><input id="pubset" placeholder="e.g. QAFILA2026" maxlength="20"></div><button class="chip" data-a="pubset">Set</button></div>
      <h3>Founder codes</h3>
      <p class="muted">One code per organiser or city lead. Each person who joins with it becomes the root of their own caravan.</p>
      <div class="inline"><div><label>Label</label><input id="flabel" placeholder="Lahore lead" maxlength="60"></div><div><label>Max uses (blank = unlimited)</label><input id="fmax" type="number" min="1" inputmode="numeric"></div><button class="chip solid" data-a="fnew">Create code</button></div>
      ${invites.length ? `<table><tr><th>Code</th><th>Label</th><th>Kind</th><th>Used</th><th></th></tr>${invites.map((i) => `<tr>
        <td class="code2">${esc(i.code)}</td><td>${esc(i.label)}</td><td>${esc(i.kind)}</td>
        <td>${i.uses}${i.maxUses ? ' / ' + i.maxUses : ''} · ${i.joined} joined</td>
        <td>${i.revoked ? '<span class="pillbox bad">REVOKED</span>' : `<button class="chip" data-a="revoke" data-code="${esc(i.code)}">Revoke</button>`}</td></tr>`).join('')}</table>` : '<p class="empty">No founder or waitlist codes yet.</p>'}`;
  },
  async waitlist() {
    const status = window.__wl || 'pending';
    const { requests } = await api('GET', `/waitlist?status=${status}`);
    return `<h3>Waitlist</h3>
      <div class="inline">${['pending', 'approved', 'rejected'].map((s) => `<button class="chip ${s === status ? 'solid' : ''}" data-a="wlfilter" data-s="${s}">${s}</button>`).join('')}</div>
      ${requests.length ? `<table><tr><th>Name</th><th>Contact</th><th>Requested</th><th></th></tr>${requests.map((r) => `<tr>
        <td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.city)}</span></td>
        <td dir="ltr">${esc(r.phone)}<br>${esc(r.email)}</td><td>${date(r.createdAt)}</td>
        <td>${r.status === 'pending' ? `<button class="chip solid" data-a="approve" data-id="${r.id}">Approve</button><button class="chip" data-a="reject" data-id="${r.id}">Reject</button>`
          : r.code ? `<span class="code2">${esc(r.code)}</span> <a class="chip" target="_blank" rel="noopener" href="https://wa.me/${esc(r.phone.replace(/\D/g, ''))}?text=${encodeURIComponent('Assalamu alaikum. Your Durood Qafila invite code: ' + r.code)}">WhatsApp</a>` : esc(r.status)}</td></tr>`).join('')}</table>` : `<p class="empty">Nothing ${status}.</p>`}`;
  },
  async flags() {
    const status = window.__fl || 'open';
    const { flags } = await api('GET', `/flags?status=${status}`);
    return `<h3>Flagged totals</h3>
      <p class="muted">A member is flagged over 20,000 in a day, or over 10 times their recent average. Flagged members are hidden from public ranks; their durood still counts everywhere. <b>Clear</b> shows them again. <b>Confirm</b> keeps them hidden.</p>
      <div class="inline">${['open', 'confirmed', 'cleared'].map((s) => `<button class="chip ${s === status ? 'solid' : ''}" data-a="flfilter" data-s="${s}">${s}</button>`).join('')}</div>
      ${flags.length ? `<table><tr><th>Member</th><th>Why</th><th>Total</th><th></th></tr>${flags.map((f) => `<tr>
        <td><b>${esc(f.username)}</b><br><span class="muted">${esc(f.city)} · joined ${esc(f.joined)}</span></td>
        <td>${esc(f.reason)}<br><span class="muted">${esc(f.day)} · ${esc(f.detail)}</span></td><td>${fmt(f.total)}</td>
        <td>${f.status === 'open' ? `<button class="chip solid" data-a="flclear" data-id="${f.id}">Clear</button><button class="chip" data-a="flconfirm" data-id="${f.id}">Confirm</button>` : `<span class="pillbox">${esc(f.status)}</span>`}</td></tr>`).join('')}</table>` : `<p class="empty">No ${status} flags.</p>`}`;
  },
  async members() {
    const q = window.__q || '';
    const { members } = await api('GET', `/members?q=${encodeURIComponent(q)}`);
    return `<h3>Members</h3>
      <div class="inline"><div><label>Search name, email, phone or city</label><input id="q" value="${esc(q)}"></div><button class="chip solid" data-a="search">Search</button></div>
      ${members.length ? `<table><tr><th>Member</th><th>Counts</th><th>Status</th><th>Actions</th></tr>${members.map((m) => `<tr>
        <td><b>${esc(m.username)}</b><br><span class="muted">${esc(m.city)} · ${esc(m.joined)}<br>${m.inviter ? 'invited by ' + esc(m.inviter) : esc(m.invitedVia)}</span></td>
        <td>${fmt(m.total)}<br><span class="muted">caravan ${fmt(m.team)}${m.invites ? `<br>invites ${m.invites.used}/${m.invites.cap}` : ''}</span></td>
        <td>${m.deleted ? '<span class="pillbox bad">DELETED</span>' : ''}${m.suspended ? '<span class="pillbox bad">SUSPENDED</span>' : ''}${m.hidden ? '<span class="pillbox">HIDDEN</span>' : ''}${m.emailVerified ? '<span class="pillbox ok">EMAIL OK</span>' : ''}<br><span class="muted" dir="ltr">${esc(m.email)}<br>${esc(m.phone)}</span></td>
        <td>${m.deleted ? '' : `
          <button class="chip" data-a="${m.suspended ? 'unsuspend' : 'suspend'}" data-u="${esc(m.username)}">${m.suspended ? 'Unsuspend' : 'Suspend'}</button>
          <button class="chip" data-a="${m.suspended ? 'unsuspendb' : 'suspendb'}" data-u="${esc(m.username)}">${m.suspended ? 'Unsuspend branch' : 'Suspend branch'}</button>
          <button class="chip" data-a="${m.hidden ? 'unhide' : 'hide'}" data-u="${esc(m.username)}">${m.hidden ? 'Unhide' : 'Hide from ranks'}</button>
          <button class="chip" data-a="resetlink" data-u="${esc(m.username)}">Reset link</button>`}</td></tr>`).join('')}</table>` : '<p class="empty">No members match.</p>'}`;
  },
};

async function render() {
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
  if (!KEY) { $('#panel').innerHTML = '<p class="empty">Enter the admin key above to begin.</p>'; return; }
  try { $('#panel').innerHTML = (notice ? `<div class="msg">${esc(notice)}</div>` : '') + (await views[tab]()); }
  catch (e) { $('#panel').innerHTML = `<div class="msg" style="border-color:var(--err)">${esc(e.message)}</div>`; }
  notice = '';
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; return render(); }
  const el = ev.target.closest('[data-a]');
  if (!el) return;
  const d = el.dataset;
  const act = {
    pub: () => api('POST', '/public-code', { enabled: d.v === '1' }),
    pubnew: () => api('POST', '/public-code', { code: '', enabled: true }),
    pubset: () => api('POST', '/public-code', { code: $('#pubset').value.trim() }),
    fnew: async () => { const r = await api('POST', '/invites', { label: $('#flabel').value, maxUses: $('#fmax').value }); say(`New founder code: ${r.code}`); },
    revoke: () => api('POST', `/invites/${d.code}/revoke`),
    wlfilter: async () => { window.__wl = d.s; },
    approve: async () => { const r = await api('POST', `/waitlist/${d.id}`, { action: 'approve' }); say(`Approved. Invite code ${r.code}${r.emailed ? ' (emailed)' : ''}. Send it over WhatsApp from the approved tab.`); window.__wl = 'approved'; },
    reject: () => api('POST', `/waitlist/${d.id}`, { action: 'reject' }),
    flfilter: async () => { window.__fl = d.s; },
    flclear: () => api('POST', `/flags/${d.id}`, { action: 'clear' }),
    flconfirm: () => api('POST', `/flags/${d.id}`, { action: 'confirm' }),
    search: async () => { window.__q = $('#q').value; },
    suspend: () => api('POST', `/members/${d.u}`, { action: 'suspend' }),
    unsuspend: () => api('POST', `/members/${d.u}`, { action: 'unsuspend' }),
    suspendb: () => confirm(`Suspend ${d.u} and everyone they invited, at every level?`) && api('POST', `/members/${d.u}`, { action: 'suspend', branch: true }).then((r) => say(`${r.affected} members suspended.`)),
    unsuspendb: () => api('POST', `/members/${d.u}`, { action: 'unsuspend', branch: true }).then((r) => say(`${r.affected} members restored.`)),
    hide: () => api('POST', `/members/${d.u}`, { action: 'hide' }),
    unhide: () => api('POST', `/members/${d.u}`, { action: 'unhide' }),
    resetlink: async () => { const r = await api('POST', `/members/${d.u}`, { action: 'reset-link' }); say(`Reset link for ${d.u} (works once, one hour): ${r.url}`); },
  }[d.a];
  if (act) run(act);
});

$('#save').onclick = () => { KEY = $('#key').value.trim(); sessionStorage.setItem('adminKey', KEY); $('#key').value = ''; render(); };
$('#auditBtn').onclick = async () => {
  try {
    const r = await api('GET', '/audit');
    $('#audit').innerHTML = `<div class="msg" style="${r.ok ? '' : 'border-color:var(--err)'}">${r.ok ? `Audit clean: ${fmt(r.users)} members, ${fmt(r.ledgerTotal)} durood, every total matches the ledger.` : `Audit found ${r.problems.length} problem(s): ${esc(JSON.stringify(r.problems.slice(0, 3)))}`}</div>`;
  } catch (e) { $('#audit').innerHTML = `<div class="msg" style="border-color:var(--err)">${esc(e.message)}</div>`; }
};
$('#mode').onclick = () => {
  const next = document.documentElement.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-mode', next);
  try { localStorage.setItem('mode', next); } catch { /* private mode */ }
};
if (KEY) $('#key').placeholder = 'Admin key (saved for this tab)';
render();
