import { I18N } from './i18n.js';
import { uiIcon, badgeSvg } from './icons.js';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// Urdu text is a separate file, fetched only when Urdu is in use (English pages skip ~15 KB)
let urCity = {};
const loadUr = () => (I18N.ur ? Promise.resolve() : import('./i18n-ur.js').then((m) => { I18N.ur = m.UR.ur; urCity = m.UR_CITY || {}; }));
// a member's city in Urdu when we know its Urdu name ('Lahore, Punjab, Pakistan' -> 'لاہور'); otherwise as stored
const cityName = (s) => {
  if (S.lang !== 'ur' || !s) return s;
  const first = String(s).split(',')[0].trim();
  return urCity[first] || urCity[Object.keys(urCity).find((k) => k.length >= 6 && first.startsWith(k))] || s;
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
  feed: null, feedSeen: null, tapOpen: false, geo: null, league: null,
  drawer: false, sheet: null, sideHidden: ls.get('side') === '0', folds: (() => { try { return JSON.parse(ls.get('folds') || '{}'); } catch { return {}; } })(),
  intro: ls.get('intro') ? null : 0,
  sunnah: null,
  draft: null,
  error: '',
};
if (S.lang === 'ur') await loadUr().catch(() => {}); // before the first screen, so an Urdu member never sees English first

const t = (k) => (I18N[S.lang] || I18N.en)[k] ?? I18N.en[k] ?? k;
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
// every number carries its unit, so durood recited and points earned are never mistaken for each other
const UNITS = { durood: 'u_durood', pts: 'u_pts', days: 'u_days', people: 'u_people' };
const unit = (u) => `<i class="u u-${u}">${t(UNITS[u])}</i>`;
const U = (n, u) => `${N(fmt(n))}${unit(u)}`;
const membersN = (n) => `${fmt(n)} ${t(n === 1 ? 'member1' : 'members')}`;
// an empty list says so kindly: a soft icon and one line, centred
const empty = (icon, text) => `<div class="empty"><span class="eico">${uiIcon(icon, 22, 1.8)}</span><p>${text}</p></div>`;
const cell = (v, label, u) => `<div><b>${typeof v === 'string' ? v : fmt(v)}</b><span>${label}${u ? ` ${unit(u)}` : ''}</span></div>`;
const $ = (s) => document.querySelector(s);
const app = $('#app');

let toastTimer;
function toast(msg, badge, action) {
  const el = $('#toast');
  el.innerHTML = (badge ? `<span class="tbadge">${badgeSvg(badge, true, 44)}</span>` : '') + `<span>${esc(msg)}</span>` + (action ? `<button class="tact" type="button">${esc(action.label)}</button>` : '');
  el.classList.toggle('withact', !!action);
  if (action) el.querySelector('.tact').onclick = () => { el.classList.remove('show'); action.run(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 3200);
}

// ---- feel: vibration, sound, motion (each can be turned off in Settings; motion follows the phone's "reduce motion") -----------------
const prefs = (() => { try { return JSON.parse(ls.get('feel') || '{}'); } catch { return {}; } })();
const setPref = (k, v) => { prefs[k] = v; ls.set('feel', JSON.stringify(prefs)); };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const HAPTICS = { tap: 8, light: 10, done: [12, 40, 18], round: [30, 50, 30], hundred: [60, 60, 60, 60, 90] };
function haptic(kind = 'tap') { if (prefs.vibrate !== false) try { navigator.vibrate?.(HAPTICS[kind] ?? 10); } catch { /* not supported */ } }
let audio = null;
function sound(kind = 'tap') {
  if (prefs.sound === false) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const tone = (freq, at, dur, vol = 0.05, type = 'sine') => {
      const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + at;
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    };
    if (kind === 'tap') tone(1500, 0, 0.04, 0.035, 'triangle');                 // a soft bead click
    else if (kind === 'round') { tone(880, 0, 0.18, 0.05); tone(1320, 0.09, 0.22, 0.04); }
    else if (kind === 'hundred') { tone(660, 0, 0.25, 0.05); tone(880, 0.12, 0.25, 0.05); tone(1320, 0.24, 0.4, 0.05); }
    else if (kind === 'done') { tone(740, 0, 0.12, 0.045); tone(1110, 0.07, 0.18, 0.04); }
  } catch { /* no audio */ }
}
// numbers that change roll to their new value
function rollNumber(el, from, to) {
  if (!el || from === to || reduceMotion()) return;
  const t0 = performance.now(), dur = 450;
  const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3; el.innerHTML = bigHtml(Math.round(from + (to - from) * e)); fitNumerals(); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// grey blocks while a page loads, instead of "…"
const skel = (n = 3) => `<div class="skel" aria-busy="true" aria-label="…">${Array.from({ length: n }, (_, i) => `<i style="width:${[92, 70, 84, 60][i % 4]}%"></i>`).join('')}</div>`;

// the phone's clock can be wrong; every reply carries the server's time, so calendar days and "3h ago" follow the server
let skew = 0;
const serverNow = () => Date.now() + skew;
const noteServerTime = (res) => { const d = Date.parse(res.headers.get('date') || ''); if (d) { const s = d - Date.now(); skew = Math.abs(s) > 120e3 ? s : 0; } }; // the header is to the second; small drift is ignored
async function api(path, method = 'GET', body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token && { Authorization: `Bearer ${S.token}` }) },
      body: body ? JSON.stringify(body) : undefined,
      // a weak signal can hold a request open for minutes: give up and treat it as no signal. Reads and sends with a
      // request id (safe to repeat) wait 12 s, so a durood goes to the outbox; other writes 30 s
      signal: AbortSignal.timeout?.(method === 'GET' || body?.rid ? 12_000 : 30_000),
    });
  } catch (e) { throw Object.assign(new Error('network'), { slow: e?.name === 'TimeoutError' }); }
  noteServerTime(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && S.token && data.error === 'unauthorized') logout(false);
    if (res.status === 403 && data.error === 'suspended' && S.token) { logout(false); S.error = (I18N[S.lang] || I18N.en).err.suspended; draw(); }
    throw new Error(data.error || 'server_error');
  }
  return data;
}
const errText = (e) => (I18N[S.lang] || I18N.en).err[e.message] || t('err').server_error;

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
  S.ref = ''; S.refName = null; S.error = '';
}

function logout(render = true) {
  S.profile = null; S.drawer = false; S.sheet = null; S.celebrate = null; // a drawer left open would keep the sign-in page from scrolling
  // nothing of one member's is left for the next person on a shared phone
  S.pending = 0; ls.del('pending'); S.draft = null; S.draftKind = null; S.threads = {}; S.history = null; S.editing = null;
  S.token = null; S.me = null; ls.del('token'); ls.del('meCache'); cachedMe = null;
  S.tab = 'home'; S.cv = S.feed = S.sunnahMine = S.majalis = S.board.data = null; boardCache.clear();
  if (render) draw();
}

// ---- reward feedback --------------------------------------------------------
const gainedSince = (before) => Math.max(0, (S.me.xp || 0) - (before || 0));
function celebrate(res) {
  const bits = [];
  if (res.goalHit) bits.push(t('goal_reached'));
  if (res.added) bits.push(t('saved_n')(fmt(res.added)));
  if (res.xpGained) bits.push(t('points_gained')(fmt(res.xpGained)));
  if (res.levelUp) bits.push(t('level_up')(res.levelUp));
  for (const b of res.newBadges || []) bits.push(`${t('new_badge')} ${t('badge')[b][0]}`);
  // a just-added number can be taken back straight away (a slip of the finger: 3130 for 313)
  const undo = res.entryId && res.added ? { label: t('undo'), run: () => undoLog(res.entryId) } : undefined;
  if (bits.length) toast(bits.join(' · '), (res.newBadges || [])[0], undo);
  if (res.levelUp || res.newBadges?.length) navigator.vibrate?.([60, 40, 60]);
  // a card to share for a real milestone (not the very first small ones) or a new level
  const big = (res.newBadges || []).find((c) => SHAREABLE.has(c));
  if (!S.celebrate) {
    if (big) S.celebrate = { kind: 'badge', code: big };
    else if (res.levelUp && res.levelUp >= 2) S.celebrate = { kind: 'level', level: res.levelUp };
    // the card waits for the counter to roll and the points to float up, so the two moments don't land on top of each other
    if (S.celebrate) { S.celebrateHold = Date.now() + 1400; setTimeout(draw, 1450); }
  }
}
async function undoLog(entryId) {
  try {
    const r = await api(`/entries/${entryId}`, 'PATCH', { count: 0, rid: `u-${crypto.randomUUID()}` });
    S.rollFrom = S.me.today; S.me = r.me; S.history = r.history; haptic('light'); toast(t('log_undone')); draw();
  } catch (e) { toast(errText(e)); }
}
const SHAREABLE = new Set(['d1k', 'd10k', 'd100k', 'd1m', 'streak7', 'streak30', 'streak100', 'karwan7', 'karwan30', 'league_silver', 'league_gold', 'league_diamond', 'city_podium', 'city_champion', 'group10k', 'group100k', 'group1m']);

// ---- views (Swiss style: type, hairline rules, flat colour) --------------------------

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
// the country list (11 KB) is fetched the first time a phone form shows, on sign-up or in Settings, not on the welcome slides
const countryOptions = () => (ensureGeo(), S.geo?.countries || [{ cc: 'PK', name: 'Pakistan', dial: '92' }])
  .map((c) => `<option value="${c.cc}" ${c.cc === (S.geo?.country || 'PK') ? 'selected' : ''}>${esc(c.name)} (+${c.dial})</option>`).join('');
let geoAsked = false;
function ensureGeo() {
  if (geoAsked) return;
  geoAsked = true;
  api(`/geo?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || '')}`).then((g) => { S.geo = g; draw(); }, () => { geoAsked = false; }); // the form falls back to Pakistan meanwhile
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
      ${S.signupsOpen === false ? `<div class="notice" role="status">${t('signups_closed_note')}</div>` : ''}
      <label for="f-invite">${t('invite_code')}</label>
      <input id="f-invite" type="text" name="invite" value="${esc(S.ref)}" autocapitalize="none" autocomplete="off" required data-check="invite" dir="ltr" aria-describedby="rcheck">
      <div class="hint ${S.refName ? 'ok' : ''}" id="rcheck">${S.refName ? `${t('joining')} <bdi>${esc(S.refName)}</bdi> ✓` : t('invite_hint')}</div>
      <div id="lcv" hidden>
        <label for="f-cvname">${t('leader_name')}</label>
        <input id="f-cvname" type="text" name="caravanName" data-check="cvname" autocapitalize="none" autocomplete="off" maxlength="20" dir="ltr" aria-describedby="cvcheck">
        <div class="hint" id="cvcheck">${t('leader_name_hint')}</div>
      </div>
      <p class="linkrow">${t('no_code')} <button type="button" class="linkbtn" data-act="mode" data-mode="waitlist">${t('request_access')}</button></p>
      <label for="f-username">${t('username')}</label>
      <input id="f-username" type="text" name="username" data-check="username" autocapitalize="none" autocomplete="username" maxlength="20" required dir="ltr">
      <div class="hint" id="ucheck">${t('username_hint')}</div>
      ${field(t('email'), 'email', 'email', 'autocomplete="email" required dir="ltr"')}
      <label for="f-phone">${t('phone')}</label>
      <div class="phonerow"><select name="phoneCountry" aria-label="${esc(t('country'))}">${countryOptions()}</select><input id="f-phone" type="tel" name="phone" autocomplete="tel-national" required dir="ltr" placeholder="300 1234567"></div>
      <div class="hint">${t('phone_hint')}</div>
      ${cityPicker(t('city'))}
      <label for="f-mjsel">${t('majlis_title')}</label>
      <select id="f-mjsel" name="majlisSel" required>${signupMajalisOptions()}</select>
      <div id="mjnew" hidden>
        <input name="newMajlisName" type="text" maxlength="40" autocomplete="off" placeholder="${esc(t('majlis_propose_ph'))}" aria-label="${esc(t('majlis_propose_ph'))}">
        <input name="newMajlisUr" type="text" maxlength="40" dir="auto" autocomplete="off" placeholder="${esc(t('majlis_propose_ur'))}" aria-label="${esc(t('majlis_propose_ur'))}">
        <div class="hint">${t('majlis_new_hint')}</div>
      </div>
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

// ---- the frame: a sidebar (a drawer on phones, like Todoist), the bottom bar and the + button ---------------------------------------
const NAV_GLYPH = { home: 'home', feed: 'feed', rank: 'bars', caravan: 'caravan', sunnah: 'leaf', progress: 'me', settings: 'gear', browse: 'me' };
const navIcon = (k, size = 22) => uiIcon(NAV_GLYPH[k] || 'star', size, 1.7);
const openQuests = () => (S.me.quests || []).filter((q) => !q.info && !q.done).length;
function sideItem(k, count = 0, dot = false) {
  return `<button class="sitem ${S.tab === k ? 'on' : ''}" ${S.tab === k ? 'aria-current="page"' : ''} data-act="go" data-tab="${k}">${navIcon(k, 20)}<span>${t('nav_' + k)}</span>${count ? `<b class="cnt">${count > 99 ? '99+' : count}</b>` : dot ? '<i class="pip" aria-hidden="true"></i>' : ''}</button>`;
}
function sidebar() {
  const m = S.me, title = t('titles')[Math.min(m.level - 1, 9)];
  return `<aside class="side ${S.drawer ? 'open' : ''}" aria-label="${esc(t('menu'))}" id="side">
    <div class="sidetop"><button class="sprof" data-act="go" data-tab="progress">${av(m, 40, false)}<span><b>${esc(m.displayName || m.username)}</b><small>${t('level')} ${m.level} · ${esc(title)}</small></span></button>
      <button class="pill icon sclose" data-act="drawerx" aria-label="${esc(t('close'))}">✕</button></div>
    <button class="sadd" data-act="addsheet">${uiIcon('plus', 20, 2.4)}<span>${t('add_durood')}</span></button>
    <div class="sgroup">${sideItem('home', openQuests())}${sideItem('feed', m.unreadNews || 0)}${sideItem('rank')}</div>
    <div class="slabel">${t('grp_groups')}</div>
    <div class="sgroup">${sideItem('sunnah')}${sideItem('caravan')}</div>
    <div class="slabel">${t('grp_you')}</div>
    <div class="sgroup">${sideItem('progress')}${sideItem('settings', 0, !m.emailVerified)}</div>
    <div class="sfoot"><button class="chip" data-act="setlang" data-l="${S.lang === 'ur' ? 'en' : 'ur'}">${S.lang === 'ur' ? 'English' : 'اردو'}</button><button class="chip" data-act="logout">${t('logout')}</button></div>
  </aside>${S.drawer ? `<div class="scrim" data-act="drawerx" aria-hidden="true"></div>` : ''}`;
}
function shell() {
  const tabs = ['home', 'feed', 'rank'];
  // quick add sits in the top bar (iOS keeps add actions there, never floating over a list); pages with their own main action leave it out
  const fab = !['settings', 'home', 'caravan', 'sunnah'].includes(S.tab);
  const addLabel = esc(t('add_durood'));
  return `
  <a class="skip" href="#main">${t('skip_to')}</a>
  ${sidebar()}
  <header class="hd"><span class="row"><button class="pill icon burger" data-act="drawer" aria-label="${esc(t(S.sideHidden ? 'side_show' : 'side_hide'))}" title="${esc(t(S.sideHidden ? 'side_show' : 'side_hide'))}" aria-controls="side">${uiIcon('sidebar', 18, 1.9)}</button><span class="ptitle">${t('nav_' + S.tab)}</span></span>
    <span class="row">${fab ? `<button class="pill icon hadd" data-act="addsheet" aria-label="${addLabel}" title="${addLabel}">${uiIcon('plus', 20, 2.4)}</button>` : ''}<span class="stk" title="${esc(t('streak'))}" aria-label="${S.me.streak} ${esc(t('streak'))}">${uiIcon('flame', 16, 1.8)} ${S.me.streak}</span><button class="pill icon bell" data-act="news" aria-label="${t('news_title')}" title="${t('news_title')}">${ICON_BELL}${S.me.unreadNews ? `<i class="dot">${S.me.unreadNews > 9 ? '9+' : S.me.unreadNews}</i>` : ''}</button></span></header>
  <main id="main" tabindex="-1" class="wrap tab-${S.tab}${Date.now() - (S.enterAt || 0) < 900 ? ' enter' : ''}"><h1 class="sr">${t('nav_' + S.tab)}</h1><div class="ltitle" aria-hidden="true">${t('nav_' + S.tab)}</div>${S.offlineMode || outbox().length ? `<div class="offbar" role="status">${uiIcon('refresh', 14, 2)} ${S.offlineMode ? t('offline_bar') : ''} ${outbox().length ? t('outbox_n')(fmt(outbox().reduce((n, x) => n + x.count, 0))) : ''}</div>` : ''}${view()}</main>
  <nav class="tabs" aria-label="${esc(t('app'))}">${tabs.map((k) => `<button class="${S.tab === k ? 'on' : ''}" ${S.tab === k ? 'aria-current="page"' : ''} data-act="tab" data-tab="${k}">${navIcon(k)}<em>${t('nav_' + k)}</em></button>`).join('')}
    <button class="${['sunnah', 'caravan', 'progress', 'settings'].includes(S.tab) ? 'on' : ''}" data-act="drawer" aria-label="${esc(t('menu'))}">${uiIcon('menu', 22, 1.7)}<em>${t('nav_browse')}</em></button></nav>
  ${S.sheet === 'add' ? addSheet() : ''}
  ${S.profile ? profileModal() : ''}
  ${S.celebrate && !(S.celebrateHold > Date.now()) ? celebrateModal() : ''}
  ${S.me.needsCity ? cityModal() : ''}`;
}

function view() {
  return ({ home, feed: feedView, rank, sunnah: sunnahPage, caravan, progress, settings }[S.tab] || home)();
}

// a section that folds away, like a Todoist section; what is open is remembered on this device
function fold(k, title, meta, body, openByDefault = true) {
  const open = S.folds[k] ?? openByDefault;
  return `<section class="fold ${open ? 'open' : ''}"><button class="foldhead" data-act="fold" data-k="${k}" aria-expanded="${open}"><svg class="chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="ftitle">${title}</span>${meta ? `<span class="fmeta">${meta}</span>` : ''}</button>${open ? `<div class="foldbody">${body}</div>` : ''}</section>`;
}

// the durood counter's entry: a number, quick amounts, or counting by tapping. Used on Today and in the + sheet.
function logBox() {
  return `<div class="numbox">
    <label for="manual">${t('enter_total')}</label>
    <div class="row"><input type="number" id="manual" inputmode="numeric" enterkeyhint="done" min="1" placeholder="${t('count_ph')}" dir="ltr"><button class="blk addbtn" data-act="manual"><span>${t('add')}</span><b class="ar">→</b></button></div>
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
  </div>` : ''}`;
}
function counter() {
  const m = S.me, live = m.today + S.pending;
  const dateLine = new Date(`${pkDay()}T00:00:00Z`).toLocaleDateString(S.lang === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `<div class="sub"><span>${dateLine}</span><span>${t('goal_word')} ${U(m.dailyGoal, 'durood')}</span></div>
  <div class="big ${bigClass(live)}" id="big">${bigHtml(live)}</div>
  <div id="livebar">${bar((live / m.dailyGoal) * 100)}</div>`;
}
function addSheet() {
  return `<div class="modal sheetm"><div class="box sheetbox" aria-label="${esc(t('add_durood'))}">
    <div class="row between"><b class="sheettitle">${t('add_durood')}</b><button class="chip" data-act="sheetx">${t('close')}</button></div>
    ${counter()}
    ${logBox()}
  </div></div>`;
}

// any progress at all shows a sliver, so a small start never looks like an empty, broken bar
const bar = (pct) => `<div class="bar"><i style="width:${pct > 0 ? Math.max(2, Math.min(100, pct)) : 0}%"></i></div>`;

// ---- Today: the counter, then everything to do today in folding sections -------------------------------------------------------
function home() {
  const m = S.me, f = S.feed;
  if (!f && !S.feedLoading) { S.feedLoading = true; loadFeed().catch(() => {}).finally(() => { S.feedLoading = false; if (S.tab === 'home') draw(); }); } // first screen after sign-in
  const notices = [
    // a running streak and nothing yet today: a gentle nudge (stronger in the evening, Pakistan time)
    m.streak > 0 && !m.today ? `<div class="streaknudge ${new Date(serverNow() + 5 * 3600e3).getUTCHours() >= 18 ? 'late' : ''}">${uiIcon('flame', 16, 2)} ${t(new Date(serverNow() + 5 * 3600e3).getUTCHours() >= 18 ? 'streak_nudge_late' : 'streak_nudge')(m.streak)}</div>` : '',
    m.special ? `<div class="special">${uiIcon('star', 14, 2)} ${t('special_banner')(esc(pick(m.special.nameEn, m.special.nameUr)))}</div>` : '',
  ].join('');

  // today's Sunnah (tick or photo); its page holds the history and the community's photos
  let sunnahBody = skel(), sunnahMeta = '';
  if (f) {
    sunnahBody = `${sunnahCard(f.today)}<button class="rowlink" data-act="tab" data-tab="sunnah"><span>${t('sn_more')}</span><b class="ar">→</b></button>`;
    sunnahMeta = f.today?.sunnah ? N(`${f.today.ticked || f.today.mine ? 1 : 0} / 1`) : '';
  }
  // durood quests first, then the Sunnah quest (it is ticked in the Sunnah card below)
  const quests = m.quests;
  // the live line never shows less than the member's own day (the shared numbers are cached for a few seconds)
  const liveToday = Math.max(m.pub.today || 0, m.today || 0), liveMembers = Math.max(m.pub.membersToday || 0, m.today ? 1 : 0);

  return `${notices}
  <section class="counterbox">${counter()}
  ${liveToday ? `<div class="live">${uiIcon('feed', 13, 2)} ${t('live_today')(fmt(liveToday), membersN(liveMembers))}</div>` : ''}
  ${logBox()}</section>
  ${fold('quests', t('grp_quests'), N(`${quests.filter((q) => q.done).length} / ${quests.length}`),
    `${quests.filter((q) => q.period === 'day').every((q) => q.done) ? `<div class="alldone">${uiIcon('star', 14, 2)} ${t('quests_all_done')}</div>` : ''}${quests.map((q) => quest(q)).join('')}`)}
  ${fold('sunnah', t('nav_sunnah'), sunnahMeta, sunnahBody)}
  ${fold('challenge', chTitle(m.pub.challenge || {}), '', challengeCard(m), false)}
  <p class="note">${t('reminder_note')}</p>`;
}

// keep the big number and its bar in step with taps without redrawing the screen
// the headline numeral shrinks with the number of characters so large counts never clip
// the comma gets a little room of its own: with the tight letter-spacing of a big numeral it touches the digit after it
const bigHtml = (n) => fmt(n).replace(/,/g, '<span class="cm">,</span>');
// The big numerals are sized from the screen width, but a phone's own "font size" setting scales them again (Android does).
// So after every change measure what was really drawn and shrink to the room there is: no digit is ever cut off by its card.
function fitNumerals() {
  for (const el of document.querySelectorAll('#big, .cnum')) {
    el.style.removeProperty('font-size');
    const cs = getComputedStyle(el), pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const r = document.createRange(); r.selectNodeContents(el);
    // three ways of seeing how wide the digits really are (the text's own box, and what overflows the card); the widest wins, so a
    // browser that reports one of them wrongly (Safari on iPhone does for some fonts) cannot let a number run off the card
    for (let pass = 0; pass < 3; pass++) {
      const room = el.clientWidth - pad;
      const w = Math.max(r.getBoundingClientRect().width, el.scrollWidth - pad);
      if (!(room > 0 && w > room + 0.5)) break;
      el.style.setProperty('font-size', `${(parseFloat(getComputedStyle(el).fontSize) * room / w * 0.96).toFixed(1)}px`, 'important');
    }
  }
}
if (typeof ResizeObserver === 'function') { // the card changing size (rotation, the keyboard, a late font) re-measures too
  let ro, last = null;
  const watch = () => { const box = document.querySelector('.counterbox'); if (box && box !== last) { ro?.disconnect(); last = box; ro = new ResizeObserver(() => fitNumerals()); ro.observe(box); } };
  new MutationObserver(watch).observe(document.documentElement, { childList: true, subtree: true });
}
document.fonts?.ready.then(fitNumerals); // measured again once the numeral font is really there
document.fonts?.addEventListener?.('loadingdone', fitNumerals); // ready can resolve before a font was asked for (Safari), so also re-measure whenever one finishes loading
addEventListener('load', fitNumerals);
addEventListener('resize', fitNumerals);
addEventListener('orientationchange', () => setTimeout(fitNumerals, 300));
const bigClass = (n) => { const c = fmt(n).length; return c <= 3 ? '' : c <= 5 ? 'l5' : c === 6 ? 'l6' : c === 7 ? 'l7' : 'l9'; }; // l9: 8+ characters (e.g. 5,000,000) still fit a 320px phone
function liveHome() {
  const m = S.me, live = m.today + S.pending;
  if (!$('#big')) return;
  $('#big').innerHTML = bigHtml(live);
  $('#big').className = `big ${bigClass(live)}`;
  fitNumerals();
  $('#livebar').innerHTML = bar((live / m.dailyGoal) * 100);
  if ($('#pend')) { $('#pend').textContent = fmt(S.pending); $('#submitp').disabled = !S.pending; }
}

const chTitle = () => t('challenge_title');
function challengeCard(m) {
  const c = m.pub.challenge;
  if (!c || c.state === 'waiting') return '';
  const pct = Math.min(100, (c.total / c.target) * 100);
  const head = `<div class="chead"><span>${uiIcon('star', 14, 2)} ${esc(chTitle(c))}</span><span>${c.state === 'running' || c.state === 'over' ? t('day_of')(c.dayIndex, c.days) : ''}</span></div>`;
  const tot = `<div class="ctotal"><b>${fmt(c.total)}</b><span dir="auto">${t('of')} ${human(c.target)}${unit('durood')}</span></div>`;
  const markPct = c.state === 'running' ? ((c.dayIndex - 1) / c.days) * 100 : 0;
  const barEl = `<div class="cbar">${bar(pct)}${c.state === 'running' && markPct > 0 ? `<span class="pace" style="inset-inline-start:${markPct}%" title="plan"></span>` : ''}</div>`;
  let body = '';
  if (c.state === 'running') {
    const gap = c.gap;
    const status = gap === 0 && c.dayIndex === 1 ? t('first_day')(human(c.today), human(c.neededToday)) : gap === 0 ? t('on_plan') : gap > 0 ? t('ahead')(human(gap)) : t('behind')(human(gap));
    const proj = c.projectedTotal == null ? t('plan_each_day')(human(c.plannedPerDay))
      : t('projected')(human(c.projectedTotal), Math.round((c.projectedTotal / c.target) * 100), c.days);
    body = `<div class="cells">${cell(human(c.neededToday), t('needed_today'), 'durood')}${cell(human(c.today), t('reported_today'), 'durood')}<div><b>${c.daysLeft}</b><span>${t('days_left')}</span></div></div>
      <div class="cstatus ${gap < 0 ? 'behind' : 'ahead'}">${status}</div><div class="cnote">${proj}</div>`;
  } else if (c.state === 'upcoming') {
    body = `<div class="cstatus ahead">${c.startsIn === 1 ? t('starts_tomorrow') : t('starts_in')(c.startsIn)}</div>`;
  } else if (c.state === 'over') {
    body = `<div class="cstatus behind">${t('over_msg')(c.dayIndex, c.days, human(c.short))}</div>`;
  } else if (c.state === 'done') {
    body = `<div class="cstatus ahead">${t('done_msg')(human(c.target))}</div>`;
  }
  return `<div class="challenge">${head}${tot}${barEl}${body}<div class="cnote">${membersN(m.pub.members)} · ${t('self_reported')}</div></div>`;
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
    ${c.title === c.big ? `<div class="ccap">${esc(String(c.label).replace(/:$/, ''))}</div>` : ''}
    <div class="cnum ${c.big.length > 6 ? 'long' : ''}">${esc(c.big)}</div>
    ${c.title === c.big ? '' : `<div class="ctitle">${esc(c.title)}</div>`}
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
    g.fillText(`${human(total)} ${t('of')} ${human(target)} · ${chTitle(S.me?.pub?.challenge || {})}`, left, 1190);
  } else {
    g.fillStyle = soft; g.font = `600 44px ${family}`; g.fillText(S.me.username, left, 1190);
  }
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
  const file = new File([blob], 'durood-quest.png', { type: 'image/png' });
  const text = x.kind ? `${c.title}: ${c.text}. ${location.origin}` : `${t('share_crore')(x.done ? human(x.target).split(' ')[0] : x.k, x.day)} ${location.origin}`;
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'durood-quest.png'; a.click(); // no file sharing here: save the image
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

const QUEST_UNIT = { goal: 'durood', weekgoal: 'durood', special: 'durood', days5: 'days' };
function quest(q, dim) {
  return `<div class="q ${q.done ? 'd' : ''} ${dim ? 'dim' : ''}" data-q="${q.id}">
    <span class="bx"></span>
    <span class="t">${q.id === 'streak' ? `${uiIcon('flame', 14, 2)} ${t('q_streak')(q.streakDay)}` : t('q_' + q.id)}<small>${t(q.period === 'day' ? 'daily' : 'weekly')}${q.goal > 1 ? ` · ${N(`${fmt(q.cur)} / ${fmt(q.goal)}`)}${unit(QUEST_UNIT[q.id] || 'durood')}` : ''}</small></span>
    <span class="qxp" title="${esc(t('q_reward'))}">${N(`+${fmt(q.xp)}`)}${unit('pts')}</span>
  </div>`;
}

// ---- people: a picture (or their initial) and a name; tap to see their profile -------------------------------------------------------
const hueOf = (name) => [...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function av(p, size = 36, link = true) {
  const inner = p.avatar
    ? `<img class="av" width="${size}" height="${size}" src="${esc(p.avatar)}" alt="" loading="lazy">`
    : `<span class="av ini" style="width:${size}px;height:${size}px;--h:${hueOf(p.username)};font-size:${Math.round(size * 0.44)}px" aria-hidden="true">${esc([...p.username][0] || '?').toUpperCase()}</span>`;
  return link ? `<button class="avbtn" data-act="profile" data-u="${esc(p.username)}"${p.ref ? ` data-ref="${esc(p.ref)}"` : ''} aria-label="${esc(t('view_profile')(p.username))}">${inner}</button>` : inner;
}
const nameLine = (p) => `<b>${esc(p.username)}</b>${p.displayName ? ` <small class="dn">${esc(p.displayName)}</small>` : ''}`;
function profileModal() {
  const d = S.profile, p = d.data;
  const head = `<div class="row between"><h3 class="in">${esc(d.username)}</h3><button class="chip" data-act="closeprofile">${t('close')}</button></div>`;
  if (!p) return `<div class="modal msheet"><div class="box">${head}<p class="muted center">…</p></div></div>`;
  return `<div class="modal msheet"><div class="box profile">${head}
    <div class="pbig">${av(p, 96, false)}</div>
    ${p.displayName ? `<div class="pname" dir="auto">${esc(p.displayName)}</div>` : ''}
    ${p.bio ? `<p class="pbio" dir="auto">${esc(p.bio)}</p>` : ''}
    <p class="muted center">${p.city ? `${esc(cityName(p.city))} · ` : ''}${t('member_since')} ${esc(dayText(p.joined, SINCE))}${p.caravan ? ` · ${esc(p.caravan)}` : ''}</p>
    ${p.whatsapp ? `<button class="blk wabtn" data-act="wachat" data-u="${esc(d.username)}"><span>${t('wa_message')}</span><b class="ar">→</b></button>` : ''}
    ${p.level ? `<div class="stats flat">${p.total != null ? cell(p.total, t('total'), 'durood') : ''}${cell(p.streak, t('streak_l'))}${cell(p.level, t('level'))}</div>` : ''}
    ${p.badges?.length ? `<div class="earned static">${p.badges.filter((c) => t('badge')[c]).map((c) => `<span title="${esc(t('badge')[c][0])}">${badgeSvg(c, true)}</span>`).join('')}</div>` : ''}</div></div>`;
}

// ---- the feed ---------------------------------------------------------------------------------------------------
const pick = (en, ur) => (S.lang === 'ur' && ur) || en;
// a stored day ('2026-10-25') in the member's language: { day: 'numeric', month: 'short' } -> '25 Oct'; anything else is shown as it is
const dayText = (d, o) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? new Date(`${d}T00:00:00Z`).toLocaleDateString(S.lang === 'ur' ? 'ur-PK' : 'en-GB', { ...o, timeZone: 'UTC' }) : d || '');
const SINCE = { month: 'long', year: 'numeric' };
function ago(at) {
  const m = Math.max(0, Math.round((serverNow() - at) / 60000));
  return m < 1 ? t('ago_now') : m < 60 ? t('ago_m')(m) : m < 1440 ? t('ago_h')(Math.floor(m / 60)) : t('ago_d')(Math.floor(m / 1440));
}
const statusTag = (st) => `<span class="tag ${st}">${t('st_' + st)}</span>`;

function sunnahCard(d) {
  const sn = d.sunnah, mine = d.mine, r = d.rules;
  if (!sn) return `<div class="fcard"><h3>${t('sunnah_title')}</h3><p class="muted">${t('no_sunnah')}</p></div>`;
  let photoPart;
  if (mine) photoPart = `<div class="row between"><b>${t('your_post')}</b>${statusTag(mine.status)}</div>${mine.photoUrl ? `<img class="shot thumb" src="${esc(mine.photoUrl)}" alt="${esc(t('your_post'))}">` : `<p class="muted">${t('photo_gone')}</p>`}`;
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

// ---- the Sunnah page and the Seerah page ----------------------------------------------------------------------------------------
function sunnahPage() {
  const f = S.feed;
  if (!f) return skel();
  const mine = S.sunnahMine;
  const photos = f.items.filter((it) => it.type === 'photo');
  return `${sunnahCard(f.today)}
    <h3>${t('sn_history')}</h3>
    ${!mine ? skel() : mine.length ? `<ul class="lb">${mine.map((p) => `<li>${p.photoUrl ? `<img class="shot thumb" loading="lazy" src="${esc(p.photoUrl)}" alt="">` : ''}<span class="name">${esc(pick(p.titleEn, p.titleUr))}<small>${esc(dayText(p.day, { day: 'numeric', month: 'short' }))}</small></span>${statusTag(p.status)}</li>`).join('')}</ul>` : `<p class="muted padx">${t('sn_history_empty')}</p>`}
    <h3>${t('sn_community')}</h3>
    ${photos.length ? `<div class="stream">${photos.map(feedItem).join('')}</div>` : `<p class="muted padx">${t('sn_community_empty')}</p>`}`;
}
// replies: short, one level, opened under the item they belong to
const replyKind = (it) => (it.type === 'photo' ? 'post' : it.type);
const threadKey = (it) => `${replyKind(it)}:${it.id}`;
function threadHtml(it) {
  const th = (S.threads || {})[threadKey(it)];
  if (!th) return '';
  const list = (th.list || []).map((r) => `<div class="reply"><div class="fwho">${av(r, 26)}${nameLine(r)}${r.city ? ` <small>${esc(cityName(r.city))}</small>` : ''}<small class="when">${ago(r.at)}</small>
      ${r.mine ? '' : `<button class="chip" data-act="rreport" data-id="${r.id}" data-key="${threadKey(it)}" aria-label="${esc(t('report_label'))}" title="${esc(t('report_ask'))}">${uiIcon('flag', 12, 2)}</button>`}</div>
      <div class="reflbody" dir="auto">${esc(r.body)}</div></div>`).join('');
  const mineN = (th.list || []).filter((r) => r.mine).length;
  const form = mineN >= 3 ? `<small class="muted">${t('reply_limit_note')}</small>`
    : `<div class="row"><input type="text" aria-label="${esc(t('reply_btn'))}" data-rbox="${threadKey(it)}" maxlength="140" placeholder="${esc(t('reply_ph'))}" dir="auto" value="${esc(th.draft || '')}"><button class="chip solid" data-act="reply" data-key="${threadKey(it)}">${t('reply_send')}</button></div>`;
  return `<div class="thread">${th.loading ? '<small class="muted">…</small>' : list}${form}</div>`;
}

function feedItem(it) {
  const who = () => `<div class="fwho">${av(it, 32)}${nameLine(it)}${it.city ? ` <small>${esc(cityName(it.city))}</small>` : ''}<small class="when">${ago(it.at)}</small></div>`;
  const rk = replyKind(it);
  const acts = `<div class="facts"><button class="chip like ${it.liked ? 'on' : ''}" data-act="like" data-kind="${rk}" data-id="${it.id}" aria-label="${esc(t('like_label'))}" aria-pressed="${it.liked ? 'true' : 'false'}" ${it.mine || it.liked ? 'disabled' : ''}>${uiIcon('heart', 14, 2)}${it.likes ? ` ${fmt(it.likes)}` : ''}</button>
    <button class="chip" data-act="thread" data-kind="${rk}" data-id="${it.id}" aria-label="${esc(t('reply_btn'))}" aria-expanded="${(S.threads || {})[threadKey(it)] ? 'true' : 'false'}">${uiIcon('chat', 14, 2)} ${it.replies ? fmt(it.replies) : t('reply_btn')}</button>
    ${it.mine ? '' : `<button class="chip" data-act="report" data-kind="${rk}" data-id="${it.id}" aria-label="${esc(t('report_label'))}" title="${esc(t('report_ask'))}">${uiIcon('flag', 14, 2)}</button>`}</div>${threadHtml(it)}`;
  if (it.type === 'announcement') {
    return `<div class="fitem ann ${it.at > (S.feedSeen || Infinity) ? 'unread' : ''}"><div class="flabel">${uiIcon('feed', 12, 2)} ${t('ann_label')}<small class="when">${ago(it.at)}</small></div>
      <b>${esc(pick(it.titleEn, it.titleUr))}</b>${it.bodyEn || it.bodyUr ? `<p>${esc(pick(it.bodyEn, it.bodyUr))}</p>` : ''}</div>`;
  }
  if (it.type === 'photo') {
    return `<div class="fitem"><div class="flabel">${uiIcon('leaf', 12, 2)} ${esc(pick(it.titleEn, it.titleUr))}</div>${who()}
      <img class="shot" loading="lazy" src="${esc(it.photoUrl)}"${it.w && it.h ? ` width="${Number(it.w)}" height="${Number(it.h)}"` : ''} alt="">${acts}</div>`;
  }
  if (it.type === 'milestone') {
    const b = t('badge')[it.code] || [it.code, ''];
    return `<div class="fitem ms ${it.mine ? 'mine' : ''}"><div class="flabel">${uiIcon('star', 12, 2)} ${t('ms_label')}<small class="when">${ago(it.at)}</small></div>
      <b>${t('ms_text')(esc(it.username), esc(b[0]))}</b><div class="muted">${esc(b[1])}</div>
      ${it.mine ? (it.cheers ? `<div class="cheerline">${t('cheered_n')(it.cheers)}</div>` : '')
        : `<button class="chip cheer ${it.cheered ? 'on' : ''}" data-act="cheer" data-id="${it.id}" ${it.cheered ? 'disabled' : ''} aria-pressed="${it.cheered}">${t('mashallah')}${it.cheers ? ` ${N(fmt(it.cheers))}` : ''}</button>`}</div>`;
  }
  if (it.type === 'city') {
    return `<div class="fitem ms"><div class="flabel">${uiIcon('star', 12, 2)} ${t('city_label')}<small class="when">${ago(it.at)}</small></div><b>${t('city_item')(it.rank, esc(cityName(String(it.label || '').split(',')[0].trim())))}</b></div>`;
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
  if (!f) return skel();
  // posting happens on Today; the feed is for reading what everyone shared
  return `<button class="rowlink" data-act="tab" data-tab="home"><span>${uiIcon('camera', 14, 2)} ${t('feed_share')}</span><b class="ar">→</b></button>
    <div class="stream">${f.items.length ? feedList(f.items) : empty('feed', t('feed_empty'))}</div>
    ${f.next ? `<button class="chip more" data-act="more">${t('more')}</button>` : ''}`;
}

// ---- compete: the challenge, the weekly league, and rankings of people, caravans, majalis and cities ----------------------------
const TIER_KEYS = ['bronze', 'silver', 'gold', 'diamond'];
function leagueView() {
  const L = S.board.data;
  if (!L) return skel();
  const name = t('tier_' + TIER_KEYS[L.tier]);
  const head = `<div class="leaguehead"><b>${uiIcon('bolt', 16, 2)} ${t('league_title')} · ${name}</b><small>${t('league_days')(L.daysLeft)}</small></div>`;
  const last = L.last ? `<p class="note">${t('league_last_' + L.last.result)(L.last.rank)}</p>` : '';
  if (!L.joined) return `${head}<p class="muted" style="margin-inline:20px">${t('league_join')(name)}</p>${last}<p class="note">${t('league_rules')}</p>`;
  return `${head}${last}<ul class="lb">${L.rows.map((r) => `
    <li class="${r.me ? 'me' : ''} ${r.up ? 'up' : ''} ${r.down ? 'down' : ''}"><span class="rank">${r.rank}</span>${av(r, 34)}
      <span class="name">${esc(r.username)}${r.me ? ` <em class="tag">${t('you')}</em>` : ''}<small>${r.up ? t('league_up') : r.down ? t('league_down') : esc(cityName(r.city) || '')}</small></span>
      <span class="score">${U(r.score, 'durood')}</span></li>`).join('')}</ul><p class="note">${t('league_rules')}</p>`;
}

function rank() {
  const b = S.board, rows = b.data?.rows;
  const grp = ['caravans', 'cities', 'majalis'].includes(b.type);
  const list = b.type === 'league' ? leagueView() : !rows ? skel() : rows.length ? `<ul class="lb">${rows.map((r) => `
    <li class="${r.me ? 'me' : ''}"><span class="rank">${r.rank}</span>${r.avatar !== undefined ? av(r, 34) : ''}
      <span class="name"><bdi>${esc(r.displayName || (r.name != null ? (b.type === 'cities' ? cityName(r.name) : r.name) : (r.nameUr ? pick(r.username, r.nameUr) : r.username)))}</bdi>${r.me ? ` <em class="tag">${t(b.type === 'caravans' ? 'cv_yours' : 'you')}</em>` : ''}<small>${r.city ? `${esc(cityName(r.city))}` : ''}${grp ? `${r.city ? ' · ' : ''}${membersN(r.members)}${b.metric === 'average' ? ` · ${fmt(r.active)} ${t('active')}` : ''}` : ''}</small></span>
      <span class="score">${N(`${grp && b.metric === 'growth' && r.score > 0 ? '+' : ''}${fmt(r.score)}`)}${unit('durood')}</span></li>`).join('')}${b.data.you ? `
    <li class="gap" aria-hidden="true">⋯</li>
    <li class="me"><span class="rank${b.data.you.rank > 999 ? ' long' : b.data.you.rank > 99 ? ' mid' : ''}">${fmt(b.data.you.rank)}</span>${av(S.me, 34)}<span class="name">${esc(S.me.username)} <em class="tag">${t('you')}</em><small>${esc(cityName(S.me.city) || '')}</small></span>
      <span class="score">${U(b.data.you.score, 'durood')}</span></li>` : ''}</ul>` : `<p class="muted center">${t(b.type === 'cities' ? 'empty_cities' : 'empty_board')}</p>`;
  const kinds = [['users', 'rk_people'], ['league', 'rk_league'], ['caravans', 'rk_caravans'], ['cities', 'rk_cities'], ['majalis', 'rk_majalis']];
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
  ${b.type === 'majalis' ? `<p class="note">${t('majalis_min')(b.data?.minActive || 3)}</p>` : ''}
  <p class="note">${t('self_reported')}</p>
  <p class="note">${t('reminder_note')}</p>`;
}

// ---- caravans: a named group an admin creates; members join it at sign-up with its name ----------------------------------------------------
const cvRow = (r, extra = '') => `<li>${av(r, 34)}<span class="name">${esc(r.username)}${r.owner ? ` <em class="tag">${t('cv_owner')}</em>` : ''}<small>${r.city ? `${esc(cityName(r.city))} · ` : ''}${t('this_week')} ${U(r.week, 'durood')}${r.today ? ` <span class="didtoday" role="img" aria-label="${esc(t('cv_today'))}" title="${esc(t('cv_today'))}">${uiIcon('check', 12, 2.6)}</span>` : ''}</small></span><span class="score">${U(r.total, 'durood')}</span>${extra}</li>`;
function cvHome(cv) {
  const c = cv.caravan, ks = cv.streak, shown = S.cvAll ? cv.members : cv.members.slice(0, 8);
  return `<h3 class="first-d">${t('caravan_title')}</h3>
  <div class="uname cvname"${c.displayName ? ' dir="auto"' : ''}>${esc(c.displayName || c.name)}</div>
  <div class="muted padx">${c.displayName ? `${N('@' + esc(c.name))} · ` : ''}${t('cv_owner_is')(esc(c.ownerName))}</div>
  <p class="note first">${t('cv_name_is_code')(`<b dir="ltr">${esc(c.name)}</b>`)}</p>
  <div class="stats">${cell(c.members, t('c_members'))}${cell(c.total, t('c_total'), 'durood')}${cell(c.week, t('c_week'), 'durood')}</div>
  <div class="lvl"><div class="row between"><span>${t('next_milestone')}</span><b>${U(c.next, 'durood')}</b></div>${bar(c.next === c.prev ? 100 : ((c.total - c.prev) / (c.next - c.prev)) * 100)}</div>
  ${ks.active ? `<div class="karwan"><b>${uiIcon('flame', 16, 1.8)} ${t('karwan_streak')(ks.streak)}</b>
      <div>${t('karwan_today')(fmt(ks.today), fmt(ks.size))}</div>
      ${ks.missing.length ? `<div class="muted">${t('karwan_missing')} ${ks.missing.map((n) => `<span class="chipname">${esc(n)}</span>`).join(' ')}</div>` : ''}</div>` : `<p class="note">${t('karwan_need')}</p>`}
  ${c.owner && cv.lagging?.length ? `<h3>${t('cv_lag_title')} (${fmt(cv.lagging.length)})</h3><p class="muted padx">${t('cv_lag_hint')}</p>
  <ul class="lb lag">${cv.lagging.map((m) => `<li>${av(m, 34)}<span class="name">${esc(m.username)}<small>${m.quietDays == null ? t('cv_lag_never') : t('cv_lag_days')(m.quietDays)}</small></span><button class="chip" data-act="cvremove" data-u="${esc(m.username)}" aria-label="${esc(t('cv_remove'))}: ${esc(m.username)}">${t('cv_remove_short')}</button></li>`).join('')}</ul>` : ''}
  <h3>${t('cv_members')} (${fmt(c.members)})</h3>
  <ul class="lb">${shown.map((m) => cvRow(m, c.owner && !m.owner ? `<button class="chip" data-act="cvremove" data-u="${esc(m.username)}" aria-label="${esc(t('cv_remove'))}" title="${esc(t('cv_remove'))}">✕</button>` : c.owner ? '<span class="xslot" aria-hidden="true"></span>' : '')).join('')}</ul>
  ${cv.members.length > 8 && !S.cvAll ? `<button class="chip more" data-act="cvall">${t('cv_show_all')(fmt(cv.members.length))}</button>` : ''}
  ${c.owner ? `<form novalidate class="cname" data-form="cvrename"><label for="cv-rename">${t('cv_rename')}</label>
      <div class="row"><input id="cv-rename" name="name" type="text" maxlength="20" autocomplete="off" autocapitalize="off" dir="ltr" value="${esc(c.name)}"><button class="chip solid" type="submit">${t('save')}</button></div>
      <div class="hint" id="cvcheck">${t('cv_name_hint')}</div></form>
    <form novalidate class="cname" data-form="cvdisplay"><label for="cv-display">${t('cv_display')}</label>
      <div class="row"><input id="cv-display" name="displayName" type="text" maxlength="40" autocomplete="off" dir="auto" placeholder="${esc(t('cv_display_ph'))}" value="${esc(c.displayName || '')}"><button class="chip solid" type="submit">${t('save')}</button></div>
      <div class="hint">${t('cv_display_hint')}</div></form>` : ''}`;
}
function caravan() {
  const cv = S.cv;
  return !cv ? skel() : cv.caravan ? cvHome(cv) : `<h3 class="first-d">${t('caravan_title')}</h3>${empty('caravan', t('cv_none'))}`;
}

function historyBlock() {
  const h = S.history;
  if (!h) return skel();
  const time = (at) => new Date(at).toLocaleTimeString(S.lang === 'ur' ? 'en-GB' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  if (!h.days.length) return `<p class="note first">${t('hist_empty')}</p>`;
  return h.days.map((d) => `
    <div class="hday"><span>${d.day === h.today ? t('today') : d.day === h.yesterday ? t('yesterday') : esc(dayText(d.day, { weekday: 'short', day: 'numeric', month: 'short' }))}</span><b>${U(d.total, 'durood')}</b></div>
    ${d.entries.map((e) => `
      <div class="hrow ${S.editing === e.id ? 'ed' : ''}">
        <span class="hc">${fmt(e.count)}</span>
        <span class="ht">${time(e.at)}${e.edits.length ? ` <em class="tag">${t('edited')}</em><small>${t('was')} ${e.edits.map((x) => N(`${fmt(x.from)} → ${fmt(x.to)}`)).join(' · ')}</small>` : ''}</span>
        ${d.editable ? (S.editing === e.id
          ? `<span class="edit"><input type="number" id="editval" inputmode="numeric" min="1" value="${e.count}" dir="ltr"><button class="chip solid" data-act="editsave" data-id="${e.id}">${t('save')}</button><button class="chip" data-act="editx">${t('cancel')}</button></span>`
          : `<button class="chip" data-act="edit" data-id="${e.id}">${t('edit')}</button>`) : ''}
      </div>`).join('')}`).join('');
}

// achievements: personal, caravan (your caravan's totals and streaks), and the city podium
const BADGE_FAMILIES = [
  ['personal', ['first_step', 'd1k', 'd10k', 'd100k', 'd1m', 'streak7', 'streak30', 'streak100', 'sunnah1', 'sunnah7', 'sunnah30', 'league_silver', 'league_gold', 'league_diamond']],
  ['karwan', ['group10k', 'group100k', 'group1m', 'karwan7', 'karwan30']],
  ['city', ['city_podium', 'city_champion']],
];

// ---- Progress: level and points, history of what you logged, and badges ------------------------------------------------------------
function progress() {
  const m = S.me, title = t('titles')[Math.min(m.level - 1, 9)];
  return `<div class="myhead small"><div class="mybig">${av(m, 56, false)}</div><div><div class="uname">${esc(m.username)}</div><div class="muted">${t('level')} ${m.level} · ${esc(title)}</div></div></div>
  <div class="stats">${cell(m.week, t('week'), 'durood')}${cell(m.total, t('total'), 'durood')}${cell(m.bestStreak, t('best_streak'), 'days')}</div>
  <div class="lvl"><div class="row between"><span>${uiIcon('bolt', 14, 1.9)} ${t('level')} ${m.level} · ${esc(title)}</span><b>${N(`${fmt(m.xp)} / ${fmt(m.next)}`)}${unit('pts')}</b></div>${bar(m.pct)}
    <p class="unitnote">${t('units_note')(unit('durood'), unit('pts'))}</p>
    <div class="row between muted" style="margin-top:6px"><span title="${esc(t('shield_hint'))}">${uiIcon('shield', 14, 1.9)} ${m.shields} ${t('shields_word')}</span><button class="linkbtn" data-act="goleague">${t('league_title')}: ${t('tier_' + TIER_KEYS[m.league || 0])}</button></div></div>
  ${fold('badges', t('badges'), `<span class="minibadges" aria-hidden="true">${m.badges.slice(-3).reverse().map((c) => badgeSvg(c, true)).join('')}</span>${N(`${m.badges.length} / ${BADGE_FAMILIES.reduce((n, [, l]) => n + l.length, 0)}`)}`, `${BADGE_FAMILIES.map(([fam, list]) => `<h3>${t('fam_' + fam)}</h3>
  <div class="badges">${list.slice().sort((x, y) => m.badges.includes(y) - m.badges.includes(x)).map((c) => { const got = m.badges.includes(c); return `<div class="badge ${got ? 'got' : ''}" title="${esc(t('badge')[c][1])}">${badgeSvg(c, got)}<b>${esc(t('badge')[c][0])}</b><span>${esc(t('badge')[c][1])}</span></div>`; }).join('')}</div>`).join('')}`, false)}
  ${fold('history', t('hist_title'), '', `<p class="note first">${t('hist_hint')}</p>${historyBlock()}`, false)}
  ${fold('majlis', t('majlis_title'), m.majlis ? esc(pick(m.majlis.name, m.majlis.nameUr)) : '', majlisBox(), !m.majlis)}
  ${fold('points', t('points_title'), '', `<ul class="how">${t('points_list').map((x) => `<li>${x}</li>`).join('')}</ul>`, false)}`;
}

// the member's majlis: pick one, or propose a new one for an admin to approve
// the Majlis choice on the sign-up page: the list is fetched once (no sign-in needed), 'not listed' lets the member name a new one at once
function signupMajalisOptions() {
  if (!S.signupMajalis && !S.signupMajalisLoading) {
    S.signupMajalisLoading = true;
    api('/majalis-public').then((r) => { S.signupMajalis = r.majalis; }).catch(() => { S.signupMajalis = []; }).finally(() => { S.signupMajalisLoading = false; if (!S.me) draw(); });
  }
  const list = S.signupMajalis || [];
  return `<option value="">${t('majlis_choose')}</option>${list.map((m) => `<option value="${m.id}">${esc(pick(m.name, m.nameUr))}</option>`).join('')}<option value="__new">${t('majlis_new_opt')}</option>`;
}
function majlisBox() {
  const d = S.majalis;
  if (!d) { if (!S.majalisLoading) { S.majalisLoading = true; api('/majalis').then((r) => { S.majalis = r; }).catch(() => {}).finally(() => { S.majalisLoading = false; draw(); }); } return skel(); }
  return `<div class="padx"><p class="muted">${t('majlis_text')}</p>
    <div class="row"><select id="mj-pick" aria-label="${esc(t('majlis_title'))}"><option value="">${t('majlis_none')}</option>${d.majalis.map((x) => `<option value="${x.id}" ${d.mine?.id === x.id ? 'selected' : ''}>${esc(pick(x.name, x.nameUr))} (${fmt(x.members)})</option>`).join('')}</select>
    <button class="chip solid" data-act="majlisset">${t('majlis_save')}</button></div>
    <details class="pdetails"><summary>${t('majlis_propose')}</summary>
      <form novalidate data-form="majlisnew"><input name="name" type="text" maxlength="40" placeholder="${esc(t('majlis_propose_ph'))}" aria-label="${esc(t('majlis_propose_ph'))}" dir="auto">
      <input name="nameUr" type="text" maxlength="40" placeholder="${esc(t('majlis_propose_ur'))}" aria-label="${esc(t('majlis_propose_ur'))}" dir="rtl">
      <button class="chip solid" type="submit">${t('majlis_send')}</button></form></details></div>`;
}

// ---- Settings: profile, preferences, security, and leaving ------------------------------------------------------------------------
function settings() {
  const m = S.me;
  return `
  <div class="myhead"><div class="mybig">${av(m, 72, false)}</div><div class="myact">
    <label class="chip solid" tabindex="0">${t(m.avatar ? 'change_photo' : 'add_photo')}<input type="file" accept="image/*" data-avatar hidden></label>
    ${m.avatar ? `<button class="chip" data-act="rmavatar">${t('remove_photo')}</button>` : ''}
    <small class="muted">${t('photo_hint')}</small></div></div>
  <div class="uname">${esc(m.username)}</div>
  ${m.displayName ? `<div class="pname padx" dir="auto">${esc(m.displayName)}</div>` : ''}
  ${m.bio ? `<p class="pbio padx" dir="auto">${esc(m.bio)}</p>` : ''}
  <div class="muted"><bdi dir="ltr">${esc(m.email)}</bdi> · <bdi dir="ltr">${esc(m.phone)}</bdi></div>
  ${m.emailVerified ? '' : `<div class="notice">${t('email_unconfirmed')} <button class="linkbtn" data-act="resend">${t('resend')}</button></div>`}
  <h3>${t('appearance')}</h3>
  <label class="padx">${t('language')}</label>
  <div class="seg"><button class="${S.lang === 'en' ? 'on' : ''}" data-act="setlang" data-l="en">English</button><button class="${S.lang === 'ur' ? 'on' : ''}" data-act="setlang" data-l="ur">اردو</button></div>
  <div class="swlist">${['sound', 'vibrate'].map((k) => `<div class="swrow"><span id="sw-${k}">${t('feel_' + k)}</span><button class="sw" role="switch" aria-checked="${prefs[k] !== false}" aria-labelledby="sw-${k}" data-act="setfeel" data-k="${k}" data-v="${prefs[k] === false ? 1 : 0}"><i></i></button></div>`).join('')}</div>
  <div class="swlist"><div class="swrow"><span id="sw-hide">${t('wa_hide')}</span><button class="sw" role="switch" aria-checked="${!!m.hidePhone}" aria-labelledby="sw-hide" data-act="wahide" data-v="${m.hidePhone ? 0 : 1}"><i></i></button></div></div>
  <div class="hint padx">${t('wa_hide_hint')}</div>
  <label class="padx">${t('display')}</label>
  <div class="seg"><button class="${isDark() ? '' : 'on'}" data-act="setmode" data-m="light">${t('mode_light')}</button><button class="${isDark() ? 'on' : ''}" data-act="setmode" data-m="dark">${t('mode_dark_name')}</button></div>

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
    <label for="s-email">${t('email')} <span class="tag ${m.emailVerified ? 'verified' : ''}">${m.emailVerified ? t('email_ok') : '!'}</span></label>
    <input id="s-email" type="email" name="email" value="${esc(m.email)}" dir="ltr" required>
    <label for="s-pw">${t('pw_for_email')}</label>
    <input id="s-pw" type="password" name="password" autocomplete="current-password" dir="ltr">
    <button class="blk" type="submit"><span>${t('save')}</span><b class="ar">→</b></button>
  </form>
  ${fold('ssec', t('security_title'), '', `  <form novalidate data-form="password">
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
`, false)}
  <button class="blk out" data-act="logout" style="margin-top:12px"><span>${t('logout')}</span></button>
  <button class="linkbtn signoutall" data-act="logoutall">${t('logout_all')}</button>

  ${fold('sdel', t('delete_title'), '', `  <form novalidate data-form="delete">
    <p class="muted">${t('delete_text')}</p>
    <label for="d-pw">${t('password')}</label>
    <input id="d-pw" type="password" name="password" autocomplete="current-password" required dir="ltr">
    <button class="blk out danger" type="submit"><span>${t('delete_btn')}</span></button>
  </form>
`, false)}
  ${footerLinks()}`;
}
// a deadline input defaulting to a few days ahead (Pakistan time), never before today
const pkDay = (plus = 0) => new Date(serverNow() + 5 * 3600e3 + plus * 864e5).toISOString().slice(0, 10);

// ---- drawing + data loading -----------------------------------------------------
let liveAt = 0;
let lastBar = '';
async function loadLive() {
  if (Date.now() - liveAt < 60000) return;
  liveAt = Date.now();
  try { S.live = await api('/public'); if (!S.me) draw(); } catch { /* the welcome screen works without it */ }
}
// Every redraw rebuilds the page. So what the person typed, and where their cursor was, is carried over by name.
const fieldKey = (el) => `${el.closest('form')?.dataset.form || ''}|${el.name || el.id || (el.hasAttribute('data-city') ? 'city' : '') || el.dataset.rbox || ''}`;
const FIELDS = 'input[name]:not([type=file]):not([type=hidden]), textarea, input[data-city], input[data-rbox], #cv-rename, select[name]';
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
  if (ev.key === 'Escape' && S.drawer && !app.querySelector('.modal')) { S.drawer = false; draw(); ($('.burger')?.offsetParent ? $('.burger') : $('nav.tabs [data-act=drawer]'))?.focus(); return; }
  const m = app.querySelector('.modal');
  if (!m) return;
  if (ev.key === 'Escape') { m.querySelector('[data-act=celebrateX],[data-act=closeprofile],[data-act=sheetx]')?.click(); return; }
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
  if (S.lang === 'ur' && !I18N.ur) { loadUr().then(draw, () => { S.lang = 'en'; draw(); }); return; } // switching to Urdu: wait for its text (offline and never loaded: stay in English)
  applyLang();
  if (!S.me) loadLive();
  if (S.me) checkCelebrate();
  const keep = snapshotFields();
  document.body.classList.toggle('in-app', !!S.me);
  document.body.classList.toggle('side-hidden', !!S.sideHidden);
  document.body.classList.toggle('drawer-open', !!S.drawer && !!S.me);
  document.title = S.me ? `${t('nav_' + S.tab)} · ${t('app')}` : t('app');
  const barColor = S.me ? (isDark() ? '#1c1c1e' : '#f6f6f8') : '#0c0e2b';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', barColor); // the phone's bar matches the frosted header inside the app
  if (barColor !== lastBar) { // the Android app's status bar is native: tell it too (light bar, dark icons; dark bar, light icons)
    lastBar = barColor;
    const sb = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.StatusBar : null;
    sb?.setBackgroundColor({ color: barColor }).catch(() => {});
    sb?.setStyle({ style: barColor === '#f6f6f8' ? 'LIGHT' : 'DARK' }).catch(() => {});
  }
  app.innerHTML = S.me ? shell() : S.offline ? offlineView() : S.intro !== null ? introView() : authView();
  restoreFields(keep);
  enhanceModal();
  fitNumerals();
  if (S.rollFrom != null && S.me) { rollNumber($('#big'), S.rollFrom + S.pending, S.me.today + S.pending); S.rollFrom = null; }
  afterDraw();
  cacheMe();
}

// ---- motion after each render: bars grow from where they were, quests just finished pop, the streak flame jumps,
// earned points float up, and reaching the daily goal bursts. Memory is kept per bar so a redraw that changes nothing stays still.
const fxMem = { bars: new Map(), quests: null, streak: null };
function afterDraw() {
  if (!S.me) return;
  const still = reduceMotion();
  document.querySelectorAll('.bar > i').forEach((el, i) => {
    if (el.closest('#livebar, #pbar')) return; // these follow every tap / second themselves
    const k = `${S.tab}:${i}`, to = el.style.width, from = fxMem.bars.get(k);
    fxMem.bars.set(k, to);
    if (still || from === to) return;
    el.style.transition = 'none'; el.style.width = from ?? '0%';
    void el.offsetWidth; // start from the old width
    el.style.transition = ''; el.style.width = to;
  });
  const done = new Set(S.me.quests.filter((q) => q.done).map((q) => q.id));
  if (fxMem.quests && !still) for (const id of done) if (!fxMem.quests.has(id)) document.querySelector(`.q[data-q="${id}"]`)?.classList.add('justdone');
  fxMem.quests = done;
  if (fxMem.streak != null && S.me.streak > fxMem.streak && !still) document.querySelector('.stk')?.classList.add('bump');
  fxMem.streak = S.me.streak;
  const fx = S.fx; S.fx = null;
  if (!fx || still) return;
  const at = ($('#livebar') || $('.hadd') || app).getBoundingClientRect();
  if (fx.pts) {
    const el = document.createElement('div');
    el.className = 'floatpts'; el.innerHTML = `${N('+' + fmt(fx.pts))}${unit('pts')}`;
    el.style.left = `${at.left + at.width / 2}px`; el.style.top = `${at.top - 40}px`;
    document.body.append(el); setTimeout(() => el.remove(), 1600);
  }
  if (fx.goal) {
    sound('hundred'); haptic('hundred');
    const end = $('#livebar')?.getBoundingClientRect() || at, burst = document.createElement('div');
    burst.className = 'burst';
    burst.style.left = `${S.lang === 'ur' ? end.left : end.right}px`; burst.style.top = `${end.top + end.height / 2}px`;
    burst.innerHTML = Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2, r = 46 + (i % 3) * 14; return `<i style="--dx:${Math.cos(a) * r}px;--dy:${Math.sin(a) * r}px;--d:${(i % 4) * 40}ms"></i>`; }).join('');
    document.body.append(burst); setTimeout(() => burst.remove(), 1300);
  }
}

const boardUrl = (b) => (b.type === 'users' ? `/leaderboard?type=users&period=${b.period}`
  : b.type === 'league' ? '/league'
  : b.type === 'cities' || b.type === 'majalis' ? `/leaderboard?type=${b.type}&metric=${b.metric}`
  : b.metric === 'total' ? `/leaderboard?type=${b.type}&period=week` : `/leaderboard?type=${b.type}&metric=${b.metric}`);
async function loadFeed() { S.feed = await api('/feed'); S.feedSeen = S.feed.seenAt; }
const boardCache = new Map();
async function enterTab(tab) {
  if (tab === 'me') tab = 'progress'; // older links
  // the page you are on, scrolled down: glide back to the top, as iOS tab bars do (at the top, the tap reloads it)
  if (tab === S.tab && !S.drawer && window.scrollY > 40) { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; }
  S.tab = tab; S.drawer = false; S.enterAt = Date.now();
  // pages cross-fade and slide, where the browser can (Chrome and Android's WebView); otherwise they just change
  if (document.startViewTransition && !reduceMotion()) {
    const vt = document.startViewTransition(() => draw());
    vt.ready.catch(() => {}); vt.finished.catch(() => {}); // a quick second tap skips the first animation: expected, not an error
  } else draw();
  window.scrollTo(0, 0);
  try {
    if (tab === 'rank') { // the last copy of a board shows at once while a fresh one loads; a reply for a board no longer chosen is ignored
      const url = boardUrl(S.board);
      S.board.data = boardCache.get(url) || null; draw();
      const d = await api(url); boardCache.set(url, d);
      if (boardUrl(S.board) !== url) return;
      S.board.data = d;
    }
    if (tab === 'home') { await loadFeed(); return S.tab === 'home' && draw(); }
    if (tab === 'sunnah') {
      const more = api('/sunnah/mine').then((r) => { S.sunnahMine = r.posts; });
      if (!S.feed) { await loadFeed(); draw(); }
      await more.catch(() => {});
      return S.tab === tab && draw();
    }
    if (tab === 'caravan') S.cv = await api('/caravan');
    if (tab === 'progress') S.history = await api('/history');
    if (tab === 'feed') {
      if (!S.feed) draw(); // the feed already on screen stays while the newest loads
      await loadFeed();
      draw();
      await api('/news/seen', 'POST');
      S.me.unreadNews = 0;
      return draw();
    }
    if (S.tab === tab) draw();
  } catch (e) { toast(errText(e)); }
}
// pull down at the top of a page to refresh it, as in most phone apps
(() => {
  let y0 = null, dy = 0, ind = null;
  const reset = () => { y0 = null; dy = 0; if (ind) { ind.remove(); ind = null; } };
  addEventListener('touchstart', (e) => { if (S.me && !S.sheet && !S.drawer && scrollY <= 0 && e.touches.length === 1 && !e.target.closest('input, textarea, .trow, .tap, .seg')) y0 = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy < 8) return;
    if (!ind) { ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = uiIcon('refresh', 18, 2.2); document.body.append(ind); }
    const p = Math.min(1, dy / 80);
    ind.style.transform = `translate(-50%, ${Math.min(dy, 110) * 0.6}px) rotate(${p * 270}deg)`; ind.style.opacity = p;
    ind.classList.toggle('ready', p >= 1);
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 == null) return;
    const go = dy >= 80, el = ind; ind = null; y0 = null; dy = 0;
    if (!go) { el?.remove(); return; }
    el.classList.add('spin'); haptic('light');
    try { await refreshMe(); await enterTab(S.tab); } catch (e) { toast(errText(e)); }
    el.remove();
  });
  addEventListener('touchcancel', reset);
})();
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
        S.rollFrom = S.me.today; // the counter rolls up to the new number
        const goal = S.me.dailyGoal, hit = S.me.today < goal && res.me.today >= goal;
        S.me = res.me;
        S.fx = { pts: res.xpGained, goal: hit }; res.goalHit = hit;
        haptic('done'); sound('done');
        celebrate(res);
        if (outbox().length) setTimeout(flushOutbox, 0); // the connection is back: send what was kept offline too
        return true;
      } catch (e) {
        if (e.message === 'network' && attempt < 2 && !e.slow) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
        if (e.message === 'network') { queueLog(count, rid); return true; } // no signal, or one that hung: kept on the phone, sent later with the same id
        toast(errText(e));
        return false;
      }
    }
  } finally { busy = false; }
}

// ---- events ---------------------------------------------------------------------
app.addEventListener('click', async (ev) => {
  // a tap anywhere on a ranking row opens that member's profile, like tapping their photo (the photo stays the keyboard's button)
  const el = ev.target.closest('[data-act]') || ev.target.closest('.lb li')?.querySelector('.avbtn[data-act=profile]');
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
        if (e.message === 'network' && attempt < 2 && !e.slow) { await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1))); continue; }
        toast(errText(e)); el.disabled = false; return;
      }
    }
  }
  if (act === 'resend') { try { const r = await api('/email/resend', 'POST'); toast(t(r.sent === false ? 'email_off' : 'email_sent')); } catch (e) { toast(errText(e)); } return; }
  if (act === 'tab' || act === 'go') { haptic('tap'); return enterTab(el.dataset.tab); }
  if (act === 'drawer') {
    if (matchMedia('(min-width: 1024px)').matches) { S.sideHidden = !S.sideHidden; ls.set('side', S.sideHidden ? '0' : '1'); return draw(); } // wide screens: show or hide the sidebar
    S.drawer = !S.drawer; draw(); if (S.drawer) $('#side .sitem.on, #side .sitem')?.focus(); return;
  }
  if (act === 'drawerx') { S.drawer = false; return draw(); }
  if (act === 'addsheet') {
    S.drawer = false;
    if (S.tab === 'home' && $('#manual')) { $('#manual').scrollIntoView({ block: 'center', behavior: 'smooth' }); $('#manual').focus({ preventScroll: true }); return draw(); } // Today has the box already
    S.sheet = 'add'; draw(); $('#manual')?.focus(); return;
  }
  if (act === 'sheetx') { S.sheet = null; return draw(); }
  if (act === 'fold') { haptic('tap'); const k = el.dataset.k; S.folds[k] = el.getAttribute('aria-expanded') !== 'true'; ls.set('folds', JSON.stringify(S.folds)); return draw(); }
  if (act === 'logout') return logout(true);
  if (act === 'logoutall') {
    if (!confirm(t('logout_all_ask'))) return;
    try { const r = await api('/sessions/revoke', 'POST'); S.token = r.token; ls.set('token', r.token); toast(t('logout_all_done')); } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'retry') {
    el.disabled = true;
    try { await refreshMe(); S.offline = false; } catch (e) { if (e.message !== 'network') S.offline = false; }
    return draw();
  }
  if (act === 'allms') { S.allMs = true; return draw(); }
  if (act === 'celebrateX') { S.celebrate = null; return draw(); }
  if (act === 'shareCard') { el.disabled = true; await shareCard(); el.disabled = false; return; }

  if (act === 'tap' || act === 'padd') {
    S.pending += act === 'tap' ? 1 : Number(el.dataset.n);
    ls.set('pending', S.pending);
    liveHome();
    if (act === 'tap') {
      // a tasbih feel: a light tick on every count, a stronger one at each 33, and a chime at each 100
      const n = S.pending, kind = n % 100 === 0 ? 'hundred' : n % 33 === 0 ? 'round' : 'tap';
      haptic(kind); sound(kind);
      el.classList.remove('tapping'); void el.offsetWidth; el.classList.add('tapping');
      const pend = $('#pend'); if (pend) { pend.classList.remove('bump'); void pend.offsetWidth; pend.classList.add('bump'); }
      if (kind !== 'tap') el.classList.add(kind === 'hundred' ? 'glow100' : 'glow33'), setTimeout(() => el.classList.remove('glow33', 'glow100'), 700);
    }
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
  if (act === 'taptoggle') { S.tapOpen = !S.tapOpen; return draw(); }
  if (act === 'fill') { const f = $('#manual'); f.value = (Number(f.value) || 0) + Number(el.dataset.n); f.focus(); return; }
  if (act === 'manual') {
    const box = $('#manual'), n = Number(box.value);
    if (!Number.isInteger(n) || n < 1) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); haptic('light'); box.focus(); return; } // nothing to add yet
    if (await submitLog(n)) { S.sheet = null; draw(); } // the + sheet closes once the number is saved
    return;
  }

  if (act === 'board') {
    if (el.dataset.type) S.board.type = el.dataset.type;
    if (el.dataset.period) S.board.period = el.dataset.period;
    if (el.dataset.metric) S.board.metric = el.dataset.metric;
    return enterTab('rank');
  }
  if (act === 'cheer') {
    el.disabled = true; el.classList.add('on', 'pop'); haptic('light');
    try {
      const r = await api('/cheer', 'POST', { id: Number(el.dataset.id) });
      const item = S.feed?.items.find((x) => x.type === 'milestone' && x.id === Number(el.dataset.id));
      if (item) Object.assign(item, r);
      draw();
    } catch (e) { el.disabled = false; el.classList.remove('on'); toast(errText(e)); }
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
      await loadFeed(); return draw();
    } catch (e) { toast(errText(e)); if (e.message === 'bad_image' || e.message === 'duplicate_image') S.draft = null; return draw(); }
  }
  if (act === 'profile') {
    const ref = el.dataset.ref; // a ranking row shows a made-up name; its ref opens the real profile
    S.profile = { username: el.dataset.u, data: null }; draw();
    try { S.profile.data = await api(ref ? `/members/ref/${encodeURIComponent(ref)}` : `/members/${encodeURIComponent(el.dataset.u)}`); if (ref) S.profile.username = S.profile.data.username; } catch (e) { S.profile = null; toast(errText(e)); }
    return draw();
  }
  if (act === 'wachat') {
    try { const r = await api(`/wa/${encodeURIComponent(el.dataset.u)}`); window.open(r.url, '_blank', 'noopener'); } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'wahide') {
    const v = el.dataset.v === '1';
    try { S.me = await api('/me', 'PATCH', { hidePhone: v }); toast(t(v ? 'wa_hidden' : 'saved')); } catch (e) { toast(errText(e)); }
    return draw();
  }
  if (act === 'closeprofile') { S.profile = null; return draw(); }
  if (act === 'rmavatar') { try { S.me = await api('/me/avatar', 'DELETE'); toast(t('saved')); } catch (e) { toast(errText(e)); } return draw(); }
  if (act.startsWith('cv')) {
    if (act === 'cvall') { S.cvAll = true; return draw(); }
    if (act === 'cvremove') {
      if (!confirm(t('cv_remove_ask')(el.dataset.u))) return;
      try { const r = await api('/caravan/remove', 'POST', { username: el.dataset.u }); if (r.view) S.cv = r.view; } catch (e) { toast(errText(e)); }
      return draw();
    }
  }
  if (act === 'majlisset') {
    try { const r = await api('/me/majlis', 'PUT', { id: $('#mj-pick').value || null }); S.me = r.me; S.majalis = { majalis: r.majalis, mine: r.mine, proposal: r.proposal }; toast(t('saved')); draw(); } catch (e) { toast(errText(e)); }
    return;
  }
  if (act === 'setfeel') { setPref(el.dataset.k, el.dataset.v === '1'); if (el.dataset.v === '1') { haptic('round'); sound('round'); } return draw(); }
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
    haptic('light');
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
});

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
      // checked top to bottom, so the message is about the first field that needs attention
      const missing = [['invite', 'invite_required'], ['username', 'bad_username'], ['email', 'bad_email'], ['phone', 'bad_phone'], ['cityId', 'city_required'], ['majlisSel', 'majlis_required'], ['password', 'bad_password']]
        .find(([k]) => !String(f[k] || '').trim() || (k === 'password' && f[k].length < 6));
      if (missing) throw new Error(missing[1]);
      const isNew = f.majlisSel === '__new';
      if (isNew && !String(f.newMajlisName || '').trim()) throw new Error('bad_majlis');
      const r = await api('/register', 'POST', { ...f, invite: (f.invite || '').trim(), lang: S.lang,
        ...(isNew ? { newMajlis: { name: f.newMajlisName, nameUr: f.newMajlisUr } } : { majlisId: Number(f.majlisSel) }) });
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
      S.me = await api('/me', 'PATCH', { dailyGoal: Number(f.dailyGoal), ...(f.cityId ? { cityId: Number(f.cityId) } : {}), email: f.email, ...(f.password ? { password: f.password } : {}) });
      toast(t('saved'));
      draw();
    } else if (kind === 'citysave') {
      if (!f.cityId) throw new Error('city_required');
      S.me = await api('/me', 'PATCH', { cityId: Number(f.cityId) });
      toast(t('saved')); draw();
    } else if (kind === 'majlisnew') {
      S.majalis = await api('/majalis', 'POST', { name: f.name, nameUr: f.nameUr });
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
    } else if (kind === 'cvrename') {
      S.cv = (await api('/caravan/name', 'PUT', { name: f.name })).view; toast(t('saved')); draw();
    } else if (kind === 'cvdisplay') {
      S.cv = (await api('/caravan/display-name', 'PUT', { displayName: f.displayName })).view; toast(t('saved')); draw();
    } else if (kind === 'delete') {
      if (!confirm(t('delete_confirm'))) { btn.disabled = false; return; }
      await api('/me', 'DELETE', { password: f.password });
      logout(false); S.authMode = 'login'; draw(); toast(t('deleted'));
    }
  } catch (e) {
    if (['settings', 'delete', 'citysave', 'profile', 'password', 'phone', 'cvrename', 'cvdisplay', 'majlisnew'].includes(kind)) { toast(errText(e)); btn.disabled = false; }
    else {
      S.error = errText(e); draw();
      // point at the field the message is about
      const FIELD = { invite_required: 'invite', bad_invite: 'invite', invite_revoked: 'invite', invite_used: 'invite', caravan_full: 'invite',
        bad_username: 'username', username_taken: 'username', bad_email: 'email', bad_phone: 'phone', account_exists: 'email', city_required: 'city', bad_password: 'password' };
      const name = FIELD[e.message], el = name && app.querySelector(`form[data-form="${kind}"] ${name === 'city' ? '[data-city]' : `[name="${name}"]`}`);
      if (el) { el.setAttribute('aria-invalid', 'true'); el.classList.add('shake'); el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); el.focus({ preventScroll: true }); }
    }
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
  if (ev.target.id === 'f-mjsel') { const box = $('#mjnew'); if (box) box.hidden = ev.target.value !== '__new'; return; }
  const pic = ev.target.closest('input[data-avatar]');
  if (pic && pic.files[0]) {
    try { S.me = await api('/me/avatar', 'POST', { image: await toAvatarDataUrl(pic.files[0]) }); toast(t('saved')); } catch (e) { toast(e.message === 'bad_image' ? (I18N[S.lang] || I18N.en).err.bad_image : errText(e)); }
    return draw();
  }
  const el = ev.target.closest('input[data-photo]');
  if (!el || !el.files[0]) return;
  try { S.draft = await toJpegDataUrl(el.files[0]); S.draftKind = el.dataset.photo; draw(); } catch (e) { toast((I18N[S.lang] || I18N.en).err.bad_image); }
});

// the suggestion list works from the keyboard: arrows move, Enter picks, Escape closes
app.addEventListener('keydown', (ev) => {
  // the keyboard's Enter / Go adds the durood typed in, and saves (or Escape cancels) a history edit
  if (ev.key === 'Enter' && ev.target.id === 'manual') { ev.preventDefault(); ev.target.closest('.numbox')?.querySelector('[data-act=manual]')?.click(); return; }
  if (ev.target.id === 'editval' && (ev.key === 'Enter' || ev.key === 'Escape')) { ev.preventDefault(); $(ev.key === 'Enter' ? '[data-act=editsave]' : '[data-act=editx]')?.click(); return; }
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
  const cn = ev.target.closest('#cv-rename');
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
    } else if (el.dataset.check === 'cvname') {
      const out = $('#cvcheck');
      if (!v) { out.className = 'hint'; out.textContent = t('leader_name_hint'); return; }
      try {
        const r = await api(`/username-check?u=${encodeURIComponent(v)}`);
        out.className = 'hint ' + (r.ok ? 'ok' : 'bad');
        out.textContent = r.ok ? `✓ ${t('ok_free')}` : r.reason ? t('err').bad_caravan_name : t('err').caravan_name_taken;
      } catch { /* the server checks again at sign-up */ }
    } else {
      const out = $('#rcheck');
      if (!v) { out.className = 'hint'; out.textContent = t('invite_hint'); const lc = $('#lcv'); if (lc) lc.hidden = true; return; }
      try {
        const r = await api(`/invite-check?code=${encodeURIComponent(v)}`);
        if ($('#f-invite')?.value.trim() !== v) return; // typed on since: a newer check is coming
        out.className = 'hint ' + (r.valid ? 'ok' : 'bad');
        const lead = r.valid && r.kind === 'leader'; // a leader code: the person starts their own caravan and names it
        const lc = $('#lcv'); if (lc) lc.hidden = !lead;
        out.innerHTML = lead ? `${t('leader_ok')} ✓` : r.valid ? `${t('joining')} <bdi>${esc(r.displayName || r.caravan || r.from)}</bdi> ✓` : esc(t('err')[r.reason] || t('err').bad_invite);
      } catch { /* ignore */ }
    }
  }, 350);
});

// ---- no signal: durood added offline waits on the phone (with its request id) and is sent once the connection is back -------------
// The id makes every resend count once. The last copy of the member's own data is kept so the app opens without a connection.
const outbox = () => { try { return JSON.parse(ls.get('outbox') || '[]'); } catch { return []; } };
const setOutbox = (list) => (list.length ? ls.set('outbox', JSON.stringify(list)) : ls.del('outbox'));
function queueLog(count, rid) {
  setOutbox([...outbox(), { count, rid, uid: S.me.id, at: Date.now() }]);
  S.rollFrom = S.me.today;
  S.me = { ...S.me, today: S.me.today + count, total: S.me.total + count, week: S.me.week + count }; // shown now, confirmed when sent
  S.offlineMode = true; haptic('done'); toast(t('queued')(fmt(count)));
}
let flushing = false;
async function flushOutbox() {
  const list = outbox();
  if (flushing || !list.length || !S.me) return;
  flushing = true;
  let sent = 0;
  try {
    for (const item of list) {
      if (item.uid !== S.me.id) { setOutbox(outbox().filter((x) => x.rid !== item.rid)); continue; } // another account's, from before a sign-out
      try {
        const res = await api('/log', 'POST', { count: item.count, rid: item.rid });
        S.me = res.me; sent += res.added || 0;
      } catch (e) {
        if (e.message === 'network') return; // still no signal: try again later
        toast(errText(e)); // refused (e.g. the daily limit): dropped, the member is told
      }
      setOutbox(outbox().filter((x) => x.rid !== item.rid));
    }
    S.offlineMode = false;
    if (sent) toast(t('queued_sent')(fmt(sent)));
  } finally { flushing = false; if (S.me) draw(); }
}
setInterval(() => { if (outbox().length && navigator.onLine !== false) flushOutbox(); }, 20_000);
let cachedMe = null;
function cacheMe() { if (S.me && S.me !== cachedMe) { cachedMe = S.me; ls.set('meCache', JSON.stringify(S.me)); } }

// iOS-style large title: the small title in the header appears once the big one has scrolled away
addEventListener('scroll', () => document.body.classList.toggle('scrolled', scrollY > 40), { passive: true });

// ---- boot -----------------------------------------------------------------------
window.addEventListener('online', () => {
  if (S.offline || S.offlineMode) refreshMe().then(() => { S.offline = false; S.offlineMode = false; draw(); flushOutbox(); }).catch(() => {});
  else flushOutbox();
});
window.addEventListener('offline', () => { if (S.me) { S.offlineMode = true; draw(); } });
async function boot() {
  applyLang();
  if (S.ref) api(`/invite-check?code=${encodeURIComponent(S.ref)}`).then((r) => { if (r.valid && (r.displayName || r.caravan)) { S.refName = r.displayName || r.caravan; if (!S.me) draw(); } }).catch(() => {});
  api('/config').then((c) => { if (c.signupsOpen === false) { S.signupsOpen = false; if (!S.me) draw(); } }).catch(() => {});
  if (S.resetToken) logout(false); // a reset link always starts from signed-out
  if (S.token) {
    try { await refreshMe(); } catch (e) {
      // a bad token logs out inside api(); with no connection the app opens on the member's last known numbers, if this phone has them
      if (e.message === 'network') { try { S.me = JSON.parse(ls.get('meCache')); } catch { S.me = null; } if (S.me) S.offlineMode = true; else S.offline = true; }
    }
  }
  draw();
  if (!S.offlineMode) flushOutbox();
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
    if (S.drawer) { S.drawer = false; return draw(); }
    if (S.sheet) { S.sheet = null; return draw(); }
    if (S.profile) { S.profile = null; return draw(); }
    if (S.editing) { S.editing = null; return draw(); }
    if (S.token && S.tab !== 'home') return enterTab('home');
    nativeApp.exitApp();
  });
}
boot();
