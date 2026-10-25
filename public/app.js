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
  lang: ls.get('lang') || (/^ur/i.test(navigator.language || '') ? 'ur' : 'en'), // the phone's own language decides the first screen
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
  feed: null, feedSeen: null, reflDraft: '', tapOpen: false, geo: null, league: null,
  intro: ls.get('intro') ? null : 0,
  team: null,
  learn: null,
  player: null,
  sunnah: null,
  draft: null,
  error: '',
};

const MILESTONES = [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000];   // referral tree

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

// a device token: sign-in from this phone keeps working when strangers have locked the account with wrong guesses
const keepDevice = (r) => { if (r?.device) ls.set('device', r.device); };
function setSession(token, me) {
  S.token = token; S.me = me; S.lang = me.lang;
  ls.set('token', token); ls.set('lang', me.lang); ls.del('ref');
  S.ref = ''; S.error = '';
  setTimeout(initBurhan, 0);
}

function logout(render = true, byUser = false) {
  if (byUser && S.token && pushSupported()) { // this device stops getting the last member's notifications
    const tok = S.token;
    fetch('/api/push', { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } }).catch(() => {});
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => sub?.unsubscribe()).catch(() => {});
  }
  S.bh = null; S.bhDetail = null; S.bhLists = null; S.profile = null;
  // nothing of one member's is left for the next person on a shared phone
  S.pending = 0; ls.del('pending'); S.draft = null; S.draftKind = null; S.reflDraft = ''; S.cDraft = {}; S.threads = {}; S.history = null; S.editing = null;
  S.token = null; S.me = null; ls.del('token');
  S.tab = 'home'; S.team = S.cv = S.learn = S.feed = S.board.data = null;
  if (render) draw();
}

// ---- reward feedback --------------------------------------------------------
const gainedSince = (before) => Math.max(0, (S.me.xp || 0) - (before || 0));
function celebrate(res) {
  const bits = [];
  if (res.added) bits.push(t('saved_n')(fmt(res.added)));
  if (res.xpGained) bits.push(t('points_gained')(fmt(res.xpGained)));
  if (res.levelUp) bits.push(t('level_up')(res.levelUp));
  for (const b of res.newBadges || []) bits.push(`${t('new_badge')} ${t('badge')[b][0]}`);
  if (bits.length) toast(bits.join(' · '), (res.newBadges || [])[0]);
  if (res.levelUp || res.newBadges?.length) navigator.vibrate?.([60, 40, 60]);
  // a card to share for a real milestone (not the very first small ones) or a new level
  const big = (res.newBadges || []).find((c) => SHAREABLE.has(c));
  if (!S.celebrate) {
    if (big) S.celebrate = { kind: 'badge', code: big };
    else if (res.levelUp && res.levelUp >= 2) S.celebrate = { kind: 'level', level: res.levelUp };
  }
}
const SHAREABLE = new Set(['d1k', 'd10k', 'd100k', 'd1m', 'streak7', 'streak30', 'streak100', 'recruit5', 'recruit25', 'karwan7', 'karwan30', 'qabila10', 'qabila50', 'qabila250', 'league_silver', 'league_gold', 'league_diamond', 'city_podium', 'city_champion', 'group10k', 'group100k', 'group1m', 'caravan10k', 'caravan100k', 'caravan1m', 'caravan10m']);

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

const footerLinks = () => `<p class="note foot credit">${t('credit')}</p>`;

// ---- welcome art: static SVG plus a few CSS-only transforms, so it costs almost nothing to draw ------------------------------
const STAR_PATH = 'M50 4 L61 27 L84 16 L73 39 L96 50 L73 61 L84 84 L61 73 L50 96 L39 73 L16 84 L27 61 L4 50 L27 39 L16 16 L39 27 Z';
const heroArt = () => `<div class="hero-art" aria-hidden="true">
  <svg class="hero-pat" width="100%" height="100%"><defs><pattern id="khatam" width="64" height="64" patternUnits="userSpaceOnUse">
    <path d="${STAR_PATH}" transform="scale(.5) translate(14 14)" fill="none" stroke="#f0cf86" stroke-opacity=".16" stroke-width="1.2"/>
    <circle cx="0" cy="0" r="1.6" fill="#f0cf86" fill-opacity=".25"/><circle cx="64" cy="64" r="1.6" fill="#f0cf86" fill-opacity=".25"/></pattern></defs>
    <rect width="100%" height="100%" fill="url(#khatam)"/></svg>
  <div class="hero-glow"></div>
  <svg class="hero-star" viewBox="0 0 100 100"><path d="${STAR_PATH}" fill="none" stroke="#f0cf86" stroke-opacity=".5" stroke-width=".6"/>
    <path d="${STAR_PATH}" transform="rotate(22.5 50 50) translate(7 7) scale(.86)" fill="none" stroke="#8fe0d2" stroke-opacity=".35" stroke-width=".5"/><circle cx="50" cy="50" r="30" fill="none" stroke="#f0cf86" stroke-opacity=".18" stroke-width=".4"/></svg>
  ${[0, 1, 2, 3, 4, 5].map((n) => `<i class="spark sp${n}"></i>`).join('')}</div>`;
const duroodWords = () => esc(t('durood')).split(' ').map((w, n) => `<span style="--d:${0.15 + n * 0.12}s">${w}</span>`).join(' ');
const liveLine = () => {
  const l = S.live;
  if (!l || !l.today) return '';
  return `<div class="livepill"><i class="pulse"></i><span>${t('welcome_live')(`<b class="n">${fmt(l.today)}</b>`, `<b class="n">${fmt(l.membersToday || l.members)}</b>`)}</span></div>`;
};
const SLIDE_ART = [
  `<svg viewBox="0 0 120 120" class="slide-art"><path d="${STAR_PATH}" transform="translate(10 10) scale(1)" fill="none" stroke="#f0cf86" stroke-width="1.4"/><text x="60" y="68" text-anchor="middle" font-size="26" fill="#f0cf86" font-family="Noto Naskh Arabic, serif">ﷺ</text></svg>`,
  `<svg viewBox="0 0 120 120" class="slide-art"><g fill="none" stroke="#f0cf86" stroke-width="1.4"><rect x="22" y="62" width="76" height="34" rx="3"/><path d="M34 62V44M60 62V28M86 62V50"/></g>
    <g fill="#8fe0d2"><circle cx="34" cy="40" r="5"/><circle cx="60" cy="24" r="6"/><circle cx="86" cy="46" r="5"/></g><text direction="ltr" x="60" y="84" text-anchor="middle" font-size="16" fill="#f0cf86" font-weight="800" font-family="Inter, sans-serif">+1</text></svg>`,
  `<svg viewBox="0 0 120 120" class="slide-art"><g stroke="#f0cf86" stroke-width="1.4" fill="none"><path d="M60 30L30 62M60 30L90 62M30 62L16 92M30 62L44 92M90 62L76 92M90 62L104 92"/></g>
    <g fill="#8fe0d2"><circle cx="60" cy="28" r="9"/></g><g fill="#f0cf86"><circle cx="30" cy="62" r="6"/><circle cx="90" cy="62" r="6"/></g><g fill="#0b0b0b" stroke="#f0cf86" stroke-width="1.2"><circle cx="16" cy="92" r="4.5"/><circle cx="44" cy="92" r="4.5"/><circle cx="76" cy="92" r="4.5"/><circle cx="104" cy="92" r="4.5"/></g></svg>`,
];
function introView() {
  const i = S.intro, last = i === 2;
  const titles = [t('intro1_title'), t('intro2_title'), t('intro3_title')], texts = [t('intro1_text'), t('intro2_text'), t('intro3_text')];
  return `<div class="stage intro3">${heroArt()}
    <div class="stage-top"><span class="brandmark">${uiIcon('star', 14, 2)} ${t('app')}</span><button class="ghost" data-act="introskip">${t('skip')}</button></div>
    <div class="stage-body" key="${i}">
      <div class="steps">${[0, 1, 2].map((n) => `<i class="${n <= i ? 'on' : ''}"></i>`).join('')}</div>
      ${i === 0 ? `<div class="arabic gold dur" dir="rtl" lang="ar">${duroodWords()}</div>` : SLIDE_ART[i]}
      <h2>${titles[i]}</h2>
      <p>${texts[i]}</p>
      ${i === 0 ? `<div class="langpick"><button class="lp ${S.lang === 'en' ? 'on' : ''}" data-act="setlang" data-l="en">English</button><button class="lp ${S.lang === 'ur' ? 'on' : ''}" data-act="setlang" data-l="ur">اردو</button></div>` : ''}
      <button class="cta" data-act="intronext"><span>${last ? t('start') : t('next')}</span><b class="ar">→</b></button>
    </div></div>`;
}

// ---- the city picker (search as you type) and the phone country --------------------------------------------------------
const cityPicker = (label, initial = '') => `<label for="city-input">${label}</label>
  <div class="cityfield"><input id="city-input" type="text" data-city role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="city-list" autocomplete="off" placeholder="${t('city_ph')}" value="${esc(initial)}">
  <input type="hidden" name="cityId" value=""><ul id="city-list" class="suggest" role="listbox" hidden></ul></div><div class="hint">${t('city_hint')}</div>`;
const countryOptions = () => (S.geo?.countries || [{ cc: 'PK', name: 'Pakistan', dial: '92' }])
  .map((c) => `<option value="${c.cc}" ${c.cc === (S.geo?.country || 'PK') ? 'selected' : ''}>${esc(c.name)} (+${c.dial})</option>`).join('');
async function loadGeo() {
  try { S.geo = await api(`/geo?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || '')}`); if (!S.me) draw(); } catch { /* the form falls back to Pakistan */ }
}


function authView() {
  const mode = S.authMode;
  const tabs = mode === 'login' || mode === 'register';
  const err = S.error ? `<div class="err" role="alert">${esc(S.error)}</div>` : '';
  const field = (label, name, type = 'text', extra = '') => `<label for="f-${name}">${label}</label><input id="f-${name}" type="${type}" name="${name}" ${extra}>`;
  let body = '';
  if (mode === 'login') {
    body = `<form novalidate class="sec" data-form="login" autocomplete="on">${err}
      ${field(t('id_label'), 'id', 'text', 'autocapitalize="none" autocomplete="username" required dir="ltr"')}
      ${field(t('password'), 'password', 'password', 'autocomplete="current-password" required dir="ltr"')}
      <button class="blk" type="submit"><span>${t('login')}</span><b class="ar">→</b></button>
      <p class="linkrow"><button type="button" class="linkbtn" data-act="mode" data-mode="forgot">${t('forgot')}</button></p></form>`;
  } else if (mode === 'register') {
    body = `<form novalidate class="sec" data-form="register" autocomplete="on">${err}
      <label for="f-invite">${t('invite_code')}</label>
      <input id="f-invite" type="text" name="invite" value="${esc(S.ref)}" autocapitalize="characters" autocomplete="off" required data-check="invite" dir="ltr">
      <div class="hint" id="rcheck">${S.refName ? `${t('invited_by')} <b>${esc(S.refName)}</b> ✓` : t('invite_hint')}</div>
      <p class="linkrow">${t('no_code')} <button type="button" class="linkbtn" data-act="mode" data-mode="waitlist">${t('request_access')}</button></p>
      <label for="f-username">${t('username')}</label>
      <input id="f-username" type="text" name="username" data-check="username" autocapitalize="none" autocomplete="username" maxlength="20" required dir="ltr">
      <div class="hint" id="ucheck">${t('username_hint')}</div>
      ${field(t('email'), 'email', 'email', 'autocomplete="email" required dir="ltr"')}
      <label for="f-phone">${t('phone')}</label>
      <div class="phonerow"><select name="phoneCountry" aria-label="${esc(t('country'))}">${countryOptions()}</select><input id="f-phone" type="tel" name="phone" autocomplete="tel-national" required dir="ltr" placeholder="300 1234567"></div>
      <div class="hint">${t('phone_hint')}</div>
      ${cityPicker(t('city'))}
      ${field(t('password'), 'password', 'password', 'autocomplete="new-password" minlength="6" required dir="ltr"')}
      <button class="blk" type="submit"><span>${t('register')}</span><b class="ar">→</b></button></form>`;
  } else if (mode === 'waitlist') {
    body = `<div class="sec"><h3 class="in">${t('request_access')}</h3>${S.wait
      ? `<p>${t('wait_done')}</p>`
      : `<p class="muted">${t('waitlist_text')}</p><form novalidate data-form="waitlist" class="plain">${err}
        ${field(t('name'), 'name', 'text', 'required maxlength="80"')}
        ${field(t('phone'), 'phone', 'tel', 'required dir="ltr"')}
        ${field(t('email'), 'email', 'email', 'dir="ltr"')}
        ${field(t('city'), 'city', 'text', 'maxlength="40"')}
        <button class="blk" type="submit"><span>${t('send_request')}</span><b class="ar">→</b></button></form>`}
      <p class="linkrow"><button type="button" class="linkbtn" data-act="mode" data-mode="login">${t('back_login')}</button></p></div>`;
  } else if (mode === 'forgot') {
    body = `<div class="sec"><h3 class="in">${t('forgot')}</h3>${S.forgot
      ? `<p>${t('forgot_done')}</p>`
      : `<p class="muted">${t('forgot_text')}</p><form novalidate data-form="forgot" class="plain">${err}
        ${field(t('email'), 'email', 'email', 'required autocomplete="email" dir="ltr"')}
        <button class="blk" type="submit"><span>${t('send_link')}</span><b class="ar">→</b></button></form>`}
      <p class="linkrow"><button type="button" class="linkbtn" data-act="mode" data-mode="login">${t('back_login')}</button></p></div>`;
  } else if (mode === 'reset') {
    body = `<div class="sec"><h3 class="in">${t('reset_title')}</h3><form novalidate data-form="reset" class="plain">${err}
      ${field(t('new_password'), 'password', 'password', 'required minlength="6" autocomplete="new-password" dir="ltr"')}
      <button class="blk" type="submit"><span>${t('save')}</span><b class="ar">→</b></button></form></div>`;
  }
  return `
  <div class="stage auth">
    <div class="hero">${heroArt()}
      <div class="stage-top"><span class="brandmark">${uiIcon('star', 14, 2)} ${t('app')}</span>${langToggle()}</div>
      <div class="hero-in"><div class="arabic gold dur" dir="rtl" lang="ar">${duroodWords()}</div><p class="tagl">${t('tagline')}</p>${liveLine()}</div>
    </div>
  <div class="wrap sheet">
    ${tabs ? `<div class="seg">
      <button class="${mode === 'login' ? 'on' : ''}" data-act="mode" data-mode="login">${t('login')}</button>
      <button class="${mode === 'register' ? 'on' : ''}" data-act="mode" data-mode="register">${t('register')}</button>
    </div>` : ''}
    ${body}
    <p class="note">${t('dedication')}</p>
    ${footerLinks()}
  </div></div>`;
}

function cityModal() {
  return `<div class="modal"><div class="box"><form novalidate data-form="citysave"><h3 class="in">${t('city_needed_title')}</h3><p class="muted">${t('city_needed_text')}</p>${cityPicker(t('city'))}
    <button class="blk" type="submit"><span>${t('save')}</span><b class="ar">→</b></button></form></div></div>`;
}

function shell() {
  const tabs = ['home', 'feed', 'rank', 'caravan', 'me'];
  return `
  <a class="skip" href="#main">${t('skip_to')}</a>
  <header class="hd"><span>${t('app')}</span><span class="row"><span class="stk" title="${esc(t('streak'))}" aria-label="${S.me.streak} ${esc(t('streak'))}">${uiIcon('flame', 16, 1.8)} ${S.me.streak}</span><button class="pill icon bell" data-act="news" aria-label="${t('news_title')}" title="${t('news_title')}">${ICON_BELL}${S.me.unreadNews ? `<i class="dot">${S.me.unreadNews > 9 ? '9+' : S.me.unreadNews}</i>` : ''}</button></span></header>
  <main id="main" tabindex="-1" class="wrap tab-${S.tab}"><h1 class="sr">${t('nav_' + S.tab)}</h1>${view()}</main>
  <nav class="tabs" aria-label="${esc(t('app'))}"><div class="brand">${t('app')}</div>${tabs.map((k) => `<button class="${S.tab === k ? 'on' : ''}" ${S.tab === k ? 'aria-current="page"' : ''} data-act="tab" data-tab="${k}">${navIcon(k)}<em>${t('nav_' + k)}</em>${k === 'caravan' && (S.me.caravanInvites || S.me.caravanRequests) ? '<i class="pip" aria-hidden="true"></i>' : ''}</button>`).join('')}</nav>
  ${S.player ? playerModal() : ''}
  ${S.bhDetail ? detailModal() : ''}
  ${S.profile ? profileModal() : ''}
  ${S.celebrate ? celebrateModal() : ''}
  ${S.me.needsCity ? cityModal() : ''}`;
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

  ${m.special ? `<div class="special">${uiIcon('star', 14, 2)} ${t('special_banner')(esc(pick(m.special.nameEn, m.special.nameUr)))}</div>` : ''}
  <div class="live">${uiIcon('feed', 13, 2)} ${t('live_today')(fmt(m.pub.today || 0), fmt(m.pub.membersToday || 0))}</div>
  <div class="numbox">
    <label for="manual">${t('enter_total')}</label>
    <div class="row"><input type="number" id="manual" inputmode="numeric" min="1" placeholder="${t('count_ph')}" dir="ltr"><button class="blk addbtn" data-act="manual"><span>${t('add')}</span><b class="ar">→</b></button></div>
    <div class="quick presets">${[100, 500, 1000].map((n) => `<button class="chip" data-act="fill" data-n="${n}">${N('+' + fmt(n))}</button>`).join('')}</div>
    <div class="hint">${t('quick_hint')}</div>
  </div>

  <button class="linkbtn tapopen" data-act="taptoggle">${uiIcon('tap', 16, 1.9)} ${t('tap_open')} ${S.tapOpen || S.pending ? '−' : '+'}</button>
  ${S.tapOpen || S.pending ? `<div class="tapbox">
    <button class="tap blk" data-act="tap"><span class="lab">${uiIcon('tap', 26, 1.9)} ${t('tap_hint')}</span><b>${N('+1')}</b></button>
    <div class="pendrow">
      <span><b id="pend">${fmt(S.pending)}</b> ${t('pending')}</span>
      <span class="quick"><button class="chip" data-act="preset">${t('reset')}</button></span>
    </div>
    <button class="blk go" data-act="submitp" id="submitp" ${S.pending ? '' : 'disabled'}><span>${t('submit_pending')}</span><b class="ar">→</b></button>
  </div>` : ''}

  ${challengeCard(m)}

  <div class="stats">
    <div><b>${fmt(m.week)}</b><span>${t('week')}</span></div>
    <div><b>${fmt(m.total)}</b><span>${t('total')}</span></div>
    <div><b>${m.level}</b><span>${t('level')} · ${esc(title)}</span></div>
  </div>
  </div><div class="col">
  ${burhanToday()}
  <div class="lvl"><div class="row between"><span>${uiIcon('bolt', 14, 1.9)} ${t('level')} ${m.level} · ${esc(title)}</span><span title="${esc(t('shield_hint'))}">${uiIcon('shield', 14, 1.9)} ${m.shields}</span></div>${bar(m.pct)}</div>

  ${pushPromptDue() ? `<div class="circlecard push"><b>${t('push_card_title')}</b><p>${t('push_card_text')}</p>
    <div class="row"><button class="blk fill1" data-act="pushon"><span>${t('push_enable')}</span><b class="ar">→</b></button><button class="chip" data-act="pushno">${t('push_later')}</button></div></div>` : ''}
  <button class="rowlink" data-act="goleague"><span>${uiIcon('bolt', 14, 2)} ${t('league_title')}</span><b>${t('tier_' + TIER_KEYS[m.league || 0])}</b></button>

  ${m.circleUrl ? `<div class="circlecard">
    <b>${t('circle_title')}</b>
    <p>${t('circle_text')}</p>
    <a class="blk fill1" href="${esc(m.circleUrl)}" target="_blank" rel="noopener"><span>${t('circle_open')}</span><b class="ar">↗</b></a>
  </div>` : ''}

  <h3>${t('durood_quests')}</h3>
  ${m.quests.filter((q) => q.group === 'durood').map((q) => quest(q)).join('')}

  <h3 class="row between"><span>${t('bonus_quests')}</span><button class="chip" data-act="tab" data-tab="feed">${t('see_bonus')}</button></h3>
  ${m.quests.filter((q) => q.group === 'bonus').map((q) => quest(q, true)).join('')}

  <h3>${t('caravan_title')}</h3>
  <button class="rowlink" data-act="tab" data-tab="caravan">${m.caravan ? `<span>${esc(m.caravan.name)} · ${fmt(m.caravan.members)} ${t('members')}</span><b>${m.caravanRequests ? `${m.caravanRequests} ` : ''}→</b>` : `<span>${m.caravanInvites ? t('cv_home_invited')(m.caravanInvites) : t('cv_home_none')}</span><b class="ar">→</b>`}</button>

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

function cardOf(x) {
  if (x.kind === 'badge') { const b = t('badge')[x.code]; return { big: b[0], label: t('new_badge'), line: b[1], title: b[0], text: b[1] }; }
  if (x.kind === 'level') return { big: String(x.level), label: t('level'), line: t('titles')[Math.min(x.level - 1, 9)], title: `${t('level')} ${x.level}`, text: t('titles')[Math.min(x.level - 1, 9)] };
  return { big: x.done ? human(x.target).split(' ')[0] : String(x.k), label: t('crore'), line: t('celebrate_text')(x.day), bar: true,
    title: x.done ? t('celebrate_done') : t('celebrate_crore')(x.k), text: t('celebrate_text')(x.day) };
}

function celebrateModal() {
  const x = S.celebrate, c = cardOf(x);
  return `<div class="modal celebrate"><div class="box">
    <div class="cnum ${c.big.length > 6 ? 'long' : ''}">${esc(c.big)}</div>
    <div class="ctitle">${esc(c.title)}</div>
    <p>${esc(c.text)}</p>
    <div class="row"><button class="blk fill1" data-act="shareCard"><span class="lab">${uiIcon('share', 20, 1.8)} ${t('share')}</span><b class="ar">→</b></button><button class="chip" data-act="celebrateX">${t('close')}</button></div>
  </div></div>`;
}

// a portrait card in the app's own style, drawn in the browser so nothing is uploaded
async function shareCard() {
  const x = S.celebrate, c = cardOf(x), dark = isDark();
  const ink = dark ? '#f4f1ea' : '#0b0b0b', paper = dark ? '#0b0b0b' : '#ffffff', sig = dark ? '#22d68f' : '#00a86b', soft = dark ? '#92928b' : '#66665f';
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const family = S.lang === 'ur' ? "Inter, 'Noto Nastaliq Urdu', serif" : 'Inter, Helvetica, Arial, sans-serif';
  try { await Promise.all(['800 100px Inter', '600 40px Inter', S.lang === 'ur' ? '400 40px "Noto Nastaliq Urdu"' : '400 40px Inter'].map((f) => document.fonts.load(f))); } catch { /* fall back */ }
  g.fillStyle = paper; g.fillRect(0, 0, W, H);
  g.fillStyle = sig; g.fillRect(0, 0, W, 28);
  g.textBaseline = 'alphabetic'; g.direction = S.lang === 'ur' ? 'rtl' : 'ltr';
  const left = S.lang === 'ur' ? W - 80 : 80; g.textAlign = S.lang === 'ur' ? 'right' : 'left';
  g.fillStyle = soft; g.font = `600 44px ${family}`; g.fillText(t('app'), left, 130);
  // the headline shrinks until it fits the card
  let size = 560;
  g.direction = 'ltr'; g.textAlign = 'left';
  while (size > 90) { g.font = `800 ${size}px ${family}`; if (g.measureText(c.big).width <= W - 120) break; size -= 20; }
  g.fillStyle = ink; g.fillText(c.big, 60, 130 + size * 0.95 + 70);
  const y = 130 + size * 0.95 + 70;
  g.direction = S.lang === 'ur' ? 'rtl' : 'ltr'; g.textAlign = S.lang === 'ur' ? 'right' : 'left';
  g.fillStyle = sig; g.font = `800 110px ${family}`; g.fillText(c.label, left, y + 150);
  g.fillStyle = ink; g.font = `600 52px ${family}`; g.fillText(c.line.slice(0, 48), left, y + 250);
  if (c.bar) {
    const total = S.me.pub.challenge.total, target = x.target;
    g.fillStyle = dark ? '#1c1c1a' : '#ecece6'; g.fillRect(80, 1090, W - 160, 36);
    g.fillStyle = sig; const w = (W - 160) * Math.min(1, total / target);
    if (S.lang === 'ur') g.fillRect(W - 80 - w, 1090, w, 36); else g.fillRect(80, 1090, w, 36);
    g.fillStyle = soft; g.font = `600 40px ${family}`;
    g.fillText(`${human(total)} ${t('of')} ${human(target)} · ${t('challenge_title')}`, left, 1190);
  } else {
    g.fillStyle = soft; g.font = `600 44px ${family}`; g.fillText(S.me.username, left, 1190);
  }
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
  const file = new File([blob], 'seerah-quest.png', { type: 'image/png' });
  const text = x.kind ? `${c.title}: ${c.text}. ${location.origin}` : `${t('share_crore')(x.done ? human(x.target).split(' ')[0] : x.k, x.day)} ${location.origin}`;
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

// ---- people: a picture (or their initial) and a name; tap to see their profile -------------------------------------------------------
const hueOf = (name) => [...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function av(p, size = 36, link = true) {
  const inner = p.avatar
    ? `<img class="av" width="${size}" height="${size}" src="${esc(p.avatar)}" alt="" loading="lazy">`
    : `<span class="av ini" style="width:${size}px;height:${size}px;--h:${hueOf(p.username)};font-size:${Math.round(size * 0.44)}px" aria-hidden="true">${esc([...p.username][0] || '?').toUpperCase()}</span>`;
  return link ? `<button class="avbtn" data-act="profile" data-u="${esc(p.username)}" aria-label="${esc(t('view_profile')(p.username))}">${inner}</button>` : inner;
}
const nameLine = (p) => `<b>${esc(p.username)}</b>${p.displayName ? ` <small class="dn">${esc(p.displayName)}</small>` : ''}`;
function profileModal() {
  const d = S.profile, p = d.data;
  const head = `<div class="row between"><h3 class="in">${esc(d.username)}</h3><button class="chip" data-act="closeprofile">${t('close')}</button></div>`;
  if (!p) return `<div class="modal"><div class="box">${head}<p class="muted center">…</p></div></div>`;
  return `<div class="modal"><div class="box profile">${head}
    <div class="pbig">${av(p, 96, false)}</div>
    ${p.displayName ? `<div class="pname" dir="auto">${esc(p.displayName)}</div>` : ''}
    ${p.bio ? `<p class="pbio" dir="auto">${esc(p.bio)}</p>` : ''}
    <p class="muted center">${p.city ? `${esc(p.city)} · ` : ''}${t('member_since')} ${N(esc(p.joined))}${p.caravan ? ` · ${esc(p.caravan)}` : ''}</p></div></div>`;
}

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
  if (mine) photoPart = `<div class="row between"><b>${t('your_post')}</b>${statusTag(mine.status)}</div>${mine.photoUrl ? `<img class="shot thumb" src="${esc(mine.photoUrl)}" alt="">` : `<p class="muted">${t('photo_gone')}</p>`}`;
  else if (S.draft) photoPart = `<b>${t('photo_preview')}</b>
      <div class="row"><button class="blk" style="flex:1" data-act="postit" data-kind="sunnah"><span>${t('post_it')}</span><b class="ar">→</b></button><button class="chip" data-act="draftx">${t('cancel')}</button></div>
      <img class="shot preview" src="${esc(S.draft)}" alt="">`;
  else photoPart = `<label class="blk upload"><span class="lab">${uiIcon('camera', 24, 1.8)} ${t('take_photo')}</span><b>+</b><input type="file" accept="image/*" capture="environment" data-photo="sunnah" hidden></label>`;
  const tick = d.ticked
    ? `<div class="q d"><span class="bx"></span><span class="t">${t('tick_done')}</span></div>`
    : `<button class="blk fill1" data-act="tick"><span>${t('tick_btn')}</span><b>✓</b></button><div class="spacer"></div>`;
  return `<div class="fcard"><h3>${t('sunnah_title')}</h3>
    <div class="head">${esc(pick(sn.titleEn, sn.titleUr))}</div><p>${esc(pick(sn.descEn, sn.descUr))}</p>${sn.source ? `<div class="muted">${t('source')}: ${esc(sn.source)}</div>` : ''}
    <div class="spacer"></div>${tick}${photoPart}
    ${mine ? '' : `<p class="note">${t('photo_rules')}</p>`}</div>`;
}

function reflectionCard(r) {
  const prompt = r.prompt ? pick(r.prompt.textEn, r.prompt.textUr) : t('reflect_default');
  const body = r.mine
    ? `<div class="reflbody" dir="auto">${esc(r.mine.body)}</div><div class="muted">${uiIcon('heart', 14, 2)} ${fmt(r.mine.likes)}</div>`
    : `<textarea id="refl" aria-label="${esc(t('reflect_title'))}" maxlength="${r.max}" rows="3" placeholder="${t('reflect_ph')}" dir="auto">${esc(S.reflDraft || '')}</textarea>
       <div class="row between"><small class="muted">${t('reflect_rules')}</small><button class="chip solid" data-act="reflect">${t('reflect_post')}</button></div>`;
  return `<div class="fcard"><h3>${uiIcon('pen', 14, 2)} ${t('reflect_title')}</h3><div class="head">${esc(prompt)}</div>${body}</div>`;
}

function lectureCard(x) {
  let talk = '';
  if (x.myComment) talk = `<div class="reflbody" dir="auto">${esc(x.myComment.body)}</div><div class="muted">${uiIcon('heart', 14, 2)} ${fmt(x.myComment.likes)}</div>`;
  else if (x.canComment) talk = `<textarea aria-label="${esc(t('comment_title'))}" data-cbox="${x.id}" maxlength="${x.commentMax}" rows="2" placeholder="${t('comment_ph')}" dir="auto">${esc((S.cDraft || {})[x.id] || '')}</textarea>
      <div class="row between"><small class="muted">${t('comment_rules')}</small><button class="chip solid" data-act="comment" data-id="${x.id}">${t('reflect_post')}</button></div>`;
  else talk = `<small class="muted">${t(x.quiz && x.quiz.length ? 'comment_locked' : 'comment_locked_watch')}</small>`;
  return `<div class="fcard"><h3>${uiIcon('play', 14, 2)} ${t('lecture_week')}</h3>
    <div class="q ${x.done ? 'd' : ''}"><span class="bx"></span>
      <span class="t">${esc(pick(x.titleEn, x.titleUr))}<small>${esc(x.speaker)}</small></span>
      <button class="chip ${x.done ? '' : 'solid'}" data-act="watch" data-id="${x.id}">${x.done ? t('watched') : `${uiIcon('play', 13, 2)} ${t('watch')}`}</button>
    </div>
    <div class="spacer"></div><b>${t('comment_title')}</b><div class="ctalk">${talk}</div></div>`;
}

// replies: short, one level, opened under the item they belong to
const replyKind = (it) => (it.type === 'photo' ? 'post' : it.type);
const threadKey = (it) => `${replyKind(it)}:${it.id}`;
function threadHtml(it) {
  const th = (S.threads || {})[threadKey(it)];
  if (!th) return '';
  const list = (th.list || []).map((r) => `<div class="reply"><div class="fwho">${av(r, 26)}${nameLine(r)}${r.city ? ` <small>${esc(r.city)}</small>` : ''}<small class="when">${ago(r.at)}</small>
      ${r.mine ? '' : `<button class="chip" data-act="rreport" data-id="${r.id}" data-key="${threadKey(it)}" aria-label="${esc(t('report_label'))}" title="${esc(t('report_ask'))}">${uiIcon('flag', 12, 2)}</button>`}</div>
      <div class="reflbody" dir="auto">${esc(r.body)}</div></div>`).join('');
  const mineN = (th.list || []).filter((r) => r.mine).length;
  const form = mineN >= 3 ? `<small class="muted">${t('reply_limit_note')}</small>`
    : `<div class="row"><input type="text" aria-label="${esc(t('reply_btn'))}" data-rbox="${threadKey(it)}" maxlength="140" placeholder="${esc(t('reply_ph'))}" dir="auto" value="${esc(th.draft || '')}"><button class="chip solid" data-act="reply" data-key="${threadKey(it)}">${t('reply_send')}</button></div>`;
  return `<div class="thread">${th.loading ? '<small class="muted">…</small>' : list}${form}</div>`;
}

function feedItem(it) {
  const who = () => `<div class="fwho">${av(it, 32)}${nameLine(it)}${it.city ? ` <small>${esc(it.city)}</small>` : ''}<small class="when">${ago(it.at)}</small></div>`;
  const rk = replyKind(it);
  const acts = `<div class="facts"><button class="chip like ${it.liked ? 'on' : ''}" data-act="like" data-kind="${rk}" data-id="${it.id}" aria-label="${esc(t('like_label'))}" aria-pressed="${it.liked ? 'true' : 'false'}" ${it.mine || it.liked ? 'disabled' : ''}>${uiIcon('heart', 14, 2)} ${fmt(it.likes)}</button>
    <button class="chip" data-act="thread" data-kind="${rk}" data-id="${it.id}" aria-label="${esc(t('reply_btn'))}" aria-expanded="${(S.threads || {})[threadKey(it)] ? 'true' : 'false'}">${uiIcon('chat', 14, 2)} ${it.replies ? fmt(it.replies) : t('reply_btn')}</button>
    ${it.mine ? '' : `<button class="chip" data-act="report" data-kind="${rk}" data-id="${it.id}" aria-label="${esc(t('report_label'))}" title="${esc(t('report_ask'))}">${uiIcon('flag', 14, 2)}</button>`}</div>${threadHtml(it)}`;
  if (it.type === 'announcement') {
    return `<div class="fitem ann ${it.at > (S.feedSeen || Infinity) ? 'unread' : ''}"><div class="flabel">${uiIcon('feed', 12, 2)} ${t('ann_label')}<small class="when">${ago(it.at)}</small></div>
      <b>${esc(pick(it.titleEn, it.titleUr))}</b>${it.bodyEn || it.bodyUr ? `<p>${esc(pick(it.bodyEn, it.bodyUr))}</p>` : ''}</div>`;
  }
  if (it.type === 'photo') {
    return `<div class="fitem"><div class="flabel">${uiIcon('leaf', 12, 2)} ${esc(pick(it.titleEn, it.titleUr))}</div>${who()}
      <img class="shot" loading="lazy" src="${esc(it.photoUrl)}" alt="">${acts}</div>`;
  }
  if (it.type === 'reflection') {
    return `<div class="fitem"><div class="flabel">${uiIcon('pen', 12, 2)} ${t('reflect_title')}</div>${who()}
      ${it.promptEn ? `<div class="muted fprompt">${esc(pick(it.promptEn, it.promptUr))}</div>` : ''}<div class="reflbody" dir="auto">${esc(it.body)}</div>${acts}</div>`;
  }
  if (it.type === 'comment') {
    return `<div class="fitem"><div class="flabel">${uiIcon('play', 12, 2)} ${esc(pick(it.lectureEn, it.lectureUr))}</div>${who()}
      <div class="reflbody" dir="auto">${esc(it.body)}</div>${acts}</div>`;
  }
  if (it.type === 'milestone') {
    const b = t('badge')[it.code] || [it.code, ''];
    return `<div class="fitem ms ${it.mine ? 'mine' : ''}"><div class="flabel">${uiIcon('star', 12, 2)} ${t('ms_label')}<small class="when">${ago(it.at)}</small></div>
      <b>${t('ms_text')(esc(it.username), esc(b[0]))}</b><div class="muted">${esc(b[1])}</div></div>`;
  }
  if (it.type === 'city') {
    return `<div class="fitem ms"><div class="flabel">${uiIcon('star', 12, 2)} ${t('city_label')}<small class="when">${ago(it.at)}</small></div><b>${t('city_item')(it.rank, esc(it.label))}</b></div>`;
  }
  if (it.type === 'crore') {
    return `<div class="fitem ms"><div class="flabel">${uiIcon('star', 12, 2)} ${t('challenge_title')}<small class="when">${ago(it.at)}</small></div><b>${t('crore_text')(it.k)}</b></div>`;
  }
  return '';
}

// news first, and only the latest few milestones unless asked: they were most of the page
function feedList(items) {
  const news = items.filter((i) => i.type === 'announcement'), rest = items.filter((i) => i.type !== 'announcement');
  let ms = 0, hidden = 0;
  const shown = rest.filter((i) => { if (i.type !== 'milestone' || S.allMs) return true; if (++ms <= 4) return true; hidden++; return false; });
  return [...news, ...shown].map(feedItem).join('') + (hidden ? `<button class="chip more" data-act="allms">${t('show_milestones')(hidden)}</button>` : '');
}
function feedView() {
  const f = S.feed;
  if (!f) return '<p class="muted center">…</p>';
  return `<div class="cols"><div class="col">
    <h3 class="first-d">${t('today_card')}</h3>
    ${f.lectures.map(lectureCard).join('')}
    ${sunnahCard(f.today)}
    ${reflectionCard(f.reflection)}
  </div><div class="col">
    <h3 class="first-d">${t('stream_title')}</h3>
    <div class="stream">${f.items.length ? feedList(f.items) : `<p class="muted center">${t('feed_empty')}</p>`}</div>
    ${f.next ? `<button class="chip more" data-act="more">${t('more')}</button>` : ''}
  </div></div>`;
}

// ---- compete: the challenge, the weekly league, and rankings of people, caravans, Qabilas and cities ----------------------------
const TIER_KEYS = ['bronze', 'silver', 'gold', 'diamond'];
function leagueView() {
  const L = S.board.data;
  if (!L) return '<p class="muted center">…</p>';
  const name = t('tier_' + TIER_KEYS[L.tier]);
  const head = `<div class="leaguehead"><b>${uiIcon('bolt', 16, 2)} ${t('league_title')} · ${name}</b><small>${t('league_days')(L.daysLeft)}</small></div>`;
  const last = L.last ? `<p class="note">${t('league_last_' + L.last.result)(L.last.rank)}</p>` : '';
  if (!L.joined) return `${head}<p class="muted" style="margin-inline:20px">${t('league_join')(name)}</p>${last}<p class="note">${t('league_rules')}</p>`;
  return `${head}${last}<ul class="lb">${L.rows.map((r) => `
    <li class="${r.me ? 'me' : ''} ${r.up ? 'up' : ''} ${r.down ? 'down' : ''}"><span class="rank">${r.rank}</span>${av(r, 34)}
      <span class="name">${esc(r.username)}${r.me ? ` <em class="tag">${t('you')}</em>` : ''}<small>${r.up ? t('league_up') : r.down ? t('league_down') : esc(r.city || '')}</small></span>
      <span class="score">${fmt(r.score)}</span></li>`).join('')}</ul><p class="note">${t('league_rules')}</p>`;
}

function rank() {
  const b = S.board, rows = b.data?.rows;
  const grp = ['caravans', 'trees', 'cities'].includes(b.type);
  const list = b.type === 'league' ? leagueView() : !rows ? '<p class="muted center">…</p>' : rows.length ? `<ul class="lb">${rows.map((r) => `
    <li class="${r.me ? 'me' : ''}"><span class="rank">${r.rank}</span>${r.avatar !== undefined ? av(r, 34) : ''}
      <span class="name">${esc(r.name ?? r.username)}${r.me ? ` <em class="tag">${t(b.type === 'caravans' ? 'cv_yours' : 'you')}</em>` : ''}<small>${r.city ? `${esc(r.city)}` : ''}${grp ? `${r.city ? ' · ' : ''}${fmt(r.members)} ${t('members')}${b.metric === 'average' ? ` · ${fmt(r.active)} ${t('active')}` : ''}` : ''}</small></span>
      <span class="score">${grp && b.metric === 'growth' && r.score > 0 ? '+' : ''}${fmt(r.score)}</span></li>`).join('')}</ul>` : `<p class="muted center">${t(b.type === 'cities' ? 'empty_cities' : 'empty_board')}</p>`;
  const kinds = [['users', 'rk_people'], ['league', 'rk_league'], ['caravans', 'rk_caravans'], ['trees', 'rk_trees'], ['cities', 'rk_cities']];
  const note = b.type === 'league' ? '' : grp ? `${t('rk_note_' + b.type)} ${t('cv_note_' + b.metric)}` : (b.period === 'challenge' ? t('challenge_note') : '');
  return `
  ${challengeCard(S.me)}
  <div class="seg five">${kinds.map(([k, l]) => `<button class="${b.type === k ? 'on' : ''}" data-act="board" data-type="${k}">${t(l)}</button>`).join('')}</div>
  ${grp ? `<div class="seg thin">${['total', 'average', 'growth'].map((x) => `<button class="${b.metric === x ? 'on' : ''}" data-act="board" data-metric="${x}">${t('cv_' + x)}</button>`).join('')}</div>`
    : b.type === 'users' ? `<div class="seg thin">
    <button class="${b.period === 'week' ? 'on' : ''}" data-act="board" data-period="week">${t('this_week')}</button>
    <button class="${b.period === 'challenge' ? 'on' : ''}" data-act="board" data-period="challenge">${t('challenge_board')}</button>
    <button class="${b.period === 'all' ? 'on' : ''}" data-act="board" data-period="all">${t('all_time')}</button></div>` : ''}
  ${list}
  ${note ? `<p class="note">${note}</p>` : ''}
  ${b.type === 'cities' ? `<p class="note">${t('cities_min')(b.data?.minActive || 5)}</p>` : ''}
  <p class="note">${t('self_reported')}</p>
  <p class="note">${t('reminder_note')}</p>`;
}

function uplineBlock(tm) {
  if (!tm?.upline?.length) return '';
  return `<h3>${t('upline_title')}</h3>
  <ul class="lb upline">${tm.upline.map((u) => `<li><span class="name">${esc(u.username)}<small>${u.city ? `${esc(u.city)} · ` : ''}${fmt(u.members)} ${t('members')}</small></span><span class="score">${fmt(u.team)}</span></li>`).join('')}</ul>`;
}

// ---- caravans: a group you create and name, joined by invitation or by asking ----------------------------------------------------
const cvRow = (r, extra = '') => `<li>${av(r, 34)}<span class="name">${esc(r.username)}${r.owner ? ` <em class="tag">${t('cv_owner')}</em>` : ''}<small>${r.city ? `${esc(r.city)} · ` : ''}${t('this_week')} ${fmt(r.week)}${r.today ? ` · ${t('cv_today')}` : ''}</small></span><span class="score">${fmt(r.total)}</span>${extra}</li>`;
function cvJoinOrCreate(cv) {
  return `<h3 class="first-d">${t('caravan_title')}</h3>
  <p class="muted">${t('cv_intro')}</p>
  ${cv.invitations.length ? `<h3>${t('cv_invitations')}</h3>${cv.invitations.map((i) => `<div class="circlecard"><b>${esc(i.name)}</b> · ${fmt(i.members)} ${t('members')}
      <div class="row" style="margin-top:8px"><button class="blk fill1" data-act="cvaccept" data-id="${i.id}"><span>${t('cv_join_it')}</span><b class="ar">→</b></button><button class="chip" data-act="cvdecline" data-id="${i.id}">${t('decline')}</button></div></div>`).join('')}` : ''}
  <form novalidate class="cname" data-form="cvcreate"><label for="cv-new">${t('cv_create')}</label>
    <div class="row"><input id="cv-new" name="name" type="text" maxlength="20" autocomplete="off" autocapitalize="off" dir="ltr" placeholder="${esc(t('cv_name_ph'))}"><button class="chip solid" type="submit">${t('cv_create_btn')}</button></div>
    <div class="hint" id="cvcheck">${t('cv_name_hint')}</div></form>
  <h3>${t('cv_join_title')}</h3>
  <div class="padx bh"><p class="muted">${t('cv_join_text')}</p>
    <input id="cvjoinq" type="text" aria-label="${esc(t('cv_join_ph'))}" autocomplete="off" autocapitalize="off" dir="ltr" placeholder="${esc(t('cv_join_ph'))}"><div id="cvjoinres" class="chips"></div>
    ${cv.requests.length ? `<b>${t('cv_my_requests')}</b>${cv.requests.map((r) => `<div class="row between"><span>${esc(r.name)}</span><button class="chip" data-act="cvcancelreq" data-id="${r.id}">${t('cv_cancel')}</button></div>`).join('')}` : ''}</div>`;
}
function cvHome(cv) {
  const c = cv.caravan, ks = cv.streak, shown = S.cvAll ? cv.members : cv.members.slice(0, 8);
  const pending = cv.pending || [];
  return `<h3 class="first-d">${t('caravan_title')}</h3>
  <div class="uname cvname">${esc(c.name)}</div>
  <div class="muted padx">${t('cv_owner_is')(esc(c.ownerName))}</div>
  <div class="stats"><div><b>${fmt(c.members)}</b><span>${t('c_members')}</span></div><div><b>${fmt(c.total)}</b><span>${t('c_total')}</span></div><div><b>${fmt(c.week)}</b><span>${t('c_week')}</span></div></div>
  <div class="lvl"><div class="row between"><span>${t('next_milestone')}</span><b>${fmt(c.next)}</b></div>${bar(c.next === c.prev ? 100 : ((c.total - c.prev) / (c.next - c.prev)) * 100)}</div>
  ${ks.active ? `<div class="karwan"><b>${uiIcon('flame', 16, 1.8)} ${t('karwan_streak')(ks.streak)}</b>
      <div>${t('karwan_today')(fmt(ks.today), fmt(ks.size))}</div>
      ${ks.missing.length ? `<div class="muted">${t('karwan_missing')} ${ks.missing.map((n) => `<span class="chipname">${esc(n)}</span>`).join(' ')}</div>` : ''}</div>` : `<p class="note">${t('karwan_need')}</p>`}
  <h3>${t('cv_members')} (${fmt(c.members)})</h3>
  <ul class="lb">${shown.map((m) => cvRow(m, c.owner && !m.owner ? `<button class="chip" data-act="cvremove" data-u="${esc(m.username)}" aria-label="${esc(t('cv_remove'))}" title="${esc(t('cv_remove'))}">✕</button>` : '')).join('')}</ul>
  ${cv.members.length > 8 && !S.cvAll ? `<button class="chip more" data-act="cvall">${t('cv_show_all')(fmt(cv.members.length))}</button>` : ''}
  ${c.owner ? `<h3>${t('cv_invite_title')}</h3><div class="padx bh">
      <input id="cvinvq" type="text" aria-label="${esc(t('cv_invite_ph'))}" autocomplete="off" autocapitalize="off" dir="ltr" placeholder="${esc(t('cv_invite_ph'))}"><div id="cvinvres" class="chips"></div>
      ${pending.length ? `<b>${t('cv_pending')}</b>${pending.map((p) => `<div class="circlecard"><b>${esc(p.username)}</b>${p.city ? ` · ${esc(p.city)}` : ''}
        <p class="muted">${p.kind === 'request' ? t('cv_asked') : t('cv_invited')}</p>
        <div class="row">${p.kind === 'request' ? `<button class="blk fill1" data-act="cvreqyes" data-u="${esc(p.username)}"><span>${t('accept')}</span><b class="ar">→</b></button><button class="chip" data-act="cvreqno" data-u="${esc(p.username)}">${t('decline')}</button>` : `<button class="chip" data-act="cvcancelinv" data-u="${esc(p.username)}">${t('cv_cancel')}</button>`}</div></div>`).join('')}` : ''}</div>
    <form novalidate class="cname" data-form="cvrename"><label for="cv-rename">${t('cv_rename')}</label>
      <div class="row"><input id="cv-rename" name="name" type="text" maxlength="20" autocomplete="off" autocapitalize="off" dir="ltr" value="${esc(c.name)}"><button class="chip solid" type="submit">${t('save')}</button></div>
      <div class="hint" id="cvcheck">${t('cv_name_hint')}</div></form>` : ''}
  <div class="padx" style="margin-top:14px"><button class="chip" data-act="cvleave">${t('cv_leave')}</button></div>`;
}
function caravan() {
  const m = S.me, tm = S.team, cv = S.cv;
  const link = `${location.origin}/?invite=${m.username}`;
  const main = !cv ? '<p class="muted center">…</p>' : cv.caravan ? cvHome(cv) : cvJoinOrCreate(cv);
  return `<div class="cols"><div class="col">
  ${main}
  </div><div class="col">
  <h3 class="first-d">${t('your_code')}</h3>
  <p class="note first">${t('cq_def')}</p>
  <div class="code">${esc(m.username)}</div>
  <div class="muted" style="margin-top:12px">${t('your_link')}</div>
  <div class="link">${esc(link)}</div>
  <div class="invleft"><b>${m.invites.left}</b> <span>${t('invites_left')} · ${N(`${m.invites.used} / ${m.invites.cap}`)}</span><small>${t('invites_next')(m.invites.nextAt)}</small></div>
  <div class="row" style="margin-top:12px"><button class="blk wa fill1" data-act="wa"><span class="lab">${uiIcon('share', 22, 1.8)} ${t('share_wa')}</span><b class="ar">→</b></button><button class="chip" data-act="copy" data-text="${esc(link)}">${t('copy')}</button></div>
  ${burhanCaravan()}
  <h3>${t('direct_list')} (${fmt(m.team.direct)})</h3>
  ${!tm ? '…' : tm.direct.length ? `<ul class="lb">${tm.direct.map((d) => `
    <li>${av(d, 34)}<span class="name">${esc(d.username)}<small>${d.city ? `${esc(d.city)} · ` : ''}${fmt(d.total)} · ${t('this_week')} ${fmt(d.week)}</small></span><span class="score">${fmt(d.total)}</span></li>`).join('')}</ul>` : `<p class="muted">${t('none_yet')}</p>`}
  ${uplineBlock(tm)}
  </div></div>`;
}

function historyBlock() {
  const h = S.history;
  if (!h) return '<p class="muted center">…</p>';
  const time = (at) => new Date(at).toLocaleTimeString(S.lang === 'ur' ? 'en-GB' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  if (!h.days.length) return `<p class="note first">${t('hist_empty')}</p>`;
  return h.days.map((d) => `
    <div class="hday"><span>${d.day === h.today ? t('today') : d.day === h.yesterday ? t('yesterday') : N(esc(d.day))}</span><b>${fmt(d.total)}</b></div>
    ${d.entries.map((e) => `
      <div class="hrow ${S.editing === e.id ? 'ed' : ''}">
        <span class="hc">${fmt(e.count)}</span>
        <span class="ht">${time(e.at)}${e.edits.length ? ` <em class="tag">${t('edited')}</em><small>${t('was')} ${e.edits.map((x) => N(`${fmt(x.from)} → ${fmt(x.to)}`)).join(' · ')}</small>` : ''}</span>
        ${d.editable ? (S.editing === e.id
          ? `<span class="edit"><input type="number" id="editval" inputmode="numeric" min="1" value="${e.count}" dir="ltr"><button class="chip solid" data-act="editsave" data-id="${e.id}">${t('save')}</button><button class="chip" data-act="editx">${t('cancel')}</button></span>`
          : `<button class="chip" data-act="edit" data-id="${e.id}">${t('edit')}</button>`) : ''}
      </div>`).join('')}`).join('');
}

// three families of achievements, plus the city podium: personal, caravan (people you invited yourself), Qabila (everyone under you)
const BADGE_FAMILIES = [
  ['personal', ['first_step', 'd1k', 'd10k', 'd100k', 'd1m', 'streak7', 'streak30', 'streak100', 'scholar1', 'scholar10', 'circle', 'sunnah1', 'sunnah7', 'sunnah30', 'league_silver', 'league_gold', 'league_diamond']],
  ['karwan', ['recruit1', 'recruit5', 'recruit25', 'group10k', 'group100k', 'group1m', 'karwan7', 'karwan30']],
  ['qabila', ['qabila10', 'qabila50', 'qabila250', 'caravan10k', 'caravan100k', 'caravan1m', 'caravan10m']],
  ['city', ['city_podium', 'city_champion']],
];

function me() {
  const m = S.me;
  return `
  <div class="myhead"><div class="mybig">${av(m, 84, false)}</div><div class="myact">
    <label class="chip solid" tabindex="0">${t(m.avatar ? 'change_photo' : 'add_photo')}<input type="file" accept="image/*" data-avatar hidden></label>
    ${m.avatar ? `<button class="chip" data-act="rmavatar">${t('remove_photo')}</button>` : ''}
    <small class="muted">${t('photo_hint')}</small></div></div>
  <div class="uname">${esc(m.username)}</div>
  ${m.displayName ? `<div class="pname padx" dir="auto">${esc(m.displayName)}</div>` : ''}
  ${m.bio ? `<p class="pbio padx" dir="auto">${esc(m.bio)}</p>` : ''}
  <div class="muted" dir="ltr">${esc(m.email)} · ${esc(m.phone)}</div>
  ${m.hiddenFromRanks ? `<div class="flagnote">${t('flagged')}</div>` : ''}
  ${m.emailVerified ? '' : `<div class="notice">${t('email_unconfirmed')} <button class="linkbtn" data-act="resend">${t('resend')}</button></div>`}
  <div class="row wrapx padx shortcuts"><button class="chip" data-act="setlang" data-l="${S.lang === 'ur' ? 'en' : 'ur'}">${S.lang === 'ur' ? 'English' : 'اردو'}</button><a class="chip" href="#settings">${t('settings')}</a><button class="chip" data-act="logout">${t('logout')}</button></div>
  <div class="stats"><div><b>${m.level}</b><span>${t('level')}</span></div><div><b>${fmt(m.total)}</b><span>${t('total')}</span></div><div><b>${m.bestStreak}</b><span>${t('best_streak')}</span></div></div>
  <h3>${t('points_title')}</h3>
  <div class="lvl"><div class="row between"><span>${t('level')} ${m.level} · ${esc(t('titles')[Math.min(m.level - 1, 9)])}</span><b>${N(`${fmt(m.xp)} / ${fmt(m.next)}`)}</b></div>${bar(m.pct)}</div>
  <ul class="how">${t('points_list').map((x) => `<li>${x}</li>`).join('')}</ul>

  ${burhanMe()}
  <h3>${t('tree_title')}</h3>
  <p class="note first">${t('tree_sub')}</p>
  <div class="stats"><div><b>${fmt(m.team.members)}</b><span>${t('tree_people')}</span></div><div><b>${fmt(m.team.total)}</b><span>${t('tree_total')}</span></div><div><b>${S.team ? fmt(S.team.week) : '…'}</b><span>${t('tree_week')}</span></div></div>
  ${(() => { const down = m.team.total - m.total, nx = MILESTONES.find((x) => x > down) || MILESTONES.at(-1), pv = MILESTONES.filter((x) => x <= down).at(-1) || 0; return `<div class="lvl"><div class="row between"><span>${t('tree_next')}</span><b>${fmt(nx)}</b></div>${bar(nx === pv ? 100 : ((down - pv) / (nx - pv)) * 100)}</div>`; })()}

  <h3>${t('hist_title')}</h3>
  <p class="note first">${t('hist_hint')}</p>
  ${historyBlock()}

  ${BADGE_FAMILIES.map(([fam, list]) => `<h3>${t('badges')} · ${t('fam_' + fam)}</h3>
  <div class="badges">${list.slice().sort((x, y) => m.badges.includes(y) - m.badges.includes(x)).map((c) => { const got = m.badges.includes(c); return `<div class="badge ${got ? 'got' : ''}" title="${esc(t('badge')[c][1])}">${badgeSvg(c, got)}<b>${esc(t('badge')[c][0])}</b><span>${esc(t('badge')[c][1])}</span></div>`; }).join('')}</div>`).join('')}

  <h3 id="settings">${t('profile_title')}</h3>
  <form novalidate data-form="profile">
    <label for="p-name">${t('display_name')}</label>
    <input id="p-name" name="displayName" type="text" maxlength="40" autocomplete="name" dir="auto" value="${esc(m.displayName || '')}" placeholder="${esc(t('display_name_ph'))}">
    <label for="p-bio">${t('bio')}</label>
    <input id="p-bio" name="bio" type="text" maxlength="100" dir="auto" value="${esc(m.bio || '')}" placeholder="${esc(t('bio_ph'))}">
    <div class="hint">${t('profile_hint')}</div>
    <button class="blk" type="submit"><span>${t('save')}</span><b class="ar">→</b></button>
  </form>
  <h3>${t('settings')}</h3>
  <form novalidate data-form="settings">
    <label for="s-goal">${t('daily_goal')}</label>
    <input id="s-goal" type="number" name="dailyGoal" min="1" max="100000" value="${m.dailyGoal}" dir="ltr">
    ${cityPicker(t('city'), m.city)}
    <label for="s-time">${t('reminder_time')}</label>
    <input id="s-time" type="time" name="reminderTime" value="${esc(m.reminderTime || '')}" dir="ltr">
    <div class="hint">${t('reminder_hint')}</div>
    <label for="s-email">${t('email')} <span class="tag ${m.emailVerified ? 'verified' : ''}">${m.emailVerified ? t('email_ok') : '!'}</span></label>
    <input id="s-email" type="email" name="email" value="${esc(m.email)}" dir="ltr" required>
    <label for="s-pw">${t('pw_for_email')}</label>
    <input id="s-pw" type="password" name="password" autocomplete="current-password" dir="ltr">
    <button class="blk" type="submit"><span>${t('save')}</span><b class="ar">→</b></button>
  </form>
  <h3>${t('security_title')}</h3>
  <form novalidate data-form="password">
    <label for="pw-cur">${t('pw_current')}</label><input id="pw-cur" type="password" name="current" autocomplete="current-password" dir="ltr">
    <label for="pw-new">${t('pw_new')}</label><input id="pw-new" type="password" name="next" autocomplete="new-password" dir="ltr">
    <label for="pw-again">${t('pw_again')}</label><input id="pw-again" type="password" name="again" autocomplete="new-password" dir="ltr">
    <div class="hint">${t('pw_note')}</div>
    <button class="blk" type="submit"><span>${t('pw_change')}</span><b class="ar">→</b></button>
  </form>
  <form novalidate data-form="phone">
    <label for="ph-new">${t('phone_new')}</label>
    <div class="phonerow"><select name="phoneCountry" aria-label="${esc(t('country'))}">${countryOptions()}</select><input id="ph-new" type="tel" name="phone" autocomplete="tel-national" dir="ltr" placeholder="300 1234567"></div>
    <label for="ph-pw">${t('pw_current')}</label><input id="ph-pw" type="password" name="password" autocomplete="current-password" dir="ltr">
    <div class="hint">${t('phone_note')}</div>
    <button class="blk out" type="submit"><span>${t('phone_change')}</span></button>
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
  <form novalidate data-form="delete">
    <p class="muted">${t('delete_text')}</p>
    <label for="d-pw">${t('password')}</label>
    <input id="d-pw" type="password" name="password" autocomplete="current-password" required dir="ltr">
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


// ---- Al-Burhan (internal edition only): murabbi, masul, mamulaat percentages, tasks and routines ------------------------------------------
const inBurhan = () => S.edition === 'internal';
async function initBurhan() {
  if (!S.me) return;
  if (S.edition === undefined) { try { S.edition = (await api('/config')).edition; } catch { return; } }
  await loadBurhan();
}
async function loadBurhan() {
  if (!inBurhan() || !S.me) return;
  try { S.bh = await api('/burhan'); draw(); } catch { /* the app works without it */ }
}
const wdName = (d) => t('weekdays')[d];
const mamulaatBars = (m) => !m ? '' : `<div class="mam"><div class="row between"><b>${t('mam_title')}</b><span class="muted">${m.average == null ? '' : t('mam_avg')(m.average)}</span></div>
  <div class="bars" aria-label="${esc(t('mam_title'))}">${m.series.map((x) => `<i title="${esc(x.day)}${x.percent == null ? '' : ` · ${x.percent}%`}" class="${x.percent == null ? 'none' : ''}" style="height:${x.percent == null ? 6 : Math.max(6, x.percent)}%"></i>`).join('')}</div>
  <div class="muted">${m.today == null ? t('mam_none_today') : t('mam_today')(m.today)}</div></div>`;
const asgLabel = (a) => a.kind === 'routine' ? t('every')(wdName(a.weekday)) : a.dueDay ? t('due')(N(esc(a.dueDay))) : t('task_word');

function assignRow(a, mode) { // mode: 'mine' (razakar ticks) or 'masul' (masul can end)
  const state = a.kind === 'routine'
    ? (a.dueToday || !a.last4.due ? '' : `<small class="muted">${t('routine_stats')(a.last4.done, a.last4.due)}</small>`)
    : (a.done ? `<small class="ok">${t('done_on')(N(esc(a.doneOn)))}</small>` : a.overdue ? `<small class="bad">${t('overdue')}</small>` : '');
  const tickable = mode === 'mine' && (a.kind === 'routine' ? a.dueToday : true);
  const done = a.kind === 'routine' ? a.doneToday : a.done;
  return `<div class="q ${done ? 'd' : ''}"><span class="bx"></span>
    <span class="t">${esc(a.title)}<small>${asgLabel(a)}</small>${state}</span>
    ${tickable ? `<button class="chip ${done ? '' : 'solid'}" data-act="atick" data-id="${a.id}" data-done="${done ? 0 : 1}">${done ? t('undo') : t('mark_done')}</button>` : ''}
    ${mode === 'masul' ? `<button class="chip" data-act="endassign" data-id="${a.id}" aria-label="${esc(t('end_assign'))}" title="${esc(t('end_assign'))}">✕</button>` : ''}</div>`;
}

function burhanToday() {
  const b = S.bh;
  if (!b || (!b.today.length && !(b.mamulaat && b.mamulaat.today != null))) return '';
  return `<h3>${t('bh_title')} · ${t('today')}</h3>
  ${b.today.map((a) => assignRow(a, 'mine')).join('')}
  ${b.mamulaat && b.mamulaat.today != null ? `<button class="rowlink" data-act="tab" data-tab="me"><span>${t('mam_title')}</span><b>${b.mamulaat.today}%</b></button>` : ''}`;
}

function whoSees() {
  const b = S.bh;
  const last = (x) => (x && x.lastViewed ? ` <small class="muted">${t('last_viewed')(ago(x.lastViewed))}</small>` : '');
  return `<div class="circlecard who"><b>${t('who_title')}</b>
    <p><b>${t('murabbi_word')}${b.murabbi && !b.murabbi.waiting ? ` (${esc(b.murabbi.username)})` : ''}:</b> ${t('who_murabbi')}${last(b.murabbi)}</p>
    <p><b>${t('masul_word')}${b.masul ? ` (${esc(b.masul.username)})` : ''}:</b> ${t('who_masul')}${last(b.masul)}</p>
    <p class="muted">${t('who_nobody')}</p></div>`;
}

function burhanMe() {
  const b = S.bh;
  if (!b) return '';
  const mu = b.murabbi;
  const err = S.bhError ? `<div class="notice" role="alert">${esc(S.bhError)}</div>` : '';
  let murabbiBox;
  if (!mu) murabbiBox = `${err}<p class="muted">${t('murabbi_text')}</p><button class="blk" data-act="bhactivate"><span>${t('murabbi_find')}</span><b class="ar">→</b></button>`;
  else if (mu.stage === 'waiting') murabbiBox = `<div class="notice">${t('murabbi_waiting')(esc(mu.name || '—'))}</div><div class="row"><button class="chip solid" data-act="bhactivate">${t('check_again')}</button><button class="chip" data-act="bhunlink">${t('unlink')}</button></div>`;
  else if (mu.stage === 'confirm') murabbiBox = `<div class="circlecard"><b>${t('murabbi_is_it')}</b>
      <p><b>${esc(mu.username)}</b>${mu.city ? ` · ${esc(mu.city)}` : ''}<br><small class="muted">${t('murabbi_listed_as')(esc(mu.name || '—'))}</small></p>
      <p class="muted">${t('murabbi_sees')}</p>
      <div class="row"><button class="blk fill1" data-act="bhconfirm"><span>${t('yes_mine')}</span><b class="ar">→</b></button><button class="chip" data-act="bhunlink">${t('not_mine')}</button></div></div>`;
  else if (mu.stage === 'pending') murabbiBox = `<div class="notice">${t('murabbi_pending')(esc(mu.username))}</div><div class="row"><button class="chip" data-act="bhunlink">${t('unlink')}</button></div>`;
  else murabbiBox = `<div class="row between"><span>${t('murabbi_word')}: <b>${esc(mu.username)}</b></span><button class="chip" data-act="bhunlink">${t('unlink')}</button></div>`;
  const pick = S.masulPick;
  const masulBox = b.masul
    ? `<div class="row between"><span>${t('masul_word')}: <b>${esc(b.masul.username)}</b></span><button class="chip" data-act="bhmasulclear">${t('unlink')}</button></div>`
    : pick ? `<div class="circlecard"><b>${t('masul_add_q')(esc(pick))}</b><p class="muted">${t('masul_sees')}</p>
        <div class="row"><button class="blk fill1" data-act="bhmasulyes"><span>${t('yes_add')}</span><b class="ar">→</b></button><button class="chip" data-act="bhmasulno">${t('cancel')}</button></div></div>`
    : `<p class="muted">${t('masul_text')}</p><div class="row"><input id="masulq" type="text" aria-label="${esc(t('masul_ph'))}" autocomplete="off" autocapitalize="off" dir="ltr" placeholder="${esc(t('masul_ph'))}"></div><div id="masulres" class="chips"></div>`;
  return `<h3>${t('bh_title')}</h3>
  <div class="padx bh">
    ${whoSees()}
    <div class="spacer"></div><b>${t('murabbi_word')}</b>${murabbiBox}
    ${mu?.stage === 'active' ? mamulaatBars(b.mamulaat) : ''}
    <div class="spacer"></div><b>${t('masul_word')}</b>${masulBox}
    ${b.assignments.length ? `<div class="spacer"></div><b>${t('assigned_title')}</b>${b.assignments.map((a) => assignRow(a, 'mine')).join('')}` : ''}
  </div>`;
}

function burhanCaravan() {
  const b = S.bh;
  if (!b || (!b.roles.saaliks && !b.roles.razakars && !b.roles.requests)) return '';
  const sa = S.bhLists?.saaliks, ra = S.bhLists?.razakars, rq = S.bhLists?.requests || [];
  return `${rq.length ? `<h3>${t('requests_title')} (${rq.length})</h3>${rq.map((r) => `<div class="circlecard"><b>${esc(r.username)}</b>${r.city ? ` · ${esc(r.city)}` : ''}<p class="muted">${t('request_text')}</p><div class="row"><button class="blk fill1" data-act="bhaccept" data-u="${esc(r.username)}"><span>${t('accept')}</span><b class="ar">→</b></button><button class="chip" data-act="bhdecline" data-u="${esc(r.username)}">${t('decline')}</button></div></div>`).join('')}` : ''}${b.roles.saaliks ? `<h3>${t('saaliks_title')} (${b.roles.saaliks})</h3>
    ${!sa ? '…' : `<ul class="lb">${sa.map((x) => `<li><button class="rowbtn" data-act="opensaalik" data-u="${esc(x.username)}">${av(x, 34, false)}<span class="name">${esc(x.username)}<small>${x.city ? `${esc(x.city)} · ` : ''}${t('durood_week')(fmt(x.duroodWeek))}${x.mamulaatToday == null ? '' : ` · ${t('mam_short')} ${x.mamulaatToday}%`}</small></span><span class="score">${fmt(x.duroodToday)}</span></button></li>`).join('')}</ul>`}` : ''}
  ${b.roles.razakars ? `<h3>${t('razakars_title')} (${b.roles.razakars})</h3>
    ${!ra ? '…' : `<ul class="lb">${ra.map((x) => `<li><button class="rowbtn" data-act="openrazakar" data-u="${esc(x.username)}">${av(x, 34, false)}<span class="name">${esc(x.username)}<small>${x.city ? `${esc(x.city)} · ` : ''}${t('open_tasks')(x.openTasks)}${x.overdue ? ` · <span class="bad">${t('overdue_n')(x.overdue)}</span>` : ''}${x.routinePercent == null ? '' : ` · ${t('routines_short')} ${x.routinePercent}%`}</small></span><span class="score">${fmt(x.duroodWeek)}</span></button></li>`).join('')}</ul>`}` : ''}`;
}

function progressGrid(g) {
  const c = (v, l) => `<div><b>${fmt(v)}</b><span>${l}</span></div>`;
  return `<div class="stats">${c(g.durood.total, t('total'))}${c(g.durood.today, t('today'))}${c(g.durood.week, t('week'))}</div>
    <div class="stats">${c(g.streak, t('streak'))}${c(g.xp, 'XP')}${c(g.level, t('level'))}</div>
    <div class="stats">${c(g.sunnahs, t('sunnah_word'))}${c(g.lectures, t('lectures_word'))}${c(g.reflections, t('reflect_title'))}</div>`;
}

function detailModal() {
  const d = S.bhDetail, r = d.data;
  const head = `<div class="row between"><h3 class="in">${esc(d.username)}</h3><button class="chip" data-act="closedetail">${t('close')}</button></div>`;
  if (!r) return `<div class="modal"><div class="box">${head}<p class="muted center">…</p></div></div>`;
  if (d.type === 'saalik') {
    const p = r.profile;
    return `<div class="modal"><div class="box wide">${head}
      <p class="muted" dir="ltr">${esc(p.phone)} · ${esc(p.email)}<br>${esc(p.city || '')}${p.country ? ` · ${esc(p.country)}` : ''} · ${t('joined')} ${N(esc(p.joined))}</p>
      ${progressGrid(r.progress)}
      <div class="stats"><div><b>${fmt(r.extra.caravan)}</b><span>${t('c_members')}</span></div><div><b>${fmt(r.extra.qabila)}</b><span>${t('rk_trees')}</span></div><div><b>${fmt(r.extra.badges)}</b><span>${t('badges_word')}</span></div></div>
      ${mamulaatBars(r.mamulaat)}${r.mamulaat.stale ? `<small class="muted">${t('mam_stale')}</small>` : ''}
      ${r.masul ? `<p class="muted">${t('masul_word')}: <b>${esc(r.masul)}</b></p>` : ''}
      ${r.assignments.length ? `<b>${t('assigned_view')}</b>${r.assignments.map((a) => assignRow(a, 'view')).join('')}` : ''}</div></div>`;
  }
  const f = S.assignForm || { kind: 'task' };
  return `<div class="modal"><div class="box wide">${head}
    <p class="muted">${esc(r.city || '')} · ${t('joined')} ${N(esc(r.joined))}</p>
    ${progressGrid(r.progress)}
    <b>${t('assigned_view')}</b>
    ${r.assignments.length ? r.assignments.map((a) => assignRow(a, 'masul')).join('') : `<p class="muted">${t('none_assigned')}</p>`}
    <form novalidate data-form="assign" class="assign"><b>${t('assign_new')}</b>
      <div class="seg thin"><button type="button" class="${f.kind === 'task' ? 'on' : ''}" data-act="assignkind" data-k="task">${t('task_word')}</button><button type="button" class="${f.kind === 'routine' ? 'on' : ''}" data-act="assignkind" data-k="routine">${t('routine_word')}</button></div>
      <input type="text" name="title" maxlength="80" aria-label="${esc(t('assign_ph'))}" placeholder="${esc(t('assign_ph'))}" dir="auto">
      ${f.kind === 'routine'
        ? `<label for="a-wd">${t('weekday_word')}</label><select id="a-wd" name="weekday">${t('weekdays').map((n, i) => `<option value="${i}" ${i === 5 ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`
        : `<label for="a-due">${t('due_optional')}</label><input id="a-due" type="date" name="dueDay" dir="ltr">`}
      <button class="blk" type="submit"><span>${t('assign_btn')}</span><b class="ar">→</b></button></form>
  </div></div>`;
}

// ---- drawing + data loading -----------------------------------------------------
let liveAt = 0;
async function loadLive() {
  if (Date.now() - liveAt < 60000) return;
  liveAt = Date.now();
  try { S.live = await api('/public'); if (!S.me) draw(); } catch { /* the welcome screen works without it */ }
}
// Every redraw rebuilds the page. So what the person typed, and where their cursor was, is carried over by name.
const fieldKey = (el) => `${el.closest('form')?.dataset.form || ''}|${el.name || el.id || (el.hasAttribute('data-city') ? 'city' : '') || el.dataset.cbox || el.dataset.rbox || ''}`;
const FIELDS = 'input[name]:not([type=file]):not([type=hidden]), textarea, input[data-city], input[data-cbox], input[data-rbox], #cv-new, #cv-rename, #cvinvq, #cvjoinq, #masulq, select[name]';
function snapshotFields() {
  const snap = new Map();
  app.querySelectorAll(FIELDS).forEach((el) => { const k = fieldKey(el); if (k.endsWith('|')) return; snap.set(k, el.type === 'radio' || el.type === 'checkbox' ? el.checked : el.value); });
  app.querySelectorAll('input[name=cityId]').forEach((el) => snap.set(fieldKey(el) + '#id', el.value));
  const a = document.activeElement;
  return { snap, focus: a && app.contains(a) && a.matches(FIELDS) ? fieldKey(a) : null };
}
function restoreFields({ snap, focus }) {
  let focusEl = null;
  app.querySelectorAll(FIELDS).forEach((el) => {
    const k = fieldKey(el);
    if (!snap.has(k) || el.type === 'radio' || el.type === 'checkbox') return;
    if (!el.value) el.value = snap.get(k);
    if (k === focus) focusEl = el;
  });
  app.querySelectorAll('input[name=cityId]').forEach((el) => { const v = snap.get(fieldKey(el) + '#id'); if (v && !el.value) el.value = v; });
  if (focusEl) { focusEl.focus(); try { focusEl.setSelectionRange(focusEl.value.length, focusEl.value.length); } catch { /* not a text field */ } }
}

// dialogs: named, focus moves in and returns, Tab stays inside, Escape closes, the page behind does not scroll
let opener = null;
function enhanceModal() {
  const m = app.querySelector('.modal');
  document.body.classList.toggle('modal-open', !!m);
  if (!m) {
    if (opener) { const o = opener; opener = null; (document.querySelector(o) || $('#main'))?.focus?.(); }
    return;
  }
  const box = m.querySelector('.box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  if (!box.hasAttribute('aria-label')) box.setAttribute('aria-label', (box.querySelector('h3, .ctitle, b')?.textContent || t('app')).trim());
  if (!m.contains(document.activeElement)) {
    const a = document.activeElement;
    if (!opener && a && a.dataset?.act) opener = `[data-act="${a.dataset.act}"]${a.dataset.id ? `[data-id="${a.dataset.id}"]` : ''}`;
    box.setAttribute('tabindex', '-1');
    (box.querySelector('textarea, input, button, [href]') || box).focus();
  }
}
document.addEventListener('keydown', (ev) => {
  const m = app.querySelector('.modal');
  if (!m) return;
  if (ev.key === 'Escape') { m.querySelector('[data-act=pclose],[data-act=celebrateX],[data-act=closedetail],[data-act=closeprofile]')?.click(); return; }
  if (ev.key !== 'Tab') return;
  const f = [...m.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((e) => e.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f.at(-1);
  if (!m.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
  else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
});

function offlineView() {
  return `<div class="stage"><div class="hero-in" style="padding-top:18vh"><div class="arabic gold" dir="rtl" lang="ar">${esc(t('durood'))}</div>
    <h2 style="margin:16px 0 6px">${t('offline_title')}</h2><p class="tagl" style="max-width:34ch;margin-inline:auto">${t('offline_text')}</p>
    <button class="cta" style="margin:20px auto 0;max-width:260px" data-act="retry"><span>${t('retry')}</span><b class="ar">→</b></button></div></div>`;
}

function draw() {
  applyLang();
  if (!S.me) loadLive();
  if (S.me) checkCelebrate();
  const keep = snapshotFields();
  document.body.classList.toggle('in-app', !!S.me);
  document.title = S.me ? `${t('nav_' + S.tab)} · ${t('app')}` : t('app');
  app.innerHTML = S.me ? shell() : S.offline ? offlineView() : S.intro !== null ? introView() : authView();
  restoreFields(keep);
  enhanceModal();
}

const boardUrl = (b) => (b.type === 'users' ? `/leaderboard?type=users&period=${b.period}`
  : b.type === 'league' ? '/league'
  : b.type === 'cities' ? `/leaderboard?type=cities&metric=${b.metric}`
  : b.metric === 'total' ? `/leaderboard?type=${b.type}&period=week` : `/leaderboard?type=${b.type}&metric=${b.metric}`);
async function enterTab(tab) {
  S.tab = tab;
  draw();
  try {
    if (tab === 'rank') { S.board.data = null; draw(); S.board.data = await api(boardUrl(S.board)); }
    if (inBurhan() && ['home', 'me', 'caravan'].includes(tab)) { loadBurhan().then(async () => { if (tab === 'caravan' && S.bh && (S.bh.roles.saaliks || S.bh.roles.razakars || S.bh.roles.requests)) { S.bhLists = { saaliks: S.bh.roles.saaliks ? (await api('/burhan/saaliks')).saaliks : [], razakars: S.bh.roles.razakars ? (await api('/burhan/razakars')).razakars : [], requests: S.bh.roles.requests ? (await api('/burhan/requests')).requests : [] }; if (S.tab === 'caravan') draw(); } }); }
    if (tab === 'caravan') { [S.team, S.cv] = await Promise.all([api('/team'), api('/caravan')]); }
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
  if (act === 'logout') return logout(true, true);
  if (act === 'logoutall') {
    if (!confirm(t('logout_all_ask'))) return;
    try { const r = await api('/sessions/revoke', 'POST'); S.token = r.token; ls.set('token', r.token); toast(t('logout_all_done')); } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'retry') {
    el.disabled = true;
    try { await refreshMe(); S.offline = false; initBurhan(); } catch (e) { if (e.message !== 'network') S.offline = false; }
    return draw();
  }
  if (act === 'allms') { S.allMs = true; return draw(); }
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
  if (act === 'goleague') { S.board.type = 'league'; return enterTab('rank'); }
  if (act === 'pickcity') {
    const field = el.closest('.cityfield');
    field.querySelector('input[name=cityId]').value = el.dataset.id;
    field.querySelector('[data-city]').value = el.dataset.label;
    el.parentElement.hidden = true; field.querySelector('[data-city]').setAttribute('aria-expanded', 'false'); field.querySelector('[data-city]').focus();
    return;
  }
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
    try { const r = await api('/sunnah/tick', 'POST'); S.me = r.me; S.feed.today = { ...S.feed.today, ...r, me: undefined }; toast(r.xpGained ? `${t('tick_thanks')} · ${t('points_gained')(fmt(r.xpGained))}` : t('tick_thanks')); } catch (e) { toast(errText(e)); }
    return draw();
  }
  if (act === 'postit') {
    el.disabled = true; el.textContent = t('posting');
    try {
      const before = S.me.xp;
      const r = await api('/sunnah/post', 'POST', { image: S.draft });
      S.draft = null; S.draftKind = null; S.me = r.me;
      toast(`${t('photo_posted')} · ${t('points_gained')(fmt(gainedSince(before)))}`);
      return enterTab('feed');
    } catch (e) { toast(errText(e)); if (e.message === 'bad_image' || e.message === 'duplicate_image') S.draft = null; return draw(); }
  }
  if (act === 'reflect') {
    const text = $('#refl').value;
    S.reflDraft = text;
    el.disabled = true;
    try {
      const before = S.me.xp;
      const r = await api('/reflections', 'POST', { text });
      S.me = r.me; S.reflDraft = '';
      toast(`${t('reflect_posted')} · ${t('points_gained')(fmt(gainedSince(before)))}`);
      return enterTab('feed');
    } catch (e) { toast(errText(e)); el.disabled = false; }
    return;
  }
  if (act === 'profile') {
    S.profile = { username: el.dataset.u, data: null }; draw();
    try { S.profile.data = await api(`/members/${encodeURIComponent(el.dataset.u)}`); } catch (e) { S.profile = null; toast(errText(e)); }
    return draw();
  }
  if (act === 'closeprofile') { S.profile = null; return draw(); }
  if (act === 'rmavatar') { try { S.me = await api('/me/avatar', 'DELETE'); toast(t('saved')); } catch (e) { toast(errText(e)); } return draw(); }
  if (act.startsWith('cv')) {
    const call = async (path, body, after) => { try { const r = await api(path, 'POST', body); if (r.view) S.cv = r.view; if (r.me) S.me = r.me; if (after) after(r); } catch (e) { toast(errText(e)); } draw(); };
    if (act === 'cvall') { S.cvAll = true; return draw(); }
    if (act === 'cvinvite') return call('/caravan/invite', { username: el.dataset.u }, (r) => toast(r.joined ? t('saved') : t('cv_invited')));
    if (act === 'cvjoin') return call('/caravan/join', { name: el.dataset.name }, (r) => toast(r.joined ? t('saved') : t('cv_asked_sent')));
    if (act === 'cvaccept' || act === 'cvdecline') return call(`/caravan/invitations/${el.dataset.id}`, { accept: act === 'cvaccept' });
    if (act === 'cvreqyes' || act === 'cvreqno') return call(`/caravan/requests/${encodeURIComponent(el.dataset.u)}`, { accept: act === 'cvreqyes' });
    if (act === 'cvcancelreq') return call('/caravan/cancel', { caravanId: Number(el.dataset.id) });
    if (act === 'cvcancelinv') return call('/caravan/cancel', { username: el.dataset.u });
    if (act === 'cvremove') { if (!confirm(t('cv_remove_ask')(el.dataset.u))) return; return call('/caravan/remove', { username: el.dataset.u }); }
    if (act === 'cvleave') { if (!confirm(t('cv_leave_ask'))) return; S.cvAll = false; return call('/caravan/leave', {}); }
  }
  if (act === 'bhactivate') {
    el.disabled = true; S.bhError = '';
    try { await api('/burhan/murabbi', 'POST'); await loadBurhan(); } catch (e) { S.bhError = errText(e); draw(); }
    return;
  }
  if (act === 'bhconfirm') { try { await api('/burhan/murabbi/confirm', 'POST'); await loadBurhan(); toast(t('saved')); } catch (e) { toast(errText(e)); } return; }
  if (act === 'bhaccept' || act === 'bhdecline') {
    try {
      await api(`/burhan/requests/${encodeURIComponent(el.dataset.u)}`, 'POST', { accept: act === 'bhaccept' });
      await loadBurhan();
      S.bhLists = { ...S.bhLists, requests: (await api('/burhan/requests')).requests, saaliks: (await api('/burhan/saaliks')).saaliks };
      toast(t('saved')); draw();
    } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'bhmasulpick') { S.masulPick = el.dataset.u; return draw(); }
  if (act === 'bhmasulno') { S.masulPick = null; return draw(); }
  if (act === 'bhmasulyes') {
    try { await api('/burhan/masul', 'PUT', { username: S.masulPick }); S.masulPick = null; await loadBurhan(); toast(t('saved')); } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'bhunlink') { if (!confirm(t('unlink_ask'))) return; try { await api('/burhan/murabbi', 'DELETE'); await loadBurhan(); } catch (e) { toast(errText(e)); } return; }
  if (act === 'bhmasulclear') { if (!confirm(t('unlink_ask'))) return; try { await api('/burhan/masul', 'DELETE'); await loadBurhan(); } catch (e) { toast(errText(e)); } return; }
  if (act === 'atick') {
    try { await api(`/assignments/${el.dataset.id}/tick`, 'POST', { done: el.dataset.done === '1' }); await loadBurhan(); } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'opensaalik' || act === 'openrazakar') {
    const type = act === 'opensaalik' ? 'saalik' : 'razakar';
    S.bhDetail = { type, username: el.dataset.u, data: null }; S.assignForm = { kind: 'task' }; draw();
    try { S.bhDetail.data = await api(`/burhan/${type === 'saalik' ? 'saaliks' : 'razakars'}/${encodeURIComponent(el.dataset.u)}`); } catch (e) { S.bhDetail = null; toast(errText(e)); }
    return draw();
  }
  if (act === 'closedetail') { S.bhDetail = null; return draw(); }
  if (act === 'assignkind') { S.assignForm = { kind: el.dataset.k }; return draw(); }
  if (act === 'endassign') {
    try {
      await api(`/assignments/${el.dataset.id}`, 'DELETE');
      S.bhDetail.data = await api(`/burhan/razakars/${encodeURIComponent(S.bhDetail.username)}`);
      S.bhLists = { ...S.bhLists, razakars: (await api('/burhan/razakars')).razakars };
    } catch (e) { toast(errText(e)); }
    return draw();
  }
  if (act === 'comment') {
    const box = document.querySelector(`[data-cbox="${el.dataset.id}"]`);
    S.cDraft = { ...(S.cDraft || {}), [el.dataset.id]: box.value };
    el.disabled = true;
    try {
      const r = await api(`/lectures/${el.dataset.id}/comment`, 'POST', { text: box.value });
      S.me = r.me; S.feed.lectures = r.lectures; S.cDraft[el.dataset.id] = '';
      toast(`${t('comment_posted')}${r.xp ? ` · ${t('points_gained')(fmt(r.xp))}` : ''}`);
      S.feed = { ...S.feed, ...(await api('/feed')) };
    } catch (e) { toast(errText(e)); el.disabled = false; return; }
    return draw();
  }
  if (act === 'thread') {
    const key = `${el.dataset.kind}:${el.dataset.id}`;
    S.threads = S.threads || {};
    if (S.threads[key]) { delete S.threads[key]; return draw(); }
    S.threads[key] = { loading: true, list: [] }; draw();
    try { S.threads[key] = { list: (await api(`/replies?kind=${el.dataset.kind}&id=${el.dataset.id}`)).replies }; } catch (e) { delete S.threads[key]; toast(errText(e)); }
    return draw();
  }
  if (act === 'reply') {
    const key = el.dataset.key, [kind, id] = key.split(':');
    const box = document.querySelector(`[data-rbox="${key}"]`);
    S.threads[key].draft = box.value;
    el.disabled = true;
    try {
      const r = await api('/replies', 'POST', { kind, id: Number(id), text: box.value });
      S.me = r.me; S.threads[key] = { list: r.replies };
      const it = S.feed.items.find((x) => threadKey(x) === key); if (it) it.replies = r.replies.length;
      toast(r.xp ? t('points_gained')(fmt(r.xp)) + ' · ' + t('reply_posted') : t('reply_posted'));
    } catch (e) { toast(errText(e)); el.disabled = false; return; }
    return draw();
  }
  if (act === 'rreport') {
    if (!confirm(t('report_ask_reply'))) return;
    try {
      await api('/report', 'POST', { kind: 'reply', id: Number(el.dataset.id) });
      const th = S.threads[el.dataset.key]; th.list = th.list.filter((r) => r.id !== Number(el.dataset.id));
      toast(t('reported')); draw();
    } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'like') {
    el.disabled = true;
    try {
      const r = await api('/like', 'POST', { kind: el.dataset.kind, id: Number(el.dataset.id) });
      S.me = r.me;
      const it = S.feed.items.find((x) => x.id === Number(el.dataset.id) && replyKind(x) === el.dataset.kind);
      if (it) { it.likes = r.likes; it.liked = true; }
    } catch (e) { toast(errText(e)); if (e.message === 'already_liked') { const it = S.feed.items.find((x) => x.id === Number(el.dataset.id)); if (it) it.liked = true; } }
    return draw();
  }
  if (act === 'report') {
    if (!confirm(t('report_ask'))) return;
    try {
      await api('/report', 'POST', { kind: el.dataset.kind, id: Number(el.dataset.id) });
      S.feed.items = S.feed.items.filter((x) => !(x.id === Number(el.dataset.id) && replyKind(x) === el.dataset.kind));
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
      const r = await api('/login', 'POST', { id: f.id, password: f.password, device: ls.get('device') || undefined });
      keepDevice(r); setSession(r.token, r.me);
      draw();
    } else if (kind === 'register') {
      if (!f.cityId) throw new Error('city_required');
      const r = await api('/register', 'POST', { ...f, invite: (f.invite || '').trim(), lang: S.lang });
      keepDevice(r); setSession(r.token, r.me);
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
      keepDevice(r); setSession(r.token, r.me); toast(t('reset_done'));
      draw();
    } else if (kind === 'settings') {
      S.me = await api('/me', 'PATCH', { dailyGoal: Number(f.dailyGoal), ...(f.cityId ? { cityId: Number(f.cityId) } : {}), email: f.email, ...(f.password ? { password: f.password } : {}), reminderTime: f.reminderTime || '' });
      toast(t('saved'));
      draw();
    } else if (kind === 'citysave') {
      if (!f.cityId) throw new Error('city_required');
      S.me = await api('/me', 'PATCH', { cityId: Number(f.cityId) });
      toast(t('saved')); draw();
    } else if (kind === 'assign') {
      const k = (S.assignForm || {}).kind || 'task';
      await api('/assignments', 'POST', { razakar: S.bhDetail.username, kind: k, title: f.title, ...(k === 'routine' ? { weekday: Number(f.weekday) } : f.dueDay ? { dueDay: f.dueDay } : {}) });
      S.bhDetail.data = await api(`/burhan/razakars/${encodeURIComponent(S.bhDetail.username)}`);
      S.bhLists = { ...S.bhLists, razakars: (await api('/burhan/razakars')).razakars };
      toast(t('saved')); draw();
    } else if (kind === 'profile') {
      S.me = await api('/me/profile', 'PUT', { displayName: f.displayName, bio: f.bio });
      toast(t('saved')); draw();
    } else if (kind === 'password') {
      if (f.next !== f.again) throw new Error('pw_mismatch');
      const r = await api('/me/password', 'POST', { current: f.current, next: f.next });
      form.reset(); setSession(r.token, r.me); toast(t('pw_changed')); draw();
    } else if (kind === 'phone') {
      S.me = await api('/me/phone', 'POST', { phone: f.phone, cc: f.phoneCountry, password: f.password });
      form.reset(); toast(t('saved')); draw();
    } else if (kind === 'cvcreate') {
      const r = await api('/caravan', 'POST', { name: f.name });
      S.cv = r.view; S.me = r.me; toast(t('saved')); draw();
    } else if (kind === 'cvrename') {
      S.cv = (await api('/caravan/name', 'PUT', { name: f.name })).view; toast(t('saved')); draw();
    } else if (kind === 'delete') {
      if (!confirm(t('delete_confirm'))) { btn.disabled = false; return; }
      await api('/me', 'DELETE', { password: f.password });
      logout(false); S.authMode = 'login'; draw(); toast(t('deleted'));
    }
  } catch (e) {
    if (kind === 'settings' || kind === 'delete' || kind === 'citysave' || kind === 'profile' || kind === 'password' || kind === 'phone' || kind === 'cvcreate' || kind === 'cvrename' || kind === 'assign') { toast(errText(e)); btn.disabled = false; }
    else { S.error = errText(e); draw(); }
  }
});

// shrink and re-encode as JPEG in the browser (also drops camera metadata) before upload
// photos are squeezed hard before they leave the phone: small and low quality is enough for a feed and keeps storage and data costs down
const PHOTO_MAX_BYTES = 110_000;
async function toJpegDataUrl(file) {
  const bmp = await createImageBitmap(file);
  for (const side of [720, 560, 440]) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(bmp.width * scale)); c.height = Math.max(2, Math.round(bmp.height * scale));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.45, 0.35, 0.28, 0.22]) {
      const url = c.toDataURL('image/jpeg', q);
      if (url.length * 0.75 <= PHOTO_MAX_BYTES) return url;
    }
  }
  throw new Error('bad_image');
}
// a small square picture: centred crop, 192 px, squeezed under 24 KB in the browser (the server checks again and strips metadata)
async function toAvatarDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  for (const px of [192, 160, 128, 96]) {
    const c = document.createElement('canvas'); c.width = c.height = px;
    c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, px, px);
    for (const q of [0.82, 0.7, 0.58, 0.46]) { const url = c.toDataURL('image/jpeg', q); if (url.length * 0.75 <= 24_000) return url; }
  }
  throw new Error('bad_image');
}
app.addEventListener('change', async (ev) => {
  const pic = ev.target.closest('input[data-avatar]');
  if (pic && pic.files[0]) {
    try { S.me = await api('/me/avatar', 'POST', { image: await toAvatarDataUrl(pic.files[0]) }); toast(t('saved')); } catch (e) { toast(e.message === 'bad_image' ? I18N[S.lang].err.bad_image : errText(e)); }
    return draw();
  }
  const el = ev.target.closest('input[data-photo]');
  if (!el || !el.files[0]) return;
  try { S.draft = await toJpegDataUrl(el.files[0]); S.draftKind = el.dataset.photo; draw(); } catch (e) { toast(I18N[S.lang].err.bad_image); }
});

// the suggestion list works from the keyboard: arrows move, Enter picks, Escape closes
app.addEventListener('keydown', (ev) => {
  const box = ev.target.closest('[data-city]'), opt = ev.target.closest('li[role=option]');
  if (box && ev.key === 'ArrowDown') { box.closest('.cityfield').querySelector('li[role=option]')?.focus(); ev.preventDefault(); }
  if (opt) {
    if (ev.key === 'ArrowDown') { opt.nextElementSibling?.focus(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { (opt.previousElementSibling || opt.closest('.cityfield').querySelector('[data-city]')).focus(); ev.preventDefault(); }
    else if (ev.key === 'Enter' || ev.key === ' ') { opt.click(); ev.preventDefault(); }
    else if (ev.key === 'Escape') { opt.parentElement.hidden = true; opt.closest('.cityfield').querySelector('[data-city]').focus(); }
  }
});
let cityTimer;
app.addEventListener('input', (ev) => {
  const box = ev.target.closest('[data-city]');
  if (!box) return;
  const field = box.closest('.cityfield'), list = field.querySelector('.suggest'), hidden = field.querySelector('input[name=cityId]');
  hidden.value = ''; // typing again means the earlier pick no longer applies
  clearTimeout(cityTimer);
  cityTimer = setTimeout(async () => {
    const q = box.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    const cc = document.querySelector('select[name=phoneCountry]')?.value || S.me?.country || S.geo?.country || '';
    try {
      const { cities } = await api(`/cities?q=${encodeURIComponent(q)}&cc=${cc}`);
      list.innerHTML = cities.length ? cities.map((c) => `<li role="option" tabindex="-1" data-act="pickcity" data-id="${c.id}" data-label="${esc(c.label)}">${esc(c.label)}</li>`).join('') : `<li class="none" role="presentation">${t('city_none')}</li>`;
      list.hidden = false; box.setAttribute('aria-expanded', 'true');
    } catch { /* offline: try again */ }
  }, 220);
});

let checkTimer;
app.addEventListener('input', (ev) => {
  const mq = ev.target.closest('#masulq');
  if (mq) {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      const out = $('#masulres'), v = mq.value.trim();
      if (v.length < 2) { out.innerHTML = ''; return; }
      try { out.innerHTML = (await api(`/burhan/usernames?q=${encodeURIComponent(v)}`)).usernames.map((u) => `<button class="chip" data-act="bhmasulpick" data-u="${esc(u)}">${esc(u)}</button>`).join(''); } catch { /* ignore */ }
    }, 300);
    return;
  }
  const cs = ev.target.closest('#cvinvq, #cvjoinq');
  if (cs) {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      const out = cs.id === 'cvinvq' ? $('#cvinvres') : $('#cvjoinres'), v = cs.value.trim();
      if (v.length < 2) { out.innerHTML = ''; return; }
      try {
        const r = await api(`/caravan/search?q=${encodeURIComponent(v)}`);
        out.innerHTML = cs.id === 'cvinvq'
          ? r.usernames.map((u) => `<button class="chip" data-act="cvinvite" data-u="${esc(u)}">${esc(u)}</button>`).join('')
          : r.caravans.map((c) => `<button class="chip" data-act="cvjoin" data-name="${esc(c.name)}">${esc(c.name)} · ${fmt(c.members)}</button>`).join('');
        if (!out.innerHTML) out.innerHTML = `<small class="muted">${t('cv_none_found')}</small>`;
      } catch { /* ignore */ }
    }, 300);
    return;
  }
  const cn = ev.target.closest('#cv-new, #cv-rename');
  if (cn) {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      const out = $('#cvcheck'), v = cn.value.trim();
      if (!v || v === S.cv?.caravan?.name) { out.className = 'hint'; out.textContent = t('cv_name_hint'); return; }
      try {
        const r = await api(`/caravan/name-check?u=${encodeURIComponent(v)}`);
        out.className = 'hint ' + (r.ok ? 'ok' : 'bad');
        out.textContent = r.ok ? `✓ ${t('ok_free')}` : r.reason ? t('err').bad_caravan_name : t('err').caravan_name_taken;
      } catch { /* the server checks again on save */ }
    }, 350);
    return;
  }
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
window.addEventListener('online', () => { if (S.offline) refreshMe().then(() => { S.offline = false; draw(); initBurhan(); }).catch(() => {}); });
async function boot() {
  applyLang();
  if (S.ref) api(`/invite-check?code=${encodeURIComponent(S.ref)}`).then((r) => { if (r.valid && r.from) { S.refName = r.from; if (!S.me) draw(); } }).catch(() => {});
  if (S.resetToken) logout(false); // a reset link always starts from signed-out
  if (S.token) {
    try { await refreshMe(); } catch (e) { if (e.message === 'network') S.offline = true; /* a bad token logs out inside api(); a lost connection keeps the session and says so */ }
  }
  draw();
  initBurhan();
  const confirmToken = params.get('confirm');
  if (confirmToken) {
    try { await api('/email/confirm', 'POST', { token: confirmToken }); toast(t('email_confirmed')); if (S.token) await refreshMe().then(draw); } catch (e) { toast(errText(e)); }
  }
  if (urlInvite || params.get('reset') || confirmToken) history.replaceState(null, '', '/');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
// ---- inside the Android app: the back button closes what is open, then goes to Home, and only then leaves ----------------------
// (a no-op in a browser: there is no window.Capacitor there)
const nativeApp = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.App : null;
if (nativeApp) {
  document.documentElement.classList.add('native');
  nativeApp.addListener('backButton', () => {
    if (S.player) { stopPlayerTimer(); S.player = null; return draw(); }
    if (S.profile) { S.profile = null; return draw(); }
    if (S.editing) { S.editing = null; return draw(); }
    if (S.token && S.tab !== 'home') return enterTab('home');
    nativeApp.exitApp();
  });
}
if (!S.token) loadGeo();
boot();
