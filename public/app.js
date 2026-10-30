// The page: phone + count; a number we do not know yet also gives a name and a city; then today's, this week's and the overall figures.
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-US');
const ERRORS = {
  bad_phone: 'That does not look like a phone number. Include the full number, for example 0300 1234567.',
  bad_count: 'Enter a whole number, at least 1.',
  need_name: 'Please type your name.',
  need_city: 'Please choose your city.',
  slow_down: 'A lot of tries in a short time. Please wait a minute.',
  bad_request: 'Something went wrong. Please try again.',
};
const say = (id, text) => { $(id).textContent = text || ''; };
let known = null;          // null = not checked yet, true / false once we asked about the number in the box
let lastChecked = '';
let rid = crypto.randomUUID(); // one id per attempt, so a double tap or a retry counts once

async function call(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'bad_request'), { code: data.error || 'bad_request' });
  return data;
}

function showNewcomer(show) {
  $('newcomer').hidden = !show;
  if (show) say('phone-hint', 'New number: please add your name and city below.');
  else say('phone-hint', known ? 'Welcome back.' : '');
}

// when the number looks complete, ask whether we know it: a new one reveals the name and the city
let timer;
$('phone').addEventListener('input', () => {
  clearTimeout(timer);
  known = null; showNewcomer(false); say('phone-hint', '');
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
  const { cities } = await (await fetch('/api/cities')).json();
  const select = $('city');
  for (const c of cities) { const o = document.createElement('option'); o.value = c; o.textContent = c === 'Other' ? 'Other (outside Pakistan)' : c; select.append(o); }
}

function showStats(s) {
  $('you-today').textContent = fmt(s.you.today); $('all-today').textContent = fmt(s.everyone.today);
  $('you-week').textContent = fmt(s.you.week); $('all-week').textContent = fmt(s.everyone.week);
  $('all-total').textContent = fmt(s.everyone.total); $('target').textContent = fmt(s.target);
  const pct = Math.min(100, (s.everyone.total / s.target) * 100);
  $('fill').style.width = `${pct}%`; $('bar').setAttribute('aria-valuenow', String(Math.round(pct)));
  $('pct').textContent = `${pct < 1 && pct > 0 ? pct.toFixed(2) : pct.toFixed(1)}% of the target`;
  $('stats').hidden = false;
  $('stats').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  say('error', '');
  const phone = $('phone').value.trim(), count = Number($('count').value);
  if (!phone) { say('error', ERRORS.bad_phone); $('phone').focus(); return; }
  if (!Number.isInteger(count) || count < 1) { say('error', ERRORS.bad_count); $('count').focus(); return; }
  const body = { phone, count, rid };
  if (!$('newcomer').hidden) { body.name = $('name').value; body.city = $('city').value; }
  $('submit').disabled = true;
  try {
    const out = await call('/api/entry', body);
    known = true; lastChecked = phone; showNewcomer(false); say('phone-hint', 'Saved.');
    $('count').value = ''; rid = crypto.randomUUID();
    showStats(out);
  } catch (e) {
    if (e.code === 'need_name' || e.code === 'need_city') { known = false; showNewcomer(true); $(e.code === 'need_name' ? 'name' : 'city').focus(); }
    say('error', ERRORS[e.code] || ERRORS.bad_request);
  } finally { $('submit').disabled = false; }
});

loadCities();
