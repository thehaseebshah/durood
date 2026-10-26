// Captures real app screens for the promos: starts the app on a throwaway database, seeds a small demo
// community over the past week (so streaks, weekly ranks and caravans have something to show), then
// screenshots each screen at phone size.
//   APP_DIR=../app node tools/capture.mjs [out-dir]      (default out-dir: shots/)
// APP_DIR is a checkout of the app branch, e.g. `git worktree add ../app claude/durood-social-rpg-app-cwz6av`.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(process.env.APP_DIR || '../app');
const OUT = path.resolve(process.argv[2] || 'shots');
fs.mkdirSync(OUT, { recursive: true });

// A movable clock: the demo community is seeded day by day over the past week, then the clock returns to now.
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
// username, display name, city, durood per day (a little noise is added)
const PEOPLE = [
  ['ayesha', 'Ayesha Siddiqui', 'Lahore', 1200], ['bilal', 'Bilal Ahmed', 'Lahore', 950], ['hamza', 'Hamza Qureshi', 'Karachi', 1500],
  ['fatima', 'Fatima Noor', 'Karachi', 800], ['usman', 'Usman Tariq', 'Islamabad', 1100], ['zainab', 'Zainab Ali', 'Islamabad', 700],
  ['umar', 'Umar Farooq', 'Peshawar', 1300], ['maryam', 'Maryam Khan', 'Multan', 900], ['ibrahim', 'Ibrahim Shah', 'Faisalabad', 600],
  ['khadija', 'Khadija Raza', 'Lahore', 1000], ['saad', 'Saad Hussain', 'Karachi', 650], ['hira', 'Hira Malik', 'Lahore', 850],
];
const DAYS = 7;
let n = 0;
const tok = {};
off = -DAYS * 86400e3;
for (const [u, name, city] of PEOPLE) {
  const r = await api('POST', '/api/register', { username: u, email: `${u}@promo.pk`, phone: `0303${4000000 + ++n}`, password: 'secret12', cityId: CITY[city], invite: n === 1 || n > 9 ? 'PROMO' : 'ayesha', lang: 'en' });
  if (!r.token) throw new Error(`register ${u}: ${JSON.stringify(r)}`);
  tok[u] = r.token;
  await api('PUT', '/api/me/profile', { displayName: name }, r.token);
}
await api('POST', '/api/caravan', { name: 'MadinaCaravan' }, tok.ayesha);
for (const u of ['bilal', 'khadija', 'hira', 'usman']) { await api('POST', '/api/caravan/invite', { username: u }, tok.ayesha); }
for (const u of ['bilal', 'khadija', 'hira', 'usman']) {
  const v = await api('GET', '/api/caravan', null, tok[u]);
  const inv = (v.invitations || v.invites || [])[0];
  if (inv) await api('POST', `/api/caravan/invitations/${inv.id}`, { accept: true, action: 'accept' }, tok[u]);
}
for (let d = DAYS; d >= 0; d--) {
  off = -d * 86400e3 + (d ? 0 : -60e3);
  for (const [u, , , per] of PEOPLE) {
    if (d === 0 && u === 'ayesha') continue; // the hero member logs today's durood on camera
    const c = Math.round(per * (0.8 + Math.random() * 0.4));
    await api('POST', '/api/log', { count: c, rid: crypto.randomUUID() }, tok[u]);
  }
}
off = 0;
await api('POST', '/api/log', { count: 340, rid: crypto.randomUUID() }, tok.ayesha);

const browser = await chromium.launch();
const shots = [];
async function shot(name, { tab = 'home', mode = 'light', lang = 'en', before } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(B + '/');
  await page.evaluate(([t, l, md]) => { localStorage.setItem('token', t); localStorage.setItem('intro', '1'); localStorage.setItem('lang', l); localStorage.setItem('mode', md); }, [tok.ayesha, lang, mode]);
  await page.goto(B + '/');
  await page.waitForTimeout(1000);
  if (tab !== 'home') { await page.evaluate((t) => document.querySelector(`[data-tab=${t}]`)?.click(), tab); await page.waitForTimeout(1000); }
  if (before) await before(page);
  await page.addStyleTag({ content: '*{caret-color:transparent!important}' });
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  await page.close();
}
// Today with the tap counter open, one screenshot per tap (tap-00 is before the first tap), so the video can play real counting
async function tapSequence(taps) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(B + '/');
  await page.evaluate((t) => { localStorage.setItem('token', t); localStorage.setItem('intro', '1'); localStorage.setItem('lang', 'en'); localStorage.setItem('mode', 'light'); }, tok.ayesha);
  await page.goto(B + '/');
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelector('[data-act=taptoggle]')?.click());
  await page.evaluate(() => window.scrollTo(0, 90)); // as a member would, so the tap button sits mid-screen (clear of TikTok's controls in the video)
  await page.waitForTimeout(600);
  for (let i = 0; i <= taps; i++) {
    if (i) { await page.evaluate(() => document.querySelector('[data-act=tap]')?.click()); await page.waitForTimeout(350); }
    const file = path.join(OUT, `tap-${String(i).padStart(2, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    shots.push(file);
  }
  await page.close();
}
await shot('home');
await tapSequence(12);
await shot('rank', { tab: 'rank', before: async (page) => { // the board itself, not the challenge card above it
  await page.evaluate(() => { const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'People'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 70); });
  await page.waitForTimeout(500); } });
await shot('caravan', { tab: 'caravan' });
await shot('me', { tab: 'progress' });
await shot('home-dark', { mode: 'dark' });
await shot('home-ur', { before: async (page) => { await page.evaluate(() => document.querySelector('[data-act=setlang][data-l=ur]')?.click()); await page.waitForTimeout(1500); } });
await browser.close();
server.close();
console.log(shots.join('\n'));
process.exit(0);
