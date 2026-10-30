// Captures the Tasbeeh page (branch tasbeeh-cloudflare) for the how-to video: every step a member goes through, typed character by
// character, plus where each field sits for the spotlights. The real Worker runs in-process on node:sqlite (the branch's own D1
// stand-in from its tests), seeded with a demo community over the past weeks.
//   git worktree add ../tasbeeh origin/tasbeeh-cloudflare
//   APP_DIR=../tasbeeh node tools/capture-tasbeeh.mjs assets/tasbeeh
// Writes <name>.png (390x844 at 2x, dark mode) and manifest.json: { views: { name: { h, sy, r: { key: [x, y, w, h] } } } },
// h = page height, sy = how far the page was scrolled, r = element rects in page coordinates (CSS px).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(process.env.APP_DIR || '../tasbeeh');
const OUT = path.resolve(process.argv[2] || 'assets/tasbeeh');
const TARGET = '100000000';
fs.mkdirSync(OUT, { recursive: true });

const worker = (await import(pathToFileURL(path.join(APP, 'src/worker.js')))).default;
const { createD1 } = await import(pathToFileURL(path.join(APP, 'test/d1.js')));
const { addEntry, cityList } = await import(pathToFileURL(path.join(APP, 'src/logic.js')));
const DB = createD1();

// ---------- a demo community: men only, made-up names and numbers ----------
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const FIRST = ['Bilal', 'Umar', 'Hamza', 'Ali', 'Usman', 'Talha', 'Zaid', 'Anas', 'Saad', 'Fahad', 'Kashif', 'Moiz', 'Zubair', 'Haris', 'Shoaib', 'Adnan', 'Rizwan', 'Nabeel', 'Asad', 'Irfan', 'Luqman', 'Mohsin', 'Ehsan', 'Ibrahim', 'Yusuf', 'Idrees', 'Junaid', 'Waqas', 'Faisal', 'Tariq'];
const LAST = ['Khan', 'Qureshi', 'Siddiqui', 'Butt', 'Malik', 'Chaudhry', 'Sheikh', 'Awan', 'Mirza', 'Hashmi', 'Abbasi', 'Rana'];
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Gujranwala', 'Sialkot', 'Hyderabad', 'Quetta'].filter((c) => cityList().includes(c));
const DAY = 86400e3, now = Date.now();
let rid = 0;
const add = (phone, count, when, name, city) => addEntry(DB, { phone, count, rid: `seed-rid-${++rid}`, name, city }, Number(TARGET), when);
for (let i = 0; i < 140; i++) {
  const phone = `0333 ${String(4000000 + i * 7919).padStart(7, '0')}`, name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`, city = CITIES[i % CITIES.length];
  const habit = 1500 + Math.floor(rnd() * 5000), from = 4 + Math.floor(rnd() * 24);
  for (let d = from; d >= 1; d--) if (rnd() < 0.85) await add(phone, Math.round(habit * (0.6 + rnd() * 0.8)), now - d * DAY, name, city);
  if (rnd() < 0.5) await add(phone, Math.round(habit * (0.3 + rnd() * 0.5)), now - 2 * 3600e3, name, city);
}

// ---------- the Worker behind a local server, the page files beside it ----------
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const body = req.method === 'POST' ? await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); }) : undefined;
    const out = await worker.fetch(new Request(`http://local${url.pathname}`, { method: req.method, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': 'capture' }, body }), { DB, TARGET });
    res.writeHead(out.status, { 'content-type': 'application/json' }).end(await out.text());
    return;
  }
  const p = path.join(APP, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!p.startsWith(path.join(APP, 'public')) || !fs.existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce', isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
// headless Linux has no phone system font: Inter stands in for the iPhone's San Francisco; the caret is hidden so frames don't flicker
const LOOK = 'body, input, select, button { font-family: Inter, system-ui, sans-serif !important; } * { caret-color: transparent !important; }';

const KEYS = { phone: '#phone', hint: '#phone-hint', newcomer: '#newcomer', note: '#newcomer .note', name: '#name', city: '#city', count: '#count', add: '#submit', error: '#error',
  stats: '#stats', thanks: '#stats h2', today: '#stats .grid .card:nth-child(1)', week: '#stats .grid .card:nth-child(2)', target: '#stats .card.wide', bar: '#bar', footnote: '#stats .note.small', title: 'header' };
const manifest = { viewport: [390, 844], scale: 2, views: {} };
async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  const info = await page.evaluate((keys) => {
    const r = {};
    for (const [k, sel] of Object.entries(keys)) {
      const el = document.querySelector(sel); if (!el || !el.offsetParent) continue;
      const b = el.getBoundingClientRect(); r[k] = [b.x, b.y + scrollY, b.width, b.height].map((v) => Math.round(v));
    }
    return { h: document.documentElement.scrollHeight, sy: Math.round(scrollY), r };
  }, KEYS);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  manifest.views[name] = info;
}
async function type(sel, text, prefix) {
  await page.click(sel);
  await shot(`${prefix}-00`);
  for (let i = 1; i <= text.length; i++) { await page.keyboard.type(text[i - 1]); await shot(`${prefix}-${String(i).padStart(2, '0')}`); }
}
async function open() {
  await page.goto(BASE);
  await page.addStyleTag({ content: LOOK });
  await page.waitForFunction(() => document.querySelectorAll('#city option').length > 50);
}

// first visit: a new number, so name and city are asked
await open();
await shot('open');
await type('#phone', '0300 1234567', 'phone');
await page.waitForSelector('#newcomer:not([hidden])');
await page.waitForTimeout(100);
await shot('newcomer');
await type('#name', 'Ahmed Raza', 'name');
await page.focus('#city');
await shot('city-focus');
await page.selectOption('#city', 'Lahore');
await shot('city');
await type('#count', '313', 'count');
await page.click('#submit');
await page.waitForSelector('#stats:not([hidden])');
await page.waitForTimeout(200);
await page.evaluate(() => document.activeElement?.blur());
await shot('stats');
await page.evaluate(() => scrollTo(0, 0));
await shot('saved-top');

// next visit: the number is known, so only the count
await open();
await type('#phone', '0300 1234567', 'back');
await page.waitForFunction(() => document.querySelector('#phone-hint').textContent.includes('Welcome'));
await shot('welcome');
await type('#count', '100', 'more');
await page.click('#submit');
await page.waitForSelector('#stats:not([hidden])');
await page.waitForTimeout(200);
await page.evaluate(() => document.activeElement?.blur());
await shot('stats-2');

// a mistake: a count of zero
await open();
await page.fill('#phone', '0300 1234567');
await page.waitForFunction(() => document.querySelector('#phone-hint').textContent.includes('Welcome'));
await page.fill('#count', '0');
await page.click('#submit');
await page.evaluate(() => document.activeElement?.blur());
await shot('error');

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
await browser.close();
server.close();
console.log(Object.keys(manifest.views).length, 'views in', OUT);
console.log(JSON.stringify({ stats: manifest.views.stats, 'stats-2': manifest.views['stats-2'] }));
