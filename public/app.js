import { I18N } from './i18n.js';
import { uiIcon, badgeSvg } from './icons.js';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const params = new URLSearchParams(location.search);
const urlInvite = params.get('invite') || params.get('ref');
if (urlInvite) ls.set('ref', urlInvite.trim());

const S = {
  token: ls.get('token'),
  me: null,
  lang: ls.get('lang') || 'ur',
  tab: 'home',
  authMode: params.get('reset') ? 'reset' : urlInvite ? 'register' : 'login',
  resetToken: params.get('reset') || '',
  wait: false,
  forgot: false,
  history: null,
  editing: null,
  ref: ls.get('ref') || '',
  refName: null,
  pending: Number(ls.get('pending')) || 0,
  board: { type: 'users', period: 'week', metric: 'total', data: null },
  feed: null, feedSeen: null, reflDraft: '', tapOpen: false,
  intro: ls.get('intro') ? null : 0,
  team: null,
  learn: null,
  player: null,
  sunnah: null,
  draft: null,
  error: '',
};

const MILESTONES = [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000];   // referral tree
const CARAVAN_MILESTONES = [10_000, 100_000, 1_000_000];                  // the people I invited myself

const t = (k) => I18N[S.lang][k] ?? I18N.en[k] ?? k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
// Pakistan counts in lakh and crore; numerals stay ASCII (Inter) in both languages
const trim2 = (x) => String(Math.round(x * 100) / 100);
function human(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return `${trim2(a / 1e7)} ${t('crore')}`;
  if (a >= 1e5) return `${trim2(a / 1e5)} ${t('lakh')}`;
  return fmt(a);
}
const N = (x) => `<span class="n">${x}</span>`; // keeps '+50' and '475 / 900' left-to-right inside Urdu text
const $ = (s) => document.querySelector(s);
const app = $('#app');

let toastTimer;
function toast(msg, badge) {
  const el = $('#toast');
  el.innerHTML = (badge ? `<span class="tbadge">${badgeSvg(badge, true, 44)}</span>` : '') + `<span>${esc(msg)}</span>`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function api(path, method = 'GET', body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token && { Authorization: `Bearer ${S.token}` }) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error('network'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && S.token && data.error === 'unauthorized') logout(false);
    if (res.status === 403 && data.error === 'suspended' && S.token) { logout(false); S.error = I18N[S.lang].err.suspended; draw(); }
    throw new Error(data.error || 'server_error');
  }
  return data;
}
const errText = (e) => I18N[S.lang].err[e.message] || t('err').server_error;

function applyLang() {
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.lang === 'ur' ? 'rtl' : 'ltr';
  document.title = t('app');
}

function setSession(token, me) {
  S.token = token; S.me = me; S.lang = me.lang;
  ls.set('token', token); ls.set('lang', me.lang); ls.del('ref');
  S.ref = ''; S.error = '';
}

function logout(render = true) {
  S.token = null; S.me = null; ls.del('token');
  S.tab = 'home'; S.team = S.learn = S.feed = S.board.data = null;
  if (render) draw();
}

// ---- reward feedback --------------------------------------------------------
function celebrate(res) {
  const bits = [];
  if (res.xpGained) bits.push(t('gained'));
  if (res.levelUp) bits.push(t('level_up')(res.levelUp));
  for (const b of res.newBadges || []) bits.push(`${t('new_badge')} ${t('badge')[b][0]}`);
  if (bits.length) toast(bits.join(' · '), (res.newBadges || [])[0]);
  if (res.levelUp || res.newBadges?.length) navigator.vibrate?.([60, 40, 60]);
}

// ---- views (Swiss style: type, hairline rules, flat colour) --------------------------
const NAV_GLYPH = { home: 'home', feed: 'feed', rank: 'bars', caravan: 'caravan', me: 'me' };
const navIcon = (k) => uiIcon(NAV_GLYPH[k], 22, 1.7);

const ICON_SUN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const ICON_BELL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
const isDark = () => document.documentElement.getAttribute('data-mode') === 'dark';

// white / dark choice: the button shows the mode you would switch to
function langToggle() {
  return `<span class="row"><button class="pill icon" data-act="scheme" aria-label="${t(isDark() ? 'mode_white' : 'mode_dark')}" title="${t(isDark() ? 'mode_white' : 'mode_dark')}">${isDark() ? ICON_SUN : ICON_MOON}</button><button class="pill" data-act="lang">${S.lang === 'ur' ? 'English' : 'اردو'}</button></span>`;
}

const footerLinks = () => `<p class="note foot"><a href="/privacy.html">${t('privacy')}</a></p>`;

function introView() {
  const i = S.intro, last = i === 2;
  const titles = [t('intro1_title'), t('intro2_title'), t('intro3_title')], texts = [t('intro1_text'), t('intro2_text'), t('intro3_text')];
  return `
  <div class="hd"><span>${t('app')}</span><button class="linkbtn" data-act="introskip">${t('skip')}</button></div>
  <div class="wrap intro3">
    <div class="steps">${[0, 1, 2].map((n) => `<i class="${n <= i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="arabic">${i === 0 ? t('durood') : ''}</div>
    <h2>${titles[i]}</h2>
    <p>${texts[i]}</p>
    ${i === 0 ? `<div class="langpick"><button class="blk ${S.lang === 'en' ? '' : 'out'}" data-act="setlang" data-l="en"><span>English</span></button><button class="blk ${S.lang === 'ur' ? '' : 'out'}" data-act="setlang" data-l="ur"><span>اردو</span></button></div>` : ''}
    <button class="blk" data-act="intronext"><span>${last ? t('start') : t('next')}</span><b>→</b></button>
  </div>`;
}

function authView() {
  const mode = S.authMode;
  const tabs = mode === 'login' || mode === 'register';
  const err = S.error ? `<div class="err">${esc(S.error)}</div>` : '';
  const field = (label, name, type = 'text', extra = '') => `<label>${label}</label><input type="${type}" name="${name}" ${extra}>`;
  let body = '';
  if (mode === 'login') {
    body = `<form class="sec" data-form="login" autocomplete="on">${err}
      ${field(t('id_label'), 'id', 'text', 'autocapitalize="none" autocomplete="username" required dir="ltr"')}
      ${field(t('password'), 'password', 'password', 'autocomplete="current-password" required dir="ltr"')}
      <button class="blk" type="submit"><span>${t('login')}</span><b>→</b></button>
      <p class="linkrow"><button type="button" class="linkbtn" data-act="mode" data-mode="forgot">${t('forgot')}</button></p></form>`;
  } else if (mode === 'register') {
    body = `<form class="sec" data-form="register" autocomplete="on">${err}
      <label>${t('invite_code')}</label>
      <input type="text" name="invite" value="${esc(S.ref)}" autocapitalize="characters" autocomplete="off" required data-check="invite" dir="ltr">
      <div class="hint" id="rcheck">${S.refName ? `${t('invited_by')} <b>${esc(S.refName)}</b> ✓` : t('invite_hint')}</div>
      <p class="linkrow">${t('no_code')} <button type="button" class="linkbtn" data-act="mode" data-mode="waitlist">${t('request_access')}</button></p>
      <label>${t('username')}</label>
      <input type="text" name="username" data-check="username" autocapitalize="none" autocomplete="username" maxlength="20" required dir="ltr">
      <div class="hint" id="ucheck">${t('username_hint')}</div>
      ${field(t('email'), 'email', 'email', 'autocomplete="email" required dir="ltr"')}
      ${field(t('phone'), 'phone', 'tel', 'autocomplete="tel" required dir="ltr"')}
      <div class="hint">${t('phone_hint')}</div>
      ${field(t('city'), 'city', 'text', 'maxlength="40"')}
      ${field(t('password'), 'password', 'password', 'autocomplete="new-password" minlength="6" required dir="ltr"')}
      <button class="blk" type="submit"><span>${t('register')}</span><b>→</b></button></form>`;
  } else if (mode === 'waitlist') {
    body = `<div class="sec"><h3 class="in">${t('request_access')}</h3>${S.wait
      ? `<p>${t('wait_done')}</p>`
      : `<p class="muted">${t('waitlist_text')}</p><form data-form="waitlist" class="plain">${err}
        ${field(t('name'), 'name', 'text', 'required maxlength="80"')}
        ${field(t('phone'), 'phone', 'tel', 'required dir="ltr"')}
        ${field(t('email'), 'email', 'email', 'dir="ltr"')}
        ${field(t('city'), 'city', 'text', 'maxlength="40"')}
        <button class="blk" type="submit"><span>${t('send_request')}</span><b>→</b></button></form>`}
      <p class="linkrow"><button type="button" class="linkbtn" data-act="mode" data-mode="login">${t('back_login')}</button></p></div>`;
  } else if (mode === 'forgot') {
    body = `<div class="sec"><h3 class="in">${t('forgot')}</h3>${S.forgot
      ? `<p>${t('forgot_done')}</p>`
      : `<p class="muted">${t('forgot_text')}</p><form data-form="forgot" class="plain">${err}
        ${field(t('email'), 'email', 'email', 'required autocomplete="email" dir="ltr"')}
        <button class="blk" type="submit"><span>${t('send_link')}</span><b>→</b></button></form>`}
      <p class="linkrow"><button type="button" class="linkbtn" data-act="mode" data-mode="login">${t('back_login')}</button></p></div>`;
  } else if (mode === 'reset') {
    body = `<div class="sec"><h3 class="in">${t('reset_title')}</h3><form data-form="reset" class="plain">${err}
      ${field(t('new_password'), 'password', 'password', 'required minlength="6" autocomplete="new-password" dir="ltr"')}
      <button class="blk" type="submit"><span>${t('save')}</span><b>→</b></button></form></div>`;
  }
  return `
  <div class="hd"><span>${t('app')}</span>${langToggle()}</div>
  <div class="wrap">
    <div class="intro"><div class="arabic">${t('durood')}</div><p>${t('tagline')}</p></div>
    ${tabs ? `<div class="seg">
      <button class="${mode === 'login' ? 'on' : ''}" data-act="mode" data-mode="login">${t('login')}</button>
      <button class="${mode === 'register' ? 'on' : ''}" data-act="mode" data-mode="register">${t('register')}</button>
    </div>` : ''}
    ${body}
    <p class="note">${t('dedication')}</p>
    ${footerLinks()}
  </div>`;
}

function shell() {
  const tabs = ['home', 'feed', 'rank', 'caravan', 'me'];
  return `
  <div class="hd"><span>${t('app')}</span><span class="row"><span class="stk" title="${esc(t('streak'))}" aria-label="${S.me.streak} ${esc(t('streak'))}">${uiIcon('flame', 16, 1.8)} ${S.me.streak}</span><button class="pill icon bell" data-act="news" aria-label="${t('news_title')}" title="${t('news_title')}">${ICON_BELL}${S.me.unreadNews ? `<i class="dot">${S.me.unreadNews > 9 ? '9+' : S.me.unreadNews}</i>` : ''}</button></span></div>
  <div class="wrap tab-${S.tab}">${view()}</div>
  <nav class="tabs"><div class="brand">${t('app')}</div>${tabs.map((k) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${navIcon(k)}<em>${t('nav_' + k)}</em></button>`).join('')}</nav>
  ${S.player ? playerModal() : ''}
  ${S.celebrate ? celebrateModal() : ''}`;
}

function view() {
  return { home, feed: feedView, rank, caravan, me }[S.tab]();
}

const bar = (pct) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

function home() {
  const m = S.me;
  const title = t('titles')[Math.min(m.level - 1, 9)];
  const live = m.today + S.pending;
  return `<div class="cols"><div class="col">
  ${m.hiddenFromRanks ? `<div class="flagnote">${t('flagged')}</div>` : ''}
  <div class="sub"><span>${t('today')}</span><span>${t('goal_word')} ${N(fmt(m.dailyGoal))}</span></div>
  <div class="big ${bigClass(live)}" id="big">${fmt(live)}</div>
  <div id="livebar">${bar((live / m.dailyGoal) * 100)}</div>

  <div class="numbox">
    <label for="manual">${t('enter_total')}</label>
    <div class="row"><input type="number" id="manual" inputmode="numeric" min="1" placeholder="${t('count_ph')}" dir="ltr"><button class="blk addbtn" data-act="manual"><span>${t('add')}</span><b>→</b></button></div>
    <div class="quick presets">${[100, 500, 1000].map((n) => `<button class="chip" data-act="fill" data-n="${n}">${N('+' + fmt(n))}</button>`).join('')}</div>
  </div>

  <button class="linkbtn tapopen" data-act="taptoggle">${uiIcon('tap', 16, 1.9)} ${t('tap_open')} ${S.tapOpen || S.pending ? '−' : '+'}</button>
  ${S.tapOpen || S.pending ? `<div class="tapbox">
    <button class="tap blk" data-act="tap"><span class="lab">${uiIcon('tap', 26, 1.9)} ${t('tap_hint')}</span><b>${N('+1')}</b></button>
    <div class="pendrow">
      <span><b id="pend">${fmt(S.pending)}</b> ${t('pending')}</span>
      <span class="quick"><button class="chip" data-act="preset">${t('reset')}</button></span>
    </div>
    <button class="blk go" data-act="submitp" id="submitp" ${S.pending ? '' : 'disabled'}><span>${t('submit_pending')}</span><b>→</b></button>
  </div>` : ''}

  ${challengeCard(m)}

  <div class="stats">
    <div><b>${fmt(m.week)}</b><span>${t('week')}</span></div>
    <div><b>${fmt(m.total)}</b><span>${t('total')}</span></div>
    <div><b>${m.level}</b><span>${esc(title)}</span></div>
  </div>
  </div><div class="col">
  <div class="lvl"><div class="row between"><span>${uiIcon('bolt', 14, 1.9)} ${t('level')} ${m.level} · ${esc(title)}</span><span title="${esc(t('shield_hint'))}">${uiIcon('shield', 14, 1.9)} ${m.shields}</span></div>${bar(m.pct)}</div>

  ${pushPromptDue() ? `<div class="circlecard push"><b>${t('push_card_title')}</b><p>${t('push_card_text')}</p>
    <div class="row"><button class="blk fill1" data-act="pushon"><span>${t('push_enable')}</span><b>→</b></button><button class="chip" data-act="pushno">${t('push_later')}</button></div></div>` : ''}
  <div class="circlecard">
    <b>${t('circle_title')}</b>
    <p>${t('circle_text')}</p>
    ${m.circleUrl ? `<a class="blk fill1" href="${esc(m.circleUrl)}" target="_blank" rel="noopener"><span>${t('circle_open')}</span><b>↗</b></a>` : `<p class="muted">${t('circle_none')}</p>`}
  </div>

  <h3>${t('durood_quests')}</h3>
  ${m.quests.filter((q) => q.group === 'durood').map((q) => quest(q)).join('')}

  <h3 class="row between"><span>${t('bonus_quests')}</span><button class="chip" data-act="tab" data-tab="feed">${t('see_bonus')}</button></h3>
  ${m.quests.filter((q) => q.group === 'bonus').map((q) => quest(q, true)).join('')}

  <h3>${t('caravan_title')}</h3>
  <button class="rowlink" data-act="tab" data-tab="caravan"><span>${fmt(m.caravan.members)} ${t('members')}</span><b>${fmt(m.total + m.caravan.down)}</b></button>

  <p class="note">${t('reminder_note')}</p>
  </div></div>`;
}

// keep the big number and its bar in step with taps without redrawing the screen
// the headline numeral shrinks with the number of characters so large counts never clip
const bigClass = (n) => { const c = fmt(n).length; return c <= 3 ? '' : c <= 5 ? 'l5' : c === 6 ? 'l6' : 'l7'; };
function liveHome() {
  const m = S.me, live = m.today + S.pending;
  $('#big').textContent = fmt(live);
  $('#big').className = `big ${bigClass(live)}`;
  $('#livebar').innerHTML = bar((live / m.dailyGoal) * 100);
  if ($('#pend')) { $('#pend').textContent = fmt(S.pending); $('#submitp').disabled = !S.pending; }
}

function challengeCard(m) {
  const c = m.pub.challenge;
  if (!c || c.state === 'waiting') return '';
  const pct = Math.min(100, (c.total / c.target) * 100);
  const head = `<div class="chead"><span>${uiIcon('star', 14, 2)} ${t('challenge_title')}</span><span>${c.state === 'running' || c.state === 'over' ? t('day_of')(c.dayIndex, c.days) : ''}</span></div>`;
  const tot = `<div class="ctotal"><b>${fmt(c.total)}</b><span>${t('of')} ${N(fmt(c.target))}</span></div><div class="chuman">${human(c.total)} ${t('of')} ${human(c.target)}</div>`;
  const markPct = c.state === 'running' ? ((c.dayIndex - 1) / c.days) * 100 : 0;
  const barEl = `<div class="cbar">${bar(pct)}${c.state === 'running' && markPct > 0 ? `<span class="pace" style="inset-inline-start:${markPct}%" title="plan"></span>` : ''}</div>`;
  let body = '';
  if (c.state === 'running') {
    const gap = c.gap;
    const status = gap === 0 ? t('on_plan') : gap > 0 ? t('ahead')(human(gap)) : t('behind')(human(gap));
    const proj = c.projectedTotal == null ? t('plan_each_day')(human(c.plannedPerDay))
      : t('projected')(human(c.projectedTotal), Math.round((c.projectedTotal / c.target) * 100), c.days);
    body = `<div class="cells"><div><b>${fmt(c.neededToday)}</b><span>${t('needed_today')}</span></div><div><b>${fmt(c.today)}</b><span>${t('reported_today')}</span></div><div><b>${c.daysLeft}</b><span>${t('days_left')}</span></div></div>
      <div class="cstatus ${gap < 0 ? 'behind' : 'ahead'}">${status}</div><div class="cnote">${proj}</div>`;
  } else if (c.state === 'upcoming') {
    body = `<div class="cstatus ahead">${c.startsIn === 1 ? t('starts_tomorrow') : t('starts_in')(c.startsIn)}</div>`;
  } else if (c.state === 'over') {
    body = `<div class="cstatus behind">${t('over_msg')(c.dayIndex, c.days, human(c.short))}</div>`;
  } else if (c.state === 'done') {
    body = `<div class="cstatus ahead">${t('done_msg')(human(c.target))}</div>`;
  }
  return `<div class="challenge">${head}${tot}${barEl}${body}<div class="cnote">${fmt(m.pub.members)} ${t('members')} · ${t('self_reported')}</div></div>`;
}

// ---- celebration: each crore reached, and the finish ---------------------------------------------------------------
function checkCelebrate() {
  const c = S.me?.pub?.challenge;
  if (!c || c.state === 'waiting' || S.celebrate) return;
  const key = `seen:${S.me.username}`;
  const done = c.state === 'done' ? 1 : 0;
  let seen = null;
  try { seen = JSON.parse(ls.get(key)); } catch { /* none */ }
  if (!seen) { ls.set(key, JSON.stringify({ r: c.reached, d: done })); return; } // new here: don't replay old milestones
  if (c.reached > seen.r || (done && !seen.d)) {
    S.celebrate = { k: c.reached, done: !!(done && !seen.d), day: c.dayIndex, target: c.target };
    ls.set(key, JSON.stringify({ r: c.reached, d: done }));
    navigator.vibrate?.([80, 50, 80, 50, 160]);
  }
}

function celebrateModal() {
  const x = S.celebrate;
  return `<div class="modal celebrate"><div class="box">
    <div class="cnum">${x.done ? human(x.target).split(' ')[0] : x.k}</div>
    <div class="ctitle">${x.done ? t('celebrate_done') : t('celebrate_crore')(x.k)}</div>
    <p>${t('celebrate_text')(x.day)}</p>
    <div class="row"><button class="blk fill1" data-act="shareCard"><span class="lab">${uiIcon('share', 20, 1.8)} ${t('share')}</span><b>→</b></button><button class="chip" data-act="celebrateX">${t('close')}</button></div>
  </div></div>`;
}

// a portrait card in the app's own style, drawn in the browser so nothing is uploaded
async function shareCard() {
  const x = S.celebrate, dark = isDark();
  const ink = dark ? '#f4f1ea' : '#0b0b0b', paper = dark ? '#0b0b0b' : '#ffffff', sig = dark ? '#22d68f' : '#00a86b', soft = dark ? '#92928b' : '#66665f';
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const family = S.lang === 'ur' ? "Inter, 'Noto Nastaliq Urdu', serif" : 'Inter, Helvetica, Arial, sans-serif';
  try { await Promise.all(['800 100px Inter', '600 40px Inter', S.lang === 'ur' ? '400 40px "Noto Nastaliq Urdu"' : '400 40px Inter'].map((f) => document.fonts.load(f))); } catch { /* fall back */ }
  g.fillStyle = paper; g.fillRect(0, 0, W, H);
  g.fillStyle = sig; g.fillRect(0, 0, W, 28);
  g.textBaseline = 'alphabetic'; g.direction = S.lang === 'ur' ? 'rtl' : 'ltr';
  const left = S.lang === 'ur' ? W - 80 : 80; g.textAlign = S.lang === 'ur' ? 'right' : 'left';
  g.fillStyle = soft; g.font = `600 44px ${family}`; g.fillText(t('app'), left, 130);
  g.fillStyle = ink; g.font = `800 560px ${family}`; g.direction = 'ltr'; g.textAlign = 'left';
  const big = x.done ? human(x.target).split(' ')[0] : String(x.k);
  g.fillText(big, 60, 760);
  g.direction = S.lang === 'ur' ? 'rtl' : 'ltr'; g.textAlign = S.lang === 'ur' ? 'right' : 'left';
  g.fillStyle = sig; g.font = `800 120px ${family}`; g.fillText(t('crore'), left, 900);
  g.fillStyle = ink; g.font = `600 56px ${family}`; g.fillText(t('celebrate_text')(x.day), left, 990);
  const total = S.me.pub.challenge.total, target = x.target;
  g.fillStyle = dark ? '#1c1c1a' : '#ecece6'; g.fillRect(80, 1090, W - 160, 36);
  g.fillStyle = sig; const w = (W - 160) * Math.min(1, total / target);
  if (S.lang === 'ur') g.fillRect(W - 80 - w, 1090, w, 36); else g.fillRect(80, 1090, w, 36);
  g.fillStyle = soft; g.font = `600 40px ${family}`;
  g.fillText(`${human(total)} ${t('of')} ${human(target)} · ${t('challenge_title')}`, left, 1190);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  const file = new File([blob], 'seerah-quest.png', { type: 'image/png' });
  const text = `${t('share_text')(x.done ? human(x.target).split(' ')[0] : x.k, x.day)} ${location.origin}`;
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'seerah-quest.png'; a.click(); // no file sharing here: save the image
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function quest(q, dim) {
  return `<div class="q ${q.done ? 'd' : ''} ${dim ? 'dim' : ''}">
    <span class="bx"></span>
    <span class="t">${t('q_' + q.id)} <em>${t(q.period === 'day' ? 'daily' : 'weekly')}</em><small>${N(`${fmt(q.cur)} / ${fmt(q.goal)}`)}</small></span>
  </div>`;
}

// ---- reminders (web push) ------------------------------------------------------------------------------------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function enablePush() {
  if (!pushSupported()) throw new Error('push_unsupported');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('push_denied');
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/push/key');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api('/push/subscribe', 'POST', sub.toJSON());
}
async function disablePush() {
  try { const reg = await navigator.serviceWorker.ready; await (await reg.pushManager.getSubscription())?.unsubscribe(); } catch { /* none */ }
  await api('/push', 'DELETE');
}
const pushPromptDue = () => S.me.streak >= 2 && pushSupported() && Notification.permission === 'default' && !ls.get('pushNo');

// ---- the feed ---------------------------------------------------------------------------------------------------
const pick = (en, ur) => (S.lang === 'ur' && ur) || en;
function ago(at) {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  return m < 1 ? t('ago_now') : m < 60 ? t('ago_m')(m) : m < 1440 ? t('ago_h')(Math.floor(m / 60)) : t('ago_d')(Math.floor(m / 1440));
}
const statusTag = (st) => `<span class="tag ${st}">${t('st_' + st)}</span>`;

function sunnahCard(d) {
  const sn = d.sunnah, mine = d.mine, r = d.rules;
  if (!sn) return `<div class="fcard"><h3>${t('sunnah_title')}</h3><p class="muted">${t('no_sunnah')}</p></div>`;
  let photoPart;
  if (mine) photoPart = `<div class="row between"><b>${t('your_post')}</b>${statusTag(mine.status)}</div>${mine.photoUrl ? `<img class="shot" src="${esc(mine.photoUrl)}" alt="">` : `<p class="muted">${t('photo_gone')}</p>`}`;
  else if (S.draft && S.draftKind !== 'class') photoPart = `<b>${t('photo_preview')}</b><img class="shot" src="${esc(S.draft)}" alt="">
      <div class="row"><button class="blk" style="flex:1" data-act="postit" data-kind="sunnah"><span>${t('post_it')}</span><b>→</b></button><button class="chip" data-act="draftx">${t('cancel')}</button></div>`;
  else photoPart = `<label class="blk upload"><span class="lab">${uiIcon('camera', 24, 1.8)} ${t('take_photo')}</span><b>+</b><input type="file" accept="image/*" capture="environment" data-photo="sunnah" hidden></label>`;
  const tick = d.ticked
    ? `<div class="q d"><span class="bx"></span><span class="t">${t('tick_done')}</span></div>`
    : `<button class="blk fill1" data-act="tick"><span>${t('tick_btn')}</span><b>✓</b></button><div class="spacer"></div>`;
  return `<div class="fcard"><h3>${t('sunnah_title')}</h3>
    <div class="head">${esc(pick(sn.titleEn, sn.titleUr))}</div><p>${esc(pick(sn.descEn, sn.descUr))}</p>${sn.source ? `<div class="muted">${t('source')}: ${esc(sn.source)}</div>` : ''}
    <div class="spacer"></div>${tick}${photoPart}
    ${mine ? '' : `<p class="note">${t('photo_rules')}</p>`}</div>`;
}

function classCard(d) {
  const cp = d.classPost;
  const body = cp
    ? `<div class="row between"><b>${t('your_post')}</b>${statusTag(cp.status)}</div>${cp.photoUrl ? `<img class="shot" src="${esc(cp.photoUrl)}" alt="">` : `<p class="muted">${t('photo_gone')}</p>`}`
    : S.draft && S.draftKind === 'class'
      ? `<b>${t('photo_preview')}</b><img class="shot" src="${esc(S.draft)}" alt="">
         <div class="row"><button class="blk" style="flex:1" data-act="postit" data-kind="class"><span>${t('post_it')}</span><b>→</b></button><button class="chip" data-act="draftx">${t('cancel')}</button></div>`
      : `<label class="blk upload"><span class="lab">${uiIcon('camera', 24, 1.8)} ${t('class_photo')}</span><b>+</b><input type="file" accept="image/*" capture="environment" data-photo="class" hidden></label>`;
  return `<div class="fcard"><h3>${t('class_title')}</h3><p class="muted">${t('class_text')}</p>${body}</div>`;
}

function reflectionCard(r) {
  const prompt = r.prompt ? pick(r.prompt.textEn, r.prompt.textUr) : t('reflect_default');
  const body = r.mine
    ? `<div class="reflbody" dir="auto">${esc(r.mine.body)}</div><div class="muted">${uiIcon('heart', 14, 2)} ${fmt(r.mine.likes)}</div>`
    : `<textarea id="refl" maxlength="${r.max}" rows="3" placeholder="${t('reflect_ph')}" dir="auto">${esc(S.reflDraft || '')}</textarea>
       <div class="row between"><small class="muted">${t('reflect_rules')}</small><button class="chip solid" data-act="reflect">${t('reflect_post')}</button></div>`;
  return `<div class="fcard"><h3>${uiIcon('pen', 14, 2)} ${t('reflect_title')}</h3><div class="head">${esc(prompt)}</div>${body}</div>`;
}

function lectureCard(x) {
  return `<div class="fcard"><h3>${uiIcon('play', 14, 2)} ${t('lecture_week')}</h3>
    <div class="q ${x.done ? 'd' : ''}"><span class="bx"></span>
      <span class="t">${esc(pick(x.titleEn, x.titleUr))}<small>${esc(x.speaker)}</small></span>
      <button class="chip ${x.done ? '' : 'solid'}" data-act="watch" data-id="${x.id}">${x.done ? t('watched') : `${uiIcon('play', 13, 2)} ${t('watch')}`}</button>
    </div></div>`;
}

function feedItem(it) {
  const who = (name, city) => `<div class="fwho"><b>${esc(name)}</b>${city ? ` <small>${esc(city)}</small>` : ''}<small class="when">${ago(it.at)}</small></div>`;
  const acts = `<div class="facts"><button class="chip like ${it.liked ? 'on' : ''}" data-act="like" data-kind="${it.type === 'photo' ? 'post' : 'reflection'}" data-id="${it.id}" ${it.mine || it.liked ? 'disabled' : ''}>${uiIcon('heart', 14, 2)} ${fmt(it.likes)}</button>
    ${it.mine ? '' : `<button class="chip" data-act="report" data-kind="${it.type === 'photo' ? 'post' : 'reflection'}" data-id="${it.id}" title="${esc(t('report_ask'))}">${uiIcon('flag', 14, 2)}</button>`}</div>`;
  if (it.type === 'announcement') {
    return `<div class="fitem ann ${it.at > (S.feedSeen || Infinity) ? 'unread' : ''}"><div class="flabel">${uiIcon('feed', 12, 2)} ${t('ann_label')}<small class="when">${ago(it.at)}</small></div>
      <b>${esc(pick(it.titleEn, it.titleUr))}</b>${it.bodyEn || it.bodyUr ? `<p>${esc(pick(it.bodyEn, it.bodyUr))}</p>` : ''}</div>`;
  }
  if (it.type === 'photo') {
    return `<div class="fitem"><div class="flabel">${uiIcon(it.kind === 'class' ? 'book' : 'leaf', 12, 2)} ${it.kind === 'class' ? t('class_label') : esc(pick(it.titleEn, it.titleUr))}</div>${who(it.username, it.city)}
      <img class="shot" loading="lazy" src="${esc(it.photoUrl)}" alt="">${acts}</div>`;
  }
  if (it.type === 'reflection') {
    return `<div class="fitem"><div class="flabel">${uiIcon('pen', 12, 2)} ${t('reflect_title')}</div>${who(it.username, it.city)}
      ${it.promptEn ? `<div class="muted fprompt">${esc(pick(it.promptEn, it.promptUr))}</div>` : ''}<div class="reflbody" dir="auto">${esc(it.body)}</div>${acts}</div>`;
  }
  if (it.type === 'milestone') {
    const b = t('badge')[it.code] || [it.code, ''];
    return `<div class="fitem ms ${it.mine ? 'mine' : ''}"><div class="flabel">${uiIcon('star', 12, 2)} ${t('ms_label')}<small class="when">${ago(it.at)}</small></div>
      <b>${t('ms_text')(esc(it.username), esc(b[0]))}</b><div class="muted">${esc(b[1])}</div></div>`;
  }
  if (it.type === 'crore') {
    return `<div class="fitem ms"><div class="flabel">${uiIcon('star', 12, 2)} ${t('challenge_title')}<small class="when">${ago(it.at)}</small></div><b>${t('crore_text')(it.k)}</b></div>`;
  }
  return '';
}

function feedView() {
  const f = S.feed;
  if (!f) return '<p class="muted center">…</p>';
  return `<div class="cols"><div class="col">
    <h3 class="first-d">${t('today_card')}</h3>
    ${f.lectures.map(lectureCard).join('')}
    ${sunnahCard(f.today)}
    ${reflectionCard(f.reflection)}
    ${classCard(f.today)}
  </div><div class="col">
    <h3 class="first-d">${t('stream_title')}</h3>
    <div class="stream">${f.items.length ? f.items.map(feedItem).join('') : `<p class="muted center">${t('feed_empty')}</p>`}</div>
    ${f.next ? `<button class="chip more" data-act="more">${t('more')}</button>` : ''}
  </div></div>`;
}

// ---- rankings: people, caravans, referral trees ---------------------------------------------------------------------
function rank() {
  const b = S.board, rows = b.data?.rows;
  const grp = b.type !== 'users';
  const list = !rows ? '<p class="muted center">…</p>' : rows.length ? `<ul class="lb">${rows.map((r) => `
    <li class="${r.me ? 'me' : ''}"><span class="rank">${r.rank}</span>
      <span class="name">${esc(r.username)}${r.me ? ` <em class="tag">${t('you')}</em>` : ''}<small>${r.city ? `${esc(r.city)}` : ''}${grp ? `${r.city ? ' · ' : ''}${fmt(r.members)} ${t('members')}${b.metric === 'average' ? ` · ${fmt(r.active)} ${t('active')}` : ''}` : ''}</small></span>
      <span class="score">${grp && b.metric === 'growth' && r.score > 0 ? '+' : ''}${fmt(r.score)}</span></li>`).join('')}</ul>` : `<p class="muted center">${t('empty_board')}</p>`;
  const kinds = [['users', 'rk_people'], ['caravans', 'rk_caravans'], ['trees', 'rk_trees']];
  return `
  <div class="seg">${kinds.map(([k, l]) => `<button class="${b.type === k ? 'on' : ''}" data-act="board" data-type="${k}">${t(l)}</button>`).join('')}</div>
  ${grp ? `<div class="seg thin">${['total', 'average', 'growth'].map((x) => `<button class="${b.metric === x ? 'on' : ''}" data-act="board" data-metric="${x}">${t('cv_' + x)}</button>`).join('')}</div>`
    : `<div class="seg thin">
    <button class="${b.period === 'week' ? 'on' : ''}" data-act="board" data-period="week">${t('this_week')}</button>
    <button class="${b.period === 'challenge' ? 'on' : ''}" data-act="board" data-period="challenge">${t('challenge_board')}</button>
    <button class="${b.period === 'all' ? 'on' : ''}" data-act="board" data-period="all">${t('all_time')}</button></div>`}
  ${list}
  <p class="note">${grp ? t('rk_note_' + b.type) + ' ' + t('cv_note_' + b.metric) : (b.period === 'challenge' ? t('challenge_note') : '')}</p>
  <p class="note">${t('self_reported')}</p>
  <p class="note">${t('reminder_note')}</p>`;
}

function uplineBlock(tm) {
  if (!tm?.upline?.length) return '';
  return `<h3>${t('upline_title')}</h3>
  <ul class="lb upline">${tm.upline.map((u) => `<li><span class="name">${esc(u.username)}<small>${u.city ? `${esc(u.city)} · ` : ''}${fmt(u.members)} ${t('members')}</small></span><span class="score">${fmt(u.team)}</span></li>`).join('')}</ul>`;
}

function caravan() {
  const m = S.me, tm = S.team;
  const link = `${location.origin}/?invite=${m.username}`;
  const own = m.total + m.caravan.down;                           // the caravan: me and the people I invited myself
  const next = CARAVAN_MILESTONES.find((x) => x > m.caravan.down) || CARAVAN_MILESTONES.at(-1);
  const prev = CARAVAN_MILESTONES.filter((x) => x <= m.caravan.down).at(-1) || 0;
  return `<div class="cols"><div class="col">
  <h3 class="first-d">${t('caravan_title')}</h3>
  <p class="muted">${t('caravan_sub')}</p>
  <div class="stats"><div><b>${fmt(m.caravan.members)}</b><span>${t('c_members')}</span></div><div><b>${fmt(own)}</b><span>${t('c_total')}</span></div><div><b>${tm ? fmt(tm.caravan.week) : '…'}</b><span>${t('c_week')}</span></div></div>
  <div class="lvl"><div class="row between"><span>${t('next_milestone')}</span><b>${fmt(next)}</b></div>${bar(next === prev ? 100 : ((m.caravan.down - prev) / (next - prev)) * 100)}</div>

  <h3>${t('direct_list')} (${fmt(m.team.direct)})</h3>
  ${!tm ? '…' : tm.direct.length ? `<ul class="lb">${tm.direct.map((d) => `
    <li><span class="name">${esc(d.username)}<small>${d.city ? `${esc(d.city)} · ` : ''}${fmt(d.total)} · ${t('this_week')} ${fmt(d.week)}</small></span><span class="score">${fmt(d.total)}</span></li>`).join('')}</ul>` : `<p class="muted">${t('none_yet')}</p>`}
  </div><div class="col">
  <h3 class="first-d">${t('your_code')}</h3>
  <div class="code">${esc(m.username)}</div>
  <div class="muted" style="margin-top:12px">${t('your_link')}</div>
  <div class="link">${esc(link)}</div>
  <div class="invleft"><b>${m.invites.left}</b> <span>${t('invites_left')} · ${N(`${m.invites.used} / ${m.invites.cap}`)}</span><small>${t('invites_next')(m.invites.nextAt)}</small></div>
  <div class="row" style="margin-top:12px"><button class="blk wa fill1" data-act="wa"><span class="lab">${uiIcon('share', 22, 1.8)} ${t('share_wa')}</span><b>→</b></button><button class="chip" data-act="copy" data-text="${esc(link)}">${t('copy')}</button></div>
  ${uplineBlock(tm)}
  </div></div>`;
}

function historyBlock() {
  const h = S.history;
  if (!h) return '<p class="muted center">…</p>';
  const time = (at) => new Date(at).toLocaleTimeString(S.lang === 'ur' ? 'en-GB' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  if (!h.days.length) return `<p class="note first">${t('hist_empty')}</p>`;
  return h.days.map((d) => `
    <div class="hday"><span>${d.day === h.today ? t('today') : d.day === h.yesterday ? t('yesterday') : esc(d.day)}</span><b>${fmt(d.total)}</b></div>
    ${d.entries.map((e) => `
      <div class="hrow ${S.editing === e.id ? 'ed' : ''}">
        <span class="hc">${fmt(e.count)}</span>
        <span class="ht">${time(e.at)}${e.edits.length ? ` <em class="tag">${t('edited')}</em><small>${t('was')} ${e.edits.map((x) => N(`${fmt(x.from)} → ${fmt(x.to)}`)).join(' · ')}</small>` : ''}</span>
        ${d.editable ? (S.editing === e.id
          ? `<span class="edit"><input type="number" id="editval" inputmode="numeric" min="1" value="${e.count}" dir="ltr"><button class="chip solid" data-act="editsave" data-id="${e.id}">${t('save')}</button><button class="chip" data-act="editx">${t('cancel')}</button></span>`
          : `<button class="chip" data-act="edit" data-id="${e.id}">${t('edit')}</button>`) : ''}
      </div>`).join('')}`).join('');
}

function me() {
  const m = S.me;
  const codes = Object.keys(I18N.en.badge).sort((x, y) => m.badges.includes(y) - m.badges.includes(x)); // earned first, then the usual order
  return `
  <div class="uname">${esc(m.username)}</div>
  <div class="muted" dir="ltr">${esc(m.email)} · ${esc(m.phone)}</div>
  ${m.hiddenFromRanks ? `<div class="flagnote">${t('flagged')}</div>` : ''}
  ${m.emailVerified ? '' : `<div class="notice">${t('email_unconfirmed')} <button class="linkbtn" data-act="resend">${t('resend')}</button></div>`}
  <div class="stats"><div><b>${m.level}</b><span>${t('level')}</span></div><div><b>${fmt(m.total)}</b><span>${t('total')}</span></div><div><b>${m.bestStreak}</b><span>${t('best_streak')}</span></div></div>

  <h3>${t('tree_title')}</h3>
  <p class="note first">${t('tree_sub')}</p>
  <div class="stats"><div><b>${fmt(m.team.members)}</b><span>${t('tree_people')}</span></div><div><b>${fmt(m.team.total)}</b><span>${t('tree_total')}</span></div><div><b>${S.team ? fmt(S.team.week) : '…'}</b><span>${t('tree_week')}</span></div></div>
  ${(() => { const down = m.team.total - m.total, nx = MILESTONES.find((x) => x > down) || MILESTONES.at(-1), pv = MILESTONES.filter((x) => x <= down).at(-1) || 0; return `<div class="lvl"><div class="row between"><span>${t('tree_next')}</span><b>${fmt(nx)}</b></div>${bar(nx === pv ? 100 : ((down - pv) / (nx - pv)) * 100)}</div>`; })()}

  <h3>${t('hist_title')}</h3>
  <p class="note first">${t('hist_hint')}</p>
  ${historyBlock()}

  <h3>${t('badges')}</h3>
  <div class="badges">${codes.map((c) => { const got = m.badges.includes(c); return `<div class="badge ${got ? 'got' : ''}" title="${esc(t('badge')[c][1])}">${badgeSvg(c, got)}<b>${esc(t('badge')[c][0])}</b><span>${esc(t('badge')[c][1])}</span></div>`; }).join('')}</div>

  <h3>${t('settings')}</h3>
  <form data-form="settings">
    <label>${t('daily_goal')}</label>
    <input type="number" name="dailyGoal" min="1" max="100000" value="${m.dailyGoal}" dir="ltr">
    <label>${t('city')}</label>
    <input type="text" name="city" maxlength="40" value="${esc(m.city)}">
    <label>${t('reminder_time')}</label>
    <input type="time" name="reminderTime" value="${esc(m.reminderTime || '')}" dir="ltr">
    <div class="hint">${t('reminder_hint')}</div>
    <label>${t('email')} <span class="tag ${m.emailVerified ? 'verified' : ''}">${m.emailVerified ? t('email_ok') : '!'}</span></label>
    <input type="email" name="email" value="${esc(m.email)}" dir="ltr" required>
    <button class="blk" type="submit"><span>${t('save')}</span><b>→</b></button>
  </form>
  <h3>${t('appearance')}</h3>
  <label class="padx">${t('language')}</label>
  <div class="seg"><button class="${S.lang === 'en' ? 'on' : ''}" data-act="setlang" data-l="en">English</button><button class="${S.lang === 'ur' ? 'on' : ''}" data-act="setlang" data-l="ur">اردو</button></div>
  <label class="padx">${t('display')}</label>
  <div class="seg"><button class="${isDark() ? '' : 'on'}" data-act="setmode" data-m="light">${t('mode_light')}</button><button class="${isDark() ? 'on' : ''}" data-act="setmode" data-m="dark">${t('mode_dark_name')}</button></div>

  ${pushSupported() ? `<div class="hint" style="margin-top:12px;padding-inline:20px">${Notification.permission === 'granted' ? t('push_on') : Notification.permission === 'denied' ? t('push_denied') : t('push_off')}</div>
  <div class="row" style="padding-inline:20px">${Notification.permission === 'granted' ? `<button class="chip" data-act="pushoff">${t('push_disable')}</button>` : Notification.permission === 'denied' ? '' : `<button class="chip solid" data-act="pushon">${t('push_enable')}</button>`}</div>` : `<div class="hint" style="margin-top:12px">${t('push_unsupported')}</div>`}
  <button class="blk out" data-act="logout" style="margin-top:12px"><span>${t('logout')}</span></button>
  <button class="linkbtn padx" data-act="logoutall" style="margin-top:8px">${t('logout_all')}</button>

  <h3>${t('delete_title')}</h3>
  <form data-form="delete">
    <p class="muted">${t('delete_text')}</p>
    <label>${t('password')}</label>
    <input type="password" name="password" autocomplete="current-password" required dir="ltr">
    <button class="blk out danger" type="submit"><span>${t('delete_btn')}</span></button>
  </form>
  ${footerLinks()}`;
}

function quizBlock(p, x) {
  if (!x.quiz?.length) return '';
  if (x.quizPassed || p.passed) return `<div class="note ok">${t('quiz_passed')}</div>`;
  const pick = (en, ur) => (S.lang === 'ur' && ur) || en;
  const wrong = p.wrong || [];
  return `<div class="quiz"><h3>${t('quiz_title')}</h3>
    ${x.quiz.map((q, i) => `<fieldset class="${wrong.includes(i) ? 'bad' : ''}"><legend>${esc(pick(q.q_en, q.q_ur))}</legend>
      ${q.options_en.map((o, j) => `<label class="opt"><input type="radio" name="qz${i}" value="${j}" data-quiz="${i}" ${p.answers?.[i] === j ? 'checked' : ''}> <span>${esc(pick(o, q.options_ur?.[j]))}</span></label>`).join('')}
      ${wrong.includes(i) ? `<small class="err">${t('quiz_wrong')}</small>` : ''}</fieldset>`).join('')}
    <button class="chip solid" data-act="quizcheck">${t('quiz_check')}</button></div>`;
}

function playerModal() {
  const p = S.player, x = p.lecture;
  const left = Math.max(0, x.minSeconds - p.elapsed);
  return `<div class="modal"><div class="box">
    <iframe src="https://www.youtube-nocookie.com/embed/${esc(x.youtubeId)}?rel=0&playsinline=1" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen title="lecture"></iframe>
    <div class="spacer"></div>
    <div class="muted" id="ptimer">${left ? `${t('watching')} · ${t('min_left')(left)}` : ''}</div>
    ${bar((p.elapsed / x.minSeconds) * 100).replace('class="bar"', 'class="bar" id="pbar"')}
    ${quizBlock(p, x)}
    <div class="spacer"></div>
    <div class="row"><button class="blk fill1" id="pclaim" data-act="pclaim" ${left || (x.quiz?.length && !p.passed && !x.quizPassed) ? 'disabled' : ''}><span>${t('can_claim')}</span></button>
    <button class="chip" data-act="pclose">${t('close')}</button></div>
  </div></div>`;
}

// ---- drawing + data loading -----------------------------------------------------
function draw() {
  applyLang();
  if (S.me) checkCelebrate();
  document.body.classList.toggle('in-app', !!S.me);
  app.innerHTML = S.me ? shell() : S.intro !== null ? introView() : authView();
}

const boardUrl = (b) => (b.type === 'users' ? `/leaderboard?type=users&period=${b.period}`
  : b.metric === 'total' ? `/leaderboard?type=${b.type}&period=week` : `/leaderboard?type=${b.type}&metric=${b.metric}`);
async function enterTab(tab) {
  S.tab = tab;
  draw();
  try {
    if (tab === 'rank') { S.board.data = null; draw(); S.board.data = await api(boardUrl(S.board)); }
    if (tab === 'caravan') { S.team = await api('/team'); }
    if (tab === 'me') { [S.history, S.team] = await Promise.all([api('/history'), api('/team')]); }
    if (tab === 'feed') {
      S.feed = null; draw();
      S.feed = await api('/feed');
      S.learn = { lectures: S.feed.lectures };
      S.feedSeen = S.feed.seenAt;
      draw();
      await api('/news/seen', 'POST');
      S.me.unreadNews = 0;
      return draw();
    }
    if (tab !== 'home') draw();
  } catch (e) { toast(errText(e)); }
}
async function refreshMe() {
  S.me = await api('/me');
  S.lang = S.me.lang;
  ls.set('lang', S.lang);
}

// Each submission carries a unique request id. If the connection drops mid-request we retry with the SAME id,
// so the server counts it exactly once even if the first attempt actually succeeded.
let busy = false;
async function submitLog(count) {
  if (busy) return false;
  busy = true;
  const rid = crypto.randomUUID();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await api('/log', 'POST', { count, rid });
        S.me = res.me;
        celebrate(res);
        return true;
      } catch (e) {
        if (e.message === 'network' && attempt < 2) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
        toast(errText(e));
        return false;
      }
    }
  } finally { busy = false; }
}

// ---- events ---------------------------------------------------------------------
app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'lang') {
    S.lang = S.lang === 'ur' ? 'en' : 'ur';
    ls.set('lang', S.lang);
    if (S.me) { S.me.lang = S.lang; api('/me', 'PATCH', { lang: S.lang }).catch(() => {}); }
    return draw();
  }
  if (act === 'scheme') {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-mode', next);
    ls.set('mode', next);
    return draw();
  }
  if (act === 'mode') { S.authMode = el.dataset.mode; S.error = ''; S.wait = false; S.forgot = false; return draw(); }
  if (act === 'edit') { S.editing = Number(el.dataset.id); draw(); $('#editval')?.focus(); return; }
  if (act === 'editx') { S.editing = null; return draw(); }
  if (act === 'editsave') {
    const count = Number($('#editval').value);
    const rid = `e-${crypto.randomUUID()}`; // one id per attempt: a retry after a dropped connection is applied once
    el.disabled = true;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await api(`/entries/${el.dataset.id}`, 'PATCH', { count, rid });
        S.me = r.me; S.history = r.history; S.editing = null;
        toast(t('saved')); return draw();
      } catch (e) {
        if (e.message === 'network' && attempt < 2) { await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1))); continue; }
        toast(errText(e)); el.disabled = false; return;
      }
    }
  }
  if (act === 'resend') { try { await api('/email/resend', 'POST'); toast(t('email_sent')); } catch (e) { toast(errText(e)); } return; }
  if (act === 'tab') return enterTab(el.dataset.tab);
  if (act === 'logout') return logout();
  if (act === 'logoutall') {
    if (!confirm(t('logout_all_ask'))) return;
    try { const r = await api('/sessions/revoke', 'POST'); S.token = r.token; ls.set('token', r.token); toast(t('logout_all_done')); } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'celebrateX') { S.celebrate = null; return draw(); }
  if (act === 'shareCard') { el.disabled = true; await shareCard(); el.disabled = false; return; }

  if (act === 'tap' || act === 'padd') {
    S.pending += act === 'tap' ? 1 : Number(el.dataset.n);
    ls.set('pending', S.pending);
    liveHome();
    if (act === 'tap') navigator.vibrate?.(8);
    return;
  }
  if (act === 'preset') { S.pending = 0; ls.set('pending', 0); return draw(); }
  if (act === 'submitp') {
    el.disabled = true;
    // the server accepts at most 100,000 per request; split large piles
    let left = S.pending;
    while (left > 0) {
      const chunk = Math.min(left, 100_000);
      if (!(await submitLog(chunk))) break;
      left -= chunk; S.pending = left; ls.set('pending', left);
    }
    return draw();
  }
  if (act === 'setlang') {
    S.lang = el.dataset.l; ls.set('lang', S.lang);
    if (S.me) { S.me.lang = S.lang; api('/me', 'PATCH', { lang: S.lang }).catch(() => {}); }
    return draw();
  }
  if (act === 'setmode') { document.documentElement.setAttribute('data-mode', el.dataset.m); ls.set('mode', el.dataset.m); return draw(); }
  if (act === 'intronext') { if (S.intro >= 2) { S.intro = null; ls.set('intro', '1'); } else S.intro += 1; return draw(); }
  if (act === 'introskip') { S.intro = null; ls.set('intro', '1'); return draw(); }
  if (act === 'news') return enterTab('feed');
  if (act === 'pushno') { ls.set('pushNo', '1'); return draw(); }
  if (act === 'pushon') { try { await enablePush(); toast(t('push_on')); } catch (e) { toast(errText(e)); } return draw(); }
  if (act === 'pushoff') { try { await disablePush(); toast(t('push_off')); } catch (e) { toast(errText(e)); } return draw(); }
  if (act === 'taptoggle') { S.tapOpen = !S.tapOpen; return draw(); }
  if (act === 'fill') { const f = $('#manual'); f.value = (Number(f.value) || 0) + Number(el.dataset.n); f.focus(); return; }
  if (act === 'manual') {
    const n = Number($('#manual').value);
    if (await submitLog(n)) draw();
    return;
  }

  if (act === 'board') {
    if (el.dataset.type) S.board.type = el.dataset.type;
    if (el.dataset.period) S.board.period = el.dataset.period;
    if (el.dataset.metric) S.board.metric = el.dataset.metric;
    return enterTab('rank');
  }
  if (act === 'wa') return window.open(`https://wa.me/?text=${encodeURIComponent(t('share_text')(S.me.username, `${location.origin}/?invite=${S.me.username}`))}`, '_blank', 'noopener');
  if (act === 'copy') {
    try { await navigator.clipboard.writeText(el.dataset.text); toast(t('copied')); } catch { prompt('', el.dataset.text); }
    return;
  }

  if (act === 'draftx') { S.draft = null; S.draftKind = null; return draw(); }
  if (act === 'tick') {
    try { const r = await api('/sunnah/tick', 'POST'); S.me = r.me; S.feed.today = { ...S.feed.today, ...r, me: undefined }; toast(r.xpGained ? t('tick_thanks') : ''); } catch (e) { toast(errText(e)); }
    return draw();
  }
  if (act === 'postit') {
    el.disabled = true; el.textContent = t('posting');
    try {
      const r = await api(el.dataset.kind === 'class' ? '/class/post' : '/sunnah/post', 'POST', { image: S.draft });
      S.draft = null; S.draftKind = null; S.me = r.me;
      return enterTab('feed');
    } catch (e) { toast(errText(e)); if (e.message === 'bad_image' || e.message === 'duplicate_image') S.draft = null; return draw(); }
  }
  if (act === 'reflect') {
    const text = $('#refl').value;
    S.reflDraft = text;
    el.disabled = true;
    try {
      const r = await api('/reflections', 'POST', { text });
      S.me = r.me; S.reflDraft = '';
      return enterTab('feed');
    } catch (e) { toast(errText(e)); el.disabled = false; }
    return;
  }
  if (act === 'like') {
    el.disabled = true;
    try {
      const r = await api('/like', 'POST', { kind: el.dataset.kind, id: Number(el.dataset.id) });
      S.me = r.me;
      const it = S.feed.items.find((x) => x.id === Number(el.dataset.id) && (x.type === 'photo') === (el.dataset.kind === 'post'));
      if (it) { it.likes = r.likes; it.liked = true; }
    } catch (e) { toast(errText(e)); if (e.message === 'already_liked') { const it = S.feed.items.find((x) => x.id === Number(el.dataset.id)); if (it) it.liked = true; } }
    return draw();
  }
  if (act === 'report') {
    if (!confirm(t('report_ask'))) return;
    try {
      await api('/report', 'POST', { kind: el.dataset.kind, id: Number(el.dataset.id) });
      S.feed.items = S.feed.items.filter((x) => !(x.id === Number(el.dataset.id) && (x.type === 'photo') === (el.dataset.kind === 'post')));
      toast(t('reported')); draw();
    } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'more') {
    el.disabled = true;
    try {
      const more = await api(`/feed?before=${S.feed.next}`);
      S.feed.items = [...S.feed.items, ...more.items]; S.feed.next = more.next;
    } catch (e) { toast(errText(e)); }
    return draw();
  }
  if (act === 'circle') {
    try { const r = await api('/circle/claim', 'POST'); S.me = r.me; celebrate(r); draw(); } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'watch') {
    const lecture = S.learn.lectures.find((x) => x.id === Number(el.dataset.id));
    try {
      await api(`/lectures/${lecture.id}/start`, 'POST');
      S.player = { lecture, elapsed: lecture.done ? lecture.minSeconds : 0 };
      draw();
      startPlayerTimer();
    } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'quizcheck') {
    const p = S.player, n = p.lecture.quiz.length;
    const answers = Array.from({ length: n }, (_, i) => { const c = document.querySelector(`input[name="qz${i}"]:checked`); return c ? Number(c.value) : -1; });
    p.answers = answers;
    try {
      const r = await api(`/lectures/${p.lecture.id}/quiz`, 'POST', { answers });
      p.passed = r.passed; p.wrong = r.wrong;
      toast(r.passed ? t('quiz_passed') : t('quiz_retry'));
    } catch (e) { toast(errText(e)); }
    return draw();
  }
  if (act === 'pclose') { stopPlayerTimer(); S.player = null; return draw(); }
  if (act === 'pclaim') {
    try {
      const r = await api(`/lectures/${S.player.lecture.id}/complete`, 'POST');
      S.me = r.me; celebrate(r);
      stopPlayerTimer(); S.player = null;
      S.learn = await api('/lectures');
      if (S.feed) S.feed.lectures = S.learn.lectures;
      draw();
    } catch (e) { toast(errText(e)); }
  }
});

let playerTimer;
function stopPlayerTimer() { clearInterval(playerTimer); }
function startPlayerTimer() {
  stopPlayerTimer();
  playerTimer = setInterval(() => {
    const p = S.player;
    if (!p || document.hidden) return; // only counts while the tab is visible
    p.elapsed += 1;
    const left = Math.max(0, p.lecture.minSeconds - p.elapsed);
    const tm = $('#ptimer'), pb = $('#pbar > i'), pc = $('#pclaim');
    if (tm) tm.textContent = left ? `${t('watching')} · ${t('min_left')(left)}` : '';
    if (pb) pb.style.width = `${Math.min(100, (p.elapsed / p.lecture.minSeconds) * 100)}%`;
    if (pc) pc.disabled = left > 0;
  }, 1000);
}

app.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const kind = form.dataset.form;
  const f = Object.fromEntries(new FormData(form));
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    if (kind === 'login') {
      const r = await api('/login', 'POST', { id: f.id, password: f.password });
      setSession(r.token, r.me);
      draw();
    } else if (kind === 'register') {
      const r = await api('/register', 'POST', { ...f, invite: (f.invite || '').trim(), lang: S.lang });
      setSession(r.token, r.me);
      draw();
    } else if (kind === 'waitlist') {
      await api('/waitlist', 'POST', f);
      S.wait = true; S.error = ''; draw();
    } else if (kind === 'forgot') {
      await api('/password/forgot', 'POST', { email: f.email });
      S.forgot = true; S.error = ''; draw();
    } else if (kind === 'reset') {
      const r = await api('/password/reset', 'POST', { token: S.resetToken, password: f.password });
      S.resetToken = ''; S.authMode = 'login';
      history.replaceState(null, '', '/');
      setSession(r.token, r.me); toast(t('reset_done'));
      draw();
    } else if (kind === 'settings') {
      S.me = await api('/me', 'PATCH', { dailyGoal: Number(f.dailyGoal), city: f.city, email: f.email, reminderTime: f.reminderTime || '' });
      toast(t('saved'));
      draw();
    } else if (kind === 'delete') {
      if (!confirm(t('delete_confirm'))) { btn.disabled = false; return; }
      await api('/me', 'DELETE', { password: f.password });
      logout(false); S.authMode = 'login'; draw(); toast(t('deleted'));
    }
  } catch (e) {
    if (kind === 'settings' || kind === 'delete') { toast(errText(e)); btn.disabled = false; }
    else { S.error = errText(e); draw(); }
  }
});

// shrink and re-encode as JPEG in the browser (also drops camera metadata) before upload
async function toJpegDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.8, 0.6, 0.4]) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length * 0.75 < 1_300_000) return url;
  }
  throw new Error('bad_image');
}
app.addEventListener('change', async (ev) => {
  const el = ev.target.closest('input[data-photo]');
  if (!el || !el.files[0]) return;
  try { S.draft = await toJpegDataUrl(el.files[0]); S.draftKind = el.dataset.photo; draw(); } catch (e) { toast(I18N[S.lang].err.bad_image); }
});

let checkTimer;
app.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-check]');
  if (!el) return;
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    const v = el.value.trim();
    if (el.dataset.check === 'username') {
      const out = $('#ucheck');
      if (!v) { out.className = 'hint'; out.textContent = t('username_hint'); return; }
      try {
        const r = await api(`/username-check?u=${encodeURIComponent(v)}`);
        out.className = 'hint ' + (r.ok ? 'ok' : 'bad');
        out.textContent = r.ok ? `✓ ${t('ok_free')}` : r.reason ? t('err').bad_username : t('taken');
      } catch { /* offline: server will validate */ }
    } else {
      const out = $('#rcheck');
      if (!v) { out.className = 'hint'; out.textContent = t('invite_hint'); return; }
      try {
        const r = await api(`/invite-check?code=${encodeURIComponent(v)}`);
        out.className = 'hint ' + (r.valid ? 'ok' : 'bad');
        out.innerHTML = r.valid ? (r.from ? `${t('invited_by')} <b>${esc(r.from)}</b> ✓` : `✓ ${t('invite_ok')}`) : esc(t('err')[r.reason] || t('err').bad_invite);
      } catch { /* ignore */ }
    }
  }, 350);
});

// ---- boot -----------------------------------------------------------------------
async function boot() {
  applyLang();
  if (S.ref) api(`/invite-check?code=${encodeURIComponent(S.ref)}`).then((r) => { if (r.valid && r.from) { S.refName = r.from; if (!S.me) draw(); } }).catch(() => {});
  if (S.resetToken) logout(false); // a reset link always starts from signed-out
  if (S.token) {
    try { await refreshMe(); } catch { /* offline keeps login screen unless token is bad */ }
  }
  draw();
  const confirmToken = params.get('confirm');
  if (confirmToken) {
    try { await api('/email/confirm', 'POST', { token: confirmToken }); toast(t('email_confirmed')); if (S.token) await refreshMe().then(draw); } catch (e) { toast(errText(e)); }
  }
  if (urlInvite || params.get('reset') || confirmToken) history.replaceState(null, '', '/');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
