// Renders a promo scene to an MP4, frame by frame, so the video is exact whatever the machine's speed.
//   node tools/render.mjs videos/001-every-durood-counts            -> videos/001-every-durood-counts/<folder>.mp4 + poster.jpg
//   node tools/render.mjs videos/002-the-full-tour --jobs 4          (splits the frames over 4 browsers, then joins them)
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
import { fileURLToPath } from 'node:url';
import { writeSfx } from './sfx.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const num = (k, d) => Number(opt(k, d));
const folder = args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')));
if (!folder) { console.error('Usage: node tools/render.mjs <video folder> [--jobs n] [--fps 30] [--from s] [--to s] [--still s] [--silent]'); process.exit(2); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(folder), name = path.basename(dir);
const fps = num('fps', 30), still = num('still', NaN), jobs = num('jobs', 1), part = opt('part', null);
const run = (cmd, a, o = {}) => new Promise((res, rej) => { const p = spawn(cmd, a, { stdio: 'inherit', ...o }); p.on('close', (c) => (c ? rej(new Error(`${cmd} exited ${c}`)) : res())); });

// a static server for the repository, so the scene loads its fonts and screenshots as it would on the web
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const draw = async (t, type = 'jpeg') => {
  await page.evaluate((t) => window.seek(t), t);
  await page.evaluate(() => Promise.all([...document.images].filter((i) => i.getAttribute('src')).map((i) => (i.complete ? 0 : i.decode().catch(() => {})))));
  return page.screenshot(type === 'png' ? { type } : { type, quality: 95 });
};
// frames [a, b) to an MP4 with no sound
async function frames(a, b, out) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-', '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = a; f < b; f++) {
    const img = await draw(f / fps);
    if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - a) % (fps * 5) === 0) process.stdout.write(`${part ? `[${a}] ` : ''}${((f - a) / fps).toFixed(0)}/${((b - a) / fps).toFixed(0)} s\n`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error(`ffmpeg exited ${c}`)) : r())));
}

if (!Number.isNaN(still)) {
  const out = path.join(dir, `still-${still}.png`);
  fs.writeFileSync(out, await draw(still, 'png'));
  console.log(out);
} else if (part) {
  const [a, b] = part.split(':').map(Number);
  await frames(a, b, opt('out'));
} else {
  const from = num('from', 0), to = Math.min(num('to', duration), duration);
  const F0 = Math.round(from * fps), F1 = Math.round(to * fps);
  const out = path.join(dir, `${name}.mp4`), tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const video = path.join(tmp, 'video.mp4');
  if (jobs > 1) {
    // each job renders a run of frames in its own browser; the runs are joined without re-encoding
    const size = Math.ceil((F1 - F0) / jobs), parts = [];
    for (let j = 0; j < jobs; j++) { const a = F0 + j * size, b = Math.min(F1, a + size); if (a < b) parts.push({ a, b, out: path.join(tmp, `part-${j}.mp4`) }); }
    await Promise.all(parts.map((p) => run(process.execPath, [fileURLToPath(import.meta.url), folder, '--fps', String(fps), '--part', `${p.a}:${p.b}`, '--out', p.out])));
    fs.writeFileSync(path.join(tmp, 'list.txt'), parts.map((p) => `file '${p.out}'`).join('\n'));
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-c', 'copy', video]);
  } else await frames(F0, F1, video);
  // always an audio track (a silent one without cues): TikTok, Reels and WhatsApp handle that more reliably
  const cues = args.includes('--silent') ? null : await page.evaluate(() => window.CUES || null);
  const wav = path.join(tmp, 'sfx.wav');
  if (cues) writeSfx(cues.filter((c) => c.t >= from && c.t < to).map((c) => ({ ...c, t: c.t - from })), to - from, wav);
  const audio = cues ? ['-i', wav] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, ...audio, '-map', '0:v', '-map', '1:a', '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  await draw(num('poster', await page.evaluate(() => window.POSTER ?? window.DURATION - 2))); // the cover image
  fs.writeFileSync(path.join(dir, 'poster.jpg'), await page.screenshot({ type: 'jpeg', quality: 88 }));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(out);
}
await browser.close();
server.close();
