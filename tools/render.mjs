// Renders a promo scene to an MP4, frame by frame, so the video is exact whatever the machine's speed.
//   node tools/render.mjs videos/001-every-durood-counts            -> videos/001-every-durood-counts/<folder>.mp4 + poster.jpg
//   node tools/render.mjs videos/001-every-durood-counts --fps 30 --from 0 --to 5 --poster 29 --silent
//   node tools/render.mjs videos/001-every-durood-counts --still 12.4     (one frame as a PNG, for checking)
// A scene is scene.html in that folder: a 1080x1920 page that sets window.DURATION, window.seek(t) and window.ready,
// and optionally window.CUES (sound effects, made by tools/sfx.mjs; --silent leaves them out) and window.POSTER (cover second).
// Needs Playwright with Chromium and ffmpeg.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeSfx } from './sfx.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : Number(args[i + 1]); };
const folder = args.find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a));
if (!folder) { console.error('Usage: node tools/render.mjs <video folder> [--fps 30] [--from s] [--to s] [--still s]'); process.exit(2); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.resolve(folder), name = path.basename(dir);
const fps = opt('fps', 30), still = opt('still', NaN);

// a static server for the repository, so the scene loads its fonts and screenshots as it would on the web
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error(e); process.exitCode = 1; });
await page.goto(`http://127.0.0.1:${server.address().port}/${path.relative(ROOT, dir)}/scene.html`);
await page.evaluate(() => window.ready);
const duration = await page.evaluate(() => window.DURATION);
const draw = async (t) => {
  await page.evaluate((t) => window.seek(t), t);
  await page.evaluate(() => Promise.all([...document.images].filter((i) => i.getAttribute('src')).map((i) => (i.complete ? 0 : i.decode().catch(() => {})))));
  return page.screenshot({ type: 'png' });
};

if (!Number.isNaN(still)) {
  const out = path.join(dir, `still-${still}.png`);
  fs.writeFileSync(out, await draw(still));
  console.log(out);
} else {
  const from = opt('from', 0), to = Math.min(opt('to', duration), duration);
  const out = path.join(dir, `${name}.mp4`);
  const cues = args.includes('--silent') ? null : await page.evaluate(() => window.CUES || null);
  const wav = path.join(os.tmpdir(), `${name}-sfx.wav`);
  if (cues) writeSfx(cues.filter((c) => c.t >= from && c.t < to).map((c) => ({ ...c, t: c.t - from })), to - from, wav);
  // always an audio track (a silent one without cues): TikTok, Reels and WhatsApp handle that more reliably
  const audio = cues ? ['-i', wav] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    ...audio, '-shortest',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '160k', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.round((to - from) * fps);
  for (let f = 0; f < frames; f++) {
    const png = await draw(from + f / fps);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % fps === 0) process.stdout.write(`\r${(f / fps).toFixed(0)} / ${(to - from).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error(`ffmpeg exited ${c}`)) : r())));
  await draw(opt('poster', await page.evaluate(() => window.POSTER ?? window.DURATION - 2))); // the cover image
  fs.writeFileSync(path.join(dir, 'poster.jpg'), await page.screenshot({ type: 'jpeg', quality: 88 }));
  console.log(`\n${out}`);
}
await browser.close();
server.close();
