// The public stats page: totals, a 14-day chart and rankings of members (made-up names) and cities. It only reads /api/stats.
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-US');
const TEXT = {
  en: { title: 'Tasbeeh stats', sub: 'All of us, together. Members appear under made-up names.', overall: 'Overall target', of: 'of', today: 'Today', week: 'This week', alltime: 'All time',
    counting: 'people counting', members: 'Members', cities_word: 'cities', avg: 'Average per member', avg_note: 'all time', last14: 'Last 14 days', people: 'Top members',
    alias_note: 'Names are made up and cannot be traced back to anyone.', citiesh: 'City rankings', updated: 'Rankings refresh about every 15 minutes.', back: 'Back to counting',
    pct: (p) => `${p}% of the target`, mem: (n) => `${fmt(n)} ${n === 1 ? 'member' : 'members'}`, empty: 'Nothing yet. Be the first!', other: 'Other (outside Pakistan)',
    to_light: 'Switch to light mode', to_dark: 'Switch to dark mode', switch: 'اردو', err: 'Could not load the stats. Please try again soon.' },
  ur: { title: 'تسبیح کے اعداد و شمار', sub: 'ہم سب مل کر۔ اراکین فرضی ناموں سے دکھائے جاتے ہیں۔', overall: 'مجموعی ہدف', of: 'میں سے', today: 'آج', week: 'اس ہفتے', alltime: 'کل ملا کر',
    counting: 'افراد شمار کر رہے ہیں', members: 'اراکین', cities_word: 'شہر', avg: 'فی رکن اوسط', avg_note: 'کل ملا کر', last14: 'پچھلے 14 دن', people: 'سرفہرست اراکین',
    alias_note: 'نام فرضی ہیں اور کسی تک نہیں پہنچتے۔', citiesh: 'شہروں کی درجہ بندی', updated: 'درجہ بندی تقریباً ہر 15 منٹ بعد تازہ ہوتی ہے۔', back: 'شمار پر واپس',
    pct: (p) => `ہدف کا ${p}٪ مکمل`, mem: (n) => `${fmt(n)} اراکین`, empty: 'ابھی کچھ نہیں۔ پہلے آپ بنیں!', other: 'دیگر (پاکستان سے باہر)',
    to_light: 'روشن موڈ پر جائیں', to_dark: 'تاریک موڈ پر جائیں', switch: 'English', err: 'اعداد و شمار نہیں آ سکے۔ تھوڑی دیر بعد کوشش کریں۔' },
};
let lang = 'en', data = null, tab = 'today', ctab = 'today', cityUr = {};
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
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr'; document.title = t('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  $('lang').textContent = t('switch'); $('lang').lang = lang === 'ur' ? 'en' : 'ur';
  $('theme').textContent = isLight() ? '☾' : '☀'; $('theme').setAttribute('aria-label', t(isLight() ? 'to_dark' : 'to_light'));
  document.querySelector('meta[name=theme-color]').setAttribute('content', isLight() ? '#f4f1ea' : '#0c0e2b');
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const b of document.querySelectorAll('[data-ctab]')) b.setAttribute('aria-selected', String(b.dataset.ctab === ctab));
  if (!data) return;
  const d = data;
  $('total').textContent = fmt(d.total); $('target').textContent = fmt(d.target);
  const pct = d.target ? Math.min(100, d.total / d.target * 100) : 0;
  $('fill').style.width = `${Math.max(pct, 0.4)}%`; $('bar').setAttribute('aria-valuenow', pct.toFixed(1));
  $('pct').textContent = t('pct', pct < 1 ? pct.toFixed(2) : pct.toFixed(1));
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
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { tab = b.dataset.tab; paint(); });
for (const b of document.querySelectorAll('[data-ctab]')) b.addEventListener('click', () => { ctab = b.dataset.ctab; paint(); });
async function load() {
  try {
    const [s, ur] = await Promise.all([fetch('/api/stats').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }), fetch('/cities-ur.json').then((r) => r.json()).catch(() => ({}))]);
    data = s; cityUr = ur;
  } catch { $('pct').textContent = t('err'); }
  paint();
}
paint(); load();
