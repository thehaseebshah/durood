// End-to-end browser test: starts its own server on a throwaway database and drives the app the way a member does.
//   npm run e2e            (needs Playwright with Chromium; set NODE_PATH to where it is installed if it isn't local)
// Every check prints a line; any failure, page error or console error makes the run fail.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-e2e-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'e2e.db'), ADMIN_KEY: 'e2e-admin-key-long-enough-1234', EDITION: 'internal',
  PUBLIC_FOUNDERS_CODE: 'E2ECODE', PUBLIC_CACHE_MS: '0', NODE_ENV: 'test', FLAG_NEW_HIGH: '1000000000' });
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
const register = (u, invite = 'E2ECODE') => api('POST', '/api/register', { username: u, email: `${u}@e2e.pk`, phone: `0303${String(4000000 + ++n)}`, password: 'secret12', cityId: 1172451, invite, lang: 'en' });

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

  // ---- sign-up through the form -------------------------------------------------------------------------
  {
    const page = await open(null);
    await page.locator('[data-act=mode][data-mode=register], [data-mode=register]').first().click().catch(() => {});
    await page.waitForTimeout(300);
    ok(await page.locator('form[data-form=register]').count() === 1, 'sign-up form shows');
    await page.click('form[data-form=register] button[type=submit]'); await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.activeElement?.name === 'invite'), 'an empty sign-up points at the first empty field');
    await page.fill('[name=invite]', 'E2ECODE'); await page.click('form[data-form=register] button[type=submit]'); await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.activeElement?.name === 'username'), '...then the next one');
    await page.close();
  }

  const host = await register('e2e_host');
  const kid = await register('e2e_kid');
  ok(!!host.token && !!kid.token, 'members register');

  // ---- Today: log durood, goal burst, points float, quest pops, units shown ----------------------------------
  {
    const page = await open(host.token, { touch: true });
    ok(await page.locator('.startcard').count() === 1, 'new member sees Getting started');
    ok(await page.locator('.q[data-q=streak]').count() === 1, 'streak quest is listed');
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

  // ---- Qabila: invites breakdown, who invited you ------------------------------------------------------------
  {
    const page = await open(kid.token);
    await go(page, 'qabila');
    ok(await page.locator('.invsrc li').count() === 4, 'invite sources are listed');
    await page.fill('.linkinv input', 'e2e_host'); await page.locator('.linkinv button').click(); await page.waitForTimeout(900);
    ok(await page.locator('.linkinv').count() === 0, 'linking to the inviter closes the form');
    const me = await api('GET', '/api/me', null, kid.token);
    ok(me.inviter === 'e2e_host', 'the kid is now under the host');
    await page.close();
  }

  // ---- Tasks: add with the + button, tick, undo ----------------------------------------------------------------
  {
    const page = await open(host.token);
    await go(page, 'tasks');
    await page.click('.hadd'); await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.activeElement?.name === 'title'), 'the + on Tasks focuses a new task');
    await page.fill('[data-form=owntask] input[name=title]', 'Plan the circle');
    const due = new Date(Date.now() + 5 * 3600e3 + 864e5).toISOString().slice(0, 10);
    await page.fill('[data-form=owntask] input[type=date]', due).catch(() => {});
    await page.click('[data-form=owntask] button[type=submit]'); await page.waitForTimeout(800);
    ok(await page.locator('.trow', { hasText: 'Plan the circle' }).count() >= 1, 'own task is added');
    await page.locator('.trow', { hasText: 'Plan the circle' }).first().locator('.tcheck').click(); await page.waitForTimeout(900);
    ok((await api('GET', '/api/burhan', null, host.token)).assignments.some((a) => a.title === 'Plan the circle' && a.done), 'ticking completes the task');
    await page.close();
  }

  // ---- caravan: create, invite by username, accept -------------------------------------------------------------------
  {
    const page = await open(host.token);
    await go(page, 'caravan');
    await page.fill('#cv-new', 'e2e_cv'); await page.click('form[data-form=cvcreate] button[type=submit]'); await page.waitForTimeout(900);
    ok((await api('GET', '/api/caravan', null, host.token)).caravan?.name === 'e2e_cv', 'a caravan is created');
    await page.fill('#cvinvq', 'e2e_ki'); await page.waitForTimeout(900);
    await page.locator('[data-act=cvinvite][data-u=e2e_kid]').click(); await page.waitForTimeout(700);
    await page.close();
    const kp = await open(kid.token);
    await go(kp, 'caravan');
    await kp.locator('[data-act=cvaccept]').first().click(); await kp.waitForTimeout(900);
    ok((await api('GET', '/api/caravan', null, host.token)).caravan?.members === 2, 'the invitee accepts and the caravan has two members');
    await kp.close();
    // the owner gives it an Urdu display name; the page shows it, with the handle beneath
    const op = await open(host.token);
    await go(op, 'caravan');
    await op.fill('#cv-display', 'قافلۂ نور'); await op.click('form[data-form=cvdisplay] button[type=submit]'); await op.waitForTimeout(900);
    ok((await op.textContent('.cvname'))?.trim() === 'قافلۂ نور' && (await op.textContent('.cvname + .muted')).includes('@e2e_cv'), 'the owner gives the caravan an Urdu display name; its handle stays beneath');
    // rapid taps between pages skip animations without page errors
    for (let i = 0; i < 20; i++) await op.evaluate((tb) => document.querySelector(`nav.tabs [data-tab=${tb}]`).click(), ['feed', 'rank', 'home'][i % 3]);
    await op.waitForTimeout(800);
    await op.close();
  }

  // ---- masul and razakar: a task given from My people is done on the razakar's Tasks page --------------------------------
  {
    await api('PUT', '/api/burhan/masul', { username: 'e2e_host' }, kid.token);
    const page = await open(host.token);
    await go(page, 'people');
    await page.locator('[data-act=openrazakar][data-u=e2e_kid]').click(); await page.waitForTimeout(900);
    const due = new Date(Date.now() + 5 * 3600e3 + 2 * 864e5).toISOString().slice(0, 10);
    await page.fill('form[data-form=assign] input[name=title]', 'Bring the banner');
    await page.fill('form[data-form=assign] input[type=date]', due);
    await page.click('form[data-form=assign] button[type=submit]'); await page.waitForTimeout(900);
    ok((await api('GET', '/api/burhan', null, kid.token)).assignments.some((x) => x.title === 'Bring the banner'), 'the masul gives the razakar a task');
    await page.close();
    const kp = await open(kid.token);
    await go(kp, 'tasks');
    await kp.locator('.trow', { hasText: 'Bring the banner' }).first().locator('.tcheck').click(); await kp.waitForTimeout(1200);
    const rep = await api('GET', '/api/burhan/razakars/e2e_kid', null, host.token);
    ok(JSON.stringify(rep).includes('Bring the banner') && rep.assignments?.some?.((x) => x.title === 'Bring the banner' && x.done), 'the razakar completes it and the masul sees it done');
    await kp.close();
  }

  // ---- reflection, a lecture, the daily goal and the language from Settings ------------------------------------------------------
  {
    await api('POST', '/api/admin/lectures', { youtube_id: 'dQw4w9WgXcQ', title_en: 'E2E lecture', speaker: 'Test', min_seconds: 30, questions: [{ q_en: 'Where did the Prophet ﷺ migrate to?', options_en: ['Makkah', 'Madinah'], answer: 1 }] }, null, K);
    const page = await open(host.token);
    await page.fill('#refl', 'Patience is light.'); await page.click('[data-act=reflect]'); await page.waitForTimeout(900);
    ok((await api('GET', '/api/feed', null, host.token)).reflection?.mine?.body === 'Patience is light.', 'a reflection is posted');
    await page.reload(); await page.waitForTimeout(1200);
    await page.locator('[data-act=watch]').first().click(); await page.waitForTimeout(900);
    ok(await page.locator('.modal [data-act=pclose]').count() === 1, 'a lecture opens in the player');
    await page.waitForTimeout(31500);
    ok(await page.locator('#pclaim').isDisabled(), 'after watching, the reward still waits for the quiz');
    await page.locator('input[name=qz0][value="1"]').check(); await page.click('[data-act=quizcheck]'); await page.waitForTimeout(800);
    ok(!(await page.locator('#pclaim').isDisabled()), 'a passed quiz unlocks the reward');
    await page.click('#pclaim'); await page.waitForTimeout(900);
    ok((await api('GET', '/api/me', null, host.token)).quests.find((q) => q.id === 'lecture')?.done === true, 'the lecture reward is claimed');
    for (let i = 0; i < 3 && await page.locator('.modal').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    ok(await page.locator('.modal').count() === 0, 'the player and any celebration close');
    await go(page, 'settings');
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

  // ---- swipe a task: right completes it, left opens the reschedule sheet ---------------------------------------------------------
  {
    const due = new Date(Date.now() + 5 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);
    await api('POST', '/api/tasks', { kind: 'task', title: 'Swipe me done', dueDay: due }, host.token);
    await api('POST', '/api/tasks', { kind: 'task', title: 'Swipe me later', dueDay: due }, host.token);
    const page = await open(host.token);
    await go(page, 'tasks');
    const swipe = async (title, dx) => {
      const box = await page.locator('.trow', { hasText: title }).first().locator('.tfront').boundingBox();
      const y = box.y + box.height / 2, x = box.x + box.width / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(x + (dx * i) / 10, y); await page.waitForTimeout(16); }
      await page.mouse.up(); await page.waitForTimeout(1000);
    };
    await swipe('Swipe me done', 260);
    ok((await api('GET', '/api/burhan', null, host.token)).assignments.some((x) => x.title === 'Swipe me done' && x.done), 'swiping right completes a task');
    await swipe('Swipe me later', -260);
    ok(await page.locator('[data-act=reschpick]').count() > 0, 'swiping left opens the reschedule sheet');
    await page.locator('[data-act=reschpick]').first().click(); await page.waitForTimeout(900);
    const moved = (await api('GET', '/api/burhan', null, host.token)).assignments.find((x) => x.title === 'Swipe me later');
    ok(moved && moved.dueDay !== due, 'picking a day moves its deadline');
    await page.close();
  }

  // ---- every page, both languages, dark mode, desktop: renders, no sideways scroll, no errors -----------------------
  for (const [lang, mode, w] of [['en', 'light', 390], ['ur', 'light', 390], ['en', 'dark', 390], ['en', 'light', 1280]]) {
    await api('PATCH', '/api/me', { lang }, host.token);
    const page = await open(host.token, { lang, mode, w });
    for (const tab of ['home', 'feed', 'rank', 'caravan', 'qabila', 'tasks', 'people', 'progress', 'settings']) {
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
    for (const mode of ['light', 'dark']) for (const tab of ['home', 'feed', 'rank', 'caravan', 'qabila', 'tasks', 'people', 'progress', 'settings']) {
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
    for (const tab of ['home', 'feed', 'rank', 'caravan', 'qabila', 'tasks', 'people', 'progress', 'settings']) { const page = await open(host.token); await go(page, tab); await scan(page, tab); await page.close(); }
    const page = await open(host.token); await go(page, 'feed'); await page.click('.hadd'); await page.waitForTimeout(400); await scan(page, 'add sheet'); await page.close();
    const anon = await browser.newPage({ viewport: { width: 390, height: 844 } }); await anon.goto(B + '/?invite=E2ECODE'); await anon.evaluate(() => localStorage.setItem('intro', '1')); await anon.goto(B + '/?invite=E2ECODE'); await anon.waitForTimeout(700);
    await anon.getByRole('button', { name: /join/i }).first().click().catch(() => {}); await anon.waitForTimeout(400); await scan(anon, 'sign-up'); await anon.close();
    ok(frames.size === 0, `no old-style hard frames anywhere${frames.size ? ': ' + [...frames].slice(0, 5).join('; ') : ''}`);
  }

  // ---- Rankings: tapping a row anywhere (here its name) opens that member's profile, as tapping the photo does ----------------------
  {
    const page = await open(host.token); await go(page, 'rank');
    const row = page.locator('.lb li:has(.avbtn)').first();
    await row.locator('.name').click(); await page.waitForTimeout(700);
    ok(await page.locator('.modal .box.profile').count() === 1, 'tapping a ranking row opens the profile');
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

  // ---- Tap targets: on a phone nothing a finger presses is under 24 px either way (WCAG 2.2 target size), every page with folds open ----
  {
    const small = new Set();
    for (const tab of ['home', 'feed', 'rank', 'caravan', 'qabila', 'tasks', 'people', 'progress', 'settings']) {
      const page = await open(host.token); await go(page, tab);
      await page.$$eval('[data-act=fold][aria-expanded=false]', (els) => els.forEach((e) => e.click())).catch(() => {}); await page.waitForTimeout(400);
      (await page.evaluate(() => [...document.querySelectorAll('button, a[href], [role=button], [role=switch], input:not([type=hidden]), select')]
        .filter((e) => e.offsetParent !== null && !e.closest('p, li small, .tagl')) // a link inside a sentence is exempt (WCAG "inline")
        .map((e) => { const r = e.getBoundingClientRect(); return r.width && (r.width < 24 || r.height < 24) ? `${e.tagName.toLowerCase()}[${e.dataset.act || ''}] ${Math.round(r.width)}x${Math.round(r.height)}` : null; })
        .filter(Boolean))).forEach((x) => small.add(`${tab}: ${x}`));
      await page.close();
    }
    ok(small.size === 0, `every tap target is at least 24 px${small.size ? ': ' + [...small].slice(0, 6).join('; ') : ''}`);
  }

  // ---- Keyboard: every stop Tab reaches on every page shows where it is (an outline or a ring), light and dark --------------------
  {
    const unseen = new Set();
    for (const mode of ['light', 'dark']) {
      const page = await open(host.token, { w: 1280, h: 900, mode });
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' }); // read the settled look
      for (const tab of ['home', 'feed', 'rank', 'caravan', 'qabila', 'tasks', 'people', 'progress', 'settings']) {
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
  for (const [w, label] of [[1280, 'desktop'], [390, 'phone']]) {
    const page = await browser.newPage({ viewport: { width: w, height: 860 } });
    page.on('pageerror', (e) => errors.push('admin: ' + e.message));
    await page.goto(B + '/admin.html'); await page.waitForTimeout(500);
    await page.click('#usekey'); await page.fill('#key', process.env.ADMIN_KEY); await page.click('#save'); await page.waitForTimeout(900);
    const tabs = await page.$$eval('#tabs button', (x) => x.map((e) => e.dataset.tab));
    ok(tabs.length >= 8, `admin (${label}): signed in with the key, ${tabs.length} tabs`);
    const wide = [];
    for (const t of tabs) {
      await page.click(`#tabs [data-tab=${t}]`); await page.waitForTimeout(400);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(t);
    }
    ok(wide.length === 0, `admin (${label}): no tab runs off the screen${wide.length ? ': ' + wide.join(', ') : ''}`);
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
