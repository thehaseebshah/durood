// Walks the page in a real browser: node scripts/browser-check.mjs [http://localhost:8080]  (needs Playwright installed; not a dependency of the app)
import { chromium } from 'playwright';
const PHONE = '0300 70' + String(Math.floor(Math.random() * 90000 + 10000));
const BASE = process.argv[2] || 'http://localhost:8787';
const PATH = process.argv[3] || '/';   // a caravan's link, e.g. /c/madinah (the plain address is only a landing page)
const type = async (page, n) => { for (const d of String(n)) await page.click(`#pad [data-k="${d}"]`); };
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
await (async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE + PATH); await page.waitForTimeout(500);
  ok(await page.locator('#phone').isVisible() && await page.locator('#count').isVisible(), 'phone and count are visible at first');
  ok(!(await page.locator('#newcomer').isVisible()), 'name and city are hidden at first');
  ok(!(await page.locator('#stats').isVisible()), 'stats are hidden at first');
  await page.fill('#phone', PHONE); await page.waitForTimeout(1000);
  ok(await page.locator('#newcomer').isVisible(), 'an unknown number reveals name and city');
  ok((await page.locator('#city option').count()) > 90 && (await page.locator('#city').evaluate((e) => e.tagName)) === 'SELECT', 'the city is a dropdown');
  await type(page, 313);
  await page.click('#submit'); await page.waitForTimeout(500);
  ok(/name/i.test(await page.textContent('#error')), 'a missing name is asked for');
  await page.fill('#name', 'Amina Khan'); await page.selectOption('#city', 'Lahore');
  await page.click('#submit'); await page.waitForTimeout(800);
  ok(await page.locator('#stats').isVisible(), 'the stats show after the entry');
  ok((await page.textContent('#you-today')) === '313' && (await page.textContent('#all-today')) === '313', 'today: 313 for you and for everyone');
  ok((await page.textContent('#you-week')) === '313', 'this week: 313');
  ok((await page.textContent('#target')) === '100,000,000', 'the overall target is shown');
    // the same number again: only the count is asked
  await page.reload(); await page.waitForTimeout(400);
  await page.fill('#phone', PHONE); await page.waitForTimeout(1000);
  ok(!(await page.locator('#newcomer').isVisible()), 'a known number does not ask for a name or city');
  await page.click('#pad [data-k="clear"]'); await type(page, 4500); await page.click('#submit'); await page.waitForTimeout(800);
  ok((await page.textContent('#you-today')) === '4,813', 'a second entry adds up (313 + 4,500)');
  const real = errors.filter((e) => !/status of 422/.test(e)); // the 422 is the page being told a new number needs a name
  ok(real.length === 0, 'no page errors ' + real.join('|'));
  await b.close();
})();
