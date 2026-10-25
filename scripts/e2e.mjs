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
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
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
    ok(await page.locator('.u-durood').count() > 0 && await page.locator('.u-pts').count() > 0, 'numbers carry durood / pts units');
    ok(!(await overflowX(page)), 'Today has no sideways scroll on a phone');
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
    await page.click('.fab'); await page.waitForTimeout(400);
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
