// Swiss promo kit: the engine behind 002 "The full tour". A video is one small page that loads kit/swiss/swiss.css and this
// file, then calls Promo.run({...}) with its storyboard and texts (see videos/002-the-full-tour/scene.html and
// kit/swiss/README.md). The page then has window.seek(t), window.DURATION, window.CUES, window.POSTER and window.ready,
// which is all tools/render.mjs needs.
//
// What the engine draws:
//   - a fixed 17.5 s opening: a green star fills the frame, word slams on full-bleed panels, the durood word by word,
//     the wordmark, then rows of screens slide past
//   - chapter panels (green and black in turn) wiped across, with a giant outlined number
//   - phone segments: a 3D phone shows captured screens (whole pages scroll under their header and tab bar), the camera
//     pans and zooms to each step, a spotlight with crop marks picks out the element and a callout explains it
//   - a cover flow deck, a laptop, sayings on full-bleed panels, a closing mosaic and the finale
//   - sound cues for tools/sfx.mjs
(() => {
const chapter = (n, title, ur, line, lineUr) => ({ type: 'chapter', d: 2.4, n, title, ur, line, lineUr });
const phone = (shot, d, cap, steps = [], more = {}) => ({ type: 'phone', shot, d, cap, steps, ...more });

// the page's fixed elements, filled with the video's own words
function scaffold(cfg) {
  const o = cfg.open, f = cfg.finale, off = cfg.offline;
  document.body.insertAdjacentHTML('afterbegin', `
<div class="stage" id="stage">
  <canvas id="grid" width="1080" height="1920"></canvas>
  <div class="abs" id="mosaic"></div>
  <div class="abs" id="deck"></div>
  <div class="abs" id="laptop"><div id="lid"><div class="bez"><img src="${cfg.assets}${cfg.laptop}.jpg" alt=""></div></div><div id="base"></div></div>

  <div class="abs" id="rig"><div id="phone"><div id="scr">
    <div class="slot" id="slotB"></div>
    <div class="slot" id="slotA"></div>
    <div id="spots"></div>
    <div id="ripple"></div>
    <div id="offline"><div class="chip">
      <svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="#0b0b0b" stroke-width="1.8" stroke-linecap="round"><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1.2" fill="#0b0b0b"/><path d="M3 3l18 18" stroke="#c4251c" stroke-width="2.2"/></svg>
      <b>${off.title}</b><span>${off.big}</span><small>${off.small}</small></div></div>
  </div></div></div>
  <div id="labels"></div>
  <canvas id="fx" width="1080" height="1920"></canvas>

  <div class="abs" id="scrim"></div>
  <div class="abs" id="bar"></div>
  <div class="abs" id="brand"><span>${cfg.brand.en}</span><span class="ur">${cfg.brand.ur}</span></div>
  <div id="caps"></div>
  <div id="panels"></div>

  <!-- opening: the durood, then the name -->
  <div class="abs ar" id="durood" data-words data-in="5.5" data-st="0.26" data-dur="0.7" data-out="10.2" lang="ar">${o.durood.ar}</div>
  <div class="abs" id="duroodRule"></div>
  <div class="abs fx" id="duroodEn" data-in="7.6" data-dur="0.7" data-out="10.2">${o.durood.en}</div>
  <div class="abs logo" id="logo1" style="top:560px">${o.logo.line1}</div>
  <div class="abs logo" id="logo2" style="top:790px">${o.logo.line2}</div>
  <div class="abs" id="logoUr">${o.logo.ur}</div>
  <div class="abs" id="logoTag"><span>${o.logo.tag}</span><span class="ur">${o.logo.tagUr}</span><b style="color:var(--arrow)">→</b></div>

  <!-- over the closing mosaic -->
  <div class="abs fx" data-wall="0.9" data-dur="0.5" style="left:80px;right:80px;top:1350px;padding:34px 40px 18px;background:var(--ink);color:#fff;box-shadow:18px 18px 0 var(--sig)"><div style="font-weight:900;font-size:88px;letter-spacing:-4px;line-height:1">${cfg.wall.en}</div><div class="ur" style="font-size:52px;line-height:2;color:var(--arrow);text-align:right">${cfg.wall.ur}</div></div>

  <!-- finale -->
  <img class="abs fx" id="icon" src="${f.icon}" alt="" data-fin="0.3" data-dur="0.7" data-out="999">
  <div class="abs fbig" data-words data-fin="0.6" data-st="0.12" data-out="999" style="top:560px">${f.name}</div>
  <div class="abs fx" data-fin="1.2" data-dur="0.7" data-out="999" style="left:80px;right:80px;top:740px;font-family:'Nastaliq',serif;font-weight:700;font-size:96px;color:var(--sigt);direction:rtl;text-align:right">${f.ur}</div>
  <div class="abs" data-words data-fin="2.0" data-st="0.06" data-out="999" style="left:80px;right:80px;top:1010px;font-weight:800;font-size:54px;line-height:1.12;letter-spacing:-1.5px">${f.line}</div>
  <div class="abs ur fx" data-fin="2.8" data-out="999" style="left:80px;right:80px;top:1160px;text-align:right;font-size:44px;color:var(--soft)">${f.lineUr}</div>
  <div class="abs fx" id="cta" data-fin="3.5" data-dur="0.6" data-out="999"><span>${f.cta}<span class="ur">${f.ctaUr}</span></span><b>→</b></div>
</div>`);
}

function run(cfg) {
  scaffold(cfg);
  const STORY = cfg.story, SLAMS = cfg.open.slams;
  // =====================================================================================================================
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const outCubic = (x) => 1 - Math.pow(1 - x, 3);
  const outQuint = (x) => 1 - Math.pow(1 - x, 5);
  const inOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const outBack = (x) => { const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const lerp = (a, b, p) => a + (b - a) * p;
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  let seed = 4242; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const vis = (e, o) => { e.style.opacity = o; e.style.visibility = o > 0.002 ? 'visible' : 'hidden'; };
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.append(e); return e; };
  const SRC = (n) => `${cfg.assets}${n}.jpg`;
  const K = 560 / 390, BZ = 18, VW = 390, VH = 844;                  // capture px -> screen px, bezel, viewport
  const HOME = { z: 1, fx: 195, fy: 422, ax: 540, ay: 1214, rx: 0, ry: 0, rz: 0 };
  let M = {};                                                          // the assets' manifest.json
  const STAR_SVG = (stroke) => `<svg class="bigstar" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" fill="none" stroke="${stroke}" stroke-width=".35"/><rect x="5" y="5" width="14" height="14" transform="rotate(45 12 12)" fill="none" stroke="${stroke}" stroke-width=".35"/></svg>`;

  // ---- timing: lay the storyboard end to end ----------------------------------------------------------------------------
  let tt = 0; STORY.forEach((s) => { s.t = tt; tt += s.d; });
  const DURATION = tt;
  const OPEN = STORY[0], FINAL = STORY.find((s) => s.type === 'final');
  const WALL = STORY.find((s) => s.type === 'wall') || { t: FINAL.t, d: 0 }; // the closing mosaic is optional
  $$('[data-fin]').forEach((e) => { e.dataset.in = FINAL.t + Number(e.dataset.fin); });
  $$('[data-wall]').forEach((e) => { e.dataset.in = WALL.t + Number(e.dataset.wall); e.dataset.out = FINAL.t - 0.1; });
  const chapters = STORY.filter((s) => s.type === 'chapter');
  const PHONES = STORY.filter((s) => s.type === 'phone');
  const RUNS = []; STORY.forEach((s, i) => { if (s.type !== 'phone') return; if (STORY[i - 1]?.type === 'phone') RUNS[RUNS.length - 1][1] = s.t + s.d; else RUNS.push([s.t, s.t + s.d]); });
  let lastCap = null; STORY.forEach((s) => { if (['phone', 'laptop', 'deck'].includes(s.type)) { if (s.cap === undefined) s.cap = lastCap; else lastCap = s.cap; } else lastCap = null; });

  // ---- the measured geometry of a shot ----------------------------------------------------------------------------------
  const geo = (shot) => M[shot] || {};
  const isFull = (shot) => !!geo(shot).full;
  const maxScroll = (shot) => Math.max(0, (geo(shot).h || VH) - VH);
  function rectOf(shot, step) {
    if (step.rect) return step.rect;
    const r = geo(shot).r?.[step.key]; if (!r) { console.warn('no rect', shot, step.key); return [0, 0, VW, VH]; }
    return r;
  }
  function scrollFor(shot, step, r) { // the element in the middle of the visible part (under the header, over the tab bar)
    if (!isFull(shot)) return geo(shot).sy || 0;
    if (step.scroll != null) return clamp(step.scroll, 0, maxScroll(shot));
    const g = geo(shot), mid = ((g.hd || 0) + (g.tab || VH)) / 2;
    return Math.round(clamp(r[1] + Math.min(r[3], 600) / 2 - mid, 0, maxScroll(shot)));
  }

  // ---- keyframes: camera, scroll and spotlights are built once the measurements are in; captions and cues now --------------
  const CAM = [], SPOTS = [], CUES = [];
  const key = (list, t, v, d = 0.9) => list.push({ t, v, d });
  function buildKeys() {
    let prevSeg = null;
    PHONES.forEach((s) => {
      // a cut to the same page carries on from where it was scrolled; a cut with no steps keeps the camera
      const same = prevSeg && prevSeg.shot === s.shot && s.tr === 'cut' && Math.abs(prevSeg.t + prevSeg.d - s.t) < 0.01;
      s.scroll0 = same ? prevSeg.scrollEnd : 0; s.scrollKeys = []; let lastScroll = s.scroll0;
      if ((s.steps?.length || s.tr !== 'cut') && !same) key(CAM, s.t, { ...HOME }, s.tr === 'cut' ? 0.01 : 0.6);
      prevSeg = s;
      (s.steps || []).forEach((st, i, steps) => {
        const r = rectOf(s.shot, st), sc = scrollFor(s.shot, st, r);
        const t0 = s.t + st.at, next = steps[i + 1] ? s.t + steps[i + 1].at : s.t + s.d - 0.15;
        if (isFull(s.shot) && sc !== lastScroll) { key(s.scrollKeys, t0, sc, st.d ?? 0.9); lastScroll = sc; }
        const vy = r[1] - (isFull(s.shot) ? sc : geo(s.shot).sy || 0);
        const z = st.z ?? clamp(Math.min(860 / (r[2] * K), 820 / (r[3] * K)), 1, 2.6);
        const cam = z <= 1.02 ? { ...HOME } : { z, fx: r[0] + r[2] / 2, fy: vy + r[3] / 2, ax: 540, ay: 1150, rx: 0, ry: 0, rz: 0 };
        key(CAM, t0, cam, st.d ?? 0.9);
        if (!st.noSpot) SPOTS.push({ seg: s, t0: t0 + 0.55, t1: next - 0.1, r, en: st.en, ur: st.ur });
      });
      s.scrollEnd = lastScroll;
    });
    CAM.sort((a, b) => a.t - b.t);
  }
  PHONES.forEach((s) => {
    (s.steps || []).forEach((st) => { if (!st.noSpot) CUES.push({ t: s.t + st.at + 0.55, k: 'tick' }); });
    if (s.tr !== 'cut') CUES.push({ t: s.t, k: 'whoosh' });
    if (s.hit) CUES.push({ t: s.t + 0.05, k: 'bloom' });
    if (s.seq?.taps) for (let i = 0; i < 16; i++) CUES.push({ t: s.t + s.seq.start + i * s.seq.every, k: 'tap' });
    if (s.shot.startsWith('type-')) CUES.push({ t: s.t, k: 'tap' });
  });
  STORY.filter((s) => s.type === 'deck' || s.type === 'laptop').forEach((s) => CUES.push({ t: s.t, k: 'whoosh' }));
  chapters.forEach((c) => CUES.push({ t: c.t, k: 'whoosh' }, { t: c.t + 0.3, k: 'thump' }));
  STORY.filter((s) => s.type === 'say').forEach((s) => CUES.push({ t: s.t, k: 'thump' }));
  SLAMS.forEach(([t]) => CUES.push({ t, k: 'thump' }));
  CUES.push({ t: 0, k: 'swell' }, { t: 5.5, k: 'whoosh' }, { t: 10.2, k: 'whoosh' }, { t: 14.0, k: 'rise' }, { t: WALL.t, k: 'whoosh' }, { t: FINAL.t, k: 'whoosh' }, { t: FINAL.t + 0.6, k: 'bloom' }, { t: FINAL.t + 3.5, k: 'tick' });
  CUES.sort((a, b) => a.t - b.t);

  // value of a keyframed track at time t: each key eases from wherever the track was when it started
  function track(list, t, base) {
    let from = base, to = base, t0 = -1e9, d = 1;
    const at = (x) => (typeof base === 'object' ? Object.fromEntries(Object.keys(to).map((k) => [k, lerp(from[k] ?? to[k], to[k], inOut(prog(x, t0, t0 + d)))])) : lerp(from, to, inOut(prog(x, t0, t0 + d))));
    for (const k of list) { if (k.t > t) break; from = at(k.t); to = typeof base === 'object' ? { ...to, ...k.v } : k.v; t0 = k.t; d = k.d; }
    return at(t);
  }

  // ---- DOM for captions, chapter panels, slams and sayings, the progress bar --------------------------------------------------
  const capList = [];
  STORY.forEach((s) => { if (!s.cap) return; const p = capList[capList.length - 1]; if (p && p.cap === s.cap && Math.abs(p.t1 - s.t) < 0.01) p.t1 = s.t + s.d; else capList.push({ t0: s.t, t1: s.t + s.d, cap: s.cap }); });
  capList.forEach((c) => {
    const [k, h, u] = c.cap, box = el('div', 'abs cap', null, $('#caps'));
    el('div', 'kick fx', `<span class="star"><i></i><i></i></span>${k}`, box).dataset.in = c.t0 + 0.15;
    const hd = el('div', 'head', h, box); hd.dataset.words = ''; hd.dataset.in = c.t0 + 0.25; hd.dataset.st = 0.06;
    el('div', 'sub ur fx', u, box).dataset.in = c.t0 + 0.6;
    box.querySelectorAll('[data-in]').forEach((e) => { e.dataset.out = c.t1; });
  });
  const panels = $('#panels');
  chapters.forEach((c, i) => {
    const dark = i % 2 === 1, box = el('div', `abs chap ${dark ? 'k' : 'g'}`, STAR_SVG(dark ? '#2ee59d' : '#0b0b0b'), panels); c.el = box;
    el('div', 'num', c.n, box);
    const st = el('div', 'stack', null, box);
    el('div', 'ttl', c.title.replace(/\S+/g, (w) => `<span class="w">${w}</span>`), st);
    el('div', 'rule', '', st); el('div', 'tur', c.ur, st); el('div', 'line', c.line, st); el('div', 'lur', c.lineUr, st);
    c.words = [...box.querySelectorAll('.ttl .w')];
  });
  SLAMS.forEach((s) => { s.el = el('div', `abs slam ${s[1]}`, `<div class="big">${s[2]}</div><div class="su">${s[3]}</div>`, panels); });
  STORY.filter((s) => s.type === 'say').forEach((s) => { s.el = el('div', `abs slam ${s.c}`, `<div class="mid">${s.en}</div><div class="su">${s.ur}</div>`, panels); });
  chapters.forEach(() => el('i', null, '<b></b>', $('#bar')));

  // words rise out of a blur, one after another; elements leave by lifting into a blur
  $$('[data-words]').forEach((e) => {
    const walk = (node) => [...node.childNodes].forEach((c) => {
      if (c.nodeType === 3) { const f = document.createDocumentFragment(); c.textContent.split(/(\s+)/).forEach((p) => { if (!p) return; if (/^\s+$/.test(p)) f.append(p); else el('span', 'w', null, f).textContent = p; }); c.replaceWith(f); }
      else if (!c.classList?.contains('w')) walk(c);
    });
    walk(e);
  });
  const ANIM = $$('[data-in]').map((e) => ({ e, a: +e.dataset.in, out: +e.dataset.out, st: +(e.dataset.st || 0), dur: +(e.dataset.dur || 0.6), words: e.hasAttribute('data-words') ? [...e.querySelectorAll('.w')] : null }));
  function animText(t) {
    for (const { e, a, out, st, dur, words } of ANIM) {
      const o = inOut(prog(t, out - 0.35, out)), on = t >= a - 0.01 && t < out;
      vis(e, on ? 1 - o : 0);
      if (!on) { e.style.transform = ''; continue; }
      if (words) {
        // Swiss: words slide up out of a hard edge, no blur
        words.forEach((w, i) => { const p = outQuint(prog(t, a + i * st, a + i * st + dur)); w.style.opacity = p > 0 ? 1 : 0; w.style.clipPath = `inset(0 0 ${(1 - p) * 100}% 0)`; w.style.transform = `translateY(${(1 - p) * 0.6}em)`; });
        e.style.transform = `translateX(${-o * 60}px)`;
      } else {
        const p = outQuint(prog(t, a, a + dur));
        e.style.opacity = p * (1 - o); e.style.transform = `translateX(${(1 - p) * -40 - o * 60}px)`;
      }
    }
  }

  // ---- the grid: hairlines on paper, with green squares stepping along it ----------------------------------------------------
  const g = $('#grid').getContext('2d'), fx = $('#fx').getContext('2d');
  const GX = Array.from({ length: 13 }, (_, i) => 60 + i * 80), GY = Array.from({ length: 24 }, (_, i) => 40 + i * 80);
  const DOTS = Array.from({ length: 70 }, () => ({ x: GX[Math.floor(rnd() * 13)], y: GY[Math.floor(rnd() * 24)], s: rnd() * DURATION, d: 1.2 + rnd() * 2 }));
  function star(ctx, x, y, r, rot, fill) {
    ctx.save(); ctx.translate(x, y); for (const a of [0, Math.PI / 4]) { ctx.save(); ctx.rotate(rot + a); if (fill) ctx.fillRect(-r, -r, 2 * r, 2 * r); else ctx.strokeRect(-r, -r, 2 * r, 2 * r); ctx.restore(); } ctx.restore();
  }
  function drawGrid(t) {
    g.clearRect(0, 0, 1080, 1920); fx.clearRect(0, 0, 1080, 1920);
    const draw = outCubic(prog(t, 0.1, 1.2));
    g.globalAlpha = 1; g.strokeStyle = '#ecece6'; g.lineWidth = 1.5;
    for (const x of GX) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1920 * draw); g.stroke(); }
    for (const y of GY) { g.beginPath(); g.moveTo(0, y); g.lineTo(1080 * draw, y); g.stroke(); }
    g.fillStyle = '#00a86b';
    for (const d of DOTS) { const p = prog(t, d.s, d.s + d.d); if (p <= 0 || p >= 1) continue; g.globalAlpha = Math.sin(p * Math.PI) * 0.8; g.fillRect(d.x - 7, d.y - 7, 14, 14); }
    // a large outline star turns slowly behind the phone while it is on screen
    const onPhone = RUNS.some(([a, b]) => t >= a - 0.5 && t < b + 0.5);
    if (onPhone) { g.globalAlpha = 0.07; g.strokeStyle = '#0b0b0b'; g.lineWidth = 3; star(g, 540, 1230, 430, t * 0.12, false); }
    g.globalAlpha = 1;
  }
  // green squares fly out from a point (chapter titles, the streak chip)
  function burst(cx, cy, lt, n = 16, spread = 700, size = 16) {
    if (lt < 0 || lt > 1) return;
    fx.fillStyle = '#00a86b';
    for (let k = 0; k < n; k++) { const a = (k / n) * 6.283 + k, r = outCubic(lt) * spread * (0.6 + (k % 3) * 0.2); fx.globalAlpha = 1 - lt; star(fx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, size * (1 - lt * 0.5), lt * 3 + k, true); }
    fx.globalAlpha = 1;
  }

  // ---- the phone ------------------------------------------------------------------------------------------------------------
  function makeSlot(slot) {
    slot.innerHTML = `<img class="page"><div class="crop hd"><img></div><div class="crop tb"><img></div><img class="view"><img class="alt">`;
    return { slot, page: slot.querySelector('.page'), hd: slot.querySelector('.hd'), hdImg: slot.querySelector('.hd img'), tb: slot.querySelector('.tb'), tbImg: slot.querySelector('.tb img'), view: slot.querySelector('.view'), alt: slot.querySelector('.alt') };
  }
  const SLOTS = [makeSlot($('#slotA')), makeSlot($('#slotB'))];
  const setSrc = (img, src) => { if (img.getAttribute('src') !== src) img.setAttribute('src', src); };
  function paint(S, seg, t) {
    const shot = seg.shot, gm = geo(shot), lt = t - seg.t;
    let viewSrc = null;
    if (seg.seq?.fps) viewSrc = SRC(`${shot}-${String(Math.min(seg.seq.max ?? gm.frames - 1, Math.floor(lt * seg.seq.fps))).padStart(2, '0')}`);
    else if (seg.seq?.frame != null) viewSrc = SRC(`${shot}-${String(seg.seq.frame).padStart(2, '0')}`);
    else if (seg.seq?.taps) viewSrc = SRC(`tap-${String(clamp(Math.floor((lt - seg.seq.start) / seg.seq.every) + 1, 0, 16)).padStart(2, '0')}`);
    else if (seg.seq?.hold != null) viewSrc = SRC(`tap-${String(seg.seq.hold).padStart(2, '0')}`);
    if (isFull(shot) && !viewSrc) {
      const sc = track(seg.scrollKeys, t, seg.scroll0 || 0);
      setSrc(S.page, SRC(`${shot}-full`)); setSrc(S.hdImg, SRC(shot)); setSrc(S.tbImg, SRC(shot));
      S.page.style.display = S.hd.style.display = S.tb.style.display = ''; S.view.style.display = 'none';
      S.page.style.transform = `translateY(${-sc * K}px)`;
      S.hd.style.top = '0px'; S.hd.style.height = `${(gm.hd || 0) * K}px`;
      S.tb.style.top = `${gm.tab * K}px`; S.tb.style.height = `${(VH - gm.tab) * K}px`; S.tbImg.style.top = `${-gm.tab * K}px`;
      seg.scrollNow = sc;
    } else {
      setSrc(S.view, viewSrc || SRC(shot));
      S.page.style.display = S.hd.style.display = S.tb.style.display = 'none'; S.view.style.display = '';
      seg.scrollNow = gm.sy || 0;
    }
    if (seg.wipe) { // light / dark: a hard diagonal edge sweeps across and back
      setSrc(S.alt, SRC(seg.wipe)); S.alt.style.display = '';
      const p = inOut(prog(lt, 0.8, 2.2)) * (1 - inOut(prog(lt, 3.4, 4.6))), x = lerp(-60, 160, p);
      S.alt.style.clipPath = `polygon(0 0, ${x}% 0, ${x - 40}% 100%, 0 100%)`;
    } else if (seg.flip) { setSrc(S.alt, SRC(seg.flip)); S.alt.style.display = lt > 1.15 ? '' : 'none'; S.alt.style.clipPath = 'none'; }
    else S.alt.style.display = 'none';
  }
  const PHONE = $('#phone');
  function segAt(t) { let s = null; for (const p of PHONES) if (p.t <= t) s = p; else break; return s && t < s.t + s.d ? s : null; }
  function drawPhone(t) {
    const run = RUNS.find(([a, b]) => t >= a && t < b);
    vis(PHONE, run ? 1 : 0); $('#labels').innerHTML = ''; $('#spots').innerHTML = '';
    if (!run) return;
    const seg = segAt(t), idx = PHONES.indexOf(seg), prev = PHONES[idx - 1];
    const trDur = seg.tr === 'cut' || !prev || prev.t + prev.d < seg.t - 0.01 ? 0 : seg.tr === 'push' ? 0.5 : 0.4;
    const p = trDur ? inOut(prog(t, seg.t, seg.t + trDur)) : 1;
    paint(SLOTS[0], seg, t);
    const [A, Bs] = [SLOTS[0].slot, SLOTS[1].slot];
    if (p < 1) {
      paint(SLOTS[1], prev, t); vis(Bs, 1);
      if (seg.tr === 'push') { A.style.transform = `translateX(${(1 - p) * 100}%)`; A.style.opacity = 1; Bs.style.transform = `translateX(${-p * 30}%)`; }
      else if (seg.tr === 'sheet') { A.style.transform = `translateY(${(1 - p) * 120}px)`; A.style.opacity = p; Bs.style.transform = ''; }
      else { A.style.transform = ''; A.style.opacity = p; Bs.style.transform = ''; }
    } else { vis(Bs, 0); A.style.transform = ''; A.style.opacity = 1; }
    // camera; the phone swings in from the side at the start of a run and leaves the other way
    const c = track(CAM, t, HOME);
    const enter = outQuint(prog(t, run[0], run[0] + 0.9)), exit = inOut(prog(t, run[1] - 0.6, run[1]));
    let ry = c.ry + Math.sin(t * 0.6) * 1.0 + (1 - enter) * 50 - exit * 50;
    if (seg.flip) ry += 180 * inOut(prog(t - seg.t, 0.4, 1.9));
    const ox = BZ + c.fx * K, oy = BZ + c.fy * K;
    PHONE.style.transformOrigin = `${ox}px ${oy}px`;
    PHONE.style.transform = `translate(${c.ax - ox + (1 - enter) * 1300 - exit * 1400}px, ${c.ay - oy}px) rotateX(${c.rx}deg) rotateY(${ry}deg) rotateZ(${c.rz}deg) scale(${c.z})`;
    $('#scr').style.transform = seg.flip && (t - seg.t) > 1.15 ? 'scaleX(-1)' : '';
    drawSpots(t, seg, c);
    drawTaps(t, seg);
    const off = seg.offline ? outQuint(prog(t, seg.t + 0.3, seg.t + 0.8)) * (1 - prog(t, seg.t + seg.d - 0.4, seg.t + seg.d)) : 0;
    vis($('#offline'), off); $('#offline .chip').style.transform = `translateY(${(1 - outQuint(prog(t, seg.t + 0.3, seg.t + 0.9))) * 80}px)`;
    if (seg.flame) burst(540, 1150, (t - seg.t - 0.8) / 1.2, 18, 520, 18);
  }
  // a spotlight is drawn in the screen (it moves with the phone), with crop marks; its callout sits beside it on the stage
  function drawSpots(t, seg, c) {
    const box = $('#spots');
    for (const s of SPOTS) {
      if (s.seg !== seg || t < s.t0 - 0.01 || t > s.t1) continue;
      const a = outQuint(prog(t, s.t0, s.t0 + 0.35)) * (1 - prog(t, s.t1 - 0.25, s.t1));
      const vy = s.r[1] - seg.scrollNow, pad = 8;
      const x = (s.r[0] - pad) * K, y = (vy - pad) * K, w = (s.r[2] + pad * 2) * K, h = (s.r[3] + pad * 2) * K;
      const grow = 1 - outQuint(prog(t, s.t0, s.t0 + 0.4));
      const sp = el('div', 'spot', null, box);
      Object.assign(sp.style, { left: `${x - grow * 20}px`, top: `${y - grow * 20}px`, width: `${w + grow * 40}px`, height: `${h + grow * 40}px`, opacity: a });
      const m = 16 + grow * 30; // crop marks just outside the corners
      [[x - m, y - m, '4px 0 0 4px'], [x + w + m - 30, y - m, '4px 4px 0 0'], [x - m, y + h + m - 30, '0 0 4px 4px'], [x + w + m - 30, y + h + m - 30, '0 4px 4px 0']].forEach(([cx, cy, bw]) => {
        const cm = el('div', 'cm', null, box); Object.assign(cm.style, { left: `${cx}px`, top: `${cy}px`, borderWidth: bw, opacity: a });
      });
      if (!s.en) continue;
      const sx1 = c.ax + c.z * K * (s.r[0] - pad - c.fx), sx2 = c.ax + c.z * K * (s.r[0] + s.r[2] + pad - c.fx);
      const sy1 = c.ay + c.z * K * (vy - pad - c.fy), sy2 = c.ay + c.z * K * (vy + s.r[3] + pad - c.fy);
      const lb = el('div', 'label', `<i></i><b>${s.en}</b>${s.ur ? `<span class="ur">${s.ur}</span>` : ''}`, $('#labels'));
      const below = sy2 + 260 < 1760 || sy1 < 820;
      lb.classList.add(below ? 'below' : 'above');
      const lw = Math.min(760, lb.offsetWidth), lh = lb.offsetHeight;
      const cx = clamp((sx1 + sx2) / 2 - lw / 2, 60, 1000 - lw);
      const ly = below ? Math.min(sy2 + 44, 1780 - lh) : Math.max(sy1 - 44 - lh, 600);
      const la = outQuint(prog(t, s.t0 + 0.15, s.t0 + 0.5)) * (1 - prog(t, s.t1 - 0.25, s.t1));
      Object.assign(lb.style, { left: `${cx}px`, top: `${ly}px`, opacity: la > 0 ? 1 : 0, clipPath: `inset(0 ${(1 - la) * 100}% 0 0)` });
      lb.querySelector('i').style.left = `${clamp((sx1 + sx2) / 2 - cx, 30, lw - 30)}px`;
    }
  }
  function drawTaps(t, seg) {
    const rip = $('#ripple');
    if (!seg.seq?.taps) { vis(rip, 0); return; }
    const lt = t - seg.t - seg.seq.start, k = Math.floor(lt / seg.seq.every), since = lt - k * seg.seq.every;
    const on = lt >= 0 && k < 16, rp = prog(since, 0, 0.3), at = geo('tap').at;
    vis(rip, on ? 0.85 * (1 - rp) : 0);
    rip.style.left = `${at.x * K}px`; rip.style.top = `${at.y * K}px`; rip.style.transform = `scale(${0.3 + rp * 1.6})`;
  }

  // ---- full-bleed panels: chapters (wiped in from the left, out to the right), slams and sayings (wiped up) -------------------
  function drawPanels(t) {
    chapters.forEach((c) => {
      const lt = t - c.t, on = lt >= 0 && lt < c.d;
      vis(c.el, on ? 1 : 0); if (!on) return;
      const wi = outQuint(prog(lt, 0, 0.45)), wo = inOut(prog(lt, c.d - 0.4, c.d));
      c.el.style.clipPath = `inset(0 ${(1 - wi) * 100}% 0 ${wo * 100}%)`;
      const num = c.el.querySelector('.num'); num.style.transform = `translateX(${(1 - outQuint(prog(lt, 0.1, 0.9))) * -200}px)`;
      c.el.querySelector('.bigstar').style.transform = `rotate(${lt * 25}deg) scale(${0.8 + 0.2 * outQuint(prog(lt, 0, 1))})`;
      c.words.forEach((w, j) => { const p = outQuint(prog(lt, 0.25 + j * 0.1, 0.8 + j * 0.1)); w.style.clipPath = `inset(0 0 ${(1 - p) * 100}% 0)`; w.style.transform = `translateY(${(1 - p) * 0.7}em)`; });
      c.el.querySelector('.rule').style.transform = `scaleX(${outQuint(prog(lt, 0.5, 1.0))})`;
      for (const [sel, a] of [['.tur', 0.6], ['.line', 0.8], ['.lur', 0.95]]) { const e = c.el.querySelector(sel), p = outQuint(prog(lt, a, a + 0.45)); e.style.opacity = p; e.style.transform = `translateX(${(1 - p) * -50}px)`; }
    });
    SLAMS.forEach(([t0], i) => {
      const e = SLAMS[i].el, end = SLAMS[i + 1]?.[0] ?? 5.5, lt = t - t0, on = lt >= 0 && t < end + 0.25;
      vis(e, on ? 1 : 0); if (!on) return;
      e.style.clipPath = `inset(${(1 - outQuint(prog(lt, 0, 0.22))) * 100}% 0 0 0)`;
      const big = e.querySelector('.big'), p = outQuint(prog(lt, 0.05, 0.5));
      big.style.transform = `scale(${1.5 - 0.5 * p}) translateX(${(1 - p) * 40}px)`; big.style.transformOrigin = '0 50%';
      e.querySelector('.su').style.opacity = prog(lt, 0.3, 0.55);
    });
    STORY.filter((s) => s.type === 'say').forEach((s) => {
      const lt = t - s.t, on = lt >= 0 && lt < s.d + 0.2;
      vis(s.el, on ? 1 : 0); if (!on) return;
      s.el.style.clipPath = `inset(${(1 - outQuint(prog(lt, 0, 0.3))) * 100}% 0 0 0)`;
      const mid = s.el.querySelector('.mid'), p = outQuint(prog(lt, 0.1, 0.6));
      mid.style.transform = `translateY(${(1 - p) * 80}px)`; mid.style.opacity = p;
      s.el.querySelector('.su').style.opacity = prog(lt, 0.5, 0.9);
    });
    // progress bar: one cell per chapter
    const cells = $$('#bar b');
    chapters.forEach((c, i) => { cells[i].style.transform = `scaleX(${prog(t, c.t, chapters[i + 1]?.t ?? WALL.t)})`; });
    const mid = prog(t, OPEN.d - 0.3, OPEN.d) * (1 - prog(t, WALL.t - 0.3, WALL.t));
    vis($('#bar'), mid); vis($('#brand'), mid);
    const anyPhone = RUNS.some(([a, b]) => t >= a && t < b) || STORY.some((s) => (s.type === 'deck' || s.type === 'laptop') && t >= s.t && t < s.t + s.d);
    vis($('#scrim'), anyPhone ? 1 : 0);
    chapters.forEach((c) => burst(200, 1000, (t - c.t - 0.35) / 0.9, 14, 900, 14));
  }

  // ---- cover flow of the five leaderboards; flat mosaics of every screen --------------------------------------------------
  const DECKS = STORY.filter((s) => s.type === 'deck');
  DECKS.forEach((d) => { d.els = d.cards.map((c, i) => { const card = el('div', 'card', `<img src="${SRC(c)}">`, $('#deck')); el('div', 'tag', `${d.tags[i][0]}<span>${d.tags[i][1]}</span>`, card); return card; }); });
  function drawDecks(t) {
    for (const d of DECKS) {
      const lt = t - d.t, on = lt >= 0 && lt < d.d, n = d.els.length, dwell = (d.d - 2.0) / (n - 1);
      let f = 0; for (let i = 0; i < n - 1; i++) f += inOut(prog(lt, 1.0 + i * dwell, 1.0 + i * dwell + 0.5));
      d.els.forEach((card, i) => {
        vis(card, on ? 1 : 0); if (!on) return;
        const o = i - f, ao = Math.abs(o), inP = outQuint(prog(lt, 0.05 + i * 0.07, 0.75 + i * 0.07)), outP = inOut(prog(lt, d.d - 0.5, d.d));
        card.style.transform = `translate3d(${540 - 260 + o * 340 + (1 - inP) * 1400 - outP * 1600}px, 640px, ${-ao * 420}px) rotateY(${clamp(-o * 40, -60, 60)}deg)`;
        card.style.opacity = clamp(1.3 - ao * 0.35);
        card.style.zIndex = 100 - Math.round(ao * 10);
        card.querySelector('.tag').style.opacity = clamp(1 - ao * 1.5);
      });
    }
  }
  const MOS = cfg.mosaic;
  const tiles = MOS.map((s) => el('div', 'tile', `<img src="${SRC(s)}">`, $('#mosaic')));
  // rows of screens slide past in alternating directions; used at the end of the opening and before the finale
  function drawMosaic(t) {
    const shows = [{ a: 14.2, b: OPEN.d + 0.1, rows: 2, w: 360, top: 330 }, { a: WALL.t, b: FINAL.t + 0.4, rows: 3, w: 280, top: 230 }];
    const show = shows.find((s) => t >= s.a && t < s.b);
    tiles.forEach((e) => vis(e, 0));
    if (!show) return;
    const lt = t - show.a, h = Math.round(show.w * 844 / 390), per = Math.ceil(tiles.length / show.rows), gap = 46;
    tiles.forEach((e, i) => {
      const row = i % show.rows, col = Math.floor(i / show.rows), dir = row % 2 ? 1 : -1;
      const inP = outQuint(prog(lt, row * 0.12, 0.9 + row * 0.12)), outP = inOut(prog(t, show.b - 0.55, show.b));
      const x = 80 + col * (show.w + gap) - (per * (show.w + gap)) / 2 + 300 + dir * lt * 60 + (1 - inP) * dir * -1400;
      const y = show.top + row * (h + gap) - outP * 1900;
      Object.assign(e.style, { width: `${show.w}px`, height: `${h}px`, transform: `translate(${x}px, ${y}px)` });
      vis(e, 1);
    });
  }

  // ---- the laptop ------------------------------------------------------------------------------------------------------------
  const LAP = STORY.find((s) => s.type === 'laptop');
  function drawLaptop(t) {
    const lt = LAP ? t - LAP.t : -1, on = lt >= 0 && lt < LAP.d; // the laptop is optional
    vis($('#laptop'), on ? 1 : 0); if (!on) return;
    const inP = outQuint(prog(lt, 0, 0.8)), open = outBack(prog(lt, 0.5, 1.8)), outP = inOut(prog(lt, LAP.d - 0.5, LAP.d));
    $('#lid').style.transform = `rotateX(${lerp(-88, -6, open)}deg)`;
    $('#laptop').style.transform = `translateX(${(1 - inP) * 1200 - outP * 1300}px) rotateY(${Math.sin(lt * 0.6) * 4}deg)`;
  }

  // ---- the opening -------------------------------------------------------------------------------------------------------------
  function drawOpening(t) {
    // a green star turns in, grows and fills the frame into the first slam
    if (t < 1.4) { const p = outCubic(prog(t, 0.2, 1.15)); fx.fillStyle = '#00a86b'; fx.globalAlpha = 1; star(fx, 540, 960, 40 + Math.pow(p, 3) * 1500, p * 2.4, true); }
    // the durood, word by word, with a green rule
    $('#duroodRule').style.transform = `scaleX(${outQuint(prog(t, 7.2, 7.9)) * (1 - inOut(prog(t, 9.8, 10.2)))})`;
    vis($('#duroodRule'), t > 5.5 && t < 10.2 ? 1 : 0);
    // the name: two words slide in on the grid, the Urdu and the tag follow; all leave upwards as the mosaic arrives
    const on = t >= 10.2 && t < 15.2, out = inOut(prog(t, 14.2, 15.0));
    [['#logo1', 10.3, -1], ['#logo2', 10.5, 1]].forEach(([s, a, d]) => { const e = $(s), p = outQuint(prog(t, a, a + 0.6)); vis(e, on ? 1 : 0); e.style.transform = `translate(${(1 - p) * d * 900}px, ${-out * 1500}px)`; });
    const u = $('#logoUr'), pu = outQuint(prog(t, 11.0, 11.6)); vis(u, on ? pu : 0); u.style.transform = `translate(${(1 - pu) * 120}px, ${-out * 1500}px)`;
    const tg = $('#logoTag'), pt = outQuint(prog(t, 11.6, 12.1)); vis(tg, on ? 1 : 0); tg.style.clipPath = `inset(0 ${(1 - pt) * 100}% 0 0)`; tg.style.transform = `translateY(${-out * 1500}px)`;
    if (on) { fx.fillStyle = '#00a86b'; fx.globalAlpha = 1 - out; star(fx, 880, 430, 70, t * 0.8, true); }
    burst(540, 960, (t - 1.15) / 0.8, 20, 900, 18);
    // the finale: a large green star turns in the empty corner
    if (t > FINAL.t) { const p = outQuint(prog(t, FINAL.t + 0.8, FINAL.t + 2.2)); fx.globalAlpha = 1; fx.fillStyle = '#00a86b'; star(fx, 880, 1810, 260 * p, t * 0.25, true); fx.fillStyle = '#ffffff'; star(fx, 880, 1810, 104 * p, -t * 0.4, true); }
  }

  // ---- one frame -------------------------------------------------------------------------------------------------------------
  function seek(t) {
    drawGrid(t);
    animText(t);
    drawMosaic(t);
    drawDecks(t);
    drawLaptop(t);
    drawPhone(t);
    drawPanels(t);
    drawOpening(t);
  }

  window.DURATION = DURATION; window.CUES = CUES; window.POSTER = FINAL.t + 5; window.seek = seek; window.STORY = STORY;
  window.ready = (async () => {
    M = await fetch(`${cfg.assets}manifest.json`).then((r) => r.json());
    buildKeys();
    const all = Object.keys(M).flatMap((n) => [M[n].view ? SRC(n) : null, M[n].full ? SRC(`${n}-full`) : null, ...(M[n].frames ? Array.from({ length: M[n].frames }, (_, i) => SRC(`${n}-${String(i).padStart(2, '0')}`)) : [])]).filter(Boolean);
    for (let i = 0; i <= 16; i++) all.push(SRC(`tap-${String(i).padStart(2, '0')}`));
    const imgs = [...new Set([...$$('img')].map((i) => i.getAttribute('src')).filter(Boolean))];
    await Promise.all([document.fonts.ready, ...[...imgs, ...all].map((src) => { const im = new Image(); im.src = src; return im.decode().catch(() => {}); })]);
  })();
  if (!navigator.webdriver) {
    let t0 = performance.now(), skip = 0;
    document.addEventListener('click', () => { t0 = performance.now(); skip = 0; });
    document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') skip += 10; if (e.key === 'ArrowLeft') skip -= 10; });
    const frame = () => { seek(((performance.now() - t0) / 1000 + skip) % DURATION); requestAnimationFrame(frame); };
    window.ready.then(() => requestAnimationFrame(frame));
  } else window.ready.then(() => seek(0));
}

window.Promo = { chapter, phone, run };
})();
