// Captures real app screens for the promos: starts the app on a throwaway database, seeds a demo community
// over the past week (so streaks, weekly ranks, city boards and caravans have something to show), then
// screenshots each screen at phone size, in dark mode (the promos are set at night).
//   APP_DIR=../app node tools/capture.mjs [out-dir]      (default out-dir: assets/shots)
// APP_DIR is a checkout of the app branch, e.g. `git worktree add ../app claude/durood-social-rpg-app-cwz6av`.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(process.env.APP_DIR || '../app');
const OUT = path.resolve(process.argv[2] || 'assets/shots');
fs.mkdirSync(OUT, { recursive: true });

// A movable clock: the community is seeded day by day over the past week, then the clock returns to now.
let off = 0; const Real = Date;
globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); } static now() { return Real.now() + off; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-promo-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'promo.db'), ADMIN_KEY: 'promo-admin-key-long-enough-1234', EDITION: 'public',
  PUBLIC_FOUNDERS_CODE: 'PROMO', PUBLIC_CACHE_MS: '0', NODE_ENV: 'test', FLAG_NEW_HIGH: '1000000000' });
const { chromium } = createRequire(import.meta.url)('playwright');
const { createServer } = await import(pathToFileURL(path.join(APP, 'server/index.js')).href);
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`;
const api = (m, p, body, token) => fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

const CITY = { Lahore: 1172451, Karachi: 1174872, Islamabad: 1176615, Peshawar: 1168197, Multan: 1169825, Faisalabad: 1179400 };
// A seeded demo (fixed random seed, so a re-capture gives the same numbers): username, display name, city, durood per day
const PEOPLE = [
  ['ayesha', 'Ayesha Siddiqui', 'Lahore', 1200], ['bilal', 'Bilal Ahmed', 'Lahore', 950], ['hamza', 'Hamza Qureshi', 'Karachi', 1500],
  ['fatima', 'Fatima Noor', 'Karachi', 800], ['usman', 'Usman Tariq', 'Islamabad', 1100], ['zainab', 'Zainab Ali', 'Islamabad', 700],
  ['umar', 'Umar Farooq', 'Peshawar', 1300], ['maryam', 'Maryam Khan', 'Multan', 900], ['ibrahim', 'Ibrahim Shah', 'Faisalabad', 600],
  ['khadija', 'Khadija Raza', 'Lahore', 1000], ['saad', 'Saad Hussain', 'Karachi', 650], ['hira', 'Hira Malik', 'Lahore', 850],
  ['ali', 'Ali Haider', 'Lahore', 700], ['sana', 'Sana Javed', 'Karachi', 1150], ['yusuf', 'Yusuf Iqbal', 'Karachi', 500],
  ['amna', 'Amna Sheikh', 'Islamabad', 900], ['hassan', 'Hassan Mirza', 'Islamabad', 750], ['rabia', 'Rabia Anwar', 'Islamabad', 600],
  ['talha', 'Talha Butt', 'Peshawar', 800], ['noor', 'Noor Fatima', 'Peshawar', 950], ['zaid', 'Zaid Khan', 'Peshawar', 700],
  ['asma', 'Asma Gul', 'Peshawar', 650], ['huzaifa', 'Huzaifa Aslam', 'Multan', 850], ['iqra', 'Iqra Nadeem', 'Multan', 700],
  ['arham', 'Arham Riaz', 'Multan', 600], ['laiba', 'Laiba Saleem', 'Multan', 900], ['anas', 'Anas Zafar', 'Faisalabad', 1000],
  ['mahnoor', 'Mahnoor Akhtar', 'Faisalabad', 800], ['abdullah', 'Abdullah Rana', 'Faisalabad', 750], ['eman', 'Eman Yousaf', 'Faisalabad', 650],
];
const CARAVAN = ['bilal', 'khadija', 'hira', 'ali', 'usman', 'sana', 'noor'];
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const DAYS = 7;
let n = 0;
const tok = {};
off = -DAYS * 86400e3;
for (const [u, name, city] of PEOPLE) {
  const r = await api('POST', '/api/register', { username: u, email: `${u}@promo.pk`, phone: `0303${4000000 + ++n}`, password: 'secret12', cityId: CITY[city], invite: 'PROMO', lang: 'en' });
  if (!r.token) throw new Error(`register ${u}: ${JSON.stringify(r)}`);
  tok[u] = r.token;
  await api('PUT', '/api/me/profile', { displayName: name }, r.token);
}
await api('POST', '/api/caravan', { name: 'MadinaCaravan' }, tok.ayesha);
for (const u of CARAVAN) await api('POST', '/api/caravan/invite', { username: u }, tok.ayesha);
for (const u of CARAVAN) {
  const inv = ((await api('GET', '/api/caravan', null, tok[u])).invitations || [])[0];
  if (inv) await api('POST', `/api/caravan/invitations/${inv.id}`, { accept: true }, tok[u]);
}
for (let d = DAYS; d >= 0; d--) {
  off = -d * 86400e3 + (d ? 0 : -60e3);
  for (const [u, , , per] of PEOPLE) {
    if (d === 0 && u === 'ayesha') continue; // the hero member logs today's durood on camera
    await api('POST', '/api/log', { count: Math.round(per * (0.8 + rnd() * 0.4)), rid: crypto.randomUUID() }, tok[u]);
  }
}
off = 0;
await api('POST', '/api/log', { count: 313, rid: crypto.randomUUID() }, tok.ayesha);

const browser = await chromium.launch();
const shots = [];
async function openApp({ mode = 'dark', lang = 'en', folds = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(B + '/');
  await page.evaluate(([t, l, md, f]) => { localStorage.setItem('token', t); localStorage.setItem('intro', '1'); localStorage.setItem('lang', l); localStorage.setItem('mode', md); localStorage.setItem('folds', f); }, [tok.ayesha, lang, mode, JSON.stringify(folds)]);
  await page.goto(B + '/');
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: '*{caret-color:transparent!important}' });
  return page;
}
const click = async (page, sel, wait = 900) => { await page.evaluate((s) => document.querySelector(s)?.click(), sel); await page.waitForTimeout(wait); };
const scrollTo = async (page, sel, gap = 70) => { await page.evaluate(([s, g]) => { const el = document.querySelector(s); if (el) window.scrollTo(0, el.getBoundingClientRect().top + scrollY - g); }, [sel, gap]); await page.waitForTimeout(500); };
async function shot(name, prep, opts) {
  const page = await openApp(opts);
  if (prep) await prep(page);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  await page.close();
}

// Today with the tap counter open, one screenshot per tap (tap-00 is before the first tap), so the video plays real counting
async function tapSequence(taps) {
  const page = await openApp();
  await click(page, '[data-act=taptoggle]', 400);
  await page.evaluate(() => window.scrollTo(0, 90)); // as a member would, so the tap button sits mid-screen
  await page.waitForTimeout(600);
  for (let i = 0; i <= taps; i++) {
    if (i) await click(page, '[data-act=tap]', 350);
    const file = path.join(OUT, `tap-${String(i).padStart(2, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    shots.push(file);
  }
  await page.close();
}
await tapSequence(20);
await shot('caravan', (p) => click(p, '[data-tab=caravan]'));
await shot('rank', async (p) => { await click(p, '[data-tab=rank]'); await scrollTo(p, '.seg.five'); });
await shot('cities', async (p) => { await click(p, '[data-tab=rank]'); await click(p, '[data-act=board][data-type=cities]'); await scrollTo(p, '.seg.five'); });
await shot('me', (p) => click(p, '[data-tab=progress]'));
await shot('badges', async (p) => { await click(p, '[data-tab=progress]'); await scrollTo(p, '.fold.open', 20); }, { folds: { badges: true } });
await browser.close();
server.close();
console.log(shots.join('\n'));
process.exit(0);
