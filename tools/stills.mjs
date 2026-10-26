// A contact sheet of stills from a scene, for checking a video without rendering it. Also prints the storyboard's timing
// when the scene exposes window.STORY.
//   node tools/stills.mjs videos/002-the-full-tour sheet.png 6 3 12 21.5 40     (folder, output, columns, seconds...)
// Each still is 1080x1920, shown at 360x640. Needs Playwright with Chromium and Python with Pillow.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [folder, out, cols = '6', ...times] = process.argv.slice(2);
if (!folder || !out) { console.error('Usage: node tools/stills.mjs <video folder> <out.png> [columns] [seconds...]'); process.exit(2); }
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
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
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(`console ${m.type()}:`, m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${server.address().port}/${path.relative(ROOT, path.resolve(folder))}/scene.html`);
await page.evaluate(() => window.ready);
console.log(await page.evaluate(() => (window.STORY || []).map((s) => `${s.t.toFixed(1).padStart(6)}  ${s.type.padEnd(8)} ${s.shot || s.title || s.en || ''}`).join('\n')));
console.log('duration', await page.evaluate(() => window.DURATION));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stills-')), files = [];
for (const t of times) {
  await page.evaluate((t) => window.seek(+t), t);
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : i.decode().catch(() => {})))));
  const f = path.join(tmp, `${files.length}.jpg`); await page.screenshot({ path: f, type: 'jpeg', quality: 80 }); files.push(f);
}
await browser.close();
server.close();
if (files.length) {
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
out, cols, fs = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
rows = (len(fs) + cols - 1) // cols
W = Image.new('RGB', (365 * min(cols, len(fs)), 645 * rows), 'gray')
for i, f in enumerate(fs): W.paste(Image.open(f).resize((360, 640)), (365 * (i % cols), 645 * (i // cols)))
W.save(out)`, out, cols, ...files]);
  console.log(out);
}
fs.rmSync(tmp, { recursive: true, force: true });
