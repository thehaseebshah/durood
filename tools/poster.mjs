// Renders a poster page (posters/NNN-slug/poster.html) to poster.png next to it, at the page's own size (default 1080x1920).
//   node tools/poster.mjs posters/001-launched            (writes posters/001-launched/poster.png)
//   node tools/poster.mjs posters/001-launched out.png
// The page may set <body data-w="1080" data-h="1350"> for another size. Needs Playwright with Chromium.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [folder, out] = process.argv.slice(2);
if (!folder) { console.error('Usage: node tools/poster.mjs <poster folder> [out.png]'); process.exit(2); }
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) console.log('missing:', r.status(), r.url()); });
await page.goto(`http://127.0.0.1:${server.address().port}/${path.relative(ROOT, path.resolve(folder))}/poster.html`);
const size = await page.evaluate(() => ({ w: +document.body.dataset.w || 1080, h: +document.body.dataset.h || 1920 }));
await page.setViewportSize({ width: size.w, height: size.h });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : i.decode().catch(() => {})))));
const file = out || path.join(folder, 'poster.png');
await page.screenshot({ path: file, type: 'png' });
await browser.close();
server.close();
console.log(file, `${size.w}x${size.h}`);
