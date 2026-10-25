// Admin page: invite codes, waitlist, flags, members. Everything is guarded by the admin key on the server.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
const human = (n) => { const a = Math.abs(n); return a >= 1e7 ? `${Math.round(a / 1e5) / 100} crore` : a >= 1e5 ? `${Math.round(a / 1e3) / 100} lakh` : fmt(a); };
const pktToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const date = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' });
let KEY = sessionStorage.getItem('adminKey') || '';
let tab = 'challenge';
let notice = '';
const TABS = [['challenge', 'Challenge'], ['invites', 'Invite codes'], ['waitlist', 'Waitlist'], ['flags', 'Flagged totals'], ['members', 'Members'], ['moderation', 'Moderation'], ['news', 'News'], ['feed', 'Feed'], ['exports', 'Exports']];

async function api(method, path, body) {
  const res = await fetch('/api/admin' + path, { method, headers: { 'content-type': 'application/json', 'x-admin-key': KEY }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 403 ? 'Wrong or missing admin key' : data.error || 'Something went wrong');
  return data;
}
const say = (m) => { notice = m; };
async function run(fn) { try { await fn(); } catch (e) { say(`Error: ${e.message}`); } render(); }

const views = {
  async challenge() {
    const { summary: c, series } = await api('GET', '/challenge');
    const planned = c.plannedPerDay;
    const state = { waiting: 'Waiting for the first member', upcoming: `Starts in ${c.startsIn} day(s)`, running: `Day ${c.dayIndex} of ${c.days}`, over: `Day ${c.dayIndex} of ${c.days}: past the deadline, still counting`, done: 'Target reached' }[c.state];
    return `<h3>40-day challenge</h3>
      <div class="msg" style="word-break:normal"><b>${esc(state)}</b><br>${fmt(c.total)} of ${fmt(c.target)} (${human(c.total)} of ${human(c.target)}) · plan ${fmt(planned)} a day
        ${c.state === 'running' ? `<br>Needed today: <b>${fmt(c.neededToday)}</b> · reported today: ${fmt(c.today)} · ${c.gap >= 0 ? 'ahead' : 'behind'} by ${human(c.gap)}${c.projectedTotal != null ? ` · projection ${human(c.projectedTotal)}` : ''}` : ''}</div>
      <p class="muted">The clock starts on the day the first member joins. If a test account started it too early, correct the start date here. The meter counts everything reported since the start day and keeps counting after the last day; the challenge boards cover the ${c.days} days only.</p>
      <div class="inline"><div><label>Start date (Pakistan time)</label><input id="chstart" type="date" value="${esc(c.start || '')}"></div>
        <div><label>Days</label><input id="chdays" type="number" min="1" max="365" value="${c.days}"></div>
        <div><label>Target (durood)</label><input id="chtarget" type="number" min="1000000" value="${c.target}"></div></div>
      <div class="inline"><label class="check" style="margin:0"><input type="checkbox" id="chclear"> Also forget the crores already recorded</label>
        <button class="chip solid" data-a="chsave">Save</button><button class="chip" data-a="chtoday">Start today</button></div>
      <h3>Recent days</h3>
      ${series.length ? `<table><tr><th>Day</th><th>Reported</th><th>Plan</th><th>Of plan</th></tr>${series.slice(-14).reverse().map((d) => `<tr><td>${esc(d.day)}</td><td>${fmt(d.total)}</td><td>${fmt(planned)}</td><td>${Math.round((d.total / planned) * 100)}%</td></tr>`).join('')}</table>` : '<p class="empty">Nothing reported yet.</p>'}
      ${c.milestones.length ? `<h3>Crores reached</h3><table><tr><th>Crore</th><th>When</th></tr>${c.milestones.map((m) => `<tr><td>${m.k}</td><td>${date(m.at)}</td></tr>`).join('')}</table>` : ''}`;
  },
  async news() {
    const { items } = await api('GET', '/news');
    return `<h3>Post an announcement</h3>
      <p class="muted">Short and newest first. Members see it under the bell. Tick the box to also send a notification to everyone who turned reminders on.</p>
      <label>Title (English)</label><input id="ntE" maxlength="120">
      <label>Title (Urdu, optional)</label><input id="ntU" maxlength="120" dir="rtl">
      <label>Text (English, optional)</label><textarea id="nbE" maxlength="600" rows="2"></textarea>
      <label>Text (Urdu, optional)</label><textarea id="nbU" maxlength="600" rows="2" dir="rtl"></textarea>
      <div class="inline"><label class="check" style="margin:0"><input type="checkbox" id="npush"> Also send a notification</label><button class="chip solid" data-a="newspost">Post</button></div>
      <h3>Posted</h3>
      ${items.length ? `<table><tr><th>When</th><th>Title</th><th></th></tr>${items.map((a) => `<tr><td>${date(a.created_at)}</td><td>${esc(a.title_en)}</td><td><button class="chip" data-a="newsdel" data-id="${a.id}">Delete</button></td></tr>`).join('')}</table>` : '<p class="empty">Nothing posted yet.</p>'}`;
  },
  async feed() {
    const [{ lectures }, { prompts }, { items }, { days }] = await Promise.all([api('GET', '/lectures'), api('GET', '/prompts'), api('GET', '/reported'), api('GET', '/special-days')]);
    const photoLink = (i) => (i.photoUrl ? `<a href="${esc(i.photoUrl)}" target="_blank" rel="noopener">photo</a>` : '');
    return `<h3>Lecture of the week</h3>
      <p class="muted">Members see the lectures whose week is the current one. Any date in the week works. A quiz is optional: a JSON list like <code>[{"q_en":"Where was the Prophet ﷺ born?","options_en":["Makkah","Madinah"],"answer":0}]</code>.</p>
      <div class="inline"><div><label>YouTube id (11 characters)</label><input id="lyt" maxlength="11"></div><div><label>Week (any date)</label><input id="lwk" type="date" value="${pktToday()}"></div><div><label>Minimum watch (seconds)</label><input id="lmin" type="number" min="30" value="600"></div></div>
      <label>Title (English)</label><input id="ltE" maxlength="120"><label>Title (Urdu, optional)</label><input id="ltU" maxlength="120" dir="rtl"><label>Speaker</label><input id="lsp" maxlength="80">
      <label>Quiz (optional JSON)</label><textarea id="lqz" rows="3"></textarea>
      <div class="inline"><button class="chip solid" data-a="lecadd">Add lecture</button></div>
      ${lectures.length ? `<table><tr><th>Week</th><th>Title</th><th>Speaker</th><th></th></tr>${lectures.map((l) => `<tr><td>${esc(l.week_start)}</td><td>${esc(l.title_en)}</td><td>${esc(l.speaker)}</td><td><button class="chip" data-a="lecdel" data-id="${l.id}">Delete</button></td></tr>`).join('')}</table>` : '<p class="empty">No lectures yet.</p>'}
      <h3>Question of the day</h3>
      <p class="muted">Shown above the daily reflection box. A day without a question shows a general prompt.</p>
      <div class="inline"><div><label>Day</label><input id="pday" type="date" value="${pktToday()}"></div></div>
      <label>Question (English)</label><input id="ptE" maxlength="200"><label>Question (Urdu, optional)</label><input id="ptU" maxlength="200" dir="rtl">
      <div class="inline"><button class="chip solid" data-a="promptset">Save question</button></div>
      ${prompts.length ? `<table><tr><th>Day</th><th>Question</th></tr>${prompts.slice(0, 10).map((p) => `<tr><td>${esc(p.day)}</td><td>${esc(p.text_en)}</td></tr>`).join('')}</table>` : ''}
      <h3>Special days</h3>
      <p class="muted">Every Friday is special automatically. Add other days (the first of Ramadan, 12 Rabi ul Awwal, a night of worship): members see a banner and get a bonus quest for reaching their goal that day.</p>
      <div class="inline"><div><label>Day</label><input id="sday" type="date" value="${pktToday()}"></div></div>
      <label>Name (English)</label><input id="snE" maxlength="60"><label>Name (Urdu, optional)</label><input id="snU" maxlength="60" dir="rtl">
      <div class="inline"><button class="chip solid" data-a="specialset">Save day</button></div>
      ${days.length ? `<table><tr><th>Day</th><th>Name</th><th></th></tr>${days.slice(0, 15).map((d) => `<tr><td>${esc(d.day)}</td><td>${esc(d.name_en)}</td><td><button class="chip" data-a="specialdel" data-day="${esc(d.day)}">Remove</button></td></tr>`).join('')}</table>` : ''}
      <h3>Reported or hidden</h3>
      <p class="muted">Three reports from different members hide a photo or reflection. Restore it, or leave it removed.</p>
      ${items.length ? `<table><tr><th>Kind</th><th>Member</th><th>Content</th><th>Reports</th><th>Status</th><th></th></tr>${items.map((i) => `<tr><td>${esc(i.kind)}</td><td>${esc(i.username)}</td><td>${esc(i.text || '')} ${photoLink(i)}</td><td>${i.reports}</td><td>${esc(i.status)}</td>
        <td>${i.status === 'removed' ? `<button class="chip solid" data-a="restore2" data-kind="${esc(i.kind)}" data-id="${i.id}">Restore</button>` : `<button class="chip" data-a="remove2" data-kind="${esc(i.kind)}" data-id="${i.id}">Remove</button>`}</td></tr>`).join('')}</table>` : '<p class="empty">Nothing reported.</p>'}`;
  },
  async exports() {
    return `<h3>Exports</h3><p class="muted">CSV files of totals as reported by members. Deleted members stay in totals. Open in Excel or Google Sheets.</p>
      <div class="inline"><button class="chip solid" data-a="exp" data-k="cities">Totals by city</button><button class="chip solid" data-a="exp" data-k="caravans">Totals by caravan</button><button class="chip solid" data-a="exp" data-k="qabilas">Totals by Qabila (invite tree)</button><button class="chip solid" data-a="exp" data-k="weeks">Totals by week</button></div>`;
  },
  async invites() {
    const { invites, publicCode } = await api('GET', '/invites');
    return `<h3>Public founders code</h3>
      <p class="muted">Anyone with this code can join and starts a new caravan. Switch it off once your launch period ends.</p>
      <div class="inline"><div><div class="code2">${esc(publicCode.code || 'not set')}</div>${publicCode.enabled ? '<span class="pillbox ok">ON</span>' : '<span class="pillbox bad">OFF</span>'}</div>
        <div><label>Sign-ups a day (0 closes it)</label><input id="pubcap" type="number" min="0" value="${publicCode.dailyCap}" style="max-width:110px"><small class="muted">${publicCode.usedToday} used today</small></div><button class="chip" data-a="pubcap">Set limit</button>
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
          : r.code ? `<span class="code2">${esc(r.code)}</span> <a class="chip" target="_blank" rel="noopener" href="https://wa.me/${esc(r.phone.replace(/\D/g, ''))}?text=${encodeURIComponent('Assalamu alaikum. Your Seerah Quest invite code: ' + r.code)}">WhatsApp</a>` : esc(r.status)}</td></tr>`).join('')}</table>` : `<p class="empty">Nothing ${status}.</p>`}`;
  },
  async flags() {
    const status = window.__fl || 'open';
    const { flags } = await api('GET', `/flags?status=${status}`);
    return `<h3>Flagged totals</h3>
      <p class="muted">A member is flagged over 20,000 in a day, or over 10 times their recent average. Flagged members are hidden from public ranks and their durood is held out of the national, challenge and caravan totals (it stays in their own total). <b>Release</b> counts it again and shows them. <b>Keep held</b> keeps it out until you unhide the member.</p>
      <div class="inline">${['open', 'confirmed', 'cleared'].map((s) => `<button class="chip ${s === status ? 'solid' : ''}" data-a="flfilter" data-s="${s}">${s}</button>`).join('')}</div>
      ${flags.length ? `<table><tr><th>Member</th><th>Why</th><th>Total</th><th></th></tr>${flags.map((f) => `<tr>
        <td><b>${esc(f.username)}</b><br><span class="muted">${esc(f.city)} · joined ${esc(f.joined)}</span></td>
        <td>${esc(f.reason)}<br><span class="muted">${esc(f.day)} · ${esc(f.detail)}</span></td><td>${fmt(f.total)}</td>
        <td>${f.status === 'open' ? `<button class="chip solid" data-a="flclear" data-id="${f.id}">Release</button><button class="chip" data-a="flconfirm" data-id="${f.id}">Keep held</button>` : `<span class="pillbox">${esc(f.status)}</span>`}</td></tr>`).join('')}</table>` : `<p class="empty">No ${status} flags.</p>`}`;
  },
  async moderation() {
    const q = window.__mq || '', filter = window.__mf || 'photos', cq = window.__cq || '';
    const [{ profiles }, { caravans }, { log }] = await Promise.all([api('GET', `/profiles?q=${encodeURIComponent(q)}&filter=${filter}`), api('GET', `/caravans?q=${encodeURIComponent(cq)}`), api('GET', '/log')]);
    const thumb = (p) => p.avatar ? `<img src="${esc(p.avatar)}" width="64" height="64" style="border-radius:50%;object-fit:cover;background:#ddd" alt="">` : '<span class="muted">no photo</span>';
    return `<h3>Pictures and names</h3>
      <p class="muted">Every member sees profile pictures, names and one-line bios. Remove what should not be there. The member can add a new one; to stop a repeat offender, suspend them in Members.</p>
      <div class="inline"><div><label>Search username, name, bio or city</label><input id="mq" value="${esc(q)}"></div>
        ${[['photos', 'With a photo'], ['text', 'With a name or line'], ['all', 'Everyone']].map(([k, l]) => `<button class="chip ${k === filter ? 'solid' : ''}" data-a="mfilter" data-f="${k}">${l}</button>`).join('')}<button class="chip solid" data-a="msearch">Search</button></div>
      ${profiles.length ? `<table><tr><th>Photo</th><th>Member</th><th>Name and line</th><th></th></tr>${profiles.map((p) => `<tr><td>${thumb(p)}</td>
        <td><b>${esc(p.username)}</b>${p.suspended ? ' <span class="pillbox bad">SUSPENDED</span>' : ''}<br><span class="muted">${esc(p.city)} · ${esc(p.joined)}${p.avatarAt ? `<br>photo ${date(p.avatarAt)}` : ''}</span></td>
        <td>${esc(p.displayName) || '<span class="muted">no name</span>'}<br><span class="muted">${esc(p.bio)}</span></td>
        <td>${p.avatar ? `<button class="chip" data-a="rmavatar" data-u="${esc(p.username)}">Remove photo</button>` : ''}${p.displayName || p.bio ? `<button class="chip" data-a="clearprofile" data-u="${esc(p.username)}">Clear name and line</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="empty">Nothing matches.</p>'}
      <h3>Caravans</h3>
      <div class="inline"><div><label>Search caravan name or owner</label><input id="cq" value="${esc(cq)}"></div><button class="chip solid" data-a="csearch">Search</button></div>
      ${caravans.length ? `<table><tr><th>Caravan</th><th>Owner</th><th>Members</th><th></th></tr>${caravans.map((c) => `<tr><td><b>${esc(c.name)}</b><br><span class="muted">${date(c.created_at)}</span></td><td>${esc(c.owner)}</td>
        <td>${fmt(c.members)}<br><span class="muted">${esc(c.sample || '')}${c.members > 6 ? ', …' : ''}</span></td>
        <td><button class="chip" data-a="cvrename" data-id="${c.id}" data-n="${esc(c.name)}">Rename</button><button class="chip" data-a="cvdelete" data-id="${c.id}" data-n="${esc(c.name)}">Delete</button></td></tr>`).join('')}</table>` : '<p class="empty">No caravans.</p>'}
      <h3>Recent moderation actions</h3>
      ${log.length ? `<table><tr><th>When</th><th>Action</th><th>Target</th><th>Detail</th></tr>${log.map((l) => `<tr><td>${date(l.at)}</td><td>${esc(l.action)}</td><td>${esc(l.target)}</td><td class="muted">${esc(l.detail)}</td></tr>`).join('')}</table>` : '<p class="empty">Nothing yet.</p>'}`;
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
  try {
    const st = await api('GET', '/status');
    const a = st.lastAudit;
    $('#audit').innerHTML = `<div class="msg" style="${a && !a.ok ? 'border-color:var(--err)' : ''}">Nightly audit: ${a ? `${date(a.at)} · ${a.ok ? 'clean' : `${a.problems} problem(s), run the audit`}` : 'not run yet (runs after 03:00 Pakistan time)'} · Last backup: ${st.lastBackup ? date(st.lastBackup) : 'none yet (set BACKUP_DIR)'}</div>`;
  } catch { /* status is a nicety */ }
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; return render(); }
  const el = ev.target.closest('[data-a]');
  if (!el) return;
  const d = el.dataset;
  const act = {
    chsave: async () => { const r = await api('POST', '/challenge', { start: $('#chstart').value, days: Number($('#chdays').value), target: Number($('#chtarget').value), clearMilestones: $('#chclear').checked }); say(`Saved. ${r.summary.start} to ${r.summary.end}, target ${fmt(r.summary.target)}.`); },
    newspost: async () => { await api('POST', '/news', { title_en: $('#ntE').value, title_ur: $('#ntU').value, body_en: $('#nbE').value, body_ur: $('#nbU').value, push: $('#npush').checked }); say('Posted.'); },
    newsdel: async () => { if (!confirm('Delete this announcement?')) return; await api('DELETE', `/news/${d.id}`); say('Deleted.'); },
    exp: async () => {
      const { csv } = await api('GET', `/export?kind=${d.k}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `seerah-quest-${d.k}-${pktToday()}.csv`; a.click();
      say('Downloaded.');
    },
    lecadd: async () => {
      const qz = $('#lqz').value.trim();
      await api('POST', '/lectures', { youtube_id: $('#lyt').value.trim(), week: $('#lwk').value, min_seconds: Number($('#lmin').value), title_en: $('#ltE').value, title_ur: $('#ltU').value, speaker: $('#lsp').value, questions: qz ? JSON.parse(qz) : undefined });
      say('Lecture added.');
    },
    lecdel: async () => { if (!confirm('Delete this lecture?')) return; await api('DELETE', `/lectures/${d.id}`); say('Deleted.'); },
    promptset: async () => { await api('POST', '/prompts', { day: $('#pday').value, text_en: $('#ptE').value, text_ur: $('#ptU').value }); say('Question saved.'); },
    specialset: async () => { await api('POST', '/special-days', { day: $('#sday').value, name_en: $('#snE').value, name_ur: $('#snU').value }); say('Day saved.'); },
    specialdel: async () => { await api('DELETE', `/special-days/${d.day}`); say('Removed.'); },
    remove2: async () => { await api('POST', `/content/${d.kind}/${d.id}`, { action: 'remove' }); say('Removed.'); },
    restore2: async () => { await api('POST', `/content/${d.kind}/${d.id}`, { action: 'restore' }); say('Restored.'); },
    chtoday: async () => { if (!confirm('Make today day 1 of the challenge?')) return; await api('POST', '/challenge', { start: pktToday() }); say('Day 1 is now today.'); },
    pub: () => api('POST', '/public-code', { enabled: d.v === '1' }),
    pubcap: async () => { await api('POST', '/public-code', { dailyCap: Number($('#pubcap').value) }); say('Daily limit saved.'); },
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
    msearch: async () => { window.__mq = $('#mq').value; },
    mfilter: async () => { window.__mf = d.f; window.__mq = $('#mq')?.value || ''; },
    csearch: async () => { window.__cq = $('#cq').value; },
    rmavatar: async () => { if (!confirm(`Remove ${d.u}'s picture?`)) return; await api('POST', `/members/${d.u}`, { action: 'remove-avatar' }); say('Picture removed.'); },
    clearprofile: async () => { if (!confirm(`Remove ${d.u}'s picture, name and line?`)) return; await api('POST', `/members/${d.u}`, { action: 'clear-profile' }); say('Cleared.'); },
    cvrename: async () => { const n = prompt('New name for this caravan (3-20 letters, numbers or _):', d.n); if (!n || n === d.n) return; await api('PUT', `/caravans/${d.id}`, { name: n }); say('Renamed.'); },
    cvdelete: async () => { if (!confirm(`Delete the caravan "${d.n}"? Its members stay in the app but leave the caravan.`)) return; await api('DELETE', `/caravans/${d.id}`); say('Deleted.'); },
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
