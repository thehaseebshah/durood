// Captures every screen of the app as released (the Al-Burhan edition: everything public, plus tasks, routines, My people,
// murabbi and masul, majalis) for the complete promo (videos/003-*). Like tools/capture-tour.mjs: starts the app on a
// throwaway database, seeds a demo community over the past week (all men, all names made up), then photographs each screen
// on a phone in light mode. The Mamulaat app is stood in for inside this process.
//   APP_DIR=../app node tools/capture-full.mjs [out-dir]      (default out-dir: assets/full)
// Output as in capture-tour: <name>.jpg (phone view), <name>-full.jpg (whole page under the header and tab bar), frame
// sequences <name>-NN.jpg, and manifest.json: page heights, header and tab bar, the box of each known element (r) and of
// every section heading by its text (heads), so a video can spotlight anything exactly.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(process.env.APP_DIR || '../app');
const OUT = path.resolve(process.argv[2] || 'assets/full');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// A movable clock: the week of history is seeded day by day, then the clock returns to now. The browser keeps real time.
let off = 0; const Real = Date;
globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); } static now() { return Real.now() + off; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-full-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'full.db'), ADMIN_KEY: 'full-admin-key-long-enough-1234', EDITION: 'internal',
  PUBLIC_FOUNDERS_CODE: 'SEERAH2026', PUBLIC_CACHE_MS: '0', NODE_ENV: 'test', FLAG_NEW_HIGH: '1000000000', REG_LIMIT_PER_HOUR: '1000',
  CIRCLE_URL: 'https://example.org/seerat-circles', MAMULAAT_API_URL: 'http://127.0.0.1:9/unused', MAMULAAT_API_KEY: 'unused' });
const { chromium } = createRequire(import.meta.url)('playwright');
const { createServer } = await import(pathToFileURL(path.join(APP, 'server/index.js')).href);
const burhan = await import(pathToFileURL(path.join(APP, 'server/burhan.js')).href);
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
const soft = (p) => p.catch((e) => console.log('  (skipped)', e.message.slice(0, 140)));
const cityId = async (q) => (await api('GET', `/api/cities?q=${encodeURIComponent(q)}&cc=PK`)).cities[0].id;
const pkDay = (ms = Date.now()) => new Real(ms + 5 * 3600e3).toISOString().slice(0, 10);

// ---- the community: men only, names made up -------------------------------------------------------------------------------
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Peshawar', 'Multan', 'Faisalabad'];
const city = {}; for (const c of CITIES) city[c] = await cityId(c);
// username, display name, city, durood a day, inviter (a username, or the public founders code)
const PEOPLE = [
  ['ahmed', 'Ahmed Raza', 'Lahore', 1300, 'SEERAH2026'], ['bilal', 'Bilal Ahmed', 'Lahore', 2100, 'SEERAH2026'],
  ['hamza', 'Hamza Qureshi', 'Karachi', 1900, 'SEERAH2026'], ['usman', 'Usman Tariq', 'Islamabad', 1250, 'ahmed'],
  ['umar', 'Umar Farooq', 'Peshawar', 1400, 'SEERAH2026'], ['ibrahim', 'Ibrahim Shah', 'Faisalabad', 700, 'bilal'],
  ['ali', 'Ali Haider', 'Lahore', 720, 'ahmed'], ['saad', 'Saad Hussain', 'Karachi', 600, 'hamza'],
  ['talha', 'Talha Butt', 'Peshawar', 820, 'umar'], ['zaid', 'Zaid Khan', 'Peshawar', 700, 'umar'],
  ['anas', 'Anas Zafar', 'Faisalabad', 1020, 'bilal'], ['yusuf', 'Yusuf Iqbal', 'Lahore', 540, 'ahmed'],
  ['hassan', 'Hassan Mirza', 'Islamabad', 780, 'usman'], ['huzaifa', 'Huzaifa Aslam', 'Multan', 870, 'SEERAH2026'],
  ['arham', 'Arham Riaz', 'Multan', 610, 'huzaifa'], ['abdullah', 'Abdullah Rana', 'Faisalabad', 760, 'SEERAH2026'],
  ['fahad', 'Fahad Malik', 'Karachi', 1150, 'hamza'], ['owais', 'Owais Siddiqui', 'Karachi', 800, 'hamza'],
  ['zubair', 'Zubair Anwar', 'Islamabad', 900, 'SEERAH2026'], ['faisal', 'Faisal Javed', 'Islamabad', 640, 'zubair'],
  ['hamid', 'Hamid Gul', 'Peshawar', 950, 'umar'], ['junaid', 'Junaid Akhtar', 'Multan', 720, 'huzaifa'],
  ['shoaib', 'Shoaib Nadeem', 'Multan', 930, 'SEERAH2026'], ['rizwan', 'Rizwan Sheikh', 'Faisalabad', 810, 'abdullah'],
  ['imran', 'Imran Saleem', 'Lahore', 850, 'ahmed'], ['kashif', 'Kashif Yousaf', 'Faisalabad', 650, 'abdullah'],
  ['waqas', 'Waqas Noor', 'Peshawar', 660, 'SEERAH2026'], ['moiz', 'Moiz Ali', 'Lahore', 700, 'bilal'],
  ['danish', 'Danish Khan', 'Karachi', 500, 'SEERAH2026'], ['haris', 'Haris Baig', 'Islamabad', 600, 'zubair'],
];
const BIO = { ahmed: 'Durood before Fajr, every day.', bilal: 'Father of three. Seerah student.', hamza: 'Karachi · Seerat Circle teacher', umar: 'Peshawar. Murabbi.' };
const LAGS = new Set(['moiz']);                                    // stops reciting: Bilal's caravan shows him as falling behind
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const tok = {}, phone = {};
let n = 0;
const DAYS = 8;
let heroSum = 0;
// the Mamulaat app, stood in for: who each member's murabbi is, and a daily mamulaat percentage
const MURABBI = { ahmed: 'umar', hamza: 'ahmed', ali: 'ahmed', ibrahim: 'ahmed' };
const digits = (p) => String(p).replace(/\D/g, '');
burhan.setProvider({
  async murabbiOf(p) { const u = Object.keys(MURABBI).find((k) => digits(phone[k]) === digits(p)); return u ? { name: PEOPLE.find((x) => x[0] === MURABBI[u])[1], whatsapp: digits(phone[MURABBI[u]]) } : null; },
  async days(p, from, to) { const out = []; for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) { const d = new Real(t).toISOString().slice(0, 10); out.push({ day: d, percent: 55 + ((Number(digits(p).slice(-3)) + Number(d.slice(-2)) * 13) % 44) }); } return out; },
});

off = -DAYS * 864e5;
for (const [u, name, c, , inv] of PEOPLE) {
  phone[u] = `+92300${1234500 + ++n}`;
  const r = await api('POST', '/api/register', { username: u, email: `${u}@example.pk`, phone: `0300${1234500 + n}`, password: 'tour12345', cityId: city[c], invite: inv, lang: 'en' });
  tok[u] = r.token;
  await soft(api('PUT', '/api/me/profile', { displayName: name, bio: BIO[u] || '' }, r.token));
}
// caravans from the first day, so their streaks run all week
async function caravan(owner, name, display, members) {
  await api('POST', '/api/caravan', { name }, tok[owner]);
  await soft(api('PUT', '/api/caravan/display-name', { displayName: display }, tok[owner]));
  for (const u of members) {
    await soft(api('POST', '/api/caravan/invite', { username: u }, tok[owner]));
    const v = await api('GET', '/api/caravan', null, tok[u]);
    if (v.invitations?.[0]) await api('POST', `/api/caravan/invitations/${v.invitations[0].id}`, { accept: true }, tok[u]);
  }
}
await caravan('ahmed', 'noor_caravan', 'Noor Caravan', ['usman', 'ali', 'imran', 'hassan', 'yusuf', 'zubair']);
await caravan('bilal', 'madinah_riders', 'Madinah Riders', ['ibrahim', 'anas', 'abdullah', 'moiz', 'rizwan']);
await caravan('hamza', 'karachi_lovers', 'Karachi Ashiqan', ['saad', 'fahad', 'owais']);
await caravan('umar', 'peshawar_noor', 'Peshawar Noor', ['talha', 'zaid', 'hamid', 'waqas']);
await soft(api('POST', '/api/caravan/join', { name: 'noor_caravan' }, tok.haris));
// majalis: everyone in one of three, so the majlis board fills
const mj = await api('GET', '/api/majalis', null, tok.ahmed);
const MJ = Object.fromEntries((mj.majalis || mj.list || []).map((m) => [m.nameEn || m.name_en || m.name, m.id]));
const pickMj = (i) => MJ[['Seerat', 'Shabab', 'Ilm e Deen'][i % 3]] ?? Object.values(MJ)[i % Math.max(1, Object.values(MJ).length)];
for (const [i, [u]] of PEOPLE.entries()) await soft(api('PUT', '/api/me/majlis', { id: u === 'ahmed' ? (MJ.Seerat ?? pickMj(0)) : pickMj(i) }, tok[u]));
// masul and razakars: Bilal is Ahmed's masul; Ahmed leads five razakars in two teams
await api('PUT', '/api/burhan/masul', { username: 'bilal' }, tok.ahmed);
for (const u of ['usman', 'talha', 'zaid', 'anas', 'saad']) await api('PUT', '/api/burhan/masul', { username: 'ahmed' }, tok[u]);
for (const [u, tags] of [['usman', ['lahore', 'events']], ['talha', ['peshawar']], ['zaid', ['peshawar', 'events']], ['anas', ['events']], ['saad', ['karachi']]]) await soft(api('PUT', `/api/burhan/razakars/${u}/tags`, { tags }, tok.ahmed));
// a task Ahmed did earlier in the week, and one now two days late
off = -4 * 864e5;
await soft(api('POST', '/api/tasks', { kind: 'task', title: 'Print the circle timetable', dueDay: pkDay(Date.now() + 864e5) }, tok.ahmed));
await soft(api('POST', '/api/tasks', { kind: 'task', title: 'Return the library books', dueDay: pkDay(Date.now() + 2 * 864e5) }, tok.ahmed));
off = -3 * 864e5;
const st0 = await api('GET', '/api/burhan', null, tok.ahmed);
const printed = (st0.assignments || []).find((a) => a.title === 'Print the circle timetable');
if (printed) await soft(api('POST', `/api/assignments/${printed.id}/tick`, { done: true }, tok.ahmed));
off = 0;
for (let d = 0; d < DAYS; d++) {
  off = -(DAYS - d) * 864e5 + 3 * 3600e3;
  for (const [u, , , per] of PEOPLE) {
    if (u === 'haris' && d % 2) continue;                        // someone skips days
    if (LAGS.has(u) && d >= DAYS - 4) continue;                  // and someone has stopped
    let count = Math.round(per * (0.8 + rnd() * 0.4));
    // Ahmed's week adds up to 9,200, so with 700 this morning the 313 he adds on camera crosses both his goal and 10,000
    if (u === 'ahmed') { if (d === DAYS - 1) count = 9200 - heroSum; heroSum += count; }
    await api('POST', '/api/log', { count, rid: crypto.randomUUID() }, tok[u]);
  }
}
// lectures: last week's and this week's (a lecture belongs to the week it is added in); two members watched this one and commented
off = -7 * 864e5;
await soft(api('POST', '/api/admin/lectures', { youtube_id: 'dQw4w9WgXcQ', title_en: 'The cave of Hira: the first revelation', title_ur: 'غارِ حرا: پہلی وحی', speaker: 'Seerat Circle', min_seconds: 900, xp: 150 }, null, K));
off = 0;
const lec = await api('POST', '/api/admin/lectures', { youtube_id: 'dQw4w9WgXcQ', title_en: 'The Hijrah: leaving Makkah for Madinah', title_ur: 'ہجرت: مکہ سے مدینہ', speaker: 'Seerat Circle', min_seconds: 900, xp: 150,
  questions: [{ q_en: 'Which city did the Prophet ﷺ migrate to?', q_ur: 'نبی ﷺ نے کس شہر کی طرف ہجرت کی؟', options_en: ['Taif', 'Madinah', 'Jerusalem'], options_ur: ['طائف', 'مدینہ', 'یروشلم'], answer: 1 }] }, null, K);
off = -2 * 3600e3;
for (const [u, text] of [['hamza', 'Subhan Allah, the trust the Prophet ﷺ placed in Allah on the night of the Hijrah.'], ['bilal', 'Watched it with my sons. The cave of Thawr scene stayed with them.']]) {
  await soft(api('POST', `/api/lectures/${lec.id}/start`, null, tok[u]));
  off += 20 * 60e3;
  await soft(api('POST', `/api/lectures/${lec.id}/quiz`, { answers: [1] }, tok[u]));
  await soft(api('POST', `/api/lectures/${lec.id}/complete`, null, tok[u]));
  await soft(api('POST', `/api/lectures/${lec.id}/comment`, { text }, tok[u]));
}
off = 0;
// today: everyone but Ahmed (he logs on camera) and the ones who stopped has recited something; Ahmed starts at 700 of 1,000
for (const [u, , , per] of PEOPLE) if (!['ahmed', 'haris'].includes(u) && !LAGS.has(u)) await api('POST', '/api/log', { count: Math.round(per * 0.7), rid: crypto.randomUUID() }, tok[u]);
await api('POST', '/api/log', { count: 700, rid: crypto.randomUUID() }, tok.ahmed);
await soft(api('PATCH', '/api/me', { dailyGoal: 1000 }, tok.ahmed));
// Ahmed's tasks and routines: his own, and from Bilal (he asks for more time on one); his team gets a task
const today = pkDay(), plus = (k) => pkDay(Date.now() + k * 864e5);
const dow = new Real(Date.now() + 5 * 3600e3).getUTCDay();   // routines take weekdays as Sunday = 0
await soft(api('POST', '/api/tasks', { kind: 'task', title: 'Read one page of Seerah', dueDay: today }, tok.ahmed));
await soft(api('POST', '/api/tasks', { kind: 'task', title: 'Call Usman about the circle', dueDay: plus(1) }, tok.ahmed));
await soft(api('POST', '/api/tasks', { kind: 'routine', title: 'Surah Al-Kahf', weekdays: [5] }, tok.ahmed));
await soft(api('POST', '/api/tasks', { kind: 'routine', title: 'Morning adhkar', weekdays: [0, 1, 2, 3, 4, 5, 6] }, tok.ahmed));
await soft(api('POST', '/api/assignments', { razakar: 'ahmed', kind: 'task', title: 'Visit the new members', dueDay: today }, tok.bilal));
await soft(api('POST', '/api/assignments', { razakar: 'ahmed', kind: 'task', title: 'Bring the banner for Jumuah', dueDay: plus(2) }, tok.bilal));
await soft(api('POST', '/api/assignments', { razakar: 'ahmed', kind: 'routine', title: 'Majlis-e-Zikr', weekdays: [dow] }, tok.bilal));
const st1 = await api('GET', '/api/burhan', null, tok.ahmed);
const banner = (st1.assignments || []).find((a) => a.title === 'Bring the banner for Jumuah');
if (banner) await soft(api('POST', `/api/assignments/${banner.id}/due-request`, { day: plus(4) }, tok.ahmed));
await soft(api('POST', '/api/assignments', { team: 'events', kind: 'task', title: 'Set up chairs for the Seerat Circle', dueDay: plus(1) }, tok.ahmed));
await soft(api('POST', '/api/assignments', { razakar: 'usman', kind: 'routine', title: 'Weekly report', weekdays: [4] }, tok.ahmed));
for (const u of ['usman', 'anas']) { const s = await api('GET', '/api/burhan', null, tok[u]); for (const a of (s.assignments || []).slice(0, 1)) await soft(api('POST', `/api/assignments/${a.id}/tick`, { done: true }, tok[u])); }
await soft(api('POST', '/api/tasks', { kind: 'task', title: 'Buy dates for the iftar', dueDay: today }, tok.usman)); // Usman's own, seen by Ahmed as "their own"
// murabbi: Umar is Ahmed's; Ahmed is murabbi to Hamza and Ali (linked) and Ibrahim (waiting for Ahmed)
for (const u of ['ahmed', 'hamza', 'ali', 'ibrahim']) { await soft(api('POST', '/api/burhan/murabbi', null, tok[u])); await soft(api('POST', '/api/burhan/murabbi/confirm', null, tok[u])); }
await soft(api('POST', '/api/burhan/requests/ahmed', { accept: true }, tok.umar));
for (const u of ['hamza', 'ali']) await soft(api('POST', `/api/burhan/requests/${u}`, { accept: true }, tok.ahmed));
// the challenge has a name, and the next one is planned
await soft(api('PUT', '/api/admin/challenge/name', { nameEn: 'Rabi ul Awwal challenge', nameUr: 'ربیع الاول چیلنج' }, null, K));
await soft(api('POST', '/api/admin/challenge/plans', { nameEn: 'Ramadan challenge', nameUr: 'رمضان چیلنج', start: plus(45), days: 30, target: 50_000_000 }, null, K));
// content: today's sunnah, news, reflections with likes and replies, cheers on milestones
await api('POST', '/api/admin/sunnahs', { sunnahs: [{ day: today, title_en: 'Smile when you meet someone', title_ur: 'مسکرا کر ملنا', desc_en: 'Your smile in the face of your brother is charity.', desc_ur: 'اپنے بھائی کے سامنے مسکرانا صدقہ ہے۔', source: 'Tirmidhi 1956' }] }, null, K);
await soft(api('POST', '/api/admin/news', { title_en: 'Day 9 of the Rabi ul Awwal challenge', body_en: 'JazakAllah to everyone reciting. Add your count each day, and invite one person you know. Every durood is dedicated to the Seerat Circles.' }, null, K));
const refl = [];
for (const [u, text] of [['hamza', 'Sending durood before Fajr made the whole morning feel lighter today.'], ['bilal', 'Read about the Hijrah with my sons tonight. They asked so many good questions.'], ['usman', 'My caravan kept me going on a tiring day. 9 days in a row now, alhamdulillah.']]) {
  const r = await soft(api('POST', '/api/reflections', { text }, tok[u])); if (r?.id) refl.push([r.id, u]);
}
for (const [id, owner] of refl) for (const u of ['zaid', 'talha', 'fahad', 'owais', 'ali', 'hamid', 'ahmed'].filter((x) => x !== owner).slice(0, 4 + (id % 3))) await soft(api('POST', '/api/like', { kind: 'reflection', id }, tok[u]));
if (refl[0]) { await soft(api('POST', '/api/replies', { kind: 'reflection', id: refl[0][0], text: 'Ameen! Same for me today.' }, tok.fahad)); await soft(api('POST', '/api/replies', { kind: 'reflection', id: refl[0][0], text: 'MashaAllah, beautiful.' }, tok.ahmed)); }
for (const u of ['usman', 'hamza', 'ali', 'imran']) await soft(api('POST', '/api/sunnah/tick', null, tok[u]));
const feed = await api('GET', '/api/feed', null, tok.usman);
for (const it of (feed.items || feed.feed || []).filter((x) => x.kind === 'badge' || x.type === 'badge').slice(0, 4)) for (const u of ['usman', 'ali', 'imran', 'hassan']) await soft(api('POST', '/api/cheer', { id: it.id }, tok[u]));
console.log('seeded', PEOPLE.length, 'members over', DAYS, 'days');

// ---- the screens ---------------------------------------------------------------------------------------------------------
const browser = await chromium.launch();
const manifest = {};
const W = 390, H = 844;
const YT = { contentType: 'text/html', body: '<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0b0b"><svg width="84" height="60" viewBox="0 0 84 60"><rect width="84" height="60" rx="14" fill="#00a86b"/><path d="M34 18v24l20-12z" fill="#fff"/></svg></body></html>' };
async function open({ token = tok.ahmed, lang = 'en', mode = 'light', intro = true, folds = {}, w = W, h = H, motion = false, path: p = '/' } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w > 900 ? 1.5 : 2, hasTouch: w < 900, isMobile: w < 900 });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.route(/youtube(-nocookie)?\.com|ytimg\.com/, (r) => r.fulfill(YT)); // the seeded lecture's video is a stand-in: show a plain player, not a real video
  await page.goto(B + '/');
  await page.evaluate(([t, l, md, i, f]) => {
    localStorage.clear();
    if (t) localStorage.setItem('token', t); if (i) { localStorage.setItem('intro', '1'); localStorage.setItem('wanote', '1'); } localStorage.setItem('lang', l); localStorage.setItem('mode', md);
    localStorage.setItem('feel', JSON.stringify({ sound: false, vibrate: false })); localStorage.setItem('folds', JSON.stringify(f));
  }, [token, lang, mode, intro, folds]);
  if (!motion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(B + p);
  await page.waitForTimeout(1300);
  await page.addStyleTag({ content: '*{caret-color:transparent!important; -webkit-user-select:none!important; user-select:none!important}' });
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
// where things are: [x, y, w, h] in page CSS px (y includes the scroll). Known elements by key (first match; '*' keys take the
// first six), and every section heading, fold and card title by its text
const SPOTS = {
  big: '#big', numbox: '.numbox', manual: '#manual', add: '[data-act=manual]', presets: '[data-act=preset]|.quick', taptoggle: '[data-act=taptoggle]',
  tap: '[data-act=tap]', tapbox: '.tapbox|.counterbox', start: '.startcard', challenge: '.challenge', tick: '[data-act=tick]', photo: '.blk.upload',
  watch: '[data-act=watch]', reflect: 'textarea', circle: '.circlecard', stk: '.stk', bell: '.hd [data-act=news]', joinreq: '.rowlink',
  'fitem*': '.fitem', 'like*': '[data-act=like]', 'cheer*': '[data-act=cheer]', seg5: '.seg.five', 'row*': '.lb li', leaguehead: '.leaguehead',
  stats: '.stats', karwan: '.karwan', cvaccept: '[data-act=cvreqyes]', wa: '[data-act=wa]|.blk', share: '[data-act=shareinv]', lvl: '.lvl', badges: '.badges',
  edit: '[data-act=edit]', modeseg: '[data-act=setmode]|.seg', feel: '[data-act=setfeel]|.swrow,.row', remind: 'input[type=time]', avatar: '.avbtn',
  invite: '[name=invite]', waitlist: '[data-mode=waitlist]', username: '[name=username]', city: '.cityfield', modal: '.modal .box|.box', side: '.side', mybig: '.mybig',
  'trow*': '.trow', tcheck: '.tcheck', 'tmenu': 'details.menu', 'teamf*': '[data-act=teamf]', assignall: '[data-act=assignall]', 'orz*': '[data-act=openrazakar]',
  'osl*': '[data-act=opensaalik]', tagadd: '[data-act=tagadd]', majlisset: '[data-act=majlisset]', bhactivate: '[data-act=bhactivate]', 'resch*': '[data-act=reschpick]',
  ownkind: '[data-act=ownkind]|.seg', bars: '.bars', mam: '.mam', lag: '.lagging|.sec', iframe: 'iframe', quiz: '.quiz', hidephone: '[data-act=setfeel][data-k=hidephone]|.swrow',
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
    const heads = [];
    for (const e of document.querySelectorAll('.foldhead, h3, .ltitle, .ttitle, .flabel, .ctitle, .sheettitle, .notice, .trow, .fitem, .lb li, label, .sec')) {
      const b = box(e); const text = (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (b && text && b[1] >= 0) heads.push([text, ...b]);
    }
    return { r: out, heads, sy };
  }, SPOTS);
}
async function view(page, name) {
  await tidy(page);
  const at = await rects(page);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 88 });
  manifest[name] = { ...(manifest[name] || {}), view: true, sy: at.sy, r: at.r, heads: at.heads };
  console.log('view', name);
}
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
// Today, whole; then typing, the goal burst (frame by frame), tapping
const TODAY_FOLDS = { quests: true, sunnah: true, seerah: true, reflect: true, challenge: true, assigned: true };
{ const page = await open({ folds: TODAY_FOLDS }); await full(page, 'today'); await page.close(); }
{
  const page = await open({ motion: true });
  await page.evaluate(() => scrollTo(0, 0));
  for (const v of ['3', '31', '313']) { await page.fill('#manual', v); await page.waitForTimeout(150); await view(page, `type-${v.length}`); }
  await frames(page, 'burst', () => page.click('[data-act=manual]'), 30, { settle: 350 });
  await page.close();
}
{
  const page = await open();
  await click(page, '[data-act=taptoggle]', 500);
  await page.evaluate(() => scrollTo(0, 40));
  await page.waitForTimeout(400);
  const tapAt = await page.evaluate(() => { const r = document.querySelector('[data-act=tap]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  for (let i = 0; i <= 16; i++) {
    if (i) await click(page, '[data-act=tap]', 300);
    await page.screenshot({ path: path.join(OUT, `tap-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 86 });
  }
  manifest.tap = { frames: 17, at: tapAt, ...(await rects(page)) };
  await page.close();
}
// Tasks: the whole page, a tick (frame by frame), swipes, the reschedule sheet and adding your own
{ const page = await open({ folds: { ttasks: true, troutines: true, tdone: true } }); await go(page, 'tasks'); await full(page, 'tasks'); await page.close(); }
{
  const page = await open({ motion: true, folds: { ttasks: true, troutines: true, tdone: true } }); await go(page, 'tasks');
  await frames(page, 'tick', () => page.locator('.trow:not(.d) .tcheck:not([disabled])').first().click(), 24, { settle: 120 });
  await page.close();
}
{
  // swipe a task: right reveals "Mark done", left "Move date"; each step is a real frame of the drag
  for (const [name, dir] of [['swipe', 1], ['swipel', -1]]) {
    const page = await open({ folds: { ttasks: true, troutines: true, tdone: true } }); await go(page, 'tasks');
    const row = page.locator(dir > 0 ? '.trow[data-can-done="1"]' : '.trow[data-can-move="1"]').first();
    const b = await row.boundingBox();
    if (!b) { await page.close(); continue; }
    const y = b.y + b.height / 2, x0 = b.x + 60;
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let i = 0; i <= 10; i++) { await page.mouse.move(x0 + dir * i * 22, y, { steps: 2 }); await page.waitForTimeout(40); await page.screenshot({ path: path.join(OUT, `${name}-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 86 }); }
    manifest[name] = { frames: 11, row: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], ...(await rects(page)) };
    await page.mouse.up(); await page.waitForTimeout(900);
    if (dir < 0) await view(page, 'resched'); else await view(page, 'swiped');
    await page.close();
  }
}
{ const page = await open(); await go(page, 'tasks'); await click(page, '.hadd', 900); await view(page, 'addtask'); await click(page, '[data-act=ownkind][data-k=routine]', 600); await view(page, 'addroutine'); await page.close(); }
// My people: saliks and razakars, teams, requests; a razakar's report with the assign form; a salik's report with mamulaat
{
  const page = await open({ folds: { psaliks: true, prazakars: true, preq: true } }); await go(page, 'people'); await full(page, 'people');
  await click(page, '[data-act=teamf][data-tag=events]', 900); await view(page, 'people-team');
  await page.close();
}
// the reports open as sheets: the top of each, then scrolled down inside the sheet
const sheetScroll = (page, by) => page.evaluate((by) => { const b = [...document.querySelectorAll('.modal .box, .modal, .sheet')].find((e) => e.scrollHeight > e.clientHeight + 10); if (b) b.scrollTop += by; }, by);
{ const page = await open(); await go(page, 'people'); await click(page, '[data-act=openrazakar][data-u=usman]', 1200); await view(page, 'razakar'); await sheetScroll(page, 560); await page.waitForTimeout(400); await view(page, 'razakar-2'); await sheetScroll(page, 560); await page.waitForTimeout(400); await view(page, 'razakar-3'); await page.close(); }
{ const page = await open(); await go(page, 'people'); await click(page, '[data-act=opensaalik][data-u=hamza]', 1500); await view(page, 'salik'); await sheetScroll(page, 560); await page.waitForTimeout(400); await view(page, 'salik-2'); await sheetScroll(page, 560); await page.waitForTimeout(400); await view(page, 'salik-3'); await page.close(); }
// navigation: the menu and the + sheet; notifications
{
  const page = await open();
  await click(page, '.tabs [data-act=drawer]', 900); await view(page, 'menu');
  await click(page, '[data-act=drawerx]', 600);
  await go(page, 'feed'); await click(page, '.hadd', 900); await view(page, 'addsheet');
  await page.close();
}
{ const page = await open(); await click(page, '[data-act=news]', 1200); await view(page, 'news'); await page.close(); }
// Learn: the Sunnah and Seerah pages; the lecture player with its quiz
{ const page = await open(); await go(page, 'sunnah'); await full(page, 'sunnah'); await go(page, 'seerah'); await full(page, 'seerah'); await page.close(); }
{ const page = await open(); await go(page, 'seerah'); await click(page, '[data-act=watch]', 2500); await view(page, 'lecture'); await page.close(); }
// Feed
{ const page = await open(); await go(page, 'feed'); await full(page, 'feed'); await page.close(); }
// Compete: every board; a profile with Message on WhatsApp
{
  const page = await open();
  await go(page, 'rank');
  await full(page, 'rank-people');
  for (const type of ['league', 'caravans', 'trees', 'cities', 'majalis']) {
    for (let i = 0; i < 3 && !(await page.locator(`[data-act=board][data-type=${type}].on`).count()); i++) await click(page, `[data-act=board][data-type=${type}]`, 1200);
    await full(page, `rank-${type}`);
  }
  await click(page, '[data-act=board][data-type=users]', 1200);
  await page.evaluate(() => { const el = document.querySelector('.seg.five') || document.querySelector('.seg'); scrollTo(0, el.getBoundingClientRect().top + scrollY - 70); }); await page.waitForTimeout(400);
  await page.locator('.lb li').nth(1).click().catch(() => {});
  await page.waitForTimeout(1200);
  await view(page, 'profile');
  await page.close();
}
// Caravan (Ahmed's), a caravan owner's Falling behind list (Bilal's), Qabila
{
  const page = await open();
  await go(page, 'caravan'); await full(page, 'caravan');
  await go(page, 'qabila'); await full(page, 'qabila');
  await page.close();
  const bp = await open({ token: tok.bilal }); await go(bp, 'caravan'); await full(bp, 'caravan-lag'); await bp.close();
}
// Me: level, badges, history, majlis, murabbi and masul, who sees your data; fixing a number
{
  const page = await open({ folds: { history: true, badges: true, points: true, majlis: true } });
  await go(page, 'progress'); await full(page, 'me');
  if (await page.locator('[data-act=edit]').count()) {
    await page.locator('[data-act=edit]').first().scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, 200));
    await page.locator('[data-act=edit]').first().click(); await page.waitForTimeout(700); await view(page, 'history-edit');
  }
  await page.close();
}
// Settings
{ const page = await open(); await go(page, 'settings'); await full(page, 'settings'); await page.close(); }
// the admin page, for organisers
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(B + '/admin'); await page.evaluate((k) => sessionStorage.setItem('adminKey', k), process.env.ADMIN_KEY);
  await page.goto(B + '/admin'); await page.waitForTimeout(1500);
  await view(page, 'admin');
  await page.close();
}
// the same Today in dark, in Urdu, and on a computer
{
  const dark = await open({ mode: 'dark' }); await view(dark, 'today-dark'); await dark.close();
  const light = await open(); await view(light, 'today-light'); await light.close();
  const ur = await open(); await click(ur, '[data-act=setlang][data-l=ur]', 2200); await ur.evaluate(() => scrollTo(0, 0)); await view(ur, 'today-ur');
  await go(ur, 'rank'); await view(ur, 'rank-ur'); await go(ur, 'tasks'); await view(ur, 'tasks-ur'); await go(ur, 'caravan'); await view(ur, 'caravan-ur');
  await click(ur, '[data-act=setlang][data-l=en]', 1200); await ur.close();
  const wide = await open({ w: 1280, h: 800 }); await view(wide, 'desktop'); await go(wide, 'tasks'); await view(wide, 'desktop-tasks'); await wide.close();
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
await browser.close();
server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('done:', OUT);
process.exit(0);
