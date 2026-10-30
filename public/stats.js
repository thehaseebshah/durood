// The public stats page: totals, a 14-day chart and rankings of members (made-up names) and cities. It only reads /api/stats.
const $ = (id) => document.getElementById(id);
const slug = (location.pathname.match(/^\/c\/([a-z0-9-]+)/) || [])[1] || '';
const fmt = (n) => Number(n).toLocaleString('en-US');
const TEXT = {
  en: { title: 'Tasbeeh stats', sub: 'All of us, together. Members appear under made-up names.', overall: 'Counted so far', of: 'of', today: 'Today', week: 'This week', alltime: 'All time',
    counting: 'people counting', members: 'Members', cities_word: 'cities', avg: 'Average per member', avg_note: 'all time', last14: 'Last 14 days', people: 'Top members',
    alias_note: 'Names are made up and cannot be traced back to anyone.', citiesh: 'City rankings', updated: 'Rankings refresh about every 15 minutes.', back: 'Back to counting',
    pct: (p) => `${p}% of the target`, mem: (n) => `${fmt(n)} ${n === 1 ? 'member' : 'members'}`, empty: 'Nothing yet. Be the first!', other: 'Other (outside Pakistan)',
    to_light: 'Switch to light mode', to_dark: 'Switch to dark mode', switch: 'اردو', err: 'Could not load the stats. Please try again soon.', gone: 'This link does not belong to a group.', road_h: 'The road to the target', road_note: 'The nearer the dome, the nearer the caravan is to its own target. Distances are not to scale.', dest: 'Target', roadlabel: 'Caravans on the road to their targets', everyone: 'Everyone', caravans_h: 'Caravan leaderboard', you: 'your caravan' },
  ur: { title: 'تسبیح کے اعداد و شمار', sub: 'ہم سب مل کر۔ اراکین فرضی ناموں سے دکھائے جاتے ہیں۔', overall: 'اب تک کی گنتی', of: 'میں سے', today: 'آج', week: 'اس ہفتے', alltime: 'کل ملا کر',
    counting: 'افراد شمار کر رہے ہیں', members: 'اراکین', cities_word: 'شہر', avg: 'فی رکن اوسط', avg_note: 'کل ملا کر', last14: 'پچھلے 14 دن', people: 'سرفہرست اراکین',
    alias_note: 'نام فرضی ہیں اور کسی تک نہیں پہنچتے۔', citiesh: 'شہروں کی درجہ بندی', updated: 'درجہ بندی تقریباً ہر 15 منٹ بعد تازہ ہوتی ہے۔', back: 'شمار پر واپس',
    pct: (p) => `ہدف کا ${p}٪ مکمل`, mem: (n) => `${fmt(n)} اراکین`, empty: 'ابھی کچھ نہیں۔ پہلے آپ بنیں!', other: 'دیگر (پاکستان سے باہر)',
    to_light: 'روشن موڈ پر جائیں', to_dark: 'تاریک موڈ پر جائیں', switch: 'English', err: 'اعداد و شمار نہیں آ سکے۔ تھوڑی دیر بعد کوشش کریں۔', gone: 'یہ لنک کسی گروپ کا نہیں ہے۔', road_h: 'ہدف کا راستہ', road_note: 'گنبد کے جتنا قریب، قافلہ اپنے ہدف کے اتنا قریب۔ فاصلے پیمانے کے مطابق نہیں۔', dest: 'ہدف', roadlabel: 'اپنے ہدف کی طرف راستے پر قافلے', everyone: 'سب', caravans_h: 'قافلوں کی درجہ بندی', you: 'آپ کا قافلہ' },
};
let lang = 'en', data = null, tab = 'today', ctab = 'today', vtab = 'today', scope = 'local', cityUr = {};
try { lang = localStorage.getItem('lang') || (/^ur/i.test(navigator.language || '') ? 'ur' : 'en'); } catch { /* private mode */ }
const t = (k, ...a) => { const v = TEXT[lang][k] ?? TEXT.en[k]; return typeof v === 'function' ? v(...a) : v; };
const isLight = () => document.documentElement.dataset.theme === 'light';
const cityName = (c) => (c === 'Other' ? t('other') : (lang === 'ur' && cityUr[c]) || c);

function list(el, rows, valueOf, nameOf, subOf) {
  el.replaceChildren();
  if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.style.display = 'block'; li.textContent = t('empty'); el.append(li); return; }
  const max = Math.max(...rows.map(valueOf), 1);
  for (const r of rows) {
    const li = document.createElement('li');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = r.rank;
    const w = document.createElement('span'); w.className = 'who'; w.textContent = nameOf(r);
    const v = document.createElement('span'); v.className = 'v'; v.textContent = fmt(valueOf(r));
    const tr = document.createElement('span'); tr.className = 'track'; const i = document.createElement('i'); i.style.width = `${Math.max(2, valueOf(r) / max * 100)}%`; tr.append(i);
    li.append(n, w, v, tr);
    if (subOf) { const s = document.createElement('span'); s.className = 'sub2'; s.textContent = subOf(r); li.append(s); }
    el.append(li);
  }
}
function short(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : String(n); }

function paint() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr'; document.title = data ? `${data.name} · ${t('title')}` : t('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  $('lang').textContent = t('switch'); $('lang').lang = lang === 'ur' ? 'en' : 'ur';
  $('theme').textContent = isLight() ? '☾' : '☀'; $('theme').setAttribute('aria-label', t(isLight() ? 'to_dark' : 'to_light'));
  document.querySelector('meta[name=theme-color]').setAttribute('content', isLight() ? '#f4f1ea' : '#0c0e2b');
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const b of document.querySelectorAll('[data-ctab]')) b.setAttribute('aria-selected', String(b.dataset.ctab === ctab));
  $('back').href = `/c/${slug}`;
  if (!data) $('title').textContent = t('title');
  $('scope-local').textContent = data ? data.name : '…';
  for (const b of document.querySelectorAll('[data-scope]')) b.setAttribute('aria-selected', String(b.dataset.scope === scope));
  for (const b of document.querySelectorAll('[data-vtab]')) b.setAttribute('aria-selected', String(b.dataset.vtab === vtab));
  if (!data) return;
  // the niche: this caravan's own progress, filling from the bottom
  const hp = data.target ? Math.min(1, data.total / data.target) : 0, hp100 = hp * 100;
  $('total').textContent = fmt(data.total); $('total').classList.toggle('long', fmt(data.total).length > 9); $('target').textContent = fmt(data.target);
  const fh = Math.round(250 * Math.min(1, Math.sqrt(hp)));
  $('archfill').setAttribute('y', String(250 - fh)); $('archfill').setAttribute('height', String(fh));
  $('pct').textContent = t('pct', hp100 < 1 ? hp100.toFixed(2) : hp100.toFixed(1));
  $('title').textContent = data.name;
  drawRoad();
  const d = scope === 'global' ? data.global : data;
  $('today').textContent = fmt(d.today); $('week').textContent = fmt(d.week); $('members').textContent = fmt(d.members);
  $('active-today').textContent = fmt(d.active.today); $('active-week').textContent = fmt(d.active.week);
  $('ncities').textContent = fmt(d.cities.filter((c) => c.city !== 'Other').length);
  $('avg').textContent = fmt(d.members ? Math.round(d.total / d.members) : 0);
  document.querySelectorAll('.num').forEach(fit);
  const max = Math.max(...d.daily.map((x) => x.total), 1), chart = $('chart');
  chart.replaceChildren();
  d.daily.forEach((x, i) => {
    const col = document.createElement('div'); if (i === d.daily.length - 1) col.className = 'now';
    const v = document.createElement('b'); v.textContent = x.total ? short(x.total) : '';
    const bar = document.createElement('i'); bar.style.height = `${Math.max(2, x.total / max * 118)}px`;
    const s = document.createElement('small'); s.textContent = x.day.slice(8);
    col.append(v, bar, s); chart.append(col);
  });
  chart.setAttribute('aria-label', `${t('last14')}: ${d.daily.map((x) => `${x.day} ${fmt(x.total)}`).join(', ')}`);
  // the caravans against each other (whichever view is open); the viewer's own is marked and always shown
  const vk = vtab;
  const ranked = [...data.caravans].sort((a, b) => b[vk] - a[vk] || a.name.localeCompare(b.name)).map((c, i) => ({ ...c, rank: i + 1 }));
  const shown = ranked.slice(0, 10); const mine = ranked.find((c) => c.mine); if (mine && !shown.includes(mine)) shown.push(mine);
  list($('caravans'), shown, (c) => c[vk], (c) => (c.mine ? `${c.name} · ${t('you')}` : c.name), (c) => t('mem', c.members));
  list($('people'), d.top[tab], (r) => r.count, (r) => r.name);
  const key = { today: 'today', week: 'week', total: 'total' }[ctab];
  const cities = [...d.cities].sort((a, b) => b[key] - a[key] || a.city.localeCompare(b.city)).filter((c) => c[key] > 0).map((c, i) => ({ ...c, rank: i + 1 }));
  list($('cities'), cities, (c) => c[key], (c) => cityName(c.city), (c) => t('mem', c.members));
}
function fit(el) {
  el.style.removeProperty('font-size');
  const box = el.parentElement, room = box.clientWidth - 32;
  if (room > 0 && el.scrollWidth > room) el.style.fontSize = `${(parseFloat(getComputedStyle(el).fontSize) * room / el.scrollWidth * 0.97).toFixed(1)}px`;
}
addEventListener('resize', () => document.querySelectorAll('.num').forEach(fit));
$('lang').addEventListener('click', () => { lang = lang === 'ur' ? 'en' : 'ur'; try { localStorage.setItem('lang', lang); } catch { /* ignore */ } paint(); });
$('theme').addEventListener('click', () => {
  if (isLight()) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'light';
  try { localStorage.setItem('theme', isLight() ? 'light' : 'dark'); } catch { /* ignore */ }
  paint();
});
for (const b of document.querySelectorAll('[data-scope]')) b.addEventListener('click', () => { scope = b.dataset.scope; paint(); });
for (const b of document.querySelectorAll('[data-vtab]')) b.addEventListener('click', () => { vtab = b.dataset.vtab; paint(); });
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { tab = b.dataset.tab; paint(); });
for (const b of document.querySelectorAll('[data-ctab]')) b.addEventListener('click', () => { ctab = b.dataset.ctab; paint(); });
async function load() {
  try {
    const [s, ur] = await Promise.all([fetch(`/api/stats?c=${encodeURIComponent(slug)}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }), fetch('/cities-ur.json').then((r) => r.json()).catch(() => ({}))]);
    data = s; cityUr = ur;
  } catch (e) { $('pct').textContent = t(e.message === '404' ? 'gone' : 'err'); }
  paint();
}
paint(); load();

// ---- the road: every caravan is a pin on a winding road to the dome; the nearer its own target, the nearer the dome ----
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.append(e); return e; };
function drawRoad() {
  const box = $('road'); box.replaceChildren();
  if (!data) return;
  const svg = sv('svg', { viewBox: '0 0 300 440', role: 'img', 'aria-label': t('roadlabel') }, box);
  const D = 'M60 420 C 240 390, 40 330, 220 280 S 70 180, 200 130 S 140 70, 150 56';
  const bed = sv('path', { d: D, class: 'bed' }, svg); sv('path', { d: D, class: 'dots' }, svg);
  const L = bed.getTotalLength();
  const all = data.caravans.map((c) => ({ ...c, p: c.target ? Math.min(1, c.total / c.target) : 0 }));
  const pick = all.slice().sort((a, b) => b.p - a.p || b.total - a.total).slice(0, 8);
  const mine = all.find((c) => c.mine); if (mine && !pick.includes(mine)) pick.push(mine);
  pick.sort((a, b) => a.p - b.p);
  let prev = -1;
  for (const c of pick) { c.s = Math.min(0.94, Math.max(0.05 + 0.88 * Math.sqrt(c.p), prev + 0.095)); prev = c.s; }
  const lead = pick.length ? pick[pick.length - 1] : null;
  if (mine) sv('path', { d: D, class: 'trail', 'stroke-dasharray': `${(mine.s * L).toFixed(1)} ${(L * 2).toFixed(1)}` }, svg);
  sv('path', { d: 'M126 60 q24 -40 48 0 z', class: 'dome' }, svg); sv('rect', { x: 124, y: 60, width: 52, height: 7, rx: 3, class: 'dome' }, svg);
  sv('path', { d: 'M150 12 a5 5 0 1 0 3 9 a4 4 0 1 1 -3 -9', class: 'dome' }, svg);
  const dest = sv('text', { x: 150, y: 90, class: 'dest' }, svg); dest.textContent = t('dest');
  for (const c of pick) {
    const pt = bed.getPointAtLength(c.s * L);
    const g = sv('g', { class: `pin${c.mine ? ' me' : ''}${c === lead ? ' lead' : ''}`, transform: `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})` }, svg);
    const pct = c.p * 100;
    const rect = sv('rect', {}, g), dot = sv('circle', { r: 5.5 }, g);
    const text = sv('text', { x: 14, y: 4, 'text-anchor': 'start' }, g);
    text.append(document.createTextNode(c.name.length > 18 ? `${c.name.slice(0, 17)}…` : c.name)); const sp = sv('tspan', { class: 'pct', dx: 6 }, text); sp.textContent = `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`;
    let bb = text.getBBox();
    if (pt.x + 14 + bb.width + 8 > 298) { text.setAttribute('x', '-14'); text.setAttribute('text-anchor', 'end'); bb = text.getBBox(); }   // not enough room on the right: label goes to the left
    rect.setAttribute('x', String(bb.x - 8)); rect.setAttribute('y', String(bb.y - 4)); rect.setAttribute('width', String(bb.width + 16)); rect.setAttribute('height', String(bb.height + 8)); rect.setAttribute('rx', String((bb.height + 8) / 2));
    g.append(dot); // the dot is drawn on top of the label's edge
  }
}
