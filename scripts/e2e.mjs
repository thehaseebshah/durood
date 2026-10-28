// End-to-end browser test: starts its own server on a throwaway database and drives the app the way a member does.
//   npm run e2e            (needs Playwright with Chromium; set NODE_PATH to where it is installed if it isn't local)
// Every check prints a line; any failure, page error or console error makes the run fail.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-e2e-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'e2e.db'), ADMIN_KEY: 'e2e-admin-key-long-enough-1234',
  PUBLIC_CACHE_MS: '0', NODE_ENV: 'test', FLAG_NEW_HIGH: '1000000000' });
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright is not installed (set NODE_PATH).'); process.exit(2); }

const { createServer } = await import('../server/index.js');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`;
const K = { 'x-admin-key': process.env.ADMIN_KEY };
const api = (m, p, body, token, h = {}) => fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...h }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
let n = 0;
const register = (u, invite = 'e2e_cv') => api('POST', '/api/register', { username: u, email: `${u}@e2e.pk`, phone: `0303${String(4000000 + ++n)}`, password: 'secret12', cityId: 1172451, invite, lang: 'en' });
// the first caravan is made by an admin: a member with no caravan, then a caravan with that member as owner (everyone else signs up with its name)
const makeOwner = async (u, caravan) => {
  await api('POST', '/api/admin/members/create', { username: u, email: `${u}@e2e.pk`, phone: `0303${String(4000000 + ++n)}`, password: 'secret12', cityId: 1172451, lang: 'en' }, null, K);
  await api('POST', '/api/admin/caravans', { name: caravan, owner: u }, null, K);
  return api('POST', '/api/login', { id: u, password: 'secret12' });
};
const TABS = ['home', 'feed', 'rank', 'caravan', 'sunnah', 'progress', 'settings'];

let failed = 0;
const ok = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++; };
const errors = [];
const browser = await chromium.launch();

async function open(token, { w = 390, h = 844, lang = 'en', mode = 'light', touch = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Permissions policy violation/.test(m.text())) errors.push(m.text()); }); // the YouTube embed probes features our policy does not grant
  await page.goto(B + '/');
  await page.evaluate(([t, l, md]) => { if (t) localStorage.setItem('token', t); localStorage.setItem('intro', '1'); localStorage.setItem('lang', l); localStorage.setItem('mode', md); }, [token, lang, mode]);
  await page.goto(B + '/');
  await page.waitForTimeout(900);
  return page;
}
const go = async (page, tab) => { await page.evaluate((t) => (document.querySelector(`.sitem[data-tab=${t}]`) || document.querySelector(`[data-tab=${t}]`))?.click(), tab); await page.waitForTimeout(900); };
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

try {
  const day = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  await api('POST', '/api/admin/sunnahs', { sunnahs: [{ day, title_en: 'Smile at your brother', title_ur: 'مسکرا کر ملنا', desc_en: 'A smile is charity.', source: 'Tirmidhi 1956' }] }, null, K);

  const host = await makeOwner('e2e_host', 'e2e_cv');
  ok(!!host.token && host.me?.caravan?.name === 'e2e_cv' && host.me.caravan.owner, 'an admin makes the first caravan and its owner');

  // ---- sign-up through the form: the code is the caravan's name ------------------------------------------------
  {
    const page = await open(null);
    await page.locator('[data-act=mode][data-mode=register], [data-mode=register]').first().click().catch(() => {});
    await page.waitForTimeout(300);
    ok(await page.locator('form[data-form=register]').count() === 1, 'sign-up form shows');
    ok((await page.textContent('label[for=f-invite]')).trim() === 'Caravan name or leader code', 'the code field is called Caravan name or leader code');
    await page.click('form[data-form=register] button[type=submit]'); await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.activeElement?.name === 'invite'), 'an empty sign-up points at the first empty field');
    await page.fill('[name=invite]', 'nobody_here'); await page.waitForTimeout(900);
    ok(await page.locator('#rcheck.bad').count() === 1, 'a caravan name that does not exist is told so while typing');
    await page.fill('[name=invite]', 'e2e_vc'); await page.waitForTimeout(1000); // a slip of the fingers
    ok(await page.locator('#rsug li[data-act=pickcv]').count() >= 1, 'a misspelt caravan name offers the caravans that look like it');
    await page.locator('#rsug li[data-act=pickcv]').first().click(); await page.waitForTimeout(900);
    ok(await page.inputValue('[name=invite]') === 'e2e_cv' && await page.locator('#rcheck.ok').count() === 1, 'tapping a suggestion fills in the exact name');
    await page.fill('[name=invite]', 'E2E_CV'); await page.waitForTimeout(900);
    ok(await page.locator('#rcheck.ok').count() === 1 && /You will join/.test(await page.textContent('#rcheck')), 'a real caravan name (any case) is accepted live');
    await page.click('form[data-form=register] button[type=submit]'); await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.activeElement?.name === 'username'), '...then the next empty field');
    // the whole form, city picked from the suggestions
    await page.fill('[name=username]', 'e2e_form'); await page.fill('[name=email]', 'e2e_form@e2e.pk'); await page.fill('[name=phone]', '300 7770001');
    await page.fill('[data-city]', 'Lahore'); await page.waitForTimeout(900);
    await page.locator('li[data-act=pickcity]').first().click();
    await page.selectOption('#f-mjsel', '__new'); await page.fill('[name=newMajlisName]', 'E2E Media'); // a new majlis, no approval
    await page.fill('[name=password]', 'secret12');
    await page.click('form[data-form=register] button[type=submit]'); await page.waitForTimeout(1500);
    ok(await page.locator('nav.tabs').count() === 1, 'the form signs a new member in');
    const me = await api('GET', '/api/me', null, await page.evaluate(() => localStorage.getItem('token')));
    ok(me.caravan?.name === 'e2e_cv' && !me.caravan.owner, 'the new member is in the caravan they named');
    ok(me.majlis?.name === 'E2E Media', 'a majlis made at sign-up is created and joined at once');
    await page.close();
    // the sign-up kill switch and the daily cap show a plain message
    await api('POST', '/api/admin/signups', { enabled: false }, null, K);
    const cl = await open(null);
    await cl.locator('[data-mode=register]').first().click().catch(() => {}); await cl.waitForTimeout(400);
    ok(await cl.locator('.notice', { hasText: 'closed' }).count() === 1, 'closed sign-ups say so on the form');
    await cl.fill('[name=invite]', 'e2e_cv'); await cl.fill('[name=username]', 'e2e_late'); await cl.fill('[name=email]', 'e2e_late@e2e.pk'); await cl.fill('[name=phone]', '300 7770002');
    await cl.fill('[data-city]', 'Lahore'); await cl.waitForTimeout(900); await cl.locator('li[data-act=pickcity]').first().click(); await cl.selectOption('#f-mjsel', { index: 1 }); await cl.fill('[name=password]', 'secret12');
    await cl.click('form[data-form=register] button[type=submit]'); await cl.waitForTimeout(900);
    ok(/closed/i.test(await cl.textContent('.err')), 'a sign-up while closed shows the closed message');
    await cl.close();
    await api('POST', '/api/admin/signups', { enabled: true, dailyCap: 0 }, null, K);
    const fl = await open(null);
    await fl.locator('[data-mode=register]').first().click().catch(() => {}); await fl.waitForTimeout(400);
    await fl.fill('[name=invite]', 'e2e_cv'); await fl.waitForTimeout(900);
    ok(/reached its sign-up limit/.test(await fl.textContent('#rcheck')), 'a caravan at its daily limit says so while typing');
    await fl.close();
    await api('POST', '/api/admin/signups', { dailyCap: 200 }, null, K);
  }

  const kid = await register('e2e_kid');
  ok(!!kid.token && kid.me.caravan.name === 'e2e_cv', 'members register with the caravan name');

  // ---- Today: log durood, goal burst, points float, quest pops, units shown ----------------------------------
  {
    const page = await open(host.token, { touch: true });
    ok(await page.locator('.q[data-q=streak]').count() === 1, 'streak quest is listed');
    ok(await page.locator('.q[data-q=sunnah]').count() === 1, 'the Sunnah quest is listed');
    ok(await page.locator('.startcard, [data-act=pushon], .circlecard').count() === 0, 'no Getting started, reminder or circle cards');
    await page.fill('#manual', '150'); await page.click('[data-act=manual]'); await page.waitForTimeout(300);
    ok(await page.locator('.floatpts').count() === 1, 'earned points float up');
    ok(await page.locator('.burst').count() === 1, 'daily goal bursts');
    ok(await page.locator('.q.justdone').count() >= 1, 'finished quests pop');
    await page.waitForTimeout(1600);
    await page.locator('[data-act=celebrateX]').click().catch(() => {});
    ok((await page.locator('#big').textContent()).trim() === '150', 'counter shows 150');
    await page.fill('#manual', '10'); await page.press('#manual', 'Enter'); await page.waitForTimeout(1600);
    await page.locator('[data-act=celebrateX]').click().catch(() => {});
    ok((await page.locator('#big').textContent()).trim() === '160', 'Enter in the durood box adds it');
    // count by tapping: five taps, then add them
    await page.click('[data-act=taptoggle]'); await page.waitForTimeout(300);
    for (let i = 0; i < 5; i++) { await page.click('[data-act=tap]'); await page.waitForTimeout(60); }
    ok((await page.locator('#pend').textContent()).trim() === '5', 'taps are counted before adding');
    await page.click('[data-act=submitp]'); await page.waitForTimeout(1500);
    await page.locator('[data-act=celebrateX]').click().catch(() => {});
    ok((await api('GET', '/api/me', null, host.token)).today === 165, 'tapped durood is added once');
    // a slip of the finger: add, then Undo on the toast
    await page.fill('#manual', '7'); await page.click('[data-act=manual]'); await page.waitForTimeout(700);
    await page.locator('#toast .tact').click(); await page.waitForTimeout(900);
    ok((await api('GET', '/api/me', null, host.token)).today === 165, 'Undo on the toast takes the number back');
    ok(await page.locator('.u-durood').count() > 0 && await page.locator('.u-pts').count() > 0, 'numbers carry durood / pts units');
    ok(!(await overflowX(page)), 'Today has no sideways scroll on a phone');
    // today's sunnah: tick it, then post a photo (made in the page: a canvas drawn and handed to the file input)
    await page.click('[data-act=tick]'); await page.waitForTimeout(700);
    ok((await api('GET', '/api/me', null, host.token)).quests.find((q) => q.id === 'sunnah')?.done === true, 'ticking the sunnah counts');
    await page.evaluate(async () => {
      const c = Object.assign(document.createElement('canvas'), { width: 640, height: 480 }), g = c.getContext('2d');
      for (let i = 0; i < 60; i++) { g.fillStyle = `hsl(${i * 6},70%,${30 + (i % 5) * 10}%)`; g.fillRect((i * 37) % 600, (i * 53) % 440, 80, 60); }
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const input = document.querySelector('input[data-photo]'), dt = new DataTransfer();
      dt.items.add(new File([blob], 'sunnah.jpg', { type: 'image/jpeg' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(900);
    ok(await page.locator('img.shot.preview').count() === 1, 'the photo shows as a preview first');
    await page.click('[data-act=postit]'); await page.waitForTimeout(1200);
    ok(await page.locator('img.shot.preview').count() === 0 && (await api('GET', '/api/feed', null, host.token)).today?.mine, 'the sunnah photo is posted');
    { // the feed keeps the photo's space before the photo arrives, so nothing below it jumps (photo requests held back here)
      const fp = await open(host.token); await fp.route('**/photos/**', () => {}); await go(fp, 'feed');
      const box = await fp.evaluate(() => { const i = document.querySelector('.fitem img.shot:not(.thumb)'); return i && { w: i.clientWidth, h: i.clientHeight, aw: +i.getAttribute('width'), ah: +i.getAttribute('height') }; });
      ok(box && box.aw > 0 && Math.abs(box.h - Math.min(380, box.w * box.ah / box.aw)) < 3, `a feed photo's space is kept before it loads (${box && `${box.w}x${box.h}`})`);
      await fp.close();
    }
    // pull to refresh
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] });
    await page.evaluate(() => scrollTo(0, 0));
    await touch('touchStart', 150); for (let y = 160; y <= 280; y += 15) { await touch('touchMove', y); await page.waitForTimeout(16); }
    ok(await page.locator('.ptr').count() === 1, 'pull to refresh shows its spinner');
    await touch('touchEnd', 280); await page.waitForTimeout(1200);
    ok(await page.locator('.ptr').count() === 0, 'pull to refresh finishes');
    await page.close();
  }

  // ---- a running streak and nothing yet today: Today nudges -------------------------------------------------------------
  {
    const { db } = await import('../server/db.js');
    const nudge = await register('e2e_nudge');
    const yesterday = new Date(Date.now() + 5 * 3600e3 - 864e5).toISOString().slice(0, 10);
    db.prepare("UPDATE users SET streak = 3, last_day = ? WHERE username = 'e2e_nudge'").run(yesterday);
    const page = await open(nudge.token);
    ok(await page.locator('.streaknudge').count() === 1, 'a running streak with nothing today shows a nudge');
    await page.fill('#manual', '10'); await page.click('[data-act=manual]'); await page.waitForTimeout(1500);
    await page.locator('[data-act=celebrateX]').click().catch(() => {});
    ok(await page.locator('.streaknudge').count() === 0, 'the nudge goes once today is recited');
    await page.close();
  }

  // ---- the Caravan page: members, the owner renames it, removes a member; a member with no caravan is told to ask an admin ----------
  {
    const page = await open(host.token);
    page.on('dialog', (d) => d.accept());
    await go(page, 'caravan');
    ok((await page.textContent('.cvname')).trim() === 'e2e_cv', 'the caravan page shows its name');
    ok(await page.locator('.lb li').count() >= 3, 'the caravan lists its members');
    ok(await page.locator('[data-act=cvleave], [data-form=cvcreate], #cvinvq, #cvjoinq').count() === 0, 'no create, join, invite or leave controls');
    await page.fill('#cv-display', 'قافلۂ نور'); await page.click('form[data-form=cvdisplay] button[type=submit]'); await page.waitForTimeout(900);
    ok((await page.textContent('.cvname'))?.trim() === 'قافلۂ نور' && (await page.textContent('.cvname + .muted')).includes('@e2e_cv'), 'the owner gives the caravan an Urdu display name; its handle stays beneath');
    await page.fill('#cv-rename', 'e2e_cv2'); await page.click('form[data-form=cvrename] button[type=submit]'); await page.waitForTimeout(900);
    ok((await api('GET', '/api/caravan', null, host.token)).caravan?.name === 'e2e_cv2', 'the owner renames the caravan');
    await page.fill('#cv-rename', 'e2e_cv'); await page.click('form[data-form=cvrename] button[type=submit]'); await page.waitForTimeout(900);
    await page.locator('[data-act=cvremove][data-u=e2e_kid]').click(); await page.waitForTimeout(900);
    ok((await api('GET', '/api/me', null, kid.token)).caravan === null, 'the owner removes a member');
    // rapid taps between pages skip animations without page errors
    for (let i = 0; i < 20; i++) await page.evaluate((tb) => document.querySelector(`nav.tabs [data-tab=${tb}]`).click(), ['feed', 'rank', 'home'][i % 3]);
    await page.waitForTimeout(800);
    await page.close();
    const kp = await open(kid.token);
    await go(kp, 'caravan');
    ok(await kp.locator('.empty', { hasText: 'ask an admin' }).count() === 1 || await kp.locator('.empty', { hasText: 'Ask an admin' }).count() === 1, 'a member with no caravan is told to ask an admin');
    await kp.close();
    const mine = (await api('GET', '/api/caravan', null, host.token)).caravan;
    await api('POST', `/api/admin/caravans/${mine.id}/members`, { username: 'e2e_kid' }, null, K);
    ok((await api('GET', '/api/me', null, kid.token)).caravan?.name === 'e2e_cv', 'an admin puts the member back');
  }

  // ---- the Sunnah page, the daily goal and the language from Settings ------------------------------------------------------
  {
    const page = await open(host.token);
    await go(page, 'sunnah');
    ok(await page.locator('main h3', { hasText: 'Your sunnah posts' }).count() === 1, 'the Sunnah page lists your posts');
    ok(await page.locator('.stream .fitem').count() >= 1, 'the Sunnah page shows the community photos');
    ok(await page.locator('[data-act=watch], [data-tab=seerah], [data-tab=qabila], [data-tab=tasks], [data-tab=people]').count() === 0, 'no lecture, Seerah, Qabila or task links');
    await go(page, 'settings');
    ok(await page.locator('#s-time, [data-act=pushon], [data-act=pushoff]').count() === 0, 'no reminder time or push settings');
    await page.fill('#s-goal', '250'); await page.click('form[data-form=settings] button[type=submit]'); await page.waitForTimeout(900);
    ok((await api('GET', '/api/me', null, host.token)).dailyGoal === 250, 'the daily goal is changed in Settings');
    await page.click('[data-act=fold][data-k=ssec]').catch(() => {}); await page.waitForTimeout(900);
    ok(await page.locator('form[data-form=phone] select[name=phoneCountry] option').count() > 100, 'changing your number in Settings offers every country, not only Pakistan');
    await page.click('main .seg [data-act=setlang][data-l=ur]'); await page.waitForTimeout(700);
    ok(await page.evaluate(() => document.documentElement.dir === 'rtl'), 'Settings switches to Urdu');
    await page.click('main .seg [data-act=setlang][data-l=en]'); await page.waitForTimeout(700);
    ok(await page.evaluate(() => document.documentElement.dir === 'ltr'), '...and back to English');
    await page.click('.sw[data-k=sound]'); await page.waitForTimeout(300);
    ok(await page.getAttribute('.sw[data-k=sound]', 'aria-checked') === 'false', 'the Sounds switch turns off');
    await page.click('.sw[data-k=sound]'); await page.waitForTimeout(300);
    ok(await page.getAttribute('.sw[data-k=sound]', 'aria-checked') === 'true', '...and back on');
    await page.close();
  }

  // ---- a caravan mate's milestone: MashaAllah ---------------------------------------------------------------------------
  {
    await api('POST', '/api/log', { count: 1000, rid: crypto.randomUUID() }, kid.token);
    const page = await open(host.token);
    await go(page, 'feed');
    const btn = page.locator('[data-act=cheer]').first();
    ok(await btn.count() === 1, 'a caravan mate\'s milestone offers MashaAllah');
    await btn.click(); await page.waitForTimeout(800);
    ok(await page.locator('[data-act=cheer].on').count() >= 1, 'MashaAllah is recorded and shown');
    await page.close();
  }

  // ---- a signal that carries nothing: a send that hangs is given up after 12 s and kept on the phone, then sent once -------------
  {
    const slow = await register('e2e_hang');
    const page = await open(slow.token);
    const held = [];
    await page.route('**/api/log', (r) => { held.push(r); }); // never answered, like a stalled mobile connection
    const t0 = Date.now();
    await page.fill('#manual', '25'); await page.click('[data-act=manual]');
    const queued = () => page.evaluate(() => JSON.parse(localStorage.getItem('outbox') || '[]').length);
    while (Date.now() - t0 < 20000 && (await queued()) !== 1) await page.waitForTimeout(250); // (waitForFunction breaks under the page's script policy in older Playwright)
    const waited = Date.now() - t0;
    ok((await page.evaluate(() => JSON.parse(localStorage.getItem('outbox') || '[]').length)) === 1, `a hung send goes to the outbox (after ${Math.round(waited / 1000)} s)`);
    ok(waited < 16000, 'without waiting through retries that would hang too');
    await page.waitForTimeout(1200); // the counter rolls up
    const big = (await page.locator('#big').textContent()).trim();
    ok(big === '25', `the counter shows it straight away (${big})`);
    await page.unroute('**/api/log');
    await page.evaluate(() => dispatchEvent(new Event('online'))); await page.waitForTimeout(1500);
    ok((await api('GET', '/api/me', null, slow.token)).today === 25, 'once the line clears, it reaches the server once');
    await page.close();
  }
  // ---- no signal: durood is kept on the phone and sent once back online; the app opens offline on the last numbers --------------
  {
    const off = await register('e2e_offline');
    const page = await open(off.token);
    await page.waitForTimeout(1500); // let the service worker cache the app
    await page.context().setOffline(true);
    await page.fill('#manual', '40'); await page.click('[data-act=manual]'); await page.waitForTimeout(3500); // two retries, then queued
    ok((await page.evaluate(() => JSON.parse(localStorage.getItem('outbox') || '[]').length)) === 1, 'offline durood waits in the outbox');
    ok((await page.locator('#big').textContent()).trim() === '40', 'the counter shows it straight away');
    ok(await page.locator('.offbar').count() === 1, 'the offline bar shows');
    await page.reload(); await page.waitForTimeout(1200);
    ok(await page.locator('#big').count() === 1, 'the app opens offline on the last known numbers');
    await page.context().setOffline(false);
    await page.evaluate(() => dispatchEvent(new Event('online'))); await page.waitForTimeout(1500);
    ok((await api('GET', '/api/me', null, off.token)).today === 40, 'back online, the durood reaches the server once');
    ok((await page.evaluate(() => localStorage.getItem('outbox'))) === null, 'the outbox is empty again');
    await page.evaluate(() => dispatchEvent(new Event('online'))); await page.waitForTimeout(800);
    ok((await api('GET', '/api/me', null, off.token)).today === 40, 'sending again does not double count');
    await page.close();
  }

  // ---- every page, both languages, dark mode, desktop: renders, no sideways scroll, no errors -----------------------
  for (const [lang, mode, w] of [['en', 'light', 390], ['ur', 'light', 390], ['en', 'dark', 390], ['en', 'light', 1280]]) {
    await api('PATCH', '/api/me', { lang }, host.token);
    const page = await open(host.token, { lang, mode, w });
    for (const tab of TABS) {
      await go(page, tab);
      const blank = await page.evaluate(() => (document.querySelector('#main')?.innerText || '').trim().length < 20);
      ok(!blank, `${lang}/${mode}/${w}: ${tab} renders`);
      if (w < 600) ok(!(await overflowX(page)), `${lang}/${mode}/${w}: ${tab} has no sideways scroll`);
    }
    if (lang === 'ur') ok(await page.evaluate(() => document.documentElement.dir === 'rtl'), 'Urdu is right-to-left');
    await page.close();
  }
  await api('PATCH', '/api/me', { lang: 'en' }, host.token);

  // ---- Accessibility: axe-core's WCAG 2 A/AA rules on every member page, light and dark (CI installs axe-core; skipped if absent) ----
  let AXE = null;
  try { AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { console.log('skip axe-core is not installed; accessibility rules not run'); }
  if (AXE) {
    const found = new Map();
    for (const mode of ['light', 'dark']) for (const tab of TABS) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true }); // the app's CSP rightly refuses injected scripts
      const page = await ctx.newPage();
      await page.goto(B + '/');
      await page.evaluate(([t, md]) => { localStorage.setItem('token', t); localStorage.setItem('intro', '1'); localStorage.setItem('mode', md); }, [host.token, mode]);
      await page.goto(B + '/'); await page.waitForTimeout(700);
      await page.evaluate((t) => (document.querySelector(`.sitem[data-tab=${t}]`) || document.querySelector(`[data-tab=${t}]`))?.click(), tab); await page.waitForTimeout(700);
      await page.addScriptTag({ content: AXE });
      const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((x) => `${x.id} (${x.nodes[0].target.join(' ')})`));
      v.forEach((x) => found.set(x, `${mode}/${tab}`));
      await ctx.close();
    }
    ok(found.size === 0, `no WCAG A/AA violations on any page, light or dark${found.size ? ': ' + [...found].slice(0, 6).map(([k, w]) => `${w} ${k}`).join('; ') : ''}`);
  }

  // ---- Weight: an English member's Today downloads no Urdu or Arabic font (those load only where they are shown) ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const fonts = [];
    const urText = []; page.on('response', (r) => { if (r.url().includes('/fonts/')) fonts.push(r.url().split('/').pop()); if (r.url().includes('i18n-ur')) urText.push(r.url()); });
    await page.goto(B + '/manifest.webmanifest'); await page.evaluate((t) => { localStorage.setItem('token', t); localStorage.setItem('intro', '1'); localStorage.setItem('lang', 'en'); }, host.token); // a page with no text of its own, so only Today's fonts are counted
    await page.goto(B + '/'); await page.waitForTimeout(1800);
    ok(!fonts.some((f) => /nastaliq|amiri/.test(f)), `English Today loads only light fonts (${fonts.join(', ')})`);
    ok(urText.length === 0, 'English Today does not download the Urdu text');
    await ctx.close();
  }

  // ---- A phone whose clock is a week fast still shows the server's day (the app corrects by the server's Date header) ----
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.clock.install({ time: new Date(Date.now() + 7 * 864e5) });
    await page.goto(B + '/'); await page.evaluate((t) => { localStorage.setItem('token', t); localStorage.setItem('intro', '1'); localStorage.setItem('lang', 'en'); }, host.token);
    await page.goto(B + '/'); await page.waitForTimeout(1200);
    const want = new Date(new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const shown = await page.evaluate(() => document.querySelector('.counterbox .sub span')?.textContent);
    ok(shown === want, `a phone with a wrong clock still shows today's date (${shown})`);
    await page.close();
  }

  // ---- Design consistency: no element draws the old hard 1.5px+ ink-coloured frame (every page, the sign-up form, the add sheet) ----
  {
    const frames = new Set();
    const scan = (page, where) => page.evaluate(() => { const ink = getComputedStyle(document.body).color; const out = [];
      document.querySelectorAll('body *').forEach((e) => { if (!e.offsetParent) return; const cs = getComputedStyle(e);
        if (['Top', 'Right', 'Bottom', 'Left'].some((sd) => parseFloat(cs['border' + sd + 'Width']) >= 1.5 && cs['border' + sd + 'Style'] !== 'none' && cs['border' + sd + 'Color'] === ink)) out.push(`${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).join('.')}`); });
      return out; }).then((r) => r.forEach((x) => frames.add(`${where}: ${x}`)));
    for (const tab of TABS) { const page = await open(host.token); await go(page, tab); await scan(page, tab); await page.close(); }
    const page = await open(host.token); await go(page, 'feed'); await page.click('.hadd'); await page.waitForTimeout(400); await scan(page, 'add sheet'); await page.close();
    const anon = await browser.newPage({ viewport: { width: 390, height: 844 } }); await anon.goto(B + '/?invite=e2e_cv'); await anon.evaluate(() => localStorage.setItem('intro', '1')); await anon.goto(B + '/?invite=e2e_cv'); await anon.waitForTimeout(700);
    await anon.getByRole('button', { name: /join/i }).first().click().catch(() => {}); await anon.waitForTimeout(400); await scan(anon, 'sign-up'); await anon.close();
    ok(frames.size === 0, `no old-style hard frames anywhere${frames.size ? ': ' + [...frames].slice(0, 5).join('; ') : ''}`);
  }

  // ---- Rankings: tapping a row anywhere (here its name) opens that member's profile, as tapping the photo does ----------------------
  {
    const page = await open(host.token); await go(page, 'rank');
    const row = page.locator('.lb li:not(.me):has(.avbtn)').first();
    const shown = (await row.locator('.name').innerText()).split('\n')[0].trim();
    ok(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/.test(shown), `another member appears under a made-up name on the ranking ("${shown}")`);
    await row.locator('.name').click(); await page.waitForTimeout(900);
    const real = (await page.locator('.modal .box.profile h3.in').innerText()).trim();
    ok(real !== shown && /^[a-z0-9_]{3,20}$/.test(real), `tapping the row shows the real username ("${real}")`);
    ok(await page.locator('.modal .box.profile').count() === 1, 'tapping a ranking row opens the profile');
    const inMine = /e2e_cv/.test(await page.locator('.modal .box.profile').innerText());
    ok(await page.locator('.modal .box.profile [data-act=wachat]').count() === (inMine ? 1 : 0), 'the WhatsApp button shows only to the leader, for members of their own caravan');
    const hasNum = await page.evaluate(() => /\+?\d{10,}/.test(document.querySelector('.modal .box.profile').textContent));
    ok(hasNum === inMine, 'a phone number shows on the profile sheet only to the leader');
    await page.close();
  }

  // ---- Logging out from the open menu must leave the sign-in page scrollable (a menu left open once locked the page) ------------
  {
    const page = await open(host.token);
    await page.click('nav.tabs [data-act=drawer]'); await page.waitForTimeout(400);
    await page.click('.side [data-act=logout]'); await page.waitForTimeout(700);
    ok(await page.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'), 'after logging out from the menu the page can scroll');
    await page.close();
  }

  // ---- Tapping the tab you are on, scrolled down, glides back to the top without reloading the page ------------------------------
  {
    const page = await open(host.token); await go(page, 'feed');
    await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.scrollY);
    await page.click('nav.tabs [data-tab=feed]'); await page.waitForTimeout(1200);
    ok(before > 100 && (await page.evaluate(() => window.scrollY)) === 0, `tapping the current tab scrolls to the top (from ${Math.round(before)})`);
    await page.close();
  }

  // ---- Large phone text (130%): on a small phone nothing on any page runs past the right edge ---------------------------------
  {
    const page = await open(host.token, { w: 360, h: 780 }); const past = new Set();
    await page.addStyleTag({ content: 'html { font-size: 130% !important; }' });
    for (const tab of TABS) {
      await go(page, tab);
      (await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.right > innerWidth + 2 || b.left < -2) && !e.closest('.seg.five, .earned'); })
        .slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`))).forEach((x) => past.add(`${tab}: ${x}`));
    }
    ok(past.size === 0, `with large text nothing runs off a small phone${past.size ? ': ' + [...past].slice(0, 6).join('; ') : ''}`);
    await page.close();
  }

  // ---- Reduce motion (the phone's setting): pages, the add sheet and the celebration after adding do not animate --------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(B + '/'); await page.evaluate((t) => { localStorage.setItem('token', t); localStorage.setItem('intro', '1'); }, host.token); await page.goto(B + '/'); await page.waitForTimeout(900);
    const moving = new Set();
    const grab = async (w) => (await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && (a.effect?.getTiming?.().duration || 0) > 50)
      .map((a) => `${a.animationName || a.transitionProperty || 'animation'} on ${a.effect?.target?.className || ''}`))).forEach((x) => moving.add(`${w}: ${x}`));
    for (const tab of TABS) { await page.evaluate((t) => (document.querySelector(`.sitem[data-tab=${t}]`) || document.querySelector(`[data-tab=${t}]`))?.click(), tab); await page.waitForTimeout(80); await grab(tab); await page.waitForTimeout(400); }
    await page.click('.hadd').catch(() => {}); await page.waitForTimeout(80); await grab('add sheet'); await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('[data-tab=home]').click()); await page.waitForTimeout(500);
    await page.fill('#manual', '10'); await page.click('[data-act=manual]'); await page.waitForTimeout(150); await grab('after adding');
    ok(moving.size === 0, `with reduce motion on, nothing animates${moving.size ? ': ' + [...moving].slice(0, 5).join('; ') : ''}`);
    await ctx.close();
  }

  // ---- The big numerals fit their card even when a phone scales its text (Android's font size setting): measured, not assumed -----
  {
    const page = await open(host.token, { w: 360, h: 780 }); const over = [];
    await page.addStyleTag({ content: '#big { font-size: 190px !important; }' }); // as if the phone had scaled the numeral up
    for (const txt of ['100', '9,714', '10,014', '1,234,567', '12,345,678']) {
      await page.evaluate((t) => { document.querySelector('#big').innerHTML = t.replace(/,/g, '<span class="cm">,</span>'); dispatchEvent(new Event('resize')); }, txt);
      await page.waitForTimeout(80);
      const [w, room] = await page.evaluate(() => { const e = document.querySelector('#big'), cs = getComputedStyle(e), r = document.createRange(); r.selectNodeContents(e);
        return [r.getBoundingClientRect().width, e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)]; });
      if (w > room + 1) over.push(`${txt} ${Math.round(w)}>${Math.round(room)}`);
    }
    ok(over.length === 0, `the big counter fits its card at any text scale${over.length ? ': ' + over.join('; ') : ''}`);
    await page.close();
  }

  // ---- Tap targets: on a phone nothing a finger presses is under 24 px either way (WCAG 2.2 target size), every page with folds open ----
  {
    const small = new Set(), ids = new Set();
    for (const tab of TABS) {
      const page = await open(host.token); await go(page, tab);
      await page.$$eval('[data-act=fold][aria-expanded=false]', (els) => els.forEach((e) => e.click())).catch(() => {}); await page.waitForTimeout(400);
      (await page.evaluate(() => [...document.querySelectorAll('button, a[href], [role=button], [role=switch], input:not([type=hidden]), select')]
        .filter((e) => e.offsetParent !== null && !e.closest('p, li small, .tagl')) // a link inside a sentence is exempt (WCAG "inline")
        .map((e) => { const r = e.getBoundingClientRect(); return r.width && (r.width < 24 || r.height < 24) ? `${e.tagName.toLowerCase()}[${e.dataset.act || ''}] ${Math.round(r.width)}x${Math.round(r.height)}` : null; })
        .filter(Boolean))).forEach((x) => small.add(`${tab}: ${x}`));
      (await page.evaluate(() => { const c = {}; document.querySelectorAll('[id]').forEach((e) => { c[e.id] = (c[e.id] || 0) + 1; });
        return Object.entries(c).filter(([, n]) => n > 1).map(([k]) => `id ${k} used twice`).concat([...document.querySelectorAll('label[for]')].filter((l) => !document.getElementById(l.htmlFor)).map((l) => `label for missing ${l.htmlFor}`)); }))
        .forEach((x) => ids.add(`${tab}: ${x}`));
      await page.close();
    }
    ok(small.size === 0, `every tap target is at least 24 px${small.size ? ': ' + [...small].slice(0, 6).join('; ') : ''}`);
    ok(ids.size === 0, `no id is used twice and every label points at a field${ids.size ? ': ' + [...ids].slice(0, 6).join('; ') : ''}`);
  }

  // ---- Keyboard: every stop Tab reaches on every page shows where it is (an outline or a ring), light and dark --------------------
  {
    const unseen = new Set();
    for (const mode of ['light', 'dark']) {
      const page = await open(host.token, { w: 1280, h: 900, mode });
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' }); // read the settled look
      for (const tab of TABS) {
        await go(page, tab); await page.evaluate(() => document.activeElement?.blur());
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press('Tab');
          const r = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body || !e.matches(':focus')) return null; const cs = getComputedStyle(e); // (not :focus: on a part inside a built-in control, like a time box's clock button, which the browser rings itself)
            const seen = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== 'none' && !/^rgba\(0, 0, 0, 0\)/.test(cs.boxShadow));
            return seen ? null : `${e.tagName.toLowerCase()}[${e.dataset.act || e.name || e.id || ''}]`; });
          if (r) unseen.add(`${mode}/${tab}: ${r}`);
        }
      }
      await page.close();
    }
    ok(unseen.size === 0, `every keyboard stop shows focus${unseen.size ? ': ' + [...unseen].slice(0, 6).join('; ') : ''}`);
  }

  // ---- Admin page: key sign-in, every tab opens, nothing runs off a phone screen -----------------------------------
  for (const [w, label] of [[1280, 'desktop'], [390, 'phone'], [360, 'small phone, large text']]) {
    const page = await browser.newPage({ viewport: { width: w, height: 860 } });
    page.on('pageerror', (e) => errors.push('admin: ' + e.message));
    await page.goto(B + '/admin.html'); await page.waitForTimeout(500);
    await page.click('#usekey'); await page.fill('#key', process.env.ADMIN_KEY); await page.click('#save'); await page.waitForTimeout(900);
    if (label.includes('large')) await page.addStyleTag({ content: 'html { font-size: 130% !important; }' });
    const tabs = await page.$$eval('#tabs button', (x) => x.map((e) => e.dataset.tab));
    ok(tabs.length >= 8, `admin (${label}): signed in with the key, ${tabs.length} tabs`);
    const wide = [];
    for (const t of tabs) {
      await page.click(`#tabs [data-tab=${t}]`); await page.waitForTimeout(400);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(t);
    }
    ok(wide.length === 0, `admin (${label}): no tab runs off the screen${wide.length ? ': ' + wide.join(', ') : ''}`);
    if (label === 'desktop') {
      // sign-ups: the kill switch and a code for a caravan
      await page.click('#tabs [data-tab=invites]'); await page.waitForTimeout(500);
      await page.click('[data-a=signupsw]'); await page.waitForTimeout(700);
      ok((await api('GET', '/api/config')).signupsOpen === false, 'the admin closes sign-ups');
      await page.click('[data-a=signupsw]'); await page.waitForTimeout(700);
      ok((await api('GET', '/api/config')).signupsOpen === true, '...and opens them again');
      await page.fill('#fcv', 'e2e_cv'); await page.fill('#flabel', 'E2E lead'); await page.click('[data-a=fnew]'); await page.waitForTimeout(700);
      ok(/New code for e2e_cv: [A-Z0-9]{4}-[A-Z0-9]{4}/.test(await page.textContent('#panel .msg')), 'a code is made for a caravan');
      await page.fill('#fcv', 'no_such_cv'); await page.click('[data-a=fnew]'); await page.waitForTimeout(700);
      ok(/No caravan has that name/.test(await page.textContent('#panel .msg')), 'a code for a missing caravan says so in plain words');
      // members: create one with the form, then a caravan with that member as owner
      await page.click('#tabs [data-tab=members]'); await page.waitForTimeout(500);
      await page.fill('#cmu', 'e2e_owner2'); await page.fill('#cmp', 'secret12'); await page.fill('#cme', 'e2e_owner2@e2e.pk'); await page.fill('#cmph', '300 8880001');
      await page.fill('#cmcity', 'Lahore'); await page.click('[data-a=cmfind]'); await page.waitForTimeout(900);
      await page.click('[data-a=cmcreate]'); await page.waitForTimeout(1200);
      ok(!!(await api('POST', '/api/login', { id: 'e2e_owner2', password: 'secret12' })).token, 'the admin creates a member with the form');
      await page.click('#tabs [data-tab=caravans]'); await page.waitForTimeout(500);
      await page.fill('#cvn', 'e2e_cv_two'); await page.fill('#cvo', 'e2e_owner2'); await page.click('[data-a=cvcreate]'); await page.waitForTimeout(1000);
      ok((await api('POST', '/api/login', { id: 'e2e_owner2', password: 'secret12' })).me.caravan?.name === 'e2e_cv_two', 'the admin creates a caravan with that member as owner');
      ok(await page.locator('td', { hasText: 'e2e_cv_two' }).count() >= 1, 'the new caravan is listed');
    }
    await page.close();
  }
} catch (e) {
  failed++; console.error('FAIL (crash)', e);
} finally {
  ok(errors.length === 0, `no page or console errors${errors.length ? `: ${[...new Set(errors)].slice(0, 5).join(' | ')}` : ''}`);
  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
}
