// The page: phone + count; a number we do not know yet also gives a name and a city; then today's, this week's and the overall figures.
// English and Urdu: the switch in the top corner is remembered on this device.
const $ = (id) => document.getElementById(id);
// a caravan has its own link, /c/<name>-<code>; the plain address is the first caravan
const slug = (location.pathname.match(/^\/c\/([a-z0-9-]+)/) || [])[1] || '';
let caravanName = '';
const fmt = (n) => Number(n).toLocaleString('en-US');
const TEXT = {
  en: {
    title: 'Tasbeeh', sub: 'Count together, every day.', phone: 'Phone number', welcome: 'New here? Welcome. Tell us who you are, just once.',
    name: 'Your name', city: 'City', choose_city: 'Choose your city', other_city: 'Other (outside Pakistan)', count: "Today's tasbeeh count", quick: 'Quick amounts',
    add: 'Add to today', added: 'JazakAllah, added', today: 'Today', week: 'This week', everyone: 'everyone', target_label: 'Overall target', of: 'of',
    progress: 'Progress to the overall target', pct: (p) => `${p}% of the target`, foot: 'The big number in each box is yours. "Everyone" is all of us together.',
    hint_new: 'New number: please add your name and city below.', hint_back: 'Welcome back.', hint_saved: 'Saved.', switch: 'اردو',
    bad_phone: 'That does not look like a phone number. Include the full number, for example 0300 1234567.', bad_count: 'Enter a whole number, at least 1.',
    need_name: 'Please type your name.', need_city: 'Please choose your city.', slow_down: 'A lot of tries in a short time. Please wait a minute.',
    bad_request: 'Something went wrong. Please try again.', no_caravan: 'This link does not belong to a group. Please ask for a new link.', offline: 'Could not connect. Check your internet and try again.',
    to_light: 'Switch to light mode', to_dark: 'Switch to dark mode', stats_link: "See everyone's stats",
  },
  ur: {
    title: 'تسبیح', sub: 'ہر روز، مل کر شمار کریں۔', phone: 'فون نمبر', welcome: 'نئے ہیں؟ خوش آمدید۔ بس ایک بار اپنا تعارف کروا دیں۔',
    name: 'آپ کا نام', city: 'شہر', choose_city: 'اپنا شہر چنیں', other_city: 'دیگر (پاکستان سے باہر)', count: 'آج کی تسبیحات کی تعداد', quick: 'فوری مقدار',
    add: 'آج میں شامل کریں', added: 'جزاک اللہ، شامل ہو گیا', today: 'آج', week: 'اس ہفتے', everyone: 'سب مل کر', target_label: 'مجموعی ہدف', of: 'میں سے',
    progress: 'مجموعی ہدف کی طرف پیش رفت', pct: (p) => `ہدف کا ${p}٪ مکمل`, foot: 'ہر خانے میں بڑا عدد آپ کا ہے۔ «سب مل کر» ہم سب کا مجموعہ ہے۔',
    hint_new: 'نیا نمبر: براہِ کرم نیچے اپنا نام اور شہر لکھیں۔', hint_back: 'دوبارہ خوش آمدید۔', hint_saved: 'محفوظ ہو گیا۔', switch: 'English',
    bad_phone: 'یہ فون نمبر درست نہیں لگتا۔ پورا نمبر لکھیں، مثلاً 0300 1234567۔', bad_count: 'پورا عدد لکھیں، کم از کم 1۔',
    need_name: 'براہِ کرم اپنا نام لکھیں۔', need_city: 'براہِ کرم اپنا شہر چنیں۔', slow_down: 'تھوڑی دیر میں بہت کوششیں ہو گئیں۔ ایک منٹ رکیں۔',
    bad_request: 'کچھ گڑبڑ ہو گئی۔ دوبارہ کوشش کریں۔', no_caravan: 'یہ لنک کسی گروپ کا نہیں ہے۔ براہِ کرم نیا لنک مانگیں۔', offline: 'رابطہ نہیں ہو سکا۔ انٹرنیٹ دیکھیں اور دوبارہ کوشش کریں۔',
    to_light: 'روشن موڈ پر جائیں', to_dark: 'تاریک موڈ پر جائیں', stats_link: 'سب کے اعداد و شمار دیکھیں',
  },
};
let lang = 'en';
try { lang = localStorage.getItem('lang') || (/^ur/i.test(navigator.language || '') ? 'ur' : 'en'); } catch { /* private mode: nothing is remembered */ }
const t = (k, ...a) => { const v = TEXT[lang][k] ?? TEXT.en[k]; return typeof v === 'function' ? v(...a) : v; };

const say = (id, text) => { $(id).textContent = text || ''; };
let known = null;            // null = not checked yet, true / false once we asked about the number in the box
let lastChecked = '';
let lastStats = null;
let cityNamesUr = {};
let rid = crypto.randomUUID(); // one id per attempt, so a double tap or a retry counts once
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function applyLang() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
  document.title = caravanName || t('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  if (caravanName) document.querySelector('h1').textContent = caravanName;
  $('stats-link').href = `/c/${slug}/stats`;
  $('lang').textContent = t('switch'); $('lang').lang = lang === 'ur' ? 'en' : 'ur';
  paintTheme();
  for (const o of $('city').options) if (o.value) o.textContent = o.value === 'Other' ? t('other_city') : (lang === 'ur' && cityNamesUr[o.value]) || o.value;
  if (lastStats) showStats(lastStats, false);
  if (!$('newcomer').hidden) say('phone-hint', t('hint_new')); else if (known) say('phone-hint', t('hint_back'));
  if ($('error').dataset.code) say('error', t($('error').dataset.code));
}
const isLight = () => document.documentElement.dataset.theme === 'light';
function paintTheme() {
  $('theme').textContent = isLight() ? '☾' : '☀'; $('theme').setAttribute('aria-label', t(isLight() ? 'to_dark' : 'to_light'));
  document.querySelector('meta[name=theme-color]').setAttribute('content', isLight() ? '#f4f1ea' : '#0c0e2b');
}
$('theme').addEventListener('click', () => {
  if (isLight()) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'light';
  try { localStorage.setItem('theme', isLight() ? 'light' : 'dark'); } catch { /* ignore */ }
  paintTheme();
});
$('lang').addEventListener('click', () => { lang = lang === 'ur' ? 'en' : 'ur'; try { localStorage.setItem('lang', lang); } catch { /* ignore */ } applyLang(); });

function fail(code) { $('error').dataset.code = code; say('error', t(code)); }
function clearFail() { delete $('error').dataset.code; say('error', ''); }

async function call(path, body) {
  let res;
  try { res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, caravan: slug }) }); }
  catch { throw Object.assign(new Error('offline'), { code: 'offline' }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'bad_request'), { code: data.error || 'bad_request' });
  return data;
}

function showNewcomer(show) {
  $('newcomer').hidden = !show;
  if (show) say('phone-hint', t('hint_new'));
  else say('phone-hint', known ? t('hint_back') : '');
}

// when the number looks complete, ask whether we know it: a new one reveals the name and the city
let timer;
$('phone').addEventListener('input', () => {
  clearTimeout(timer);
  known = null; lastChecked = ''; showNewcomer(false); say('phone-hint', '');
  timer = setTimeout(checkPhone, 450);
});
$('phone').addEventListener('change', () => { clearTimeout(timer); checkPhone(); });
async function checkPhone() {
  const phone = $('phone').value.trim();
  if (phone.replace(/\D/g, '').length < 10 || phone === lastChecked) return;
  lastChecked = phone;
  try { known = (await call('/api/check', { phone })).known; showNewcomer(!known); } catch (e) { if (e.code === 'bad_phone') say('phone-hint', ''); }
}

async function loadCities() {
  const [{ cities }, ur] = await Promise.all([fetch('/api/cities').then((r) => r.json()), fetch('/cities-ur.json').then((r) => r.json()).catch(() => ({}))]);
  cityNamesUr = ur;
  const select = $('city');
  for (const c of cities) { const o = document.createElement('option'); o.value = c; select.append(o); }
  applyLang();
}

// the group's name replaces the title; a link that belongs to no group says so instead of showing a form that cannot work
async function loadCaravan() {
  try {
    const r = await fetch(`/api/caravan?c=${encodeURIComponent(slug)}`);
    if (r.status === 404) { fail('no_caravan'); $('form').querySelectorAll('input, select, button').forEach((el) => { el.disabled = true; }); return; }
    const c = await r.json();
    caravanName = c.name;
  } catch { /* the entry itself reports connection problems */ }
  applyLang();
}

// a number that shrinks to fit its box (the overall total can be 100,000,000)
function fit(el) {
  el.style.removeProperty('font-size');
  const box = el.parentElement, room = box.clientWidth - parseFloat(getComputedStyle(box).paddingInlineStart) * 2;
  if (room > 0 && el.scrollWidth > room) el.style.fontSize = `${(parseFloat(getComputedStyle(el).fontSize) * room / el.scrollWidth * 0.97).toFixed(1)}px`;
}
// counts up to the figure instead of jumping
function setNum(id, value, animate = true) {
  const el = $(id);
  if (!animate || reduced || value < 2) { el.textContent = fmt(value); fit(el); return; }
  const t0 = performance.now(), dur = 700;
  const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3; el.textContent = fmt(Math.round(value * e)); if (k < 1) requestAnimationFrame(step); else fit(el); };
  requestAnimationFrame(step);
}
addEventListener('resize', () => document.querySelectorAll('.num').forEach(fit));

function showStats(s, animate = true) {
  lastStats = s;
  setNum('you-today', s.you.today, animate); $('all-today').textContent = fmt(s.everyone.today);
  setNum('you-week', s.you.week, animate); $('all-week').textContent = fmt(s.everyone.week);
  setNum('all-total', s.everyone.total, animate); $('target').textContent = fmt(s.target);
  const pct = Math.min(100, (s.everyone.total / s.target) * 100);
  $('fill').style.width = `${pct}%`; $('bar').setAttribute('aria-valuenow', String(Math.round(pct)));
  $('pct').textContent = t('pct', pct < 1 && pct > 0 ? pct.toFixed(2) : pct.toFixed(1));
  const first = $('stats').hidden;
  $('stats').hidden = false;
  if (animate && first) $('stats').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

$('quick').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-n]'); if (!b) return;
  $('count').value = String((Number($('count').value) || 0) + Number(b.dataset.n)); $('count').focus();
});

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clearFail();
  const phone = $('phone').value.trim(), count = Number($('count').value);
  if (!phone) { fail('bad_phone'); $('phone').focus(); return; }
  if (!Number.isInteger(count) || count < 1) { fail('bad_count'); $('count').focus(); return; }
  const body = { phone, count, rid };
  if (!$('newcomer').hidden) { body.name = $('name').value; body.city = $('city').value; }
  $('submit').disabled = true;
  try {
    const out = await call('/api/entry', body);
    known = true; lastChecked = phone; showNewcomer(false); say('phone-hint', t('hint_saved'));
    try { localStorage.setItem('phone', phone); } catch { /* ignore */ }   // remembered on this device, so next time only the count is needed
    $('count').value = ''; rid = crypto.randomUUID();
    showStats(out);
  } catch (e) {
    if (e.code === 'need_name' || e.code === 'need_city') { known = false; showNewcomer(true); $(e.code === 'need_name' ? 'name' : 'city').focus(); }
    fail(TEXT.en[e.code] ? e.code : 'bad_request');
  } finally { $('submit').disabled = false; }
});

try { const saved = localStorage.getItem('phone'); if (saved) { $('phone').value = saved; checkPhone(); } } catch { /* private mode: nothing is remembered */ }
applyLang();
loadCities();
loadCaravan();
