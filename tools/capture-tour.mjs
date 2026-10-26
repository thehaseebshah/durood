// Captures every screen of the app for the feature-tour promo (videos/002-*): starts the app on a throwaway database,
// seeds a demo community over the past week, then photographs each screen on a phone (light mode, as the tour is set on white).
//   APP_DIR=../app [MODE=dark] node tools/capture-tour.mjs [out-dir]      (default out-dir: assets/tour; screens in light mode unless MODE=dark)
// Each scrolling screen is saved twice: <name>.jpg (the phone's view, which also supplies the header and tab bar) and
// <name>-full.jpg (the whole page with the header and tab bar hidden), so the video can scroll the page underneath them
// as the phone does. manifest.json records each page's height and where its header ends and tab bar begins (CSS px).
// Real animations (the goal burst, points floating up) are captured frame by frame by pausing the page's animations
// and stepping them, so the video plays exactly what the app draws.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(process.env.APP_DIR || '../app');
const OUT = path.resolve(process.argv[2] || 'assets/tour');
const MODE = process.env.MODE || 'light';
fs.mkdirSync(OUT, { recursive: true });

// A movable clock: the week of history is seeded day by day, then the clock returns to now. The browser keeps real time.
let off = 0; const Real = Date;
globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); } static now() { return Real.now() + off; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-tour-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'tour.db'), ADMIN_KEY: 'tour-admin-key-long-enough-1234', EDITION: 'public',
  PUBLIC_FOUNDERS_CODE: 'SEERAH2026', PUBLIC_CACHE_MS: '0', NODE_ENV: 'test', FLAG_NEW_HIGH: '1000000000', REG_LIMIT_PER_HOUR: '1000',
  CIRCLE_URL: 'https://example.org/seerat-circles' });
const { chromium } = createRequire(import.meta.url)('playwright');
const { createServer } = await import(pathToFileURL(path.join(APP, 'server/index.js')).href);
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`;
const K = { 'x-admin-key': process.env.ADMIN_KEY };
const api = async (m, p, body, token, h = {}) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...h }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${m} ${p}: ${JSON.stringify(j)}`);
  return j;
};
const soft = (p) => p.catch((e) => console.log('  (skipped)', e.message.slice(0, 120)));
const cityId = async (q) => (await api('GET', `/api/cities?q=${encodeURIComponent(q)}&cc=PK`)).cities[0].id;
const pkDay = (ms = Date.now()) => new Real(ms + 5 * 3600e3).toISOString().slice(0, 10);

// ---- the community -------------------------------------------------------------------------------------------------------
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Peshawar', 'Multan', 'Faisalabad'];
const city = {}; for (const c of CITIES) city[c] = await cityId(c);
// username, display name, city, durood a day, inviter (a username, or the public founders code)
const PEOPLE = [
  ['ahmed', 'Ahmed Raza', 'Lahore', 1300, 'SEERAH2026'], ['bilal', 'Bilal Ahmed', 'Lahore', 2100, 'SEERAH2026'],
  ['fahad', 'Fahad Raza', 'Karachi', 1600, 'ahmed'], ['hamza', 'Hamza Qureshi', 'Karachi', 1900, 'SEERAH2026'],
  ['zubair', 'Zubair Ali', 'Lahore', 800, 'ahmed'], ['usman', 'Usman Tariq', 'Islamabad', 1250, 'ahmed'],
  ['kashif', 'Kashif Zafar', 'Karachi', 1150, 'fahad'], ['umar', 'Umar Farooq', 'Peshawar', 1400, 'SEERAH2026'],
  ['moiz', 'Moiz Khan', 'Multan', 900, 'ahmed'], ['ibrahim', 'Ibrahim Shah', 'Faisalabad', 700, 'bilal'],
  ['haris', 'Haris Malik', 'Lahore', 850, 'zubair'], ['saad', 'Saad Hussain', 'Karachi', 600, 'hamza'],
  ['shoaib', 'Shoaib Javed', 'Karachi', 1050, 'fahad'], ['adnan', 'Adnan Sheikh', 'Islamabad', 950, 'usman'],
  ['hassan', 'Hassan Mirza', 'Islamabad', 780, 'usman'], ['rizwan', 'Rizwan Anwar', 'Islamabad', 640, 'SEERAH2026'],
  ['talha', 'Talha Butt', 'Peshawar', 820, 'umar'], ['nabeel', 'Nabeel Ahmad', 'Peshawar', 990, 'umar'],
  ['zaid', 'Zaid Khan', 'Peshawar', 700, 'umar'], ['asad', 'Asad Gul', 'Peshawar', 660, 'SEERAH2026'],
  ['huzaifa', 'Huzaifa Aslam', 'Multan', 870, 'moiz'], ['irfan', 'Irfan Nadeem', 'Multan', 720, 'moiz'],
  ['arham', 'Arham Riaz', 'Multan', 610, 'SEERAH2026'], ['luqman', 'Luqman Saleem', 'Multan', 930, 'SEERAH2026'],
  ['anas', 'Anas Zafar', 'Faisalabad', 1020, 'bilal'], ['mohsin', 'Mohsin Akhtar', 'Faisalabad', 810, 'bilal'],
  ['abdullah', 'Abdullah Rana', 'Faisalabad', 760, 'SEERAH2026'], ['ehsan', 'Ehsan Yousaf', 'Faisalabad', 650, 'SEERAH2026'],
  ['ali', 'Ali Haider', 'Lahore', 720, 'zubair'], ['yusuf', 'Yusuf Iqbal', 'Lahore', 540, 'ahmed'],
];
const BIO = { ahmed: 'Durood before Fajr, every day.', bilal: 'Father of three. Seerah student.', fahad: 'Karachi · Seerat Circle teacher' };
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const tok = {};
let n = 0;
const DAYS = 7;
let heroSum = 0;
off = -DAYS * 864e5;
for (const [u, name, c, , inv] of PEOPLE) {
  const r = await api('POST', '/api/register', { username: u, email: `${u}@example.pk`, phone: `0300${1234500 + ++n}`, password: 'tour12345', cityId: city[c], invite: inv, lang: 'en' });
  tok[u] = r.token;
  await soft(api('PUT', '/api/me/profile', { displayName: name, bio: BIO[u] || '' }, r.token));
}
// caravans from the first day, so their streaks run all week: Ahmed's Noor Caravan (Yusuf asks to join), Bilal's, Hamza's, Umar's
async function caravan(owner, name, display, members) {
  await api('POST', '/api/caravan', { name }, tok[owner]);
  await soft(api('PUT', '/api/caravan/display-name', { displayName: display }, tok[owner]));
  for (const u of members) {
    await soft(api('POST', '/api/caravan/invite', { username: u }, tok[owner]));
    const v = await api('GET', '/api/caravan', null, tok[u]);
    if (v.invitations?.[0]) await api('POST', `/api/caravan/invitations/${v.invitations[0].id}`, { accept: true }, tok[u]);
  }
}
await caravan('ahmed', 'noor_caravan', 'Noor Caravan', ['zubair', 'fahad', 'usman', 'moiz', 'haris', 'ali']);
await caravan('bilal', 'madinah_riders', 'Madinah Riders', ['ibrahim', 'anas', 'mohsin', 'abdullah']);
await caravan('hamza', 'karachi_lovers', 'Karachi Ashiqan', ['kashif', 'saad', 'shoaib']);
await caravan('umar', 'peshawar_noor', 'Peshawar Noor', ['talha', 'nabeel', 'zaid', 'asad']);
await soft(api('POST', '/api/caravan/join', { name: 'noor_caravan' }, tok.yusuf));
for (let d = 0; d < DAYS; d++) {
  off = -(DAYS - d) * 864e5 + 3 * 3600e3;
  for (const [u, , , per] of PEOPLE) {
    if (u === 'yusuf' && d % 2) continue; // someone skips days
    let count = Math.round(per * (0.8 + rnd() * 0.4));
    // Ahmed's week adds up to 9,200, so with 700 this morning the 313 he adds on camera crosses both his goal and 10,000
    if (u === 'ahmed') { if (d === DAYS - 1) count = 9200 - heroSum; heroSum += count; }
    await api('POST', '/api/log', { count, rid: crypto.randomUUID() }, tok[u]);
  }
}
// the lecture of this week (created at today's date: a lecture belongs to the week it is added in). Fahad and Bilal watched it
// (the server clock moves past the minimum watch time), passed the quiz and commented
off = 0;
const lec = await api('POST', '/api/admin/lectures', { youtube_id: 'dQw4w9WgXcQ', title_en: 'The Hijrah: leaving Makkah for Madinah', title_ur: 'ہجرت: مکہ سے مدینہ', speaker: 'Seerat Circle', min_seconds: 900, xp: 150,
  questions: [{ q_en: 'Which city did the Prophet ﷺ migrate to?', q_ur: 'نبی ﷺ نے کس شہر کی طرف ہجرت کی؟', options_en: ['Taif', 'Madinah', 'Jerusalem'], options_ur: ['طائف', 'مدینہ', 'یروشلم'], answer: 1 }] }, null, K);
const lecId = lec.id ?? lec.lecture?.id ?? (await api('GET', '/api/lectures', null, tok.fahad)).lectures[0]?.id;
off = -2 * 3600e3;
for (const [u, text] of [['fahad', 'Subhan Allah, the trust the Prophet ﷺ placed in Allah on the night of the Hijrah.'], ['bilal', 'Watched it with my children. The cave of Thawr scene stayed with them.']]) {
  await soft(api('POST', `/api/lectures/${lecId}/start`, null, tok[u]));
  off += 20 * 60e3;
  await soft(api('POST', `/api/lectures/${lecId}/quiz`, { answers: [1] }, tok[u]));
  await soft(api('POST', `/api/lectures/${lecId}/complete`, null, tok[u]));
  await soft(api('POST', `/api/lectures/${lecId}/comment`, { text }, tok[u]));
}
off = 0;
// today: everyone but Ahmed (he logs on camera) has recited something; he starts the day at 700 with a goal of 1,000
for (const [u, , , per] of PEOPLE) if (u !== 'ahmed' && u !== 'yusuf') await api('POST', '/api/log', { count: Math.round(per * 0.7), rid: crypto.randomUUID() }, tok[u]);
await api('POST', '/api/log', { count: 700, rid: crypto.randomUUID() }, tok.ahmed);
await soft(api('PATCH', '/api/me', { dailyGoal: 1000 }, tok.ahmed));


// content: today's sunnah, news, reflections with likes and replies, cheers on milestones
await api('POST', '/api/admin/sunnahs', { sunnahs: [{ day: pkDay(), title_en: 'Smile when you meet someone', title_ur: 'مسکرا کر ملنا', desc_en: 'Your smile in the face of your brother is charity.', desc_ur: 'اپنے بھائی کے سامنے مسکرانا صدقہ ہے۔', source: 'Tirmidhi 1956' }] }, null, K);
await soft(api('POST', '/api/admin/news', { title_en: 'Day 8 of the 40-day challenge', body_en: 'JazakAllah to everyone reciting. Add your count each day, and invite one person you know. Every durood is dedicated to the Seerat Circles.' }, null, K));
const refl = [];
for (const [u, text] of [['fahad', 'Sending durood before Fajr made the whole morning feel lighter today.'], ['bilal', 'Read about the Hijrah with my children tonight. They asked so many good questions.'], ['zubair', 'My caravan kept me going on a tiring day. 8 days in a row now, alhamdulillah.']]) {
  const r = await soft(api('POST', '/api/reflections', { text }, tok[u])); if (r?.id) refl.push([r.id, u]);
}
for (const [id, owner] of refl) for (const u of ['hamza', 'usman', 'kashif', 'moiz', 'ali', 'nabeel', 'ahmed'].filter((x) => x !== owner).slice(0, 4 + (id % 3))) await soft(api('POST', '/api/like', { kind: 'reflection', id }, tok[u]));
if (refl[0]) { await soft(api('POST', '/api/replies', { kind: 'reflection', id: refl[0][0], text: 'Ameen! Same for me today.' }, tok.kashif)); await soft(api('POST', '/api/replies', { kind: 'reflection', id: refl[0][0], text: 'MashaAllah, beautiful.' }, tok.ahmed)); }
for (const u of ['zubair', 'fahad', 'haris', 'usman']) await soft(api('POST', '/api/sunnah/tick', null, tok[u]));
const feed = await api('GET', '/api/feed', null, tok.zubair);
for (const it of (feed.items || feed.feed || []).filter((x) => x.kind === 'badge' || x.type === 'badge').slice(0, 4)) for (const u of ['zubair', 'fahad', 'usman', 'haris']) await soft(api('POST', '/api/cheer', { id: it.id }, tok[u]));
console.log('seeded', PEOPLE.length, 'members over', DAYS, 'days');

// ---- the screens ---------------------------------------------------------------------------------------------------------
const browser = await chromium.launch();
const manifest = {};
const W = 390, H = 844;
async function open({ token = tok.ahmed, lang = 'en', mode = MODE, intro = true, folds = {}, w = W, h = H, motion = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w > 900 ? 1.5 : 2, hasTouch: w < 900, isMobile: w < 900 });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(B + '/');
  await page.evaluate(([t, l, md, i, f]) => {
    localStorage.clear();
    if (t) localStorage.setItem('token', t); if (i) localStorage.setItem('intro', '1'); localStorage.setItem('lang', l); localStorage.setItem('mode', md);
    localStorage.setItem('feel', JSON.stringify({ sound: false, vibrate: false })); localStorage.setItem('folds', JSON.stringify(f));
  }, [token, lang, mode, intro, folds]);
  if (!motion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(B + '/');
  await page.waitForTimeout(1300);
  await page.addStyleTag({ content: '*{caret-color:transparent!important}' });
  return page;
}
const click = async (page, sel, wait = 800) => { await page.evaluate((s) => document.querySelector(s)?.click(), sel); await page.waitForTimeout(wait); };
const go = async (page, tab) => { await page.evaluate((t) => (document.querySelector(`.tabs [data-tab=${t}]`) || document.querySelector(`.sitem[data-tab=${t}]`))?.click(), tab); await page.waitForTimeout(1100); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300); };
const tidy = (page) => page.evaluate((origin) => { // the local address reads as the real site
  const real = 'https://seerah-quest.fly.dev';
  for (const el of document.querySelectorAll('input')) if (el.value.includes(origin)) el.value = el.value.replace(origin, real);
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) if (tw.currentNode.nodeValue.includes(origin)) tw.currentNode.nodeValue = tw.currentNode.nodeValue.replace(origin, real);
}, B);
// where things are, so the video can spotlight them exactly: [x, y, w, h] in page CSS px (y includes the scroll), first match only
// unless the key ends in '*' (then the first six matches as key0..key5)
const SPOTS = {
  big: '#big', numbox: '.numbox', manual: '#manual', add: '[data-act=manual]', presets: '[data-act=preset]|.quick', taptoggle: '[data-act=taptoggle]',
  tap: '[data-act=tap]', tapbox: '.tapbox|.counterbox', start: '.startcard', quests: '[data-k=quests]|.fold', seerah: '[data-k=seerah]|.fold',
  challengeFold: '[data-k=challenge]|.fold', challenge: '.challenge', tick: '[data-act=tick]', photo: '.blk.upload', watch: '[data-act=watch]',
  lecture: '[data-act=watch]|.fcard,.sec,.fold', reflect: 'textarea', circle: '.circlecard', stk: '.stk', bell: '.hd [data-act=news]', joinreq: '.rowlink',
  'fitem*': '.fitem', 'like*': '[data-act=like]', 'cheer*': '[data-act=cheer]', seg5: '.seg.five', 'row*': '.lb li', leaguehead: '.leaguehead',
  stats: '.stats', karwan: '.karwan', cvaccept: '[data-act=cvreqyes]', cvinvite: '[data-act=cvinvite]|.sec,.fold', linkinv: '.linkinv', wa: '[data-act=wa]|[data-act=shareinv]',
  lvl: '.lvl', badges: '.badges', history: '[data-k=history]|.fold', edit: '[data-act=edit]', langseg: '[data-act=setlang]|.seg', modeseg: '[data-act=setmode]|.seg',
  feel: '[data-act=setfeel]|.swrow,.row', remind: 'input[type=time]', avatar: '.avbtn', invite: '[name=invite]', invited: '[name=invite]|label,.field,div',
  waitlist: '[data-mode=waitlist]', username: '[name=username]', city: '.cityfield', submit: 'form button[type=submit]', modal: '.modal .box|.box',
  sheet: '.sheet|.box', side: '.side', sadd: '.sadd', langpick: '.langpick', cta: '.blk', mybig: '.mybig', pbig: '.pbig', mam: '.mam',
};
async function rects(page) {
  return page.evaluate((spots) => {
    const out = {}, sy = scrollY;
    const box = (el) => { const r = el.getBoundingClientRect(); return r.width && r.height ? [Math.round(r.left), Math.round(r.top + sy), Math.round(r.width), Math.round(r.height)] : null; };
    for (const [key, spec] of Object.entries(spots)) {
      const [sel, up] = spec.split('|'), many = key.endsWith('*'), k = key.replace('*', '');
      const els = [...document.querySelectorAll(sel)].map((e) => (up ? e.closest(up) || e : e)).filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
      if (many) els.slice(0, 6).forEach((e, i) => { const b = box(e); if (b) out[k + i] = b; });
      else if (els[0]) { const b = box(els[0]); if (b) out[k] = b; }
    }
    return { r: out, sy };
  }, SPOTS);
}
async function view(page, name) {
  await tidy(page);
  const at = await rects(page);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 88 });
  manifest[name] = { ...(manifest[name] || {}), view: true, sy: at.sy, r: at.r };
  console.log('view', name);
}
// the phone's view, then the whole page under its header and tab bar
async function full(page, name) {
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
  await view(page, name);
  const geo = await page.evaluate(() => {
    const hd = document.querySelector('.hd')?.getBoundingClientRect(), tab = document.querySelector('nav.tabs')?.getBoundingClientRect();
    return { hd: hd ? Math.round(hd.bottom) : 0, tab: tab ? Math.round(tab.top) : innerHeight };
  });
  const style = await page.addStyleTag({ content: '.hd, nav.tabs { visibility: hidden !important; }' });
  await page.screenshot({ path: path.join(OUT, `${name}-full.jpg`), type: 'jpeg', quality: 88, fullPage: true });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await style.evaluate((s) => s.remove());
  manifest[name] = { ...manifest[name], full: true, h, ...geo };
  console.log('full', name, h);
}
// a real animation, frame by frame: every animation on the page is paused, then all are stepped together
async function frames(page, name, trigger, count, { fps = 30, settle = 250 } = {}) {
  await page.evaluate(() => {
    window.__anim = new Map(); window.__f = 0;
    const grab = () => { for (const a of document.getAnimations()) if (!window.__anim.has(a)) { window.__anim.set(a, window.__f); a.pause(); } };
    window.__grab = grab; new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, attributes: true }); setInterval(grab, 5);
  });
  await trigger();
  await page.waitForTimeout(settle);
  for (let f = 0; f < count; f++) {
    await page.evaluate(([f, ms]) => { window.__f = f; window.__grab(); for (const [a, born] of window.__anim) { try { a.currentTime = (f - born) * ms; } catch {} } }, [f, 1000 / fps]);
    await page.screenshot({ path: path.join(OUT, `${name}-${String(f).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 86 });
  }
  manifest[name] = { frames: count, fps, ...(await rects(page)) };
  console.log('frames', name, count);
}

// welcome, intro, sign-up with an invite code
{
  const page = await open({ token: null, intro: false });
  await view(page, 'intro-0');
  for (let i = 1; i <= 3; i++) { await click(page, '[data-act=intronext]', 900); await view(page, `intro-${i}`); }
  await click(page, '[data-mode=register]');
  await page.fill('[name=invite]', 'ahmed'); await page.locator('[name=invite]').blur(); await page.waitForTimeout(700);
  await page.fill('[name=username]', 'hamid_r').catch(() => {});
  await full(page, 'register');
  await page.close();
}
// Today: the whole page with its sections open, then typing, tapping and the goal burst
const TODAY_FOLDS = { quests: true, seerah: true, challenge: true, start: true };
{
  const page = await open({ folds: TODAY_FOLDS });
  await full(page, 'today');
  await page.close();
}
{
  const page = await open({ motion: true });
  await page.evaluate(() => scrollTo(0, 0));
  for (const v of ['3', '31', '313']) { await page.fill('#manual', v); await page.waitForTimeout(150); await view(page, `type-${v.length}`); }
  await frames(page, 'burst', () => page.click('[data-act=manual]'), 54, { settle: 350 });
  await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
  await click(page, '[data-act=celebrateX]', 300);
  await view(page, 'saved'); // the toast with Undo
  await page.close();
}
{
  const page = await open();
  await click(page, '[data-act=taptoggle]', 500);
  await page.evaluate(() => scrollTo(0, 40)); // the number and the tap button both in view
  await page.waitForTimeout(400);
  const tapAt = await page.evaluate(() => { const r = document.querySelector('[data-act=tap]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  for (let i = 0; i <= 16; i++) {
    if (i) { await click(page, '[data-act=tap]', 300); }
    await page.screenshot({ path: path.join(OUT, `tap-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 86 });
  }
  manifest.tap = { frames: 17, at: tapAt, ...(await rects(page)) };
  console.log('tap', tapAt);
  await page.close();
}
// navigation: the menu drawer and the + sheet
{
  const page = await open();
  await click(page, '.tabs [data-act=drawer]', 900); await view(page, 'menu');
  await click(page, '[data-act=drawerx]', 600);
  await go(page, 'feed');
  await click(page, '.hadd', 900); await view(page, 'addsheet');
  await page.close();
}
// Feed
{ const page = await open(); await go(page, 'feed'); await full(page, 'feed'); await page.close(); }
// Compete: every board
{
  const page = await open({ folds: { challenge: true } });
  await go(page, 'rank');
  await full(page, 'rank-people');
  for (const type of ['league', 'caravans', 'trees', 'cities']) {
    for (let i = 0; i < 3 && !(await page.locator(`[data-act=board][data-type=${type}].on`).count()); i++) await click(page, `[data-act=board][data-type=${type}]`, 1200);
    await full(page, `rank-${type}`);
  }
  await click(page, '[data-act=board][data-type=users]', 1200);
  await page.evaluate(() => { const el = document.querySelector('.seg.five'); scrollTo(0, el.getBoundingClientRect().top + scrollY - 70); }); await page.waitForTimeout(400);
  await page.locator('ol li, ul.lb li, .lb li').first().click().catch(() => {});
  await page.waitForTimeout(1000);
  await view(page, 'profile');
  await page.close();
}
// Caravan and Qabila
{
  const page = await open();
  await go(page, 'caravan'); await full(page, 'caravan');
  await go(page, 'qabila'); await full(page, 'qabila');
  await page.close();
}
// Me: level, points, badges and history, and fixing a number
{
  const page = await open({ folds: { history: true, badges: true, points: true } });
  await go(page, 'progress'); await full(page, 'me');
  if (await page.locator('[data-act=edit]').count()) {
    await page.locator('[data-act=edit]').first().scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, 200));
    await page.locator('[data-act=edit]').first().click(); await page.waitForTimeout(700); await view(page, 'history-edit');
  }
  await page.close();
}
// Settings
{ const page = await open(); await go(page, 'settings'); await full(page, 'settings'); await page.close(); }
// the same Today in light, in Urdu, and on a computer
{
  const dark = await open({ mode: 'dark' }); await view(dark, 'today-dark'); await dark.close(); // the same moment as the light and Urdu ones
  const light = await open({ mode: 'light' }); await view(light, 'today-light'); await go(light, 'rank'); await view(light, 'rank-light'); await light.close();
  const ur = await open(); await click(ur, '[data-act=setlang][data-l=ur]', 2200); await ur.evaluate(() => scrollTo(0, 0)); await view(ur, 'today-ur');
  await go(ur, 'rank'); await view(ur, 'rank-ur'); await go(ur, 'caravan'); await view(ur, 'caravan-ur');
  await click(ur, '[data-act=setlang][data-l=en]', 1200); await ur.close();
  const wide = await open({ w: 1280, h: 800 }); await view(wide, 'desktop'); await go(wide, 'rank'); await view(wide, 'desktop-rank'); await wide.close();
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
await browser.close();
server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('done:', OUT);
process.exit(0);
