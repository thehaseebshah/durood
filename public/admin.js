// Admin page. Sign in as a member with a role (owner, moderator, organiser) or with the shared admin key (acts as owner). The server checks every request; hiding tabs here is only a courtesy.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
const human = (n) => { const a = Math.abs(n); return a >= 1e7 ? `${Math.round(a / 1e5) / 100} crore` : a >= 1e5 ? `${Math.round(a / 1e3) / 100} lakh` : fmt(a); };
const pktToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const date = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' });
// a <label> without `for` tells a screen reader nothing: tie each one to the field that follows it (or sits inside it)
function linkLabels() {
  let n = 0;
  for (const l of document.querySelectorAll('label:not([for])')) {
    const f = l.querySelector('input,select,textarea') || l.nextElementSibling?.matches('input,select,textarea') && l.nextElementSibling
      || l.nextElementSibling?.querySelector?.('input,select,textarea') || l.parentElement?.querySelector('input,select,textarea');
    if (!f || l.contains(f)) continue;
    if (!f.id) f.id = `f-auto-${n++}`;
    l.htmlFor = f.id;
  }
}
const store = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* private mode */ } };
// the same device token the app keeps: this browser can still sign in when strangers have locked the account with wrong guesses
const deviceGet = () => { try { return localStorage.getItem('device'); } catch { return null; } };
const deviceSet = (v) => { try { localStorage.setItem('device', v); } catch { /* private mode */ } };
const load = (k) => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } };
let KEY = load('adminKey'), TOKEN = load('adminToken'), ME = null, showKey = false;
const can = (p) => !!ME?.can.includes(p);
let tab = 'challenge';
let notice = '';
// [id, label, permission(s): the tab shows if the role has any of them]
const TABS = [['challenge', 'Challenge', ['status']], ['invites', 'Invite codes', ['organise']], ['members', 'Members', ['members']], ['caravans', 'Caravans', ['organise', 'moderate']], ['flags', 'Flagged totals', ['moderate']], ['reported', 'Reported', ['moderate']], ['profiles', 'Pictures and names', ['moderate']], ['news', 'News', ['organise']], ['sunnahs', 'Sunnahs', ['organise']], ['majalis', 'Majalis', ['organise']], ['exports', 'Exports', ['organise']], ['waitlist', 'Waitlist', ['organise']], ['admins', 'Admins', ['manage_admins']], ['audit', 'Audit', ['audit']], ['log', 'Log', ['log']]];
const tabOk = ([, , perms]) => perms.some(can);

// what an error code means, in words an organiser can act on
const ADMIN_ERR = {
  bad_cap: 'The limit must be a whole number from 0 to 100,000.', bad_action: 'That action is not recognised. Reload the page and try again.',
  bad_date: 'Pick a valid start date.', bad_days: 'Days must be a whole number from 1 to 365.',
  bad_target: 'The target must be between 10 lakh and 1,000 crore.', bad_news: 'News needs an English title of up to 120 characters.', bad_export: 'That export is not available. Reload the page and try again.',
  not_allowed: 'Your role cannot do that.', rate_limited: 'Too many tries. Wait a few minutes.', not_found: 'That was not found. It may have been removed already.',
  bad_sunnah: 'Each Sunnah needs a day (YYYY-MM-DD) and an English text.', sunnah_in_use: 'Members have already ticked or posted this Sunnah. Edit its text instead of removing it.',
  bad_special: 'A special day needs a date and an English name.', photo_gone: 'This photo was already deleted from the server (photos are kept 14 days), so it cannot be shown again.',
  bad_role: 'Pick owner, moderator or organiser.', own_role: 'You cannot change your own role.', last_owner: 'There must always be at least one owner.',
  remove_role_first: 'This member holds an admin role. Remove the role first, then delete the account.',
  member_not_found: 'No active member has that username.', caravan_not_found: 'No caravan has that name.', already_in_caravan: 'That member is already in a caravan. Remove them from it first.',
  caravan_name_taken: 'That name is already used by a member or another caravan.', bad_caravan_name: 'A caravan name is 3 to 20 English letters, numbers or _.',
  bad_username: 'A username is 3 to 20 letters, numbers or _ (and not a reserved word).', bad_email: 'Enter a valid email address.', bad_phone: 'Enter a valid phone number and pick its country.', bad_password: 'The password must be 6 to 128 characters.',
  city_required: 'Search for the city and pick it from the list.', username_taken: 'That username is taken.', account_exists: 'An account already uses this email or phone number.',
  already_resolved: 'This request was already decided.', bad_name: 'Enter a name of at least 2 characters.', bad_invite: 'That code is not valid.',
};
async function api(method, path, body) {
  const res = await fetch('/api/admin' + path, { method, headers: { 'content-type': 'application/json', ...(TOKEN ? { 'x-admin-token': TOKEN } : { 'x-admin-key': KEY }) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.error === 'forbidden') { if (ME) signOut('Your session ended. Sign in again.'); throw new Error('Not signed in'); }
  if (!res.ok) throw new Error(ADMIN_ERR[data.error] || data.error || 'Something went wrong');
  return data;
}
const say = (m) => { notice = m; };
async function run(fn) { try { if ((await fn()) === 'stay') return; } catch (e) { say(`Error: ${e.message}`); } render(); } // 'stay': the action filled a form, keep it

const views = {
  async challenge() {
    const { summary: c, series } = await api('GET', '/challenge');
    const planned = c.plannedPerDay;
    const state = { waiting: 'Waiting for the first member', upcoming: `Starts in ${c.startsIn} day(s)`, running: `Day ${c.dayIndex} of ${c.days}`, over: `Day ${c.dayIndex} of ${c.days}: past the deadline, still counting`, done: 'Target reached' }[c.state];
    return `<h3>Community challenge</h3>
      <div class="msg" style="word-break:normal"><b>${esc(state)}</b><br>${fmt(c.total)} of ${fmt(c.target)} (${human(c.total)} of ${human(c.target)}) · plan ${fmt(planned)} a day
        ${c.state === 'running' ? `<br>Needed today: <b>${fmt(c.neededToday)}</b> · reported today: ${fmt(c.today)} · ${c.gap >= 0 ? 'ahead' : 'behind'} by ${human(c.gap)}${c.projectedTotal != null ? ` · projection ${human(c.projectedTotal)}` : ''}` : ''}</div>
      <p class="muted">One fixed challenge. The clock starts on the day the first member joins. If a test account started it too early, correct the start date here. The meter counts everything reported since the start day and keeps counting after the last day; the challenge boards cover the ${c.days} days only.</p>
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
      <p class="muted">Short and newest first. Members see it under the bell and in the Feed.</p>
      <label>Title (English)</label><input id="ntE" maxlength="120">
      <label>Title (Urdu, optional)</label><input id="ntU" maxlength="120" dir="rtl">
      <label>Text (English, optional)</label><textarea id="nbE" maxlength="600" rows="2"></textarea>
      <label>Text (Urdu, optional)</label><textarea id="nbU" maxlength="600" rows="2" dir="rtl"></textarea>
      <div class="inline"><button class="chip solid" data-a="newspost">Post</button></div>
      <h3>Posted</h3>
      ${items.length ? `<table><tr><th>When</th><th>Title</th><th></th></tr>${items.map((a) => `<tr><td>${date(a.created_at)}</td><td>${esc(a.title_en)}</td><td><button class="chip" data-a="newsdel" data-id="${a.id}">Delete</button></td></tr>`).join('')}</table>` : '<p class="empty">Nothing posted yet.</p>'}`;
  },
  async sunnahs() {
    const [{ days }, { sunnahs }] = await Promise.all([api('GET', '/special-days'), api('GET', '/sunnahs')]);
    const today = pktToday();
    // the next 14 days without a Sunnah: members see "not published yet" on those days
    const gaps = Array.from({ length: 14 }, (_, i) => new Date(Date.parse(today + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10)).filter((d) => !sunnahs.some((x) => x.day === d));
    return `<h3>Sunnah of the day</h3>
      <p class="muted">Members see the day's Sunnah on Today, tick it (+20) and can post a photo of it (+40). A day without one shows "not published yet".</p>
      ${gaps.length ? `<div class="msg" style="border-color:var(--err)">No Sunnah yet for: ${gaps.map((d) => esc(d)).join(', ')}</div>` : '<p class="muted">Every day of the next two weeks has a Sunnah.</p>'}
      <div class="inline"><div><label>Day</label><input id="sudy" type="date" value="${esc(gaps[0] || today)}"></div><div><label>Source (e.g. Bukhari 5376)</label><input id="susrc" maxlength="120"></div></div>
      <label>Sunnah (English)</label><input id="sutE" maxlength="120"><label>Sunnah (Urdu)</label><input id="sutU" maxlength="120" dir="rtl">
      <label>How to do it (English, optional)</label><textarea id="sudE" maxlength="600" rows="2"></textarea><label>How to do it (Urdu, optional)</label><textarea id="sudU" maxlength="600" rows="2" dir="rtl"></textarea>
      <div class="inline"><button class="chip solid" data-a="sunset">Save Sunnah</button></div>
      <details><summary>Add many at once</summary><p class="muted">A JSON list: <code>[{"day":"2026-11-01","title_en":"Eat with the right hand","title_ur":"…","desc_en":"…","desc_ur":"…","source":"Muslim 2020"}]</code>. A day that already has one is replaced.</p>
      <textarea id="subulk" rows="4"></textarea><div class="inline"><button class="chip" data-a="sunbulk">Save all</button></div></details>
      ${sunnahs.length ? `<table><tr><th>Day</th><th>Sunnah</th><th>Source</th><th></th></tr>${sunnahs.map((x) => `<tr${x.day < today ? ' style="opacity:.6"' : ''}><td>${esc(x.day)}</td><td>${esc(x.title_en)}${x.title_ur ? `<br><span dir="rtl">${esc(x.title_ur)}</span>` : ' <small class="muted">(no Urdu)</small>'}</td><td>${esc(x.source)}</td>
        <td><button class="chip" data-a="sunedit" data-day="${esc(x.day)}">Edit</button> ${x.day >= today ? `<button class="chip" data-a="sundel" data-day="${esc(x.day)}">Remove</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="empty">No Sunnahs scheduled.</p>'}
      <h3>Special days</h3>
      <p class="muted">Every Friday is special automatically. Add other days (the first of Ramadan, 12 Rabi ul Awwal, a night of worship): members see a banner and get a bonus quest for reaching their goal that day.</p>
      <div class="inline"><div><label>Day</label><input id="sday" type="date" value="${today}"></div></div>
      <label>Name (English)</label><input id="snE" maxlength="60"><label>Name (Urdu, optional)</label><input id="snU" maxlength="60" dir="rtl">
      <div class="inline"><button class="chip solid" data-a="specialset">Save day</button></div>
      ${days.length ? `<table><tr><th>Day</th><th>Name</th><th></th></tr>${days.slice(0, 15).map((d) => `<tr><td>${esc(d.day)}</td><td>${esc(d.name_en)}</td><td><button class="chip" data-a="specialdel" data-day="${esc(d.day)}">Remove</button></td></tr>`).join('')}</table>` : ''}`;
  },
  async reported() {
    const { items } = await api('GET', '/reported');
    const photoLink = (i) => (i.photoUrl ? `<a href="${esc(i.photoUrl)}" target="_blank" rel="noopener">photo</a>` : '');
    return `<h3>Reported or hidden</h3>
      <p class="muted">Three reports from different members hide a photo or a reply. Keep something that was reported unfairly (the reports are cleared), remove it, or restore something hidden.</p>
      ${items.length ? `<table><tr><th>Kind</th><th>Member</th><th>Content</th><th>Reports</th><th>Status</th><th></th></tr>${items.map((i) => `<tr><td>${esc(i.kind)}</td><td>${esc(i.username)}</td><td>${esc(i.text || '')} ${photoLink(i)}</td><td>${i.reports}</td><td>${esc(i.status)}</td>
        <td>${i.kind === 'post' && !i.photoUrl ? '<span class="muted">photo deleted</span>' : i.status === 'removed' ? `<button class="chip solid" data-a="restore2" data-kind="${esc(i.kind)}" data-id="${i.id}">Restore</button>` : `<button class="chip" data-a="keep2" data-kind="${esc(i.kind)}" data-id="${i.id}" title="The reports were not justified: clear them and take it off this list">Keep</button> <button class="chip" data-a="remove2" data-kind="${esc(i.kind)}" data-id="${i.id}">Remove</button>`}</td></tr>`).join('')}</table>` : '<p class="empty">Nothing reported.</p>'}`;
  },
  async majalis() {
    const { majalis } = await api('GET', '/majalis');
    return `<h3>Majalis</h3>
      <p class="muted">Members pick a majlis under Me and can propose a new one; approve the proposals that are real groups. The proposer joins a majlis once it is approved.</p>
      <table><tr><th>Majlis</th><th>Urdu</th><th>Members</th><th>Status</th><th>Proposed by</th><th></th></tr>${majalis.map((m) => `<tr><td>${esc(m.name)}</td><td dir="rtl">${esc(m.name_ur)}</td><td>${fmt(m.members)}</td><td>${esc(m.status)}</td><td>${esc(m.proposer || '—')}</td>
        <td>${m.status === 'pending' ? `<button class="chip solid" data-a="mjyes" data-id="${m.id}">Approve</button> <button class="chip" data-a="mjno" data-id="${m.id}">Reject</button>` : ''}</td></tr>`).join('')}</table>`;
  },
  async admins() {
    const { admins, roles } = await api('GET', '/admins');
    const blurb = { owner: 'everything, including who is an admin', moderator: 'pictures, names, caravans, reports, flags, suspensions', organiser: 'invite codes, caravans, waitlist, news, Sunnahs, challenge, exports, reset links' };
    return `<h3>Admins</h3>
      <p class="muted">An admin is a normal member with a role. They sign in here with their own username and password, and every action is logged under their name. Remove the role and their access ends at once.</p>
      <table><tr><th>Role</th><th>Can do</th></tr>${roles.map((r) => `<tr><td><b>${r}</b></td><td class="muted">${blurb[r]}</td></tr>`).join('')}</table>
      <h3>Give a role</h3>
      <div class="inline"><div><label>Member username</label><input id="adu" type="text" maxlength="20" autocapitalize="off"></div>
        <div><label>Role</label><select id="adr" style="width:100%;padding:11px 8px;border:2px solid var(--ink);background:var(--bg);color:var(--ink);font:inherit">${roles.map((r) => `<option value="${r}">${r}</option>`).join('')}</select></div><button class="chip solid" data-a="adgrant">Save</button></div>
      <h3>Current admins</h3>
      ${admins.length ? `<table><tr><th>Member</th><th>Role</th><th>Since</th><th></th></tr>${admins.map((a) => `<tr><td><b>${esc(a.username)}</b>${a.suspended ? ' <span class="pillbox bad">SUSPENDED</span>' : ''}</td><td>${esc(a.role)}</td><td>${a.since ? date(a.since) : ''}</td>
        <td>${a.username === ME.username ? '<span class="muted">you</span>' : `<button class="chip" data-a="adrevoke" data-u="${esc(a.username)}">Remove role</button>`}</td></tr>`).join('')}</table>` : '<p class="empty">No admin accounts yet. You are using the shared key.</p>'}`;
  },
  async exports() {
    return `<h3>Exports</h3><p class="muted">CSV files of totals as reported by members. Deleted members stay in totals. Open in Excel or Google Sheets.</p>
      <div class="inline"><button class="chip solid" data-a="exp" data-k="cities">Totals by city</button><button class="chip solid" data-a="exp" data-k="caravans">Totals by caravan</button><button class="chip solid" data-a="exp" data-k="weeks">Totals by week</button></div>`;
  },
  async invites() {
    const { invites, signups } = await api('GET', '/invites');
    return `<h3>Sign-ups</h3>
      <p class="muted">Everyone joins a caravan when they sign up, by typing its name. The switch below stops all sign-ups (existing members are not affected). The limit is how many new members one caravan name can take in a Pakistan-time day; codes made below ignore the limit.</p>
      <div class="inline"><div>${signups.enabled ? '<span class="pillbox ok">OPEN</span>' : '<span class="pillbox bad">CLOSED</span>'}</div>
        <button class="chip solid" data-a="signupsw" data-v="${signups.enabled ? '0' : '1'}">${signups.enabled ? 'Close sign-ups' : 'Open sign-ups'}</button>
        <div><label>New members per caravan name, per day</label><input id="sgcap" type="number" min="0" max="100000" value="${signups.dailyCap}" style="max-width:130px"></div><button class="chip" data-a="signupcap">Set limit</button></div>
      <h3>Codes for a caravan</h3>
      <p class="muted">A code is tied to one caravan: whoever signs up with it joins that caravan. Give one to an organiser or a city lead. Leave max uses blank for no limit.</p>
      <div class="inline"><div><label>Caravan name</label><input id="fcv" placeholder="e.g. noor_caravan" maxlength="20" autocapitalize="off" dir="ltr"></div><div><label>Label</label><input id="flabel" placeholder="Lahore lead" maxlength="60"></div><div><label>Max uses (blank = unlimited)</label><input id="fmax" type="number" min="1" inputmode="numeric"></div><button class="chip solid" data-a="fnew">Create code</button></div>
      ${invites.length ? `<table><tr><th>Code</th><th>Caravan</th><th>Label</th><th>Kind</th><th>Used</th><th></th></tr>${invites.map((i) => `<tr>
        <td class="code2">${esc(i.code)}</td><td>${esc(i.caravan || '—')}</td><td>${esc(i.label)}</td><td>${esc(i.kind)}</td>
        <td>${i.uses}${i.maxUses ? ' / ' + i.maxUses : ''} · ${i.joined} joined</td>
        <td>${i.revoked ? '<span class="pillbox bad">REVOKED</span>' : `<button class="chip" data-a="revoke" data-code="${esc(i.code)}">Revoke</button>`}</td></tr>`).join('')}</table>` : '<p class="empty">No codes yet.</p>'}`;
  },
  async waitlist() {
    const status = window.__wl || 'pending';
    const { requests } = await api('GET', `/waitlist?status=${status}`);
    return `<h3>Waitlist</h3>
      <p class="muted">Approving makes a one-use code for the caravan you name. The person signs up with the code (or the caravan's name).</p>
      ${status === 'pending' ? '<div class="inline"><div><label>Caravan to put approved people in</label><input id="wlcv" placeholder="e.g. noor_caravan" maxlength="20" autocapitalize="off" dir="ltr"></div></div>' : ''}
      <div class="inline">${['pending', 'approved', 'rejected'].map((s) => `<button class="chip ${s === status ? 'solid' : ''}" data-a="wlfilter" data-s="${s}">${s}</button>`).join('')}</div>
      ${requests.length ? `<table><tr><th>Name</th><th>Contact</th><th>Requested</th><th></th></tr>${requests.map((r) => `<tr>
        <td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.city)}</span></td>
        <td dir="ltr">${esc(r.phone)}<br>${esc(r.email)}</td><td>${date(r.createdAt)}</td>
        <td>${r.status === 'pending' ? `<button class="chip solid" data-a="approve" data-id="${r.id}">Approve</button><button class="chip" data-a="reject" data-id="${r.id}">Reject</button>`
          : r.code ? `<span class="code2">${esc(r.code)}</span> <a class="chip" target="_blank" rel="noopener" href="https://wa.me/${esc(r.phone.replace(/\D/g, ''))}?text=${encodeURIComponent('Assalamu alaikum. Your Durood Quest code: ' + r.code)}">WhatsApp</a>` : esc(r.status)}</td></tr>`).join('')}</table>` : `<p class="empty">Nothing ${status}.</p>`}`;
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
  async profiles() {
    const q = window.__mq || '', filter = window.__mf || 'photos';
    const { profiles } = await api('GET', `/profiles?q=${encodeURIComponent(q)}&filter=${filter}`);
    const thumb = (p) => p.avatar ? `<img src="${esc(p.avatar)}" width="64" height="64" style="border-radius:50%;object-fit:cover;background:#ddd" alt="">` : '<span class="muted">no photo</span>';
    return `<h3>Pictures and names</h3>
      <p class="muted">Every member sees profile pictures, names and one-line bios. Remove what should not be there. The member can add a new one; to stop a repeat offender, suspend them in Members.</p>
      <div class="inline"><div><label>Search username, name, bio or city</label><input id="mq" value="${esc(q)}"></div>
        ${[['photos', 'With a photo'], ['text', 'With a name or line'], ['all', 'Everyone']].map(([k, l]) => `<button class="chip ${k === filter ? 'solid' : ''}" data-a="mfilter" data-f="${k}">${l}</button>`).join('')}<button class="chip solid" data-a="msearch">Search</button></div>
      ${profiles.length ? `<table><tr><th>Photo</th><th>Member</th><th>Name and line</th><th></th></tr>${profiles.map((p) => `<tr><td>${thumb(p)}</td>
        <td><b>${esc(p.username)}</b>${p.suspended ? ' <span class="pillbox bad">SUSPENDED</span>' : ''}<br><span class="muted">${esc(p.city)} · ${esc(p.joined)}${p.avatarAt ? `<br>photo ${date(p.avatarAt)}` : ''}</span></td>
        <td>${esc(p.displayName) || '<span class="muted">no name</span>'}<br><span class="muted">${esc(p.bio)}</span></td>
        <td>${p.avatar ? `<button class="chip" data-a="rmavatar" data-u="${esc(p.username)}">Remove photo</button>` : ''}${p.displayName || p.bio ? `<button class="chip" data-a="clearprofile" data-u="${esc(p.username)}">Clear name and line</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="empty">Nothing matches.</p>'}`;
  },
  async caravans() {
    const cq = window.__cq || '';
    const { caravans } = await api('GET', `/caravans?q=${encodeURIComponent(cq)}`);
    return `${can('organise') ? `<h3>Create a caravan</h3>
      <p class="muted">A caravan needs an owner who is already a member and in no caravan. To start the very first one, create a member under Members, then name the caravan here. Everyone after signs up with the caravan's name.</p>
      <div class="inline"><div><label>Caravan name (English letters, numbers, _)</label><input id="cvn" maxlength="20" autocapitalize="off" dir="ltr"></div><div><label>Owner (member username)</label><input id="cvo" maxlength="20" autocapitalize="off" dir="ltr"></div><div><label>Display name (optional)</label><input id="cvd" maxlength="40" dir="auto"></div><button class="chip solid" data-a="cvcreate">Create</button></div>` : ''}
      <h3>Caravans</h3>
      <div class="inline"><div><label>Search caravan name or owner</label><input id="cq" value="${esc(cq)}"></div><button class="chip solid" data-a="csearch">Search</button></div>
      ${caravans.length ? `<table><tr><th>Caravan</th><th>Owner</th><th>Members</th><th></th></tr>${caravans.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.display_name ? `<br><span dir="auto">${esc(c.display_name)}</span>` : ''}<br><span class="muted">${date(c.created_at)}</span></td><td>${esc(c.owner)}</td>
        <td>${fmt(c.members)}<br><span class="muted">${esc(c.sample || '')}${c.members > 6 ? ', …' : ''}</span></td>
        <td><details class="amenu"><summary>Actions</summary><div>
          ${can('organise') ? `<button class="chip" data-a="cvadd" data-id="${c.id}" data-n="${esc(c.name)}">Add a member</button>` : ''}
          <button class="chip" data-a="cvrm" data-id="${c.id}" data-n="${esc(c.name)}">Remove a member</button>
          <button class="chip" data-a="cvrename" data-id="${c.id}" data-n="${esc(c.name)}">Rename</button>${c.display_name ? `<button class="chip" data-a="cvcleardn" data-id="${c.id}" data-n="${esc(c.name)}">Clear display name</button>` : ''}
          <button class="chip" data-a="cvdelete" data-id="${c.id}" data-n="${esc(c.name)}">Delete</button></div></details></td></tr>`).join('')}</table>` : '<p class="empty">No caravans.</p>'}`;
  },
  async members() {
    const q = window.__q || '';
    const { members } = await api('GET', `/members?q=${encodeURIComponent(q)}`);
    return `<h3>Members</h3>
      <div class="inline"><div><label>Search name, email, phone or city</label><input id="q" value="${esc(q)}"></div><button class="chip solid" data-a="search">Search</button></div>
      ${members.length ? `<table><tr><th>Member</th><th>Counts</th><th>Status</th><th>Actions</th></tr>${members.map((m) => `<tr>
        <td><b>${esc(m.username)}</b><br><span class="muted">${esc(m.city)} · ${esc(m.joined)}<br>${m.caravan ? 'caravan ' + esc(m.caravan) : '<b>no caravan</b>'}</span></td>
        <td>${fmt(m.total)}</td>
        <td>${m.deleted ? '<span class="pillbox bad">DELETED</span>' : ''}${m.suspended ? '<span class="pillbox bad">SUSPENDED</span>' : ''}${m.hidden ? '<span class="pillbox">HIDDEN</span>' : ''}${m.emailVerified ? '<span class="pillbox ok">EMAIL OK</span>' : ''}<br><span class="muted" dir="ltr">${esc(m.email)}<br>${esc(m.phone)}</span></td>
        <td>${m.deleted ? '' : `<details class="amenu"><summary>Actions</summary><div>
          <button class="chip" data-a="${m.suspended ? 'unsuspend' : 'suspend'}" data-u="${esc(m.username)}">${m.suspended ? 'Unsuspend' : 'Suspend'}</button>
          <button class="chip" data-a="${m.hidden ? 'unhide' : 'hide'}" data-u="${esc(m.username)}">${m.hidden ? 'Unhide' : 'Hide from ranks'}</button>
          <button class="chip" data-a="${m.phoneHidden ? 'showphone' : 'hidephone'}" data-u="${esc(m.username)}">${m.phoneHidden ? 'Show number to members' : 'Hide number from members'}</button>
          ${can('reset_link') ? `<button class="chip" data-a="resetlink" data-u="${esc(m.username)}">Reset link</button>` : ''}
          ${can('delete_member') ? `<button class="chip" data-a="memdel" data-u="${esc(m.username)}">Delete account</button>` : ''}</div></details>`}</td></tr>`).join('')}</table>` : '<p class="empty">No members match.</p>'}
      ${can('organise') ? `<h3>Create a member</h3>
      <p class="muted">For the first owner of a new caravan, or anyone who cannot sign up themselves. The member is in no caravan until you add them under Caravans.</p>
      <div class="inline"><div><label>Username</label><input id="cmu" maxlength="20" autocapitalize="off" dir="ltr"></div><div><label>Password (6 or more)</label><input id="cmp" type="text" autocomplete="off" dir="ltr"></div></div>
      <div class="inline"><div><label>Email</label><input id="cme" type="email" dir="ltr"></div><div><label>Phone</label><input id="cmph" type="tel" dir="ltr" placeholder="300 1234567"></div><div><label>Phone country (2 letters)</label><input id="cmcc" maxlength="2" value="PK" dir="ltr" style="max-width:90px"></div></div>
      <div class="inline"><div><label>City (type two letters or more, then Find)</label><input id="cmcity" dir="auto"></div><button class="chip" data-a="cmfind">Find</button>
        <div><label>Pick the city</label><select id="cmcityid"><option value="">(search first)</option></select></div></div>
      <div class="inline"><button class="chip solid" data-a="cmcreate">Create member</button></div>` : ''}`;
  },
  async audit() {
    return `<h3>Audit</h3><p class="muted">Checks every member's totals against the ledger of what they reported. It also runs by itself every night after 03:00 Pakistan time.</p>
      <div class="inline"><button class="chip solid" data-a="auditrun">Run audit now</button></div><div id="auditout"></div>`;
  },
  async log() {
    const { log } = await api('GET', '/log');
    return `<h3>Recent admin actions</h3>
      ${log.length ? `<table><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr>${log.map((l) => `<tr><td>${date(l.at)}</td><td>${esc(l.actor) || '<span class="muted">earlier</span>'}</td><td>${esc(l.action)}</td><td>${esc(l.target)}</td><td class="muted">${esc(l.detail)}</td></tr>`).join('')}</table>` : '<p class="empty">Nothing yet.</p>'}`;
  },
};

function bar() {
  $('#bar').innerHTML = ME
    ? `<span class="msg" style="margin:0;flex:1;word-break:normal">${ME.username ? `Signed in as <b>${esc(ME.username)}</b> · ${esc(ME.role)}` : 'Using the shared admin key (owner)'}</span><button class="chip" id="out">Sign out</button>`
    : showKey ? '<input type="password" id="key" placeholder="Admin key" autocomplete="off"><button class="chip solid" id="save">Use key</button><button class="chip" id="back">Back</button>'
      : '<input id="aid" type="text" placeholder="Username" autocomplete="username" autocapitalize="off"><input type="password" id="apw" placeholder="Password" autocomplete="current-password"><button class="chip solid" id="login">Sign in</button><button class="chip" id="usekey">Use admin key</button>';
}
async function enter() { // find out who the server thinks we are
  try { ME = await api('GET', '/me'); } catch { ME = null; }
  if (ME && !tabOk(TABS.find(([k]) => k === tab))) tab = TABS.find(tabOk)?.[0] || 'challenge';
}
function signOut(msg = '') { TOKEN = ''; KEY = ''; ME = null; store('adminToken', null); store('adminKey', null); notice = msg; showKey = false; render(); }

async function render() {
  document.body.classList.toggle('out', !ME);
  bar();
  $('#tabs').innerHTML = ME ? TABS.filter(tabOk).map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('') : '';
  if (!ME) { $('#audit').innerHTML = ''; $('#panel').innerHTML = (notice ? `<div class="msg">${esc(notice)}</div>` : '') + '<p class="empty">Sign in with your member username and password. Admin roles are given by the owner.</p>'; notice = ''; return; }
  try { $('#panel').innerHTML = (notice ? `<div class="msg">${esc(notice)}</div>` : '') + (await views[tab]()); }
  catch (e) { $('#panel').innerHTML = `<div class="msg" style="border-color:var(--err)">${esc(e.message)}</div>`; }
  linkLabels();
  notice = '';
  try {
    const st = await api('GET', '/status');
    const a = st.lastAudit;
    if (!can('audit') && a && !a.ok) { $('#audit').innerHTML = '<div class="msg" style="border-color:var(--err)">The nightly audit found a problem. Tell the owner.</div>'; return; }
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
    chtoday: async () => { if (!confirm('Make today day 1 of the challenge?')) return; await api('POST', '/challenge', { start: pktToday() }); say('Day 1 is now today.'); },
    newspost: async () => { await api('POST', '/news', { title_en: $('#ntE').value, title_ur: $('#ntU').value, body_en: $('#nbE').value, body_ur: $('#nbU').value }); say('Posted.'); },
    newsdel: async () => { if (!confirm('Delete this announcement?')) return; await api('DELETE', `/news/${d.id}`); say('Deleted.'); },
    exp: async () => {
      const { csv } = await api('GET', `/export?kind=${d.k}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `durood-quest-${d.k}-${pktToday()}.csv`; a.click();
      say('Downloaded.');
    },
    specialset: async () => { await api('POST', '/special-days', { day: $('#sday').value, name_en: $('#snE').value, name_ur: $('#snU').value }); say('Day saved.'); },
    specialdel: async () => { await api('DELETE', `/special-days/${d.day}`); say('Removed.'); },
    sunset: async () => {
      if (!$('#sutE').value.trim()) return say('Write the Sunnah in English first.');
      await api('POST', '/sunnahs', { sunnahs: [{ day: $('#sudy').value, title_en: $('#sutE').value.trim(), title_ur: $('#sutU').value.trim(), desc_en: $('#sudE').value.trim(), desc_ur: $('#sudU').value.trim(), source: $('#susrc').value.trim() }] });
      say(`Sunnah saved for ${$('#sudy').value}.`);
    },
    sunbulk: async () => {
      let list; try { list = JSON.parse($('#subulk').value); } catch { return say('That is not valid JSON.'); }
      const r = await api('POST', '/sunnahs', { sunnahs: list });
      say(`${r.days.length} Sunnah${r.days.length === 1 ? '' : 's'} saved.`);
    },
    sunedit: async () => {
      const x = (await api('GET', '/sunnahs')).sunnahs.find((s) => s.day === d.day);
      if (!x) return;
      $('#sudy').value = x.day; $('#susrc').value = x.source; $('#sutE').value = x.title_en; $('#sutU').value = x.title_ur; $('#sudE').value = x.desc_en; $('#sudU').value = x.desc_ur;
      $('#sutE').focus(); return 'stay';
    },
    sundel: async () => { if (!confirm(`Remove the Sunnah for ${d.day}?`)) return; await api('DELETE', `/sunnahs/${d.day}`); say('Removed.'); },
    mjyes: async () => { const r = await api('POST', `/majalis/${d.id}`, { action: 'approve' }); say(`${r.name} approved.`); },
    mjno: async () => { if (!confirm('Reject this majlis?')) return; const r = await api('POST', `/majalis/${d.id}`, { action: 'reject' }); say(`${r.name} rejected.`); },
    keep2: async () => { await api('POST', `/content/${d.kind}/${d.id}`, { action: 'restore' }); say('Kept, and its reports cleared.'); },
    remove2: async () => { await api('POST', `/content/${d.kind}/${d.id}`, { action: 'remove' }); say('Removed.'); },
    restore2: async () => { await api('POST', `/content/${d.kind}/${d.id}`, { action: 'restore' }); say('Restored.'); },
    signupsw: async () => { const r = await api('POST', '/signups', { enabled: d.v === '1' }); say(r.enabled ? 'Sign-ups are open.' : 'Sign-ups are closed. Existing members are not affected.'); },
    signupcap: async () => { const r = await api('POST', '/signups', { dailyCap: Number($('#sgcap').value) }); say(`Limit saved: ${fmt(r.dailyCap)} new members per caravan name per day.`); },
    fnew: async () => { const r = await api('POST', '/invites', { caravan: $('#fcv').value.trim(), label: $('#flabel').value, maxUses: $('#fmax').value }); say(`New code for ${r.caravan}: ${r.code}`); },
    revoke: async () => { await api('POST', `/invites/${d.code}/revoke`); say('Revoked.'); },
    wlfilter: async () => { window.__wl = d.s; },
    approve: async () => {
      const caravan = ($('#wlcv')?.value || '').trim();
      if (!caravan) return say('Type the caravan to put this person in first.');
      const r = await api('POST', `/waitlist/${d.id}`, { action: 'approve', caravan });
      say(`Approved for ${r.caravan}. Code ${r.code}${r.emailed ? ' (emailed)' : r.mailOff ? ' (not emailed: this server has no email provider)' : ''}. Send it over WhatsApp from the approved tab.`); window.__wl = 'approved';
    },
    reject: async () => { await api('POST', `/waitlist/${d.id}`, { action: 'reject' }); say('Rejected.'); },
    flfilter: async () => { window.__fl = d.s; },
    flclear: async () => { await api('POST', `/flags/${d.id}`, { action: 'clear' }); say('Released.'); },
    flconfirm: async () => { await api('POST', `/flags/${d.id}`, { action: 'confirm' }); say('Kept held.'); },
    msearch: async () => { window.__mq = $('#mq').value; },
    mfilter: async () => { window.__mf = d.f; window.__mq = $('#mq')?.value || ''; },
    csearch: async () => { window.__cq = $('#cq').value; },
    rmavatar: async () => { if (!confirm(`Remove ${d.u}'s picture?`)) return; await api('POST', `/members/${d.u}`, { action: 'remove-avatar' }); say('Picture removed.'); },
    clearprofile: async () => { if (!confirm(`Remove ${d.u}'s picture, name and line?`)) return; await api('POST', `/members/${d.u}`, { action: 'clear-profile' }); say('Cleared.'); },
    cvcreate: async () => { const r = await api('POST', '/caravans', { name: $('#cvn').value.trim(), owner: $('#cvo').value.trim(), displayName: $('#cvd').value.trim() || undefined }); say(`Caravan ${r.name} created. Owner: ${r.owner}. New members join it by typing ${r.name} at sign-up.`); },
    cvadd: async () => { const u = prompt(`Add which member to "${d.n}"? (username, a member in no caravan)`); if (!u) return; await api('POST', `/caravans/${d.id}/members`, { username: u.trim() }); say(`${u.trim()} added to ${d.n}.`); },
    cvrm: async () => { const u = prompt(`Remove which member from "${d.n}"? (username)`); if (!u) return; await api('POST', `/caravans/${d.id}/remove`, { username: u.trim() }); say(`${u.trim()} removed from ${d.n}. They stay in no caravan until you add them to one.`); },
    cvrename: async () => { const n = prompt('New name for this caravan (3-20 letters, numbers or _):', d.n); if (!n || n === d.n) return; await api('PUT', `/caravans/${d.id}`, { name: n }); say('Renamed.'); },
    cvcleardn: async () => { if (!confirm(`Clear the display name of "${d.n}"? It will show its name instead.`)) return; await api('DELETE', `/caravans/${d.id}/display-name`); say('Cleared.'); },
    cvdelete: async () => { if (!confirm(`Delete the caravan "${d.n}"? Its members stay in the app but are in no caravan until you add them to one.`)) return; await api('DELETE', `/caravans/${d.id}`); say('Deleted.'); },
    search: async () => { window.__q = $('#q').value; },
    cmfind: async () => {
      const q = $('#cmcity').value.trim();
      const cc = ($('#cmcc').value || 'PK').trim().toUpperCase();
      if (q.length < 2) { say('Type at least two letters of the city.'); return; }
      const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}&cc=${encodeURIComponent(cc)}`);
      const cities = (await res.json().catch(() => ({}))).cities || [];
      // fill the list in place: a full redraw would wipe the rest of the form
      $('#cmcityid').innerHTML = cities.length ? cities.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('') : '<option value="">(no match: try the nearest bigger town)</option>';
      return 'stay';
    },
    cmcreate: async () => {
      const body = { username: $('#cmu').value.trim(), password: $('#cmp').value, email: $('#cme').value.trim(), phone: $('#cmph').value.trim(), phoneCountry: ($('#cmcc').value || 'PK').trim().toUpperCase(), cityId: Number($('#cmcityid').value) || undefined };
      const r = await api('POST', '/members/create', body);
      say(`Member ${r.username} created. Next: Caravans, then create a caravan with them as owner (or add them to one).`);
    },
    suspend: async () => { await api('POST', `/members/${d.u}`, { action: 'suspend' }); say(`${d.u} suspended.`); },
    unsuspend: async () => { await api('POST', `/members/${d.u}`, { action: 'unsuspend' }); say(`${d.u} restored.`); },
    hide: async () => { await api('POST', `/members/${d.u}`, { action: 'hide' }); say(`${d.u} is hidden from the ranks.`); },
    unhide: async () => { await api('POST', `/members/${d.u}`, { action: 'unhide' }); say(`${d.u} is shown in the ranks.`); },
    memdel: async () => {
      if (prompt(`This erases ${d.u}'s name, email, phone, picture and photos for good. Their durood stays in the totals. Type the username to confirm.`) !== d.u) return say('Not deleted: the username did not match.');
      await api('POST', `/members/${d.u}`, { action: 'delete' }); say(`${d.u}'s account was deleted.`);
    },
    hidephone: () => api('POST', `/members/${d.u}`, { action: 'hide-phone' }).then(() => say(`${d.u}'s number is no longer offered to other members.`)),
    showphone: () => api('POST', `/members/${d.u}`, { action: 'show-phone' }).then(() => say(`${d.u}'s number is offered to members again.`)),
    adgrant: async () => { const username = $('#adu').value.trim(), role = $('#adr').value; await api('POST', '/admins', { username, role }); say(`${username} is now ${role}.`); },
    adrevoke: async () => { if (!confirm(`Remove ${d.u}'s admin role? They stay a member.`)) return; await api('DELETE', `/admins/${d.u}`); say('Role removed.'); },
    resetlink: async () => { const r = await api('POST', `/members/${d.u}`, { action: 'reset-link' }); say(`Reset link for ${d.u} (works once, one hour): ${r.url}`); },
    auditrun: async () => {
      try {
        const r = await api('GET', '/audit');
        $('#auditout').innerHTML = `<div class="msg" style="${r.ok ? '' : 'border-color:var(--err)'}">${r.ok ? `Audit clean: ${fmt(r.users)} members, ${fmt(r.ledgerTotal)} durood, every total matches the ledger.` : `Audit found ${r.problems.length} problem(s): ${esc(JSON.stringify(r.problems.slice(0, 3)))}`}</div>`;
      } catch (e) { $('#auditout').innerHTML = `<div class="msg" style="border-color:var(--err)">${esc(e.message)}</div>`; }
      return 'stay';
    },
  }[d.a];
  if (act) run(act);
});

document.addEventListener('click', async (ev) => {
  const id = ev.target.closest('button')?.id;
  if (id === 'usekey') { showKey = true; return render(); }
  if (id === 'back') { showKey = false; return render(); }
  if (id === 'out') return signOut();
  if (id === 'save') { KEY = $('#key').value.trim(); TOKEN = ''; store('adminKey', KEY); await enter(); if (!ME) { KEY = ''; store('adminKey', null); notice = 'That key was not accepted.'; } return render(); }
  if (id === 'login') {
    try {
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: $('#aid').value, password: $('#apw').value, device: deviceGet() || undefined }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error === 'rate_limited' ? 'Too many tries. Wait a few minutes.' : 'Wrong username or password, or this account is not an admin.');
      if (data.device) deviceSet(data.device);
      TOKEN = data.token; KEY = ''; store('adminToken', TOKEN); store('adminKey', null); await enter();
    } catch (e) { notice = e.message; }
    return render();
  }
});
$('#mode').onclick = () => {
  const next = document.documentElement.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-mode', next);
  try { localStorage.setItem('mode', next); } catch { /* private mode */ }
};
(async () => { if (TOKEN || KEY) await enter(); render(); })();
