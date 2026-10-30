// The admin page: unlock with the admin key, create a caravan (a group with its own link), copy the links. The key is only kept for this tab.
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-US');
const ERR = { forbidden: 'That key is not right.', slow_down: 'Too many tries. Please wait a minute.', need_name: 'Please type a name (2 to 60 letters).', bad_target: 'The target must be a whole number.', server_error: 'Something went wrong. Try again.' };
let key = '';
try { key = sessionStorage.getItem('adminKey') || ''; } catch { /* private mode */ }

const isLight = () => document.documentElement.dataset.theme === 'light';
const paintTheme = () => { $('theme').textContent = isLight() ? '☾' : '☀'; document.querySelector('meta[name=theme-color]').setAttribute('content', isLight() ? '#f4f1ea' : '#0c0e2b'); };
$('theme').addEventListener('click', () => {
  if (isLight()) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'light';
  try { localStorage.setItem('theme', isLight() ? 'light' : 'dark'); } catch { /* ignore */ }
  paintTheme();
});
paintTheme();

async function api(method, body) {
  const res = await fetch('/api/admin/caravans', { method, headers: { 'x-admin-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'server_error'); e.code = data.error || 'server_error'; throw e; }
  return data;
}
const linkOf = (slug) => `${location.origin}/c/${slug}`;
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { const i = document.createElement('input'); i.value = text; document.body.append(i); i.select(); document.execCommand('copy'); i.remove(); }
  const was = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = was; }, 1400);
}
function row(c) {
  const li = document.createElement('li');
  const b = document.createElement('b'); b.textContent = c.name;
  const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${fmt(c.members)} ${c.members === 1 ? "member" : "members"} · ${fmt(c.total)} of ${fmt(c.target)} · ${fmt(c.today)} today`;
  const link = document.createElement('div'); link.className = 'link'; link.textContent = linkOf(c.slug);
  const acts = document.createElement('div'); acts.className = 'acts';
  const cp = document.createElement('button'); cp.type = 'button'; cp.textContent = 'Copy link'; cp.addEventListener('click', () => copy(linkOf(c.slug), cp));
  const st = document.createElement('a'); st.href = `/c/${c.slug}/stats`; st.textContent = 'Stats page'; st.target = '_blank'; st.rel = 'noopener';
  acts.append(cp, st); li.append(b, meta, link, acts); return li;
}
async function refresh() { const { caravans } = await api('GET'); $('list').replaceChildren(...caravans.map(row)); }
async function open() {
  try { await refresh(); } catch (e) { $('unlock-error').textContent = ERR[e.code] || ERR.server_error; $('unlock').hidden = false; $('admin').hidden = true; try { sessionStorage.removeItem('adminKey'); } catch { /* ignore */ } return; }
  try { sessionStorage.setItem('adminKey', key); } catch { /* ignore */ }
  $('unlock').hidden = true; $('admin').hidden = false;
}
$('unlock').addEventListener('submit', (e) => { e.preventDefault(); key = $('key').value.trim(); $('unlock-error').textContent = ''; open(); });
$('create').addEventListener('submit', async (e) => {
  e.preventDefault(); $('create-error').textContent = '';
  try {
    const made = await api('POST', { name: $('name').value, target: $('target').value || undefined });
    $('made-link').value = linkOf(made.slug); $('made').hidden = false; $('name').value = ''; $('target').value = '';
    await refresh();
  } catch (err) { $('create-error').textContent = ERR[err.code] || ERR.server_error; }
});
$('made-copy').addEventListener('click', (e) => copy($('made-link').value, e.currentTarget));
if (key) open();
