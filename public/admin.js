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
const TABS = [['challenge', 'Challenge', 'status'], ['invites', 'Invite codes', 'organise'], ['waitlist', 'Waitlist', 'organise'], ['flags', 'Flagged totals', 'moderate'], ['members', 'Members', 'members'], ['moderation', 'Moderation', 'moderate'], ['news', 'News', 'organise'], ['feed', 'Feed', 'feed'], ['exports', 'Exports', 'organise'], ['burhan', 'Al-Burhan', 'moderate'], ['admins', 'Admins', 'manage_admins']];
let EDITION = 'public'; // the Al-Burhan tab exists only in the internal edition
const tabOk = ([k, , p]) => (k === 'burhan' ? EDITION === 'internal' && (can('moderate') || can('organise')) : p === 'feed' ? can('organise') || can('moderate') : can(p));

// what an error code means, in words an organiser can act on
const ADMIN_ERR = {
  bad_cap: 'Uses must be a whole number from 0 to 100,000.', bad_code: 'Codes are 4 to 20 capital letters or digits.', bad_action: 'That action is not recognised. Reload the page and try again.',
  bad_prompt: 'A prompt needs a day and English text.', bad_date: 'Pick a valid start date.', bad_days: 'Days must be a whole number from 1 to 365.',
  bad_target: 'The target must be between 10 lakh and 1,000 crore.', bad_news: 'News needs an English title of up to 120 characters.', bad_export: 'That export is not available. Reload the page and try again.',
  not_allowed: 'Your role cannot do that.', rate_limited: 'Too many tries. Wait a few minutes.', not_found: 'That was not found. It may have been removed already.',
  bad_quiz: 'The quiz is not in the right shape: up to 10 questions, each with q_en, 2 to 5 options_en (options_ur the same number, or none) and the answer number (0 is the first option).',
  bad_lecture: 'Check the YouTube id (11 characters), the English title and the week date.',
  bad_sunnah: 'Each Sunnah needs a day (YYYY-MM-DD) and an English text.', sunnah_in_use: 'Members have already ticked or posted this Sunnah. Edit its text instead of removing it.',
  bad_special: 'A special day needs a date and an English name.', bad_url: 'The link must start with https://',
  photo_gone: 'This photo was already deleted from the server (photos are kept 14 days), so it cannot be shown again.',
  bad_role: 'Pick owner, moderator or organiser.', own_role: 'You cannot change your own role.', last_owner: 'There must always be at least one owner.',
  member_not_found: 'No active member has that username.', remove_role_first: 'This member holds an admin role. Remove the role first, then delete the account.', bad_challenge: 'Check the start date, the number of days and the target.',
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
    const org = can('organise'), mod = can('moderate');
    const [{ lectures }, { prompts }, { items }, { days }, { sunnahs }, circle, { teachers }] = await Promise.all([org ? api('GET', '/lectures') : { lectures: [] }, org ? api('GET', '/prompts') : { prompts: [] }, mod ? api('GET', '/reported') : { items: [] }, org ? api('GET', '/special-days') : { days: [] }, org ? api('GET', '/sunnahs') : { sunnahs: [] }, org ? api('GET', '/circle') : {}, org ? api('GET', '/circle-teachers') : { teachers: [] }]);
    const today = pktToday();
    // the next 14 days without a Sunnah: members see "not published yet" on those days
    const gaps = Array.from({ length: 14 }, (_, i) => new Date(Date.parse(today + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10)).filter((d) => !sunnahs.some((x) => x.day === d));
    const photoLink = (i) => (i.photoUrl ? `<a href="${esc(i.photoUrl)}" target="_blank" rel="noopener">photo</a>` : '');
    return `${org ? `<h3>Sunnah of the day</h3>
      <p class="muted">Members see the day's Sunnah on Today (under Sunnah &amp; Seerah), tick it (+20) and can post a photo of it (+40). A day without one shows "not published yet".</p>
      ${gaps.length ? `<div class="msg" style="border-color:var(--err)">No Sunnah yet for: ${gaps.map((d) => esc(d)).join(', ')}</div>` : '<p class="muted">Every day of the next two weeks has a Sunnah.</p>'}
      <div class="inline"><div><label>Day</label><input id="sudy" type="date" value="${esc(gaps[0] || today)}"></div><div><label>Source (e.g. Bukhari 5376)</label><input id="susrc" maxlength="120"></div></div>
      <label>Sunnah (English)</label><input id="sutE" maxlength="120"><label>Sunnah (Urdu)</label><input id="sutU" maxlength="120" dir="rtl">
      <label>How to do it (English, optional)</label><textarea id="sudE" maxlength="600" rows="2"></textarea><label>How to do it (Urdu, optional)</label><textarea id="sudU" maxlength="600" rows="2" dir="rtl"></textarea>
      <div class="inline"><button class="chip solid" data-a="sunset">Save Sunnah</button></div>
      <details><summary>Add many at once</summary><p class="muted">A JSON list: <code>[{"day":"2026-11-01","title_en":"Eat with the right hand","title_ur":"…","desc_en":"…","desc_ur":"…","source":"Muslim 2020"}]</code>. A day that already has one is replaced.</p>
      <textarea id="subulk" rows="4"></textarea><div class="inline"><button class="chip" data-a="sunbulk">Save all</button></div></details>
      ${sunnahs.length ? `<table><tr><th>Day</th><th>Sunnah</th><th>Source</th><th></th></tr>${sunnahs.map((x) => `<tr${x.day < today ? ' style="opacity:.6"' : ''}><td>${esc(x.day)}</td><td>${esc(x.title_en)}${x.title_ur ? `<br><span dir="rtl">${esc(x.title_ur)}</span>` : ' <small class="muted">(no Urdu)</small>'}</td><td>${esc(x.source)}</td>
        <td><button class="chip" data-a="sunedit" data-day="${esc(x.day)}">Edit</button> ${x.day >= today ? `<button class="chip" data-a="sundel" data-day="${esc(x.day)}">Remove</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="empty">No Sunnahs scheduled.</p>'}
      <h3>Seerat Circle link</h3>
      <p class="muted">Members see a card with this link on Today, under Sunnah &amp; Seerah, and can claim +300 points once after they register. Leave it empty to hide the card.</p>
      <label>Sign-up link (https://…)</label><input id="ciurl" type="url" maxlength="300" value="${esc(circle.circleUrl || '')}">
      <div class="inline"><button class="chip solid" data-a="circleset">Save link</button></div>
      <h3>Circle teachers</h3>
      <p class="muted">Members who say they teach a Seerat Circle. Confirm the ones you know: they get 1,000 points once and the Circle Teacher badge (joining a circle gives 300).</p>
      ${teachers.length ? `<table><tr><th>Member</th><th>City</th><th>Asked</th><th>Status</th><th></th></tr>${teachers.map((x) => `<tr><td>${esc(x.username)}</td><td>${esc(x.city)}</td><td>${date(x.at)}</td><td>${esc(x.status)}</td>
        <td>${x.status === 'approved' ? '' : `<button class="chip solid" data-a="teachyes" data-u="${esc(x.username)}">Confirm</button>`} ${x.status === 'pending' ? `<button class="chip" data-a="teachno" data-u="${esc(x.username)}">Not a teacher</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="empty">No requests yet.</p>'}
      <h3>Lecture of the week</h3>
      <p class="muted">Members see the lectures whose week is the current one. Any date in the week works. A quiz is optional: a JSON list like <code>[{"q_en":"Where was the Prophet ﷺ born?","options_en":["Makkah","Madinah"],"answer":0}]</code>.</p>
      <div class="inline"><div><label>YouTube id (11 characters)</label><input id="lyt" maxlength="11"></div><div><label>Week (any date)</label><input id="lwk" type="date" value="${pktToday()}"></div><div><label>Minimum watch (seconds)</label><input id="lmin" type="number" min="30" value="600"></div><div><label>Points (1 to 200)</label><input id="lxp" type="number" min="1" max="200" value="150"></div></div>
      <input id="lid" type="hidden" value="">
      <label>Title (English)</label><input id="ltE" maxlength="120"><label>Title (Urdu, optional)</label><input id="ltU" maxlength="120" dir="rtl"><label>Speaker</label><input id="lsp" maxlength="80">
      <label>Quiz (optional JSON)</label><textarea id="lqz" rows="3"></textarea>
      <div class="inline"><button class="chip solid" data-a="lecadd" id="lecbtn">Add lecture</button> <button class="chip" data-a="lecnew" id="lecnew" hidden>Cancel edit</button></div>
      ${lectures.length ? `<table><tr><th>Week</th><th>Title</th><th>Speaker</th><th>Points</th><th>Quiz</th><th></th></tr>${lectures.map((l) => `<tr><td>${esc(l.week_start)}</td><td>${esc(l.title_en)}</td><td>${esc(l.speaker)}</td><td>${l.xp}</td>
        <td>${l.questions.length ? `<details><summary>${l.questions.length} question${l.questions.length === 1 ? '' : 's'}</summary>${l.questions.map((q) => `<p>${esc(q.q_en)}<br>${q.options_en.map((o, i) => (i === q.answer ? `<b>✓ ${esc(o)}</b>` : esc(o))).join(' · ')}</p>`).join('')}</details>` : '—'}</td>
        <td><button class="chip" data-a="lecedit" data-id="${l.id}">Edit</button> <button class="chip" data-a="lecdel" data-id="${l.id}">Delete</button></td></tr>`).join('')}</table>` : '<p class="empty">No lectures yet.</p>'}
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
      ${days.length ? `<table><tr><th>Day</th><th>Name</th><th></th></tr>${days.slice(0, 15).map((d) => `<tr><td>${esc(d.day)}</td><td>${esc(d.name_en)}</td><td><button class="chip" data-a="specialdel" data-day="${esc(d.day)}">Remove</button></td></tr>`).join('')}</table>` : ''}` : ''}
    ${mod ? `<h3>Reported or hidden</h3>
      <p class="muted">Three reports from different members hide a photo or reflection. Keep something that was reported unfairly (the reports are cleared), remove it, or restore something hidden.</p>
      ${items.length ? `<table><tr><th>Kind</th><th>Member</th><th>Content</th><th>Reports</th><th>Status</th><th></th></tr>${items.map((i) => `<tr><td>${esc(i.kind)}</td><td>${esc(i.username)}</td><td>${esc(i.text || '')} ${photoLink(i)}</td><td>${i.reports}</td><td>${esc(i.status)}</td>
        <td>${i.kind === 'post' && !i.photoUrl ? '<span class="muted">photo deleted</span>' : i.status === 'removed' ? `<button class="chip solid" data-a="restore2" data-kind="${esc(i.kind)}" data-id="${i.id}">Restore</button>` : `<button class="chip" data-a="keep2" data-kind="${esc(i.kind)}" data-id="${i.id}" title="The reports were not justified: clear them and take it off this list">Keep</button> <button class="chip" data-a="remove2" data-kind="${esc(i.kind)}" data-id="${i.id}">Remove</button>`}</td></tr>`).join('')}</table>` : '<p class="empty">Nothing reported.</p>'}` : ''}`;
  },
  async burhan() {
    const { majalis } = can('organise') ? await api('GET', '/majalis') : { majalis: [] };
    const majlisPart = can('organise') ? `<h3>Majalis</h3>
      <p class="muted">Al-Burhan's departments. Members pick one under Me and can propose a new one; approve the proposals that are real departments. The proposer joins a majlis once it is approved.</p>
      <table><tr><th>Majlis</th><th>Urdu</th><th>Members</th><th>Status</th><th>Proposed by</th><th></th></tr>${majalis.map((m) => `<tr><td>${esc(m.name)}</td><td dir="rtl">${esc(m.name_ur)}</td><td>${fmt(m.members)}</td><td>${esc(m.status)}</td><td>${esc(m.proposer || '—')}</td>
        <td>${m.status === 'pending' ? `<button class="chip solid" data-a="mjyes" data-id="${m.id}">Approve</button> <button class="chip" data-a="mjno" data-id="${m.id}">Reject</button>` : ''}</td></tr>`).join('')}</table>` : '';
    if (!can('moderate')) return majlisPart;
    const { murabbi, masul } = await api('GET', '/burhan-links');
    const stage = { waiting: 'murabbi not on the app yet', confirm: 'salik to confirm', pending: 'murabbi to accept', active: 'active: reports shared' };
    return `${majlisPart}<h3>Links</h3><p class="muted">Phone numbers are not verified, so a wrong murabbi can be found through someone else's number. Check links that look wrong and break them. Breaking a link stops all sharing at once; either side can link again.</p>
      <h3>Murabbi links</h3>
      ${murabbi.length ? `<table><tr><th>Salik</th><th>Murabbi</th><th>Name in Mamulaat</th><th>Stage</th><th>Since</th><th></th></tr>${murabbi.map((l) => `<tr><td>${esc(l.salik)}</td><td>${esc(l.murabbi || '—')}</td><td>${esc(l.name)}</td><td>${esc(stage[l.stage])}</td><td>${date(l.at)}</td><td><button class="chip" data-a="bhbreak" data-k="murabbi" data-u="${esc(l.salik)}">Break</button></td></tr>`).join('')}</table>` : '<p class="empty">No murabbi links yet.</p>'}
      <h3>Masul links</h3>
      ${masul.length ? `<table><tr><th>Razakar</th><th>Masul</th><th>Since</th><th></th></tr>${masul.map((l) => `<tr><td>${esc(l.razakar)}</td><td>${esc(l.masul)}</td><td>${date(l.at)}</td><td><button class="chip" data-a="bhbreak" data-k="masul" data-u="${esc(l.razakar)}">Break</button></td></tr>`).join('')}</table>` : '<p class="empty">No masul links yet.</p>'}`;
  },
  async admins() {
    const { admins, roles } = await api('GET', '/admins');
    const blurb = { owner: 'everything, including who is an admin', moderator: 'pictures, names, caravans, reports, flags, suspensions', organiser: 'invite codes, waitlist, news, lectures, challenge, exports, reset links' };
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
      <div class="inline"><button class="chip solid" data-a="exp" data-k="cities">Totals by city</button><button class="chip solid" data-a="exp" data-k="caravans">Totals by caravan</button><button class="chip solid" data-a="exp" data-k="qabilas">Totals by Qabila (invite tree)</button><button class="chip solid" data-a="exp" data-k="weeks">Totals by week</button></div>`;
  },
  async invites() {
    const { invites, publicCode } = await api('GET', '/invites');
    return `<h3>Public founders code</h3>
      <p class="muted">Anyone with this code can join; they start their own Qabila (nobody above them) and can later say who invited them, within 14 days. Switch it off once your launch period ends.</p>
      <div class="inline"><div><div class="code2">${esc(publicCode.code || 'not set')}</div>${publicCode.enabled ? '<span class="pillbox ok">ON</span>' : '<span class="pillbox bad">OFF</span>'}</div>
        <div><label>Sign-ups a day (0 closes it)</label><input id="pubcap" type="number" min="0" value="${publicCode.dailyCap}" style="max-width:110px"><small class="muted">${publicCode.usedToday} used today</small></div><button class="chip" data-a="pubcap">Set limit</button>
        <button class="chip solid" data-a="pub" data-v="${publicCode.enabled ? '0' : '1'}">${publicCode.enabled ? 'Switch off' : 'Switch on'}</button>
        <button class="chip" data-a="pubnew">New random code</button></div>
      <div class="inline"><div><label>Set your own code</label><input id="pubset" placeholder="e.g. QAFILA2026" maxlength="20"></div><button class="chip" data-a="pubset">Set</button></div>
      <h3>Founder codes</h3>
      <p class="muted">One code per organiser or city lead. Each person who joins with it starts their own Qabila (nobody above them).</p>
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
      ${log.length ? `<table><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr>${log.map((l) => `<tr><td>${date(l.at)}</td><td>${esc(l.actor) || '<span class="muted">earlier</span>'}</td><td>${esc(l.action)}</td><td>${esc(l.target)}</td><td class="muted">${esc(l.detail)}</td></tr>`).join('')}</table>` : '<p class="empty">Nothing yet.</p>'}`;
  },
  async members() {
    const q = window.__q || '';
    const { members } = await api('GET', `/members?q=${encodeURIComponent(q)}`);
    return `<h3>Members</h3>
      <div class="inline"><div><label>Search name, email, phone or city</label><input id="q" value="${esc(q)}"></div><button class="chip solid" data-a="search">Search</button></div>
      ${members.length ? `<table><tr><th>Member</th><th>Counts</th><th>Status</th><th>Actions</th></tr>${members.map((m) => `<tr>
        <td><b>${esc(m.username)}</b><br><span class="muted">${esc(m.city)} · ${esc(m.joined)}<br>${m.inviter ? 'invited by ' + esc(m.inviter) : esc(m.invitedVia)}</span></td>
        <td>${fmt(m.total)}<br><span class="muted">Qabila ${fmt(m.team)}${m.invites ? `<br>invites ${m.invites.used}/${m.invites.cap}` : ''}</span></td>
        <td>${m.deleted ? '<span class="pillbox bad">DELETED</span>' : ''}${m.suspended ? '<span class="pillbox bad">SUSPENDED</span>' : ''}${m.hidden ? '<span class="pillbox">HIDDEN</span>' : ''}${m.emailVerified ? '<span class="pillbox ok">EMAIL OK</span>' : ''}<br><span class="muted" dir="ltr">${esc(m.email)}<br>${esc(m.phone)}</span></td>
        <td>${m.deleted ? '' : `<details class="amenu"><summary>Actions</summary><div>
          <button class="chip" data-a="${m.suspended ? 'unsuspend' : 'suspend'}" data-u="${esc(m.username)}">${m.suspended ? 'Unsuspend' : 'Suspend'}</button>
          <button class="chip" data-a="${m.suspended ? 'unsuspendb' : 'suspendb'}" data-u="${esc(m.username)}">${m.suspended ? 'Unsuspend branch' : 'Suspend branch'}</button>
          <button class="chip" data-a="${m.hidden ? 'unhide' : 'hide'}" data-u="${esc(m.username)}">${m.hidden ? 'Unhide' : 'Hide from ranks'}</button>
          ${can('reset_link') ? `<button class="chip" data-a="resetlink" data-u="${esc(m.username)}">Reset link</button>` : ''}
          ${can('delete_member') ? `<button class="chip" data-a="memdel" data-u="${esc(m.username)}">Delete account</button>` : ''}</div></details>`}</td></tr>`).join('')}</table>` : '<p class="empty">No members match.</p>'}`;
  },
};

function bar() {
  $('#bar').innerHTML = ME
    ? `<span class="msg" style="margin:0;flex:1;word-break:normal">${ME.username ? `Signed in as <b>${esc(ME.username)}</b> · ${esc(ME.role)}` : 'Using the shared admin key (owner)'}</span>${can('audit') ? '<button class="chip" id="auditBtn">Run audit</button>' : ''}<button class="chip" id="out">Sign out</button>`
    : showKey ? '<input type="password" id="key" placeholder="Admin key" autocomplete="off"><button class="chip solid" id="save">Use key</button><button class="chip" id="back">Back</button>'
      : '<input id="aid" type="text" placeholder="Username" autocomplete="username" autocapitalize="off"><input type="password" id="apw" placeholder="Password" autocomplete="current-password"><button class="chip solid" id="login">Sign in</button><button class="chip" id="usekey">Use admin key</button>';
}
async function enter() { // find out who the server thinks we are
  try { ME = await api('GET', '/me'); } catch { ME = null; }
  try { EDITION = (await (await fetch('/api/config')).json()).edition || 'public'; } catch { /* stays public */ }
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
      let questions;
      try { questions = qz ? JSON.parse(qz) : undefined; } catch { return say('The quiz is not valid JSON.'); }
      const body = { youtube_id: $('#lyt').value.trim(), week: $('#lwk').value, min_seconds: Number($('#lmin').value), xp: Number($('#lxp').value), title_en: $('#ltE').value, title_ur: $('#ltU').value, speaker: $('#lsp').value, questions };
      const id = $('#lid').value;
      if (id) { await api('PUT', `/lectures/${id}`, body); say('Lecture updated. Comments, likes and quiz passes are kept.'); } else { await api('POST', '/lectures', body); say('Lecture added.'); }
    },
    lecedit: async () => {
      const l = (await api('GET', '/lectures')).lectures.find((x) => x.id === Number(d.id));
      if (!l) return;
      $('#lid').value = l.id; $('#lyt').value = l.youtube_id; $('#lwk').value = l.week_start; $('#lmin').value = l.min_seconds; $('#lxp').value = l.xp;
      $('#ltE').value = l.title_en; $('#ltU').value = l.title_ur || ''; $('#lsp').value = l.speaker || ''; $('#lqz').value = l.questions.length ? JSON.stringify(l.questions, null, 1) : '';
      $('#lecbtn').textContent = 'Save changes'; $('#lecnew').hidden = false; $('#ltE').focus();
      return 'stay';
    },
    lecnew: async () => {},
    lecdel: async () => { if (!confirm('Delete this lecture?')) return; await api('DELETE', `/lectures/${d.id}`); say('Deleted.'); },
    promptset: async () => { await api('POST', '/prompts', { day: $('#pday').value, text_en: $('#ptE').value, text_ur: $('#ptU').value }); say('Question saved.'); },
    specialset: async () => { await api('POST', '/special-days', { day: $('#sday').value, name_en: $('#snE').value, name_ur: $('#snU').value }); say('Day saved.'); },
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
    circleset: async () => { const r = await api('POST', '/circle', { url: $('#ciurl').value }); say(r.circleUrl ? 'Circle link saved. Members now see it on Today.' : 'Circle link removed: the card is hidden.'); },
    teachyes: async () => { await api('POST', `/circle-teachers/${d.u}`, { action: 'approve' }); say(`${d.u} confirmed as a circle teacher (+1,000 points).`); },
    teachno: async () => { await api('POST', `/circle-teachers/${d.u}`, { action: 'reject' }); say(`${d.u}'s request was turned down. They can ask again.`); },
    mjyes: async () => { const r = await api('POST', `/majalis/${d.id}`, { action: 'approve' }); say(`${r.name} approved.`); },
    mjno: async () => { if (!confirm('Reject this majlis?')) return; const r = await api('POST', `/majalis/${d.id}`, { action: 'reject' }); say(`${r.name} rejected.`); },
    keep2: async () => { await api('POST', `/content/${d.kind}/${d.id}`, { action: 'restore' }); say('Kept, and its reports cleared.'); },
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
    approve: async () => { const r = await api('POST', `/waitlist/${d.id}`, { action: 'approve' }); say(`Approved. Invite code ${r.code}${r.emailed ? ' (emailed)' : r.mailOff ? ' (not emailed: this server has no email provider)' : ''}. Send it over WhatsApp from the approved tab.`); window.__wl = 'approved'; },
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
    memdel: async () => {
      if (prompt(`This erases ${d.u}'s name, email, phone, picture and photos for good. Their durood stays in the totals. Type the username to confirm.`) !== d.u) return say('Not deleted: the username did not match.');
      await api('POST', `/members/${d.u}`, { action: 'delete' }); say(`${d.u}'s account was deleted.`);
    },
    bhbreak: async () => { if (!confirm(`Break ${d.u}'s ${d.k} link? Nothing more is shared; they can link again.`)) return; await api('DELETE', `/burhan-links/${d.k}/${d.u}`); say('Link broken.'); },
    unsuspend: () => api('POST', `/members/${d.u}`, { action: 'unsuspend' }),
    suspendb: () => confirm(`Suspend ${d.u} and everyone they invited, at every level?`) && api('POST', `/members/${d.u}`, { action: 'suspend', branch: true }).then((r) => say(`${r.affected} members suspended.`)),
    unsuspendb: () => api('POST', `/members/${d.u}`, { action: 'unsuspend', branch: true }).then((r) => say(`${r.affected} members restored.`)),
    hide: () => api('POST', `/members/${d.u}`, { action: 'hide' }),
    unhide: () => api('POST', `/members/${d.u}`, { action: 'unhide' }),
    adgrant: async () => { const username = $('#adu').value.trim(), role = $('#adr').value; await api('POST', '/admins', { username, role }); say(`${username} is now ${role}.`); },
    adrevoke: async () => { if (!confirm(`Remove ${d.u}'s admin role? They stay a member.`)) return; await api('DELETE', `/admins/${d.u}`); say('Role removed.'); },
    resetlink: async () => { const r = await api('POST', `/members/${d.u}`, { action: 'reset-link' }); say(`Reset link for ${d.u} (works once, one hour): ${r.url}`); },
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
  if (id === 'auditBtn') {
    try {
      const r = await api('GET', '/audit');
      $('#audit').innerHTML = `<div class="msg" style="${r.ok ? '' : 'border-color:var(--err)'}">${r.ok ? `Audit clean: ${fmt(r.users)} members, ${fmt(r.ledgerTotal)} durood, every total matches the ledger.` : `Audit found ${r.problems.length} problem(s): ${esc(JSON.stringify(r.problems.slice(0, 3)))}`}</div>`;
    } catch (e) { $('#audit').innerHTML = `<div class="msg" style="border-color:var(--err)">${esc(e.message)}</div>`; }
  }
});
$('#mode').onclick = () => {
  const next = document.documentElement.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-mode', next);
  try { localStorage.setItem('mode', next); } catch { /* private mode */ }
};
(async () => { if (TOKEN || KEY) await enter(); render(); })();
