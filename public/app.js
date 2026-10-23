import { I18N } from './i18n.js';
import { uiIcon, badgeSvg } from './icons.js';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const params = new URLSearchParams(location.search);
if (params.get('ref')) ls.set('ref', params.get('ref').trim());

const S = {
  token: ls.get('token'),
  me: null,
  lang: ls.get('lang') || 'ur',
  tab: 'home',
  authMode: params.get('ref') ? 'register' : 'login',
  ref: ls.get('ref') || '',
  refName: null,
  pending: Number(ls.get('pending')) || 0,
  board: { type: 'users', period: 'week', data: null },
  team: null,
  learn: null,
  player: null,
  sunnah: null,
  draft: null,
  error: '',
};

const MILESTONES = [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000];

const t = (k) => I18N[S.lang][k] ?? I18N.en[k] ?? k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
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
  S.tab = 'home'; S.team = S.learn = S.board.data = null;
  if (render) draw();
}

// ---- reward feedback --------------------------------------------------------
function celebrate(res) {
  const bits = [];
  if (res.xpGained) bits.push(t('gained')(res.xpGained));
  if (res.levelUp) bits.push(t('level_up')(res.levelUp));
  for (const b of res.newBadges || []) bits.push(`${t('new_badge')} ${t('badge')[b][0]}`);
  if (bits.length) toast(bits.join(' · '), (res.newBadges || [])[0]);
  if (res.levelUp || res.newBadges?.length) navigator.vibrate?.([60, 40, 60]);
}

// ---- views (Swiss style: type, hairline rules, flat colour) --------------------------
const NAV_GLYPH = { home: 'home', rank: 'bars', caravan: 'caravan', bonus: 'star', me: 'me' };
const navIcon = (k) => uiIcon(NAV_GLYPH[k], 22, 1.7);

const ICON_SUN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const isDark = () => document.documentElement.getAttribute('data-mode') === 'dark';

// white / dark choice: the button shows the mode you would switch to
function langToggle() {
  return `<span class="row"><button class="pill icon" data-act="scheme" aria-label="${t(isDark() ? 'mode_white' : 'mode_dark')}" title="${t(isDark() ? 'mode_white' : 'mode_dark')}">${isDark() ? ICON_SUN : ICON_MOON}</button><button class="pill" data-act="lang">${S.lang === 'ur' ? 'English' : 'اردو'}</button></span>`;
}

function authView() {
  const reg = S.authMode === 'register';
  return `
  <div class="hd"><span>${t('app')}</span>${langToggle()}</div>
  <div class="wrap">
    <div class="intro"><div class="arabic">${t('durood')}</div><p>${t('tagline')}</p></div>
    <div class="seg">
      <button class="${!reg ? 'on' : ''}" data-act="mode" data-mode="login">${t('login')}</button>
      <button class="${reg ? 'on' : ''}" data-act="mode" data-mode="register">${t('register')}</button>
    </div>
    <form class="sec" data-form="${reg ? 'register' : 'login'}" autocomplete="on">
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}
      ${reg ? `
        <label>${t('username')}</label>
        <input type="text" name="username" data-check="username" autocapitalize="none" autocomplete="username" maxlength="20" required dir="ltr">
        <div class="hint" id="ucheck">${t('username_hint')}</div>
        <label>${t('email')}</label>
        <input type="email" name="email" autocomplete="email" required dir="ltr">
        <label>${t('phone')}</label>
        <input type="tel" name="phone" autocomplete="tel" required dir="ltr">
        <div class="hint">${t('phone_hint')}</div>
        <label>${t('city')}</label>
        <input type="text" name="city" maxlength="40">
        <label>${t('password')}</label>
        <input type="password" name="password" autocomplete="new-password" minlength="6" required dir="ltr">
        <label>${t('referral')}</label>
        <input type="text" name="referral" value="${esc(S.ref)}" autocapitalize="none" data-check="referral" dir="ltr">
        <div class="hint" id="rcheck">${S.refName ? `${t('invited_by')} <b>${esc(S.refName)}</b> ✓` : t('no_referral')}</div>
      ` : `
        <label>${t('id_label')}</label>
        <input type="text" name="id" autocapitalize="none" autocomplete="username" required dir="ltr">
        <label>${t('password')}</label>
        <input type="password" name="password" autocomplete="current-password" required dir="ltr">
      `}
      <button class="blk" type="submit"><span>${reg ? t('register') : t('login')}</span><b>→</b></button>
    </form>
    <p class="note">${t('dedication')}</p>
  </div>`;
}

function shell() {
  const tabs = ['home', 'rank', 'caravan', 'bonus', 'me'];
  return `
  <div class="hd"><span>${t('app')}</span><span class="row"><span class="stk">${uiIcon('flame', 16, 1.8)} ${S.me.streak} ${t('streak')}</span>${langToggle()}</span></div>
  <div class="wrap">${view()}</div>
  <nav class="tabs">${tabs.map((k) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${navIcon(k)}<em>${t('nav_' + k)}</em></button>`).join('')}</nav>
  ${S.player ? playerModal() : ''}`;
}

function view() {
  return { home, bonus, rank, caravan, me }[S.tab]();
}

const bar = (pct) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

function home() {
  const m = S.me;
  const title = t('titles')[Math.min(m.level - 1, 9)];
  const natPct = (m.pub.total / m.pub.target) * 100;
  const live = m.today + S.pending;
  return `
  <div class="band arabic">${t('durood')}</div>
  <div class="sub"><span>${t('today')}</span><span>${t('goal_word')} ${N(fmt(m.dailyGoal))}</span></div>
  <div class="big ${bigClass(live)}" id="big">${fmt(live)}</div>
  <div id="livebar">${bar((live / m.dailyGoal) * 100)}</div>

  <button class="tap blk" data-act="tap"><span class="lab">${uiIcon('tap', 26, 1.9)} ${t('tap_hint')}</span><b>${N('+1')}</b></button>
  <div class="pendrow">
    <span><b id="pend">${fmt(S.pending)}</b> ${t('pending')}</span>
    <span class="quick">${[10, 33, 100].map((n) => `<button class="chip" data-act="padd" data-n="${n}">${N('+' + n)}</button>`).join('')}<button class="chip" data-act="preset">${t('reset')}</button></span>
  </div>
  <button class="blk go" data-act="submitp" id="submitp" ${S.pending ? '' : 'disabled'}><span>${t('submit_pending')}</span><b>→</b></button>
  <div class="manual"><label for="manual">${t('or_enter')}</label>
    <div class="row"><input type="number" id="manual" inputmode="numeric" min="1" placeholder="${t('count_ph')}" dir="ltr"><button class="chip solid" data-act="manual">${t('add')}</button></div></div>

  <div class="stats">
    <div><b>${fmt(m.week)}</b><span>${t('week')}</span></div>
    <div><b>${fmt(m.total)}</b><span>${t('total')}</span></div>
    <div><b>${m.level}</b><span>${esc(title)}</span></div>
  </div>
  <div class="lvl"><div class="row between"><span>${uiIcon('bolt', 14, 1.9)} ${t('level')} ${m.level} · ${N(`${fmt(m.xp)} / ${fmt(m.next)}`)} ${t('xp')}</span><span title="${esc(t('shield_hint'))}">${uiIcon('shield', 14, 1.9)} ${m.shields}</span></div>${bar(m.pct)}</div>

  <h3>${t('durood_quests')}</h3>
  ${m.quests.filter((q) => q.group === 'durood').map((q) => quest(q)).join('')}

  <h3 class="row between"><span>${t('bonus_quests')}</span><button class="chip" data-act="tab" data-tab="bonus">${t('see_bonus')}</button></h3>
  ${m.quests.filter((q) => q.group === 'bonus').map((q) => quest(q, true)).join('')}

  <h3>${t('caravan_title')}</h3>
  <button class="rowlink" data-act="tab" data-tab="caravan"><span>${fmt(m.team.members)} ${t('members')}</span><b>${fmt(m.team.total)}</b></button>

  <h3>${t('national')}</h3>
  <div class="row between"><b>${fmt(m.pub.total)}</b><span class="muted">${t('of')} ${N(fmt(m.pub.target))}</span></div>
  ${bar(natPct)}
  <p class="note">${fmt(m.pub.members)} ${t('members')} · ${t('self_reported')} · ${new Date(m.pub.asOf).toLocaleTimeString(S.lang === 'ur' ? 'ur-PK' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
  <p class="note">${t('reminder_note')}</p>`;
}

// keep the big number and its bar in step with taps without redrawing the screen
// the headline numeral shrinks with the number of characters so large counts never clip
const bigClass = (n) => { const c = fmt(n).length; return c <= 3 ? '' : c <= 5 ? 'l5' : c === 6 ? 'l6' : 'l7'; };
function liveHome() {
  const m = S.me, live = m.today + S.pending;
  $('#big').textContent = fmt(live);
  $('#big').className = `big ${bigClass(live)}`;
  $('#livebar').innerHTML = bar((live / m.dailyGoal) * 100);
  $('#pend').textContent = fmt(S.pending);
  $('#submitp').disabled = !S.pending;
}

function quest(q, dim) {
  return `<div class="q ${q.done ? 'd' : ''} ${dim ? 'dim' : ''}">
    <span class="bx"></span>
    <span class="t">${t('q_' + q.id)} <em>${t(q.period === 'day' ? 'daily' : 'weekly')}</em><small>${N(`${fmt(q.cur)} / ${fmt(q.goal)}`)}</small></span>
    <b class="p">${N('+' + q.xp)}</b>
  </div>`;
}

// secondary (sunnah) and tertiary (seerah) activities share one tab, in that order
function bonus() {
  return `<p class="note first">${t('bonus_hint')}</p>
    <h2 class="part"><i>01</i>${uiIcon('leaf', 24, 1.8)}${t('sunnah_heading')}</h2>${sunnah()}
    <h2 class="part"><i>02</i>${uiIcon('book', 24, 1.8)}${t('seerah_heading')}</h2>${learn()}`;
}

function sunnah() {
  const d = S.sunnah;
  if (!d) return '<p class="muted center">…</p>';
  const pick = (en, ur) => (S.lang === 'ur' && ur) || en;
  const sn = d.today.sunnah, mine = d.today.mine, r = d.today.rules;
  const statusTag = (st) => `<span class="tag ${st}">${t('st_' + st)}</span>`;
  let action = '';
  if (!sn) action = `<p class="muted">${t('no_sunnah')}</p>`;
  else if (mine) action = `<div class="row between"><b>${t('your_post')}</b>${statusTag(mine.status)}</div>
      <img class="shot" src="${esc(mine.photoUrl)}" alt="">
      <div class="muted">${N(`${mine.confirms}/${r.confirmsNeeded}`)} ${t('confirms_so_far')}</div>`;
  else if (S.draft) action = `<b>${t('photo_preview')}</b><img class="shot" src="${esc(S.draft)}" alt="">
      <div class="row"><button class="blk" style="flex:1" data-act="postit" id="postit"><span>${t('post_it')}</span><b>→</b></button><button class="chip" data-act="draftx">${t('cancel')}</button></div>`;
  else action = `<label class="blk upload"><span class="lab">${uiIcon('camera', 24, 1.8)} ${t('take_photo')}</span><b>+</b>
      <input type="file" accept="image/*" capture="environment" data-photo hidden></label>`;
  return `
  <div class="sec">
    <h3>${t('sunnah_title')}</h3>
    ${sn ? `<div class="head">${esc(pick(sn.titleEn, sn.titleUr))}</div><p>${esc(pick(sn.descEn, sn.descUr))}</p>${sn.source ? `<div class="muted">${t('source')}: ${esc(sn.source)}</div>` : ''}` : ''}
    <div class="spacer"></div>${action}
    ${sn && !mine ? `<p class="note">${t('photo_rules')}</p>` : ''}
    ${sn ? `<p class="note">${t('post_how')(r.confirmsNeeded, r.sunnahXp, r.verifyXp)}</p>` : ''}
  </div>
  <div class="sec">
    <h3>${uiIcon('lens', 14, 2)} ${t('review_title')}</h3>
    <p class="muted">${t('review_hint')}</p>
    ${d.feed.length ? d.feed.map((p) => `
      <div class="review" data-post="${p.id}">
        <div class="muted">${esc(pick(p.titleEn, p.titleUr))}</div>
        <img class="shot" loading="lazy" src="${esc(p.photoUrl)}" alt="">
        <div class="row"><button class="blk fill1" data-act="vote" data-id="${p.id}" data-v="confirm"><span>${t('confirm')}</span></button>
          <button class="blk out fill1" data-act="vote" data-id="${p.id}" data-v="reject"><span>${t('reject')}</span></button></div>
        <button class="chip" style="margin-top:8px" data-act="report" data-id="${p.id}">${t('report_btn')}</button>
      </div>`).join('') : `<p class="muted center">${t('no_feed')}</p>`}
  </div>
  <div class="sec">
    <h3>${t('history')}</h3>
    <div class="stats flat"><div><b>${fmt(S.me.sunnah.verified)}</b><span>${t('sunnahs_verified')}</span></div><div><b>${fmt(S.me.sunnah.reviews)}</b><span>${t('reviews_done')}</span></div></div>
    ${d.mine.map((p) => `<div class="q"><span class="t">${esc(pick(p.titleEn, p.titleUr))}<small>${esc(p.day)}</small></span>${statusTag(p.status)}</div>`).join('')}
  </div>`;
}

function rank() {
  const b = S.board;
  const rows = b.data?.rows;
  const list = !rows ? '<p class="muted center">…</p>' : rows.length ? `<ul class="lb">${rows.map((r) => `
    <li class="${r.me ? 'me' : ''}"><span class="rank">${r.rank}</span>
      <span class="name">${esc(r.username)}${r.me ? ` <em class="tag">${t('you')}</em>` : ''}${r.city ? `<small>${esc(r.city)}${r.members ? ` · ${fmt(r.members)} ${t('members')}` : ''}</small>` : r.members ? `<small>${fmt(r.members)} ${t('members')}</small>` : ''}</span>
      <span class="score">${fmt(r.score)}</span></li>`).join('')}</ul>` : `<p class="muted center">${t('empty_board')}</p>`;
  return `
  <div class="seg">
    <button class="${b.type === 'users' ? 'on' : ''}" data-act="board" data-type="users">${t('users')}</button>
    <button class="${b.type === 'teams' ? 'on' : ''}" data-act="board" data-type="teams">${t('teams')}</button>
  </div>
  <div class="seg thin">
    <button class="${b.period === 'week' ? 'on' : ''}" data-act="board" data-period="week">${t('this_week')}</button>
    <button class="${b.period === 'all' ? 'on' : ''}" data-act="board" data-period="all">${t('all_time')}</button>
  </div>
  ${list}
  <p class="note">${t('self_reported')}</p>
  <p class="note">${t('reminder_note')}</p>`;
}

function caravan() {
  const m = S.me, tm = S.team;
  const link = `${location.origin}/?ref=${m.username}`;
  const down = m.team.total - m.total;
  const next = MILESTONES.find((x) => x > down) || MILESTONES.at(-1);
  const prev = MILESTONES.filter((x) => x <= down).at(-1) || 0;
  return `
  <h3 class="first">${t('your_code')}</h3>
  <div class="code">${esc(m.username)}</div>
  <div class="muted" style="margin-top:12px">${t('your_link')}</div>
  <div class="link">${esc(link)}</div>
  <div class="row" style="margin-top:12px"><button class="blk wa fill1" data-act="wa"><span class="lab">${uiIcon('share', 22, 1.8)} ${t('share_wa')}</span><b>→</b></button><button class="chip" data-act="copy" data-text="${esc(link)}">${t('copy')}</button></div>

  <h3>${t('caravan_title')}</h3>
  <p class="muted">${t('caravan_sub')}</p>
  <div class="stats"><div><b>${fmt(m.team.members)}</b><span>${t('c_members')}</span></div><div><b>${fmt(m.team.total)}</b><span>${t('c_total')}</span></div><div><b>${tm ? fmt(tm.week) : '…'}</b><span>${t('c_week')}</span></div></div>
  <div class="lvl"><div class="row between"><span>${t('next_milestone')}</span><b>${fmt(next)}</b></div>${bar(((down - prev) / (next - prev)) * 100)}</div>

  <h3>${t('direct_list')} (${fmt(m.team.direct)})</h3>
  ${!tm ? '…' : tm.direct.length ? `<ul class="lb">${tm.direct.map((d) => `
    <li><span class="name">${esc(d.username)}<small>${d.members ? `${fmt(d.members)} ${t('members')} · ` : ''}${d.total == null ? t('hidden') : fmt(d.total)}</small></span><span class="score">${fmt(d.team)}</span></li>`).join('')}</ul>` : `<p class="muted">${t('none_yet')}</p>`}
  ${tm?.byDepth?.length ? `<p class="note">${tm.byDepth.map((d) => `${t('levels_deep')} ${d.depth}: ${fmt(d.n)}`).join(' · ')}</p>` : ''}`;
}

function learn() {
  const l = S.learn;
  const title = (x) => (S.lang === 'ur' && x.titleUr) || x.titleEn;
  return `
  <div class="sec">
    <h3>${t('circle_title')}</h3>
    <p class="muted">${t('circle_text')}</p>
    ${l?.circleUrl ? `<div class="row wrapx"><a class="blk fill1" href="${esc(l.circleUrl)}" target="_blank" rel="noopener"><span>${t('circle_open')}</span><b>↗</b></a>
      ${S.me.badges.includes('circle') ? '<b class="ok">✓</b>' : `<button class="chip" data-act="circle">${t('circle_claim')} ${N('+' + fmt(l.circleXp))}</button>`}</div>` : `<p class="muted">${t('circle_none')}</p>`}
  </div>
  <div class="sec">
    <h3>${t('lectures')}</h3>
    ${!l ? '…' : l.lectures.length ? l.lectures.map((x) => `
      <div class="q ${x.done ? 'd' : ''}"><span class="bx"></span>
        <span class="t">${esc(title(x))}<small>${esc(x.speaker)}</small></span>
        <button class="chip ${x.done ? '' : 'solid'}" data-act="watch" data-id="${x.id}">${x.done ? t('watched') : `${uiIcon('play', 13, 2)} ${t('watch')} ${N('+' + x.xp)}`}</button>
      </div>`).join('') : `<p class="muted">${t('no_lectures')}</p>`}
  </div>`;
}

function me() {
  const m = S.me;
  const codes = Object.keys(I18N.en.badge).sort((x, y) => m.badges.includes(y) - m.badges.includes(x)); // earned first, then the usual order
  return `
  <div class="uname">${esc(m.username)}</div>
  <div class="muted" dir="ltr">${esc(m.email)} · ${esc(m.phone)}</div>
  <div class="stats"><div><b>${m.level}</b><span>${t('level')}</span></div><div><b>${fmt(m.total)}</b><span>${t('total')}</span></div><div><b>${m.bestStreak}</b><span>${t('best_streak')}</span></div></div>

  <h3>${t('badges')}</h3>
  <div class="badges">${codes.map((c) => { const got = m.badges.includes(c); return `<div class="badge ${got ? 'got' : ''}" title="${esc(t('badge')[c][1])}">${badgeSvg(c, got)}<b>${esc(t('badge')[c][0])}</b><span>${esc(t('badge')[c][1])}</span></div>`; }).join('')}</div>

  <h3>${t('settings')}</h3>
  <form data-form="settings">
    <label>${t('daily_goal')}</label>
    <input type="number" name="dailyGoal" min="1" max="100000" value="${m.dailyGoal}" dir="ltr">
    <label>${t('city')}</label>
    <input type="text" name="city" maxlength="40" value="${esc(m.city)}">
    <label class="check"><input type="checkbox" name="isPublic" ${m.isPublic ? 'checked' : ''}> ${t('public_toggle')}</label>
    <div class="hint">${t('public_hint')}</div>
    <button class="blk" type="submit"><span>${t('save')}</span><b>→</b></button>
  </form>
  <button class="blk out" data-act="logout" style="margin-top:12px"><span>${t('logout')}</span></button>`;
}

function playerModal() {
  const p = S.player, x = p.lecture;
  const left = Math.max(0, x.minSeconds - p.elapsed);
  return `<div class="modal"><div class="box">
    <iframe src="https://www.youtube-nocookie.com/embed/${esc(x.youtubeId)}?rel=0&playsinline=1" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen title="lecture"></iframe>
    <div class="spacer"></div>
    <div class="muted" id="ptimer">${left ? `${t('watching')} +${x.xp} · ${t('min_left')(left)}` : ''}</div>
    ${bar((p.elapsed / x.minSeconds) * 100).replace('class="bar"', 'class="bar" id="pbar"')}
    <div class="spacer"></div>
    <div class="row"><button class="blk fill1" id="pclaim" data-act="pclaim" ${left ? 'disabled' : ''}><span>${t('can_claim')}</span></button>
    <button class="chip" data-act="pclose">${t('close')}</button></div>
  </div></div>`;
}

// ---- drawing + data loading -----------------------------------------------------
function draw() {
  applyLang();
  app.innerHTML = S.me ? shell() : authView();
}

async function enterTab(tab) {
  S.tab = tab;
  draw();
  try {
    if (tab === 'rank') { S.board.data = null; draw(); S.board.data = await api(`/leaderboard?type=${S.board.type}&period=${S.board.period}`); }
    if (tab === 'caravan') { S.team = await api('/team'); }
    if (tab === 'bonus') {
      const [today, feed, mineList, lectures] = await Promise.all([api('/sunnah/today'), api('/feed'), api('/sunnah/mine'), api('/lectures'), refreshMe()]); // refreshMe: payouts happen when *others* review
      S.sunnah = { today, feed: feed.posts, mine: mineList.posts };
      S.learn = lectures;
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
  if (act === 'mode') { S.authMode = el.dataset.mode; S.error = ''; return draw(); }
  if (act === 'tab') return enterTab(el.dataset.tab);
  if (act === 'logout') return logout();

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
  if (act === 'manual') {
    const n = Number($('#manual').value);
    if (await submitLog(n)) draw();
    return;
  }

  if (act === 'board') {
    if (el.dataset.type) S.board.type = el.dataset.type;
    if (el.dataset.period) S.board.period = el.dataset.period;
    return enterTab('rank');
  }
  if (act === 'wa') return window.open(`https://wa.me/?text=${encodeURIComponent(t('share_text')(S.me.username, `${location.origin}/?ref=${S.me.username}`))}`, '_blank', 'noopener');
  if (act === 'copy') {
    try { await navigator.clipboard.writeText(el.dataset.text); toast(t('copied')); } catch { prompt('', el.dataset.text); }
    return;
  }

  if (act === 'draftx') { S.draft = null; return draw(); }
  if (act === 'postit') {
    el.disabled = true; el.textContent = t('posting');
    try {
      const r = await api('/sunnah/post', 'POST', { image: S.draft });
      S.draft = null; S.me = r.me;
      return enterTab('bonus');
    } catch (e) { toast(errText(e)); if (e.message === 'bad_image' || e.message === 'duplicate_image') S.draft = null; return draw(); }
  }
  if (act === 'vote') {
    el.closest('.review').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const r = await api(`/posts/${el.dataset.id}/vote`, 'POST', { vote: el.dataset.v });
      const before = S.me.xp;
      S.me = r.me;
      S.sunnah.feed = S.sunnah.feed.filter((p) => p.id !== Number(el.dataset.id));
      toast(r.me.xp > before ? t('reviewed_paid')(r.me.xp - before) : t('reviewed_pending'));
      draw();
    } catch (e) { toast(errText(e)); await enterTab('bonus'); }
    return;
  }
  if (act === 'report') {
    if (!confirm(t('report_ask'))) return;
    try {
      await api(`/posts/${el.dataset.id}/report`, 'POST');
      S.sunnah.feed = S.sunnah.feed.filter((p) => p.id !== Number(el.dataset.id));
      toast(t('reported')); draw();
    } catch (e) { toast(errText(e)); }
    return;
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
  if (act === 'pclose') { stopPlayerTimer(); S.player = null; return draw(); }
  if (act === 'pclaim') {
    try {
      const r = await api(`/lectures/${S.player.lecture.id}/complete`, 'POST');
      S.me = r.me; celebrate(r);
      stopPlayerTimer(); S.player = null;
      S.learn = await api('/lectures');
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
    if (tm) tm.textContent = left ? `${t('watching')} +${p.lecture.xp} · ${t('min_left')(left)}` : '';
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
      const r = await api('/register', 'POST', { ...f, referral: (f.referral || '').trim(), lang: S.lang });
      setSession(r.token, r.me);
      draw();
    } else if (kind === 'settings') {
      S.me = await api('/me', 'PATCH', { dailyGoal: Number(f.dailyGoal), city: f.city, isPublic: !!f.isPublic });
      toast(t('saved'));
      draw();
    }
  } catch (e) {
    if (kind === 'settings') toast(errText(e));
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
  try { S.draft = await toJpegDataUrl(el.files[0]); draw(); } catch (e) { toast(I18N[S.lang].err.bad_image); }
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
      if (!v) { out.className = 'hint'; out.textContent = t('no_referral'); return; }
      try {
        const r = await api(`/referrer?code=${encodeURIComponent(v)}`);
        out.className = 'hint ' + (r.valid ? 'ok' : 'bad');
        out.innerHTML = r.valid ? `${t('invited_by')} <b>${esc(r.username)}</b> ✓` : t('err').bad_referral;
      } catch { /* ignore */ }
    }
  }, 350);
});

// ---- boot -----------------------------------------------------------------------
async function boot() {
  applyLang();
  if (S.ref) api(`/referrer?code=${encodeURIComponent(S.ref)}`).then((r) => { if (r.valid) { S.refName = r.username; if (!S.me) draw(); } }).catch(() => {});
  if (S.token) {
    try { await refreshMe(); } catch { /* offline keeps login screen unless token is bad */ }
  }
  draw();
  if (params.get('ref')) history.replaceState(null, '', '/');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
