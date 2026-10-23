import { I18N } from './i18n.js';

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

const BADGE_ICON = {
  first_step: '🌱', d1k: '📿', d10k: '🌙', d100k: '🌟', d1m: '👑', streak7: '🔥', streak30: '🔥', streak100: '🏔️',
  sunnah1: '🌿', sunnah7: '🌳', sunnah30: '🏞️', verifier10: '🔎', verifier100: '🏛️',
  recruit1: '📣', recruit5: '🧭', recruit25: '🐪', scholar1: '📖', scholar10: '🎓', circle: '🕌',
  caravan10k: '🐫', caravan100k: '🐫', caravan1m: '🏜️', caravan10m: '🌍',
};
const MILESTONES = [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000];

const t = (k) => I18N[S.lang][k] ?? I18N.en[k] ?? k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const N = (x) => `<span class="n">${x}</span>`; // keeps '+50' and '475 / 900' left-to-right inside Urdu text
const $ = (s) => document.querySelector(s);
const app = $('#app');

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
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
  for (const b of res.newBadges || []) bits.push(`${t('new_badge')} ${BADGE_ICON[b]} ${t('badge')[b][0]}`);
  if (bits.length) toast(bits.join(' · '));
  if (res.levelUp || res.newBadges?.length) navigator.vibrate?.([60, 40, 60]);
}

// ---- views --------------------------------------------------------------------
function langToggle() {
  return `<button class="pill" data-act="lang">${S.lang === 'ur' ? 'English' : 'اردو'}</button>`;
}

function authView() {
  const reg = S.authMode === 'register';
  return `
  <div class="topbar"><div class="in"><span class="brand">☪ ${t('app')}</span>${langToggle()}</div></div>
  <div class="wrap">
    <div class="card hero">
      <div class="arabic">${t('durood')}</div>
      <p>${t('tagline')}</p>
    </div>
    <div class="seg">
      <button class="${!reg ? 'on' : ''}" data-act="mode" data-mode="login">${t('login')}</button>
      <button class="${reg ? 'on' : ''}" data-act="mode" data-mode="register">${t('register')}</button>
    </div>
    <form class="card" data-form="${reg ? 'register' : 'login'}" autocomplete="on">
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
      <div class="spacer"></div>
      <button class="block gold" type="submit">${reg ? t('register') : t('login')}</button>
    </form>
    <p class="muted center">${t('dedication')}</p>
  </div>`;
}

function shell() {
  const tabs = [['home', '🏠'], ['rank', '🏆'], ['caravan', '🐫'], ['bonus', '🌿'], ['me', '👤']];
  return `
  <div class="topbar"><div class="in">
    <span class="brand">☪ ${t('app')}</span>
    <span class="row"><span class="tag" style="background:rgba(255,255,255,.2);color:#fff">${t('level')} ${S.me.level}</span>${langToggle()}</span>
  </div></div>
  <div class="wrap">${view()}</div>
  <nav class="tabs">${tabs.map(([k, ic]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}"><span class="ic">${ic}</span>${t('nav_' + (k === 'rank' ? 'rank' : k))}</button>`).join('')}</nav>
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
  return `
  <div class="card hero">
    <div class="arabic">${t('durood')}</div>
    <p>${t('dedication')}</p>
  </div>

  <div class="card center">
    <button class="tap" data-act="tap" aria-label="${t('tap_hint')}"><span id="pend">${fmt(S.pending)}</span><small>${t('tap_hint')}</small></button>
    <div class="row quick wrapx" style="justify-content:center">
      ${[10, 33, 100].map((n) => `<button class="alt" data-act="padd" data-n="${n}">${N('+' + n)}</button>`).join('')}
      <button class="alt" data-act="preset">${t('reset')}</button>
    </div>
    <div class="spacer"></div>
    <button class="gold block" data-act="submitp" id="submitp" ${S.pending ? '' : 'disabled'}>${t('submit_pending')}</button>
    <div class="hint" style="margin-top:14px">${t('or_enter')}</div>
    <div class="row"><input type="number" id="manual" inputmode="numeric" min="1" placeholder="${t('count_ph')}" dir="ltr"><button data-act="manual">${t('add')}</button></div>
  </div>

  <div class="card"><div class="grid3">
    <div class="stat"><b>${fmt(m.today)}</b><span>${t('today')}</span></div>
    <div class="stat"><b>${fmt(m.week)}</b><span>${t('week')}</span></div>
    <div class="stat"><b>${fmt(m.total)}</b><span>${t('total')}</span></div>
  </div></div>

  <div class="card">
    <div class="row">
      <div class="level-badge">${m.level}</div>
      <div style="flex:1"><b>${esc(title)}</b><div class="muted">${N(`${fmt(m.xp)} / ${fmt(m.next)}`)} ${t('xp')}</div>${bar(m.pct)}</div>
    </div>
  </div>

  <div class="card row between">
    <div class="row"><span class="flame">🔥</span><div><b>${m.streak}</b> ${t('streak')}<div class="muted">${t('best_streak')}: ${m.bestStreak}</div></div></div>
    <div class="center" title="${esc(t('shield_hint'))}"><span class="flame">🛡️</span> <b>${m.shields}</b></div>
  </div>

  <div class="card">
    <h2>${t('durood_quests')}</h2>
    ${m.quests.filter((q) => q.group === 'durood').map(quest).join('')}
  </div>

  <div class="card compact">
    <div class="row between"><h3>🌿 ${t('bonus_quests')}</h3><button class="alt" data-act="tab" data-tab="bonus" style="padding:2px 12px">${t('see_bonus')}</button></div>
    ${m.quests.filter((q) => q.group === 'bonus').map(quest).join('')}
  </div>

  <div class="card">
    <h2>${t('national')}</h2>
    <div class="muted">${t('national_sub')}</div>
    <div class="row between"><b>${fmt(m.pub.total)}</b><span class="muted">${t('of')} ${N(fmt(m.pub.target))}</span></div>
    ${bar(natPct)}
    <div class="muted" style="margin-top:6px">${fmt(m.pub.members)} ${t('members')}</div>
    <div class="muted">${t('self_reported')} · ${new Date(m.pub.asOf).toLocaleTimeString(S.lang === 'ur' ? 'ur-PK' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
  </div>
  <p class="muted center">${t('reminder_note')}</p>`;
}

function quest(q) {
  return `<div class="quest ${q.done ? 'done' : ''}">
    <span class="tick">${q.done ? '✓' : ''}</span>
    <div class="grow"><div>${t('q_' + q.id)} <span class="tag">${t(q.period === 'day' ? 'daily' : 'weekly')}</span></div>
      ${bar((q.cur / q.goal) * 100)}<div class="muted">${N(`${fmt(q.cur)} / ${fmt(q.goal)}`)}</div></div>
    <b class="ok">${N('+' + q.xp)}</b>
  </div>`;
}

// secondary (sunnah) and tertiary (seerah) activities share one tab, in that order
function bonus() {
  return `<p class="muted center">${t('bonus_hint')}</p>
    <h2 class="sec">🌿 ${t('sunnah_heading')}</h2>${sunnah()}
    <h2 class="sec">📖 ${t('seerah_heading')}</h2>${learn()}`;
}

function sunnah() {
  const d = S.sunnah;
  if (!d) return '<p class="muted center">…</p>';
  const pick = (en, ur) => (S.lang === 'ur' && ur) || en;
  const sn = d.today.sunnah, mine = d.today.mine, r = d.today.rules;
  const statusTag = (st) => `<span class="tag">${t('st_' + st)}</span>`;
  let action = '';
  if (!sn) action = `<p class="muted">${t('no_sunnah')}</p>`;
  else if (mine) action = `<div class="row between"><b>${t('your_post')}</b>${statusTag(mine.status)}</div>
      <img class="shot" src="${esc(mine.photoUrl)}" alt="">
      <div class="muted">${N(`${mine.confirms}/${r.confirmsNeeded}`)} ${t('confirms_so_far')}</div>`;
  else if (S.draft) action = `<b>${t('photo_preview')}</b><img class="shot" src="${esc(S.draft)}" alt="">
      <div class="row"><button class="gold" style="flex:1" data-act="postit" id="postit">${t('post_it')}</button><button class="alt" data-act="draftx">${t('cancel')}</button></div>`;
  else action = `<label class="btn gold block" style="margin:0">${t('take_photo')}
      <input type="file" accept="image/*" capture="environment" data-photo hidden></label>`;
  return `
  <div class="card">
    <h2>🌿 ${t('sunnah_title')}</h2>
    ${sn ? `<h3>${esc(pick(sn.titleEn, sn.titleUr))}</h3><p>${esc(pick(sn.descEn, sn.descUr))}</p>${sn.source ? `<div class="muted">${t('source')}: ${esc(sn.source)}</div>` : ''}` : ''}
    <div class="spacer"></div>${action}
    ${sn && !mine ? `<p class="hint">${t('photo_rules')}</p>` : ''}
    ${sn ? `<p class="hint">${t('post_how')(r.confirmsNeeded, r.sunnahXp, r.verifyXp)}</p>` : ''}
  </div>
  <div class="card">
    <h2>🔎 ${t('review_title')}</h2>
    <p class="muted">${t('review_hint')}</p>
    ${d.feed.length ? d.feed.map((p) => `
      <div class="review" data-post="${p.id}">
        <div class="muted">${esc(pick(p.titleEn, p.titleUr))}</div>
        <img class="shot" loading="lazy" src="${esc(p.photoUrl)}" alt="">
        <div class="row wrapx"><button style="flex:1" data-act="vote" data-id="${p.id}" data-v="confirm">${t('confirm')}</button>
          <button class="alt" style="flex:1" data-act="vote" data-id="${p.id}" data-v="reject">${t('reject')}</button></div>
        <button class="alt" style="margin-top:6px;padding:2px 10px;font-size:.8rem" data-act="report" data-id="${p.id}">${t('report_btn')}</button>
      </div>`).join('') : `<p class="muted center">${t('no_feed')}</p>`}
  </div>
  <div class="card">
    <h2>${t('history')}</h2>
    <div class="grid3" style="margin-bottom:8px">
      <div class="stat"><b>${fmt(S.me.sunnah.verified)}</b><span>${t('sunnahs_verified')}</span></div>
      <div class="stat"><b>${fmt(S.me.sunnah.reviews)}</b><span>${t('reviews_done')}</span></div>
    </div>
    ${d.mine.length ? d.mine.map((p) => `<div class="quest"><div class="grow">${esc(pick(p.titleEn, p.titleUr))}<div class="muted">${esc(p.day)}</div></div>${statusTag(p.status)}</div>`).join('') : ''}
  </div>`;
}

function rank() {
  const b = S.board;
  const rows = b.data?.rows;
  const list = !rows ? '<p class="muted center">…</p>' : rows.length ? `<ul class="lb">${rows.map((r) => `
    <li class="${r.me ? 'me' : ''}"><span class="rank">${r.rank}</span>
      <span class="name">${esc(r.username)}${r.me ? ` <span class="tag">${t('you')}</span>` : ''}${r.city ? `<div class="muted">${esc(r.city)}${r.members ? ` · ${fmt(r.members)} ${t('members')}` : ''}</div>` : r.members ? `<div class="muted">${fmt(r.members)} ${t('members')}</div>` : ''}</span>
      <span class="score">${fmt(r.score)}</span></li>`).join('')}</ul>` : `<p class="muted center">${t('empty_board')}</p>`;
  return `
  <div class="seg">
    <button class="${b.type === 'users' ? 'on' : ''}" data-act="board" data-type="users">${t('users')}</button>
    <button class="${b.type === 'teams' ? 'on' : ''}" data-act="board" data-type="teams">${t('teams')}</button>
  </div>
  <div class="seg">
    <button class="${b.period === 'week' ? 'on' : ''}" data-act="board" data-period="week">${t('this_week')}</button>
    <button class="${b.period === 'all' ? 'on' : ''}" data-act="board" data-period="all">${t('all_time')}</button>
  </div>
  <div class="card">${list}</div>
  <p class="muted center">${t('self_reported')}</p>
  <p class="muted center">${t('reminder_note')}</p>`;
}

function caravan() {
  const m = S.me, tm = S.team;
  const link = `${location.origin}/?ref=${m.username}`;
  const total = m.team.total;
  const next = MILESTONES.find((x) => x > total) || MILESTONES.at(-1);
  const prev = MILESTONES.filter((x) => x <= total).at(-1) || 0;
  return `
  <div class="card">
    <h2>${t('your_code')}</h2>
    <div class="code">${esc(m.username)}</div>
    <div class="spacer"></div>
    <div class="muted">${t('your_link')}</div>
    <div class="code" style="font-size:.9rem;font-weight:600">${esc(link)}</div>
    <div class="spacer"></div>
    <div class="row">
      <button class="wa" style="flex:1" data-act="wa">${t('share_wa')}</button>
      <button class="alt" data-act="copy" data-text="${esc(link)}">${t('copy')}</button>
    </div>
  </div>
  <div class="card">
    <h2>${t('caravan_title')}</h2>
    <p class="muted">${t('caravan_sub')}</p>
    <div class="grid3">
      <div class="stat"><b>${fmt(m.team.members)}</b><span>${t('c_members')}</span></div>
      <div class="stat"><b>${fmt(total)}</b><span>${t('c_total')}</span></div>
      <div class="stat"><b>${tm ? fmt(tm.week) : '…'}</b><span>${t('c_week')}</span></div>
    </div>
    <div class="spacer"></div>
    <div class="muted">${t('next_milestone')}: <b>${fmt(next)}</b></div>
    ${bar(((total - prev) / (next - prev)) * 100)}
  </div>
  <div class="card">
    <h2>${t('direct_list')} (${fmt(m.team.direct)})</h2>
    ${!tm ? '…' : tm.direct.length ? `<ul class="lb">${tm.direct.map((d) => `
      <li><span class="name">${esc(d.username)}<div class="muted">${d.members ? `${fmt(d.members)} ${t('members')} · ` : ''}${d.total == null ? t('hidden') : fmt(d.total)}</div></span><span class="score">${fmt(d.team)}</span></li>`).join('')}</ul>` : `<p class="muted">${t('none_yet')}</p>`}
    ${tm?.byDepth?.length ? `<div class="muted" style="margin-top:8px">${tm.byDepth.map((d) => `${t('levels_deep')} ${d.depth}: ${fmt(d.n)}`).join(' · ')}</div>` : ''}
  </div>`;
}

function learn() {
  const l = S.learn;
  const title = (x) => (S.lang === 'ur' && x.titleUr) || x.titleEn;
  return `
  <div class="card">
    <h2>🕌 ${t('circle_title')}</h2>
    <p class="muted">${t('circle_text')}</p>
    ${l?.circleUrl ? `<div class="row wrapx"><a class="btn gold" href="${esc(l.circleUrl)}" target="_blank" rel="noopener">${t('circle_open')}</a>
      ${S.me.badges.includes('circle') ? '<span class="ok">✓</span>' : `<button class="alt" data-act="circle">${t('circle_claim')} (${N('+' + fmt(l.circleXp))} ${t('xp')})</button>`}</div>` : `<p class="muted">${t('circle_none')}</p>`}
  </div>
  <div class="card">
    <h2>▶️ ${t('lectures')}</h2>
    ${!l ? '…' : l.lectures.length ? l.lectures.map((x) => `
      <div class="quest ${x.done ? 'done' : ''}">
        <span class="tick">${x.done ? '✓' : ''}</span>
        <div class="grow"><div>${esc(title(x))}</div><div class="muted">${esc(x.speaker)}</div></div>
        <button class="${x.done ? 'alt' : ''}" data-act="watch" data-id="${x.id}">${x.done ? t('watched') : `${t('watch')} ${N('+' + x.xp)}`}</button>
      </div>`).join('') : `<p class="muted">${t('no_lectures')}</p>`}
  </div>`;
}

function me() {
  const m = S.me;
  const codes = Object.keys(I18N.en.badge);
  return `
  <div class="card">
    <h2>${esc(m.username)}</h2>
    <div class="muted" dir="ltr">${esc(m.email)} · ${esc(m.phone)}</div>
    <div class="grid3" style="margin-top:8px">
      <div class="stat"><b>${m.level}</b><span>${t('level')}</span></div>
      <div class="stat"><b>${fmt(m.total)}</b><span>${t('total')}</span></div>
      <div class="stat"><b>${m.bestStreak}</b><span>${t('best_streak')}</span></div>
    </div>
  </div>
  <div class="card">
    <h2>${t('badges')}</h2>
    <div class="badges">${codes.map((c) => `<div class="badge ${m.badges.includes(c) ? '' : 'locked'}" title="${esc(t('badge')[c][1])}"><span class="ic">${BADGE_ICON[c]}</span>${esc(t('badge')[c][0])}</div>`).join('')}</div>
  </div>
  <form class="card" data-form="settings">
    <h2>${t('settings')}</h2>
    <label>${t('daily_goal')}</label>
    <input type="number" name="dailyGoal" min="1" max="100000" value="${m.dailyGoal}" dir="ltr">
    <label>${t('city')}</label>
    <input type="text" name="city" maxlength="40" value="${esc(m.city)}">
    <label class="row"><input type="checkbox" name="isPublic" ${m.isPublic ? 'checked' : ''} style="width:auto"> ${t('public_toggle')}</label>
    <div class="hint">${t('public_hint')}</div>
    <div class="spacer"></div>
    <button class="block" type="submit">${t('save')}</button>
  </form>
  <button class="alt block" data-act="logout">${t('logout')}</button>`;
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
    <div class="row"><button class="gold" style="flex:1" id="pclaim" data-act="pclaim" ${left ? 'disabled' : ''}>${t('can_claim')}</button>
    <button class="alt" data-act="pclose">${t('close')}</button></div>
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
  if (act === 'mode') { S.authMode = el.dataset.mode; S.error = ''; return draw(); }
  if (act === 'tab') return enterTab(el.dataset.tab);
  if (act === 'logout') return logout();

  if (act === 'tap' || act === 'padd') {
    S.pending += act === 'tap' ? 1 : Number(el.dataset.n);
    ls.set('pending', S.pending);
    $('#pend').textContent = fmt(S.pending);
    $('#submitp').disabled = false;
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
