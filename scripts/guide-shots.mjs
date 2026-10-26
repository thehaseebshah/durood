// Screenshots for the member guide (guide/img): starts its own server on a throwaway database, fills it with a small
// made-up community (a week of durood, a caravan, a lecture, news, reflections) and photographs each screen on a phone.
//   node scripts/guide-shots.mjs        (needs Playwright with Chromium, like npm run e2e)
// The week of history is made by moving this process's clock back and forward while seeding; the browser keeps real time.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const RealDate = Date;
let off = 0;
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-guide-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'guide.db'), ADMIN_KEY: 'guide-admin-key-long-enough-1234', EDITION: 'internal',
  PUBLIC_FOUNDERS_CODE: 'SEERAH2026', PUBLIC_CACHE_MS: '0', NODE_ENV: 'test', FLAG_NEW_HIGH: '1000000000', REG_LIMIT_PER_HOUR: '1000',
  CIRCLE_URL: 'https://albn.org/seerat' });
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../guide/img');
fs.mkdirSync(out, { recursive: true });

const { createServer } = await import('../server/index.js');
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
const cityId = async (q) => (await api('GET', `/api/cities?q=${encodeURIComponent(q)}&cc=PK`)).cities[0].id;
const pkDay = (ms = Date.now()) => new RealDate(ms + 5 * 3600e3).toISOString().slice(0, 10);

// ---- the community ---------------------------------------------------------------------------------------------------
const cities = { Lahore: await cityId('Lahore'), Karachi: await cityId('Karachi'), Islamabad: await cityId('Islamabad'), Faisalabad: await cityId('Faisalabad'), Multan: await cityId('Multan') };
const people = [ // username, display name, city, durood a day (roughly)
  ['ayesha_k', 'Ayesha Khan', 'Lahore', 1100], ['bilal_ahmed', 'Bilal Ahmed', 'Lahore', 2300], ['fatima_r', 'Fatima Raza', 'Karachi', 1600],
  ['hamza_ali', 'Hamza Ali', 'Islamabad', 900], ['zainab_s', 'Zainab Siddiqui', 'Lahore', 700], ['usman_t', 'Usman Tariq', 'Faisalabad', 1300],
  ['maryam_n', 'Maryam Noor', 'Karachi', 500], ['ali_raza', 'Ali Raza', 'Multan', 800], ['sana_m', 'Sana Malik', 'Lahore', 400],
  ['omar_f', 'Omar Farooq', 'Islamabad', 1000], ['hira_b', 'Hira Baig', 'Karachi', 650], ['ahmed_h', 'Ahmed Hassan', 'Lahore', 850],
  ['khadija_z', 'Khadija Zafar', 'Karachi', 1200], ['nida_q', 'Nida Qureshi', 'Karachi', 300],
];
const tok = {};
let n = 0;
const DAYS = 6; // days of history before today
off = -DAYS * 864e5;
for (const [u, name, city] of people) {
  const inviter = u === 'ayesha_k' || u === 'bilal_ahmed' ? 'SEERAH2026' : ['zainab_s', 'sana_m', 'hamza_ali'].includes(u) ? 'ayesha_k' : ['maryam_n', 'hira_b', 'khadija_z', 'nida_q'].includes(u) ? 'fatima_r' : 'bilal_ahmed';
  const invite = u === 'fatima_r' ? 'ayesha_k' : inviter;
  const r = await api('POST', '/api/register', { username: u, email: `${u}@example.pk`, phone: `0300${String(1234500 + ++n)}`, password: 'guide1234', cityId: cities[city], invite, lang: 'en' });
  tok[u] = r.token;
  await api('PUT', '/api/me/profile', { displayName: name, bio: '' }, r.token).catch(() => {});
}
const day0 = pkDay();
for (let d = 0; d < DAYS; d++) {
  off = -(DAYS - d) * 864e5 + 3 * 3600e3;
  for (const [u, , , per] of people) {
    if ((u === 'sana_m' && d % 2) || (u === 'hira_b' && d < 3)) continue; // a couple of people skip days
    const count = Math.round(per * (0.8 + ((d * 7 + u.length) % 5) / 10));
    await api('POST', '/api/log', { count, rid: crypto.randomUUID() }, tok[u]);
  }
}
off = 0;
// today: everyone but Ayesha (she logs on camera) has recited something
for (const [u, , , per] of people) if (u !== 'ayesha_k' && u !== 'sana_m') await api('POST', '/api/log', { count: Math.round(per * 0.6), rid: crypto.randomUUID() }, tok[u]);
await api('POST', '/api/log', { count: 600, rid: crypto.randomUUID() }, tok.ayesha_k);
await api('PATCH', '/api/me', { dailyGoal: 1000 }, tok.ayesha_k).catch((e) => console.log(e.message));

// caravan: Ayesha's "noor_caravan" with four members
await api('POST', '/api/caravan', { name: 'noor_caravan' }, tok.ayesha_k);
await api('PUT', '/api/caravan/display-name', { displayName: 'Noor Caravan' }, tok.ayesha_k).catch(() => {});
for (const u of ['zainab_s', 'fatima_r', 'hamza_ali']) {
  await api('POST', '/api/caravan/invite', { username: u }, tok.ayesha_k);
  const v = await api('GET', '/api/caravan', null, tok[u]);
  await api('POST', `/api/caravan/invitations/${v.invitations[0].id}`, { accept: true }, tok[u]);
}
await api('POST', '/api/caravan', { name: 'madinah_riders' }, tok.bilal_ahmed);
for (const u of ['usman_t', 'ali_raza', 'omar_f']) {
  await api('POST', '/api/caravan/invite', { username: u }, tok.bilal_ahmed);
  const v = await api('GET', '/api/caravan', null, tok[u]);
  await api('POST', `/api/caravan/invitations/${v.invitations[0].id}`, { accept: true }, tok[u]);
}
await api('POST', '/api/caravan', { name: 'karachi_lovers' }, tok.fatima_r).catch(() => {});
// Sana asks to join Noor Caravan, so Ayesha has a request waiting
await api('POST', '/api/caravan/join', { name: 'noor_caravan' }, tok.sana_m).catch(() => {});

// content: today's sunnah, the lecture of the week, news, reflections
await api('POST', '/api/admin/sunnahs', { sunnahs: [{ day: pkDay(), title_en: 'Smile when you meet someone', title_ur: 'مسکرا کر ملنا', desc_en: 'Your smile in the face of your brother is charity.', desc_ur: 'اپنے بھائی کے سامنے مسکرانا صدقہ ہے۔', source: 'Tirmidhi 1956' }] }, null, K);
await api('POST', '/api/admin/lectures', { youtube_id: 'dQw4w9WgXcQ', title_en: 'The Hijrah: leaving Makkah for Madinah', title_ur: 'ہجرت: مکہ سے مدینہ', speaker: 'Seerat Circle', min_seconds: 900, xp: 150,
  questions: [{ q_en: 'Which city did the Prophet ﷺ migrate to?', q_ur: 'نبی ﷺ نے کس شہر کی طرف ہجرت کی؟', options_en: ['Taif', 'Madinah', 'Jerusalem'], options_ur: ['طائف', 'مدینہ', 'یروشلم'], answer: 1 }] }, null, K);
await api('POST', '/api/admin/news', { title_en: 'Welcome to Seerah Quest', body_en: 'JazakAllah for joining. Recite, add your count each day, and invite one person you know. Day 1 of the 40-day challenge has begun.' }, null, K);
await api('POST', '/api/reflections', { text: 'Sending durood before Fajr made the whole morning feel lighter today.' }, tok.fatima_r);
await api('POST', '/api/reflections', { text: 'Read about the Hijrah with my children tonight. They asked so many good questions.' }, tok.bilal_ahmed);
await api('POST', '/api/sunnah/tick', null, tok.zainab_s).catch(() => {});
// Al-Burhan: Ayesha keeps two of her own tasks and a routine
const tomorrow = pkDay(Date.now() + 864e5);
await api('POST', '/api/tasks', { kind: 'task', title: 'Read one page of Seerah', dueDay: pkDay() }, tok.ayesha_k).catch((e) => console.log(e.message));
await api('POST', '/api/tasks', { kind: 'task', title: 'Call Zainab about the circle', dueDay: tomorrow }, tok.ayesha_k).catch((e) => console.log(e.message));
await api('POST', '/api/tasks', { kind: 'routine', title: 'Surah Kahf', weekdays: [5] }, tok.ayesha_k).catch((e) => console.log(e.message));
console.log('seeded from', day0, 'to', pkDay());

// ---- the screens -----------------------------------------------------------------------------------------------------
const browser = await chromium.launch();
async function open(token, { w = 390, h = 844, lang = 'en', mode = 'light', intro = true, folds } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 900, isMobile: w < 900 });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(B + '/');
  await page.evaluate(([t, l, md, i, f]) => {
    localStorage.clear();
    if (t) localStorage.setItem('token', t); if (i) localStorage.setItem('intro', '1'); localStorage.setItem('lang', l); localStorage.setItem('mode', md);
    localStorage.setItem('feel', JSON.stringify({ sound: false, vibrate: false })); if (f) localStorage.setItem('folds', JSON.stringify(f));
  }, [token, lang, mode, intro, folds]);
  await page.goto(B + '/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(1200);
  return page;
}
const act = async (page, sel, wait = 700) => { await page.locator(sel).first().click(); await page.waitForTimeout(wait); };
const go = async (page, tab) => { await page.evaluate((t) => (document.querySelector(`.tabs [data-tab=${t}]`) || document.querySelector(`.sitem[data-tab=${t}]`))?.click(), tab); await page.waitForTimeout(1000); };
const tidy = (page) => page.evaluate((origin) => {
  const real = 'https://seerah-quest.fly.dev';
  for (const el of document.querySelectorAll('input')) if (el.value.includes(origin)) el.value = el.value.replace(origin, real);
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) if (w.currentNode.nodeValue.includes(origin)) w.currentNode.nodeValue = w.currentNode.nodeValue.replace(origin, real);
}, B);
const shot = async (page, name, opts = {}) => { await tidy(page); await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 80, ...opts }); console.log('shot', name); };
const shotEl = async (page, sel, name) => { await tidy(page); await page.locator(sel).first().screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 80 }); console.log('shot', name); };
const scrollTo = async (page, sel) => { await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: 'start' })); await page.evaluate(() => scrollBy(0, -70)); await page.waitForTimeout(400); };

// welcome, intro and the sign-in forms
{
  const page = await open(null, { intro: false });
  await shot(page, 'intro-1');
  await act(page, '[data-act=intronext]');
  await act(page, '[data-act=intronext]'); await shot(page, 'intro-3');
  await act(page, '[data-act=intronext]'); await shot(page, 'login');
  await act(page, '[data-mode=register]');
  await page.fill('[name=invite]', 'ayesha_k'); await page.locator('[name=invite]').blur(); await page.waitForTimeout(600);
  await shot(page, 'register', { fullPage: true });
  await act(page, '[data-mode=waitlist]'); await shot(page, 'waitlist');
  await act(page, '[data-mode=login]'); await act(page, '[data-mode=forgot]'); await shot(page, 'forgot');
  await page.close();
}

const me = tok.ayesha_k;
// Today
{
  const page = await open(me);
  await shot(page, 'today');
  await page.fill('#manual', '500'); await page.waitForTimeout(200);
  await shotEl(page, '.numbox', 'numbox');
  await page.fill('#manual', '');
  await act(page, '[data-act=taptoggle]');
  for (let i = 0; i < 7; i++) await page.locator('[data-act=tap]').click();
  await page.waitForTimeout(300);
  await scrollTo(page, '.numbox');
  await shot(page, 'tap-counter');
  await act(page, '[data-act=preset]'); await act(page, '[data-act=taptoggle]');
  await page.fill('#manual', '313'); await act(page, '[data-act=manual]', 900);
  await page.locator('[data-act=celebrateX]').click().catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, 'saved-undo');
  await page.waitForTimeout(5500);
  await page.evaluate(() => scrollTo(0, 0));
  await scrollTo(page, '.fold');
  await shot(page, 'today-sections');
  await page.close();
}
{
  const page = await open(me, { folds: { quests: true, seerah: true, challenge: true } });
  await scrollTo(page, '.fold');
  await page.evaluate(() => scrollBy(0, 220)); await page.waitForTimeout(300);
  await shot(page, 'quests');
  for (const [sel, name] of [['[data-k=seerah]', 'sunnah'], ['.circlecard', 'circle'], ['.challenge', 'challenge']]) {
    if (await page.locator(sel).count()) { await scrollTo(page, sel); await shot(page, name); }
  }
  await page.close();
}
// menu, + sheet, news
{
  const page = await open(me);
  await act(page, '.tabs [data-act=drawer]'); await shot(page, 'menu');
  await act(page, '[data-act=drawerx]');
  await go(page, 'feed'); await shot(page, 'feed');
  await act(page, '.hadd'); await shot(page, 'add-sheet');
  await act(page, '[data-act=sheetx]');
  await page.close();
}
// Compete
{
  const page = await open(me);
  await go(page, 'rank'); await page.evaluate(() => document.querySelector('.seg.five')?.scrollIntoView({ block: 'start' })); await page.evaluate(() => scrollBy(0, -70)); await page.waitForTimeout(400);
  await shot(page, 'rank-people');
  for (const [type, name] of [['league', 'rank-league'], ['caravans', 'rank-caravans']]) {
    for (let i = 0; i < 3 && !(await page.locator(`[data-act=board][data-type=${type}].on`).count()); i++) {
      await page.evaluate((t) => document.querySelector(`[data-act=board][data-type=${t}]`).click(), type); await page.waitForTimeout(1200);
    }
    await shot(page, name);
  }
  await page.close();
}
// Caravan and Qabila
{
  const page = await open(me);
  await go(page, 'caravan'); await shot(page, 'caravan');
  await page.evaluate(() => scrollBy(0, 600)); await page.waitForTimeout(300); await shot(page, 'caravan-2');
  await go(page, 'qabila'); await shot(page, 'qabila');
  await page.evaluate(() => scrollBy(0, 600)); await page.waitForTimeout(300); await shot(page, 'qabila-2');
  await page.close();
  const p2 = await open(tok.maryam_n);
  await go(p2, 'caravan'); await shot(p2, 'caravan-none');
  await p2.close();
}
// Me (progress), history, settings, tasks
{
  const page = await open(me, { folds: { history: true, badges: true } });
  await go(page, 'progress'); await shot(page, 'me');
  for (const k of ['history', 'badges']) {
    const head = page.locator(`[data-act=fold][data-k=${k}]`);
    if (await head.count()) { if ((await head.getAttribute('aria-expanded')) !== 'true') { await head.click(); await page.waitForTimeout(500); } await scrollTo(page, `[data-act=fold][data-k=${k}]`); await shot(page, k === 'history' ? 'history' : 'badges'); }
  }
  if (await page.locator('[data-act=edit]').count()) { await act(page, '[data-act=edit]'); await shot(page, 'history-edit'); }
  await page.close();
}
{
  const page = await open(me);
  await go(page, 'settings'); await shot(page, 'settings');
  await page.evaluate(() => scrollBy(0, 700)); await page.waitForTimeout(300); await shot(page, 'settings-2');
  await go(page, 'tasks'); await shot(page, 'tasks');
  await go(page, 'people'); await shot(page, 'people');
  await page.close();
}
// dark, Urdu, wide screen
{
  const page = await open(me, { mode: 'dark' }); await shot(page, 'today-dark'); await page.close();
  const ur = await open(me); await ur.evaluate(() => document.querySelector('[data-act=setlang][data-l=ur]').click()); await ur.waitForTimeout(2000); await ur.evaluate(() => scrollTo(0, 0)); await shot(ur, 'today-urdu');
  await ur.evaluate(() => document.querySelector('[data-act=setlang][data-l=en]').click()); await ur.waitForTimeout(1000); await ur.close();
  const wide = await open(me, { w: 1280, h: 800 }); await shot(wide, 'today-desktop'); await wide.close();
}
// extra screens for the feature brochure: dark versions and the lecture player
{
  const page = await open(me, { mode: 'dark' });
  await go(page, 'feed'); await shot(page, 'feed-dark');
  await go(page, 'rank'); await page.evaluate(() => document.querySelector('[data-act=board][data-type=league]').click()); await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.seg.five')?.scrollIntoView({ block: 'start' })); await page.evaluate(() => scrollBy(0, -70)); await page.waitForTimeout(300);
  await shot(page, 'league-dark');
  await go(page, 'caravan'); await shot(page, 'caravan-dark');
  await go(page, 'progress'); await shot(page, 'me-dark');
  await page.close();
  const lp = await open(me, { folds: { seerah: true } });
  // a calm stand-in for the YouTube embed, so no real video appears in the pictures
  await lp.route(/youtube/, (r) => r.fulfill({ contentType: 'text/html', body: `<body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#3a2f6b,#0c0e2b 70%);font:600 15px system-ui;color:#f0cf86;text-align:center">
    <div><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="rgba(240,207,134,.15)" stroke="#f0cf86" stroke-width="2"/><path d="M26 20l18 12-18 12z" fill="#f0cf86"/></svg><div style="margin-top:10px">The Hijrah: leaving Makkah for Madinah</div><div style="opacity:.7;font-weight:400;font-size:13px">Seerat Circle</div></div></body>` }));
  await lp.evaluate(() => document.querySelector('[data-act=watch]').click()); await lp.waitForTimeout(1500);
  await shot(lp, 'lecture');
  await lp.close();
}

await browser.close();
server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('done:', out);
process.exit(0);
