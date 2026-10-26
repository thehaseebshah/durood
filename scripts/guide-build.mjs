// Builds the member guide: each tutorial in guide/src is wrapped in the shared layout and written to guide/,
// and all of them are joined into guide/print.html, which is printed to guide/seerah-quest-guide.pdf.
//   node scripts/guide-build.mjs          (HTML only, no dependencies)
//   node scripts/guide-build.mjs --pdf    (also the PDF; needs Playwright with Chromium, like npm run e2e)
// A tutorial starts with a comment holding its title, a one-line summary and how long it takes:
//   <!-- title: Add your durood | summary: Type a number, tap a preset or count by tapping. | time: 3 min -->
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../guide');
const src = path.join(root, 'src');
const APP_URL = 'https://seerah-quest.fly.dev';

// the order of the guide; each part groups a few tutorials
const PARTS = [
  ['Getting started', ['install', 'join', 'first-durood', 'find-your-way']],
  ['Every day', ['fix-a-mistake', 'streaks-and-points', 'sunnah-and-seerah']],
  ['Together', ['caravan', 'invite', 'compete']],
  ['Your account', ['settings', 'al-burhan']],
  ['Help', ['faq']],
];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pages = [];
for (const [part, slugs] of PARTS) for (const slug of slugs) {
  const raw = fs.readFileSync(path.join(src, `${slug}.html`), 'utf8');
  const m = raw.match(/^<!--(.*?)-->\s*/s);
  if (!m) throw new Error(`${slug}.html: missing the title comment`);
  const meta = Object.fromEntries(m[1].split('|').map((kv) => kv.split(':').map((x) => x.trim())).map(([k, ...v]) => [k, v.join(':')]));
  pages.push({ slug, part, title: meta.title, summary: meta.summary, time: meta.time, body: raw.slice(m[0].length) });
}
pages.forEach((p, i) => { p.n = i + 1; });

const nav = (current) => PARTS.map(([part]) => `<div class="navpart">${esc(part)}</div><ol class="navlist">${pages.filter((p) => p.part === part)
  .map((p) => `<li><a href="${p.slug}.html"${p.slug === current ? ' aria-current="page"' : ''}><span class="num">${p.n}</span>${esc(p.title)}</a></li>`).join('')}</ol>`).join('');

const layout = ({ title, description, current, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#00875a">
<link rel="icon" href="img/icon.png">
<link rel="stylesheet" href="guide.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <a class="brand" href="index.html"><img src="img/icon.png" alt="" width="28" height="28"><span>Seerah Quest <em>Guide</em></span></a>
  <span class="topright"><a class="pdf" href="seerah-quest-guide.pdf" download>PDF</a><a class="open" href="${APP_URL}">Open the app</a></span>
</header>
<div class="frame">
  <nav class="side" aria-label="Tutorials">
    <details class="navbox"${current ? '' : ' open'}><summary>All tutorials</summary>${nav(current)}</details>
  </nav>
  <main id="main">${body}</main>
</div>
<footer class="foot">Seerah Quest is free and never asks you for money. Counts are reported by members on the honour system; days follow Pakistan time.</footer>
</body>
</html>
`;

const pageBody = (p, i) => {
  const prev = pages[i - 1], next = pages[i + 1];
  return `<p class="crumb">${esc(p.part)} · Tutorial ${p.n} of ${pages.length}${p.time ? ` · ${esc(p.time)}` : ''}</p>
<h1>${esc(p.title)}</h1>
<p class="lede">${esc(p.summary)}</p>
${p.body}
<nav class="pager" aria-label="Next and previous">${prev ? `<a class="prev" href="${prev.slug}.html"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${next.slug}.html"><small>Next</small>${esc(next.title)}</a>` : `<a class="next" href="index.html"><small>Done</small>Back to the start</a>`}</nav>`;
};

pages.forEach((p, i) => fs.writeFileSync(path.join(root, `${p.slug}.html`), layout({ title: `${p.title} · Seerah Quest Guide`, description: p.summary, current: p.slug, body: pageBody(p, i) })));

// the home page: who it is for, where to begin, then every tutorial as a card
const intro = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const cards = PARTS.map(([part]) => `<h2>${esc(part)}</h2><ol class="cards">${pages.filter((p) => p.part === part)
  .map((p) => `<li><a href="${p.slug}.html"><span class="num">${p.n}</span><b>${esc(p.title)}</b><small>${esc(p.summary)}</small>${p.time ? `<em>${esc(p.time)}</em>` : ''}</a></li>`).join('')}</ol>`).join('');
fs.writeFileSync(path.join(root, 'index.html'), layout({ title: 'Seerah Quest Guide', description: 'Step-by-step tutorials for Seerah Quest, with pictures of every screen.', current: '', body: intro.replace('<!-- tutorials -->', cards) }));

// one long page for printing: a cover, the contents, then every tutorial on its own pages
const print = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Seerah Quest Guide</title><link rel="stylesheet" href="guide.css"></head>
<body class="print">
<section class="cover"><img src="img/icon.png" alt="" width="96" height="96"><h1>Seerah Quest</h1><p class="lede">A step-by-step guide for members</p>
<p>Durood, Sunnah and Seerah. Every durood recited is dedicated to facilitating the work of the Seerat Circles across Pakistan.</p>
<p class="small">Open the app: ${APP_URL}<br>Pictures show a made-up community. Your own screens will show your own names and numbers.</p></section>
<section class="toc"><h2>Contents</h2>${PARTS.map(([part]) => `<h3>${esc(part)}</h3><ol>${pages.filter((p) => p.part === part).map((p) => `<li value="${p.n}"><a href="#${p.slug}">${esc(p.title)}</a> <small>${esc(p.summary)}</small></li>`).join('')}</ol>`).join('')}</section>
${pages.map((p) => `<article class="chapter" id="${p.slug}"><p class="crumb">${esc(p.part)} · Tutorial ${p.n}</p><h1>${esc(p.title)}</h1><p class="lede">${esc(p.summary)}</p>${p.body.replace(/href="([a-z-]+)\.html(#[a-z-]+)?"/g, (_, s, h) => `href="${h || `#${s}`}"`)}</article>`).join('\n')}
</body></html>
`;
fs.writeFileSync(path.join(root, 'print.html'), print);
console.log(`built ${pages.length} tutorials, index.html and print.html in ${root}`);

if (process.argv.includes('--pdf')) {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(root, 'print.html'), { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.pdf({ path: path.join(root, 'seerah-quest-guide.pdf'), format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font:9px sans-serif;color:#888;width:100%;text-align:center">Seerah Quest Guide · <span class="pageNumber"></span></div>' });
  await browser.close();
  console.log('printed', path.join(root, 'seerah-quest-guide.pdf'));
}
