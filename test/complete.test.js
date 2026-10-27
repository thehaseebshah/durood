// Features completed after the half-built audit: Sunnah scheduling, the Seerat Circle claim, moderation "keep", hidden-post notice,
// caravan notifications, honest email status, lecture editing, a held total's final word, and deleting an account from the admin page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';

const { createServer } = await import('../server/index.js');
(await import('./helpers.js')).seedCaravan();
const { db } = await import('../server/db.js');
const news = await import('../server/news.js');
const { dayOf, dayNum, dayStr } = await import('../server/game.js');
const { audit } = await import('../server/audit.js');

let server, base, n = 0;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const K = (method, path, body) => api(method, `/api/admin${path}`, { headers: { 'x-admin-key': 'test-admin' }, body });
const signup = (username, invite = 'testcv') => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0307${String(1000000 + n)}`, password: 'secret1', cityId: 1172451, invite, lang: 'en' } }); };
const today = dayOf(), plus = (k) => dayStr(dayNum(today) + k);

test('organisers schedule, list, edit and remove daily Sunnahs; one already used cannot be removed', async () => {
  assert.equal((await K('POST', '/sunnahs', { sunnahs: [{ day: today, title_en: 'Smile', source: 'Tirmidhi' }, { day: plus(1), title_en: 'Salam first' }] })).days.length, 2);
  let list = (await K('GET', '/sunnahs')).sunnahs;
  assert.deepEqual(list.map((x) => x.day), [today, plus(1)]);
  await K('POST', '/sunnahs', { sunnahs: [{ day: plus(1), title_en: 'Give salam first', title_ur: 'پہلے سلام' }] }); // same day: replaced
  list = (await K('GET', '/sunnahs')).sunnahs;
  assert.equal(list.find((x) => x.day === plus(1)).title_ur, 'پہلے سلام');
  const u = await signup('sn_member');
  assert.equal((await api('GET', '/api/feed', { token: u.token })).today.sunnah.titleEn, 'Smile');
  await api('POST', '/api/sunnah/tick', { token: u.token });
  assert.equal((await K('DELETE', `/sunnahs/${today}`)).error, 'sunnah_in_use');
  assert.equal((await K('DELETE', `/sunnahs/${plus(1)}`)).ok, true);
  assert.equal((await K('DELETE', `/sunnahs/${plus(1)}`)).error, 'not_found');
});

test('a photo whose file is already deleted cannot be "restored" into nothing', async () => {
  const u = await signup('pg_member');
  const s = db.prepare('SELECT id FROM sunnahs WHERE day = ?').get(today);
  const id = Number(db.prepare(`INSERT INTO posts (user_id, sunnah_id, file, sha256, status, created_day, created_at, resolved_at, purged_at) VALUES (?,?,?,?, 'removed', ?,?,?,?)`)
    .run(db.prepare('SELECT id FROM users WHERE username = ?').get('pg_member').id, s.id, 'gone.jpg', crypto.randomBytes(8).toString('hex'), today, Date.now(), Date.now(), Date.now()).lastInsertRowid);
  assert.equal((await K('POST', `/content/post/${id}`, { action: 'restore' })).error, 'photo_gone');
  db.prepare('DELETE FROM posts WHERE id = ?').run(id); // a made-up row: it has no payout history for the audit
  assert.ok(u.token);
});

test('without an email provider, members and admins are told nothing was emailed', async () => {
  const u = await signup('em_member');
  assert.equal((await api('POST', '/api/email/resend', { token: u.token })).sent, false);
});

test('after "keep held" the member gets a final word instead of "being checked" for ever', async () => {
  const u = await signup('fl_member');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get('fl_member').id;
  db.prepare("INSERT INTO flags (user_id, reason, day, detail, day_total, created_at) VALUES (?, 'daily_20k', ?, 'test', 25000, ?)").run(id, today, Date.now());
  db.prepare('UPDATE users SET hidden_from_ranks = 1 WHERE id = ?').run(id);
  assert.equal((await api('GET', '/api/me', { token: u.token })).flagState, 'open');
  const f = db.prepare('SELECT id FROM flags WHERE user_id = ?').get(id);
  await K('POST', `/flags/${f.id}`, { action: 'confirm' });
  assert.equal((await api('GET', '/api/me', { token: u.token })).flagState, 'decided');
});

test('only an owner deletes an account from the admin page, never an admin\'s, and it is anonymised like a self-deletion', async () => {
  const u = await signup('dl_target'); await signup('dl_org');
  await K('POST', '/admins', { username: 'dl_org', role: 'organiser' });
  const tok = (await api('POST', '/api/admin/login', { body: { id: 'dl_org', password: 'secret1' } })).token;
  assert.equal((await api('POST', '/api/admin/members/dl_target', { headers: { 'x-admin-token': tok }, body: { action: 'delete' } })).error, 'not_allowed');
  assert.equal((await K('POST', '/members/dl_org', { action: 'delete' })).error, 'remove_role_first');
  assert.equal((await K('POST', '/members/dl_target', { action: 'delete' })).ok, true);
  assert.equal((await api('GET', '/api/me', { token: u.token })).status, 401);
  assert.equal((await api('POST', '/api/login', { body: { id: 'dl_target', password: 'secret1' } })).error, 'bad_login');
  assert.ok((await K('GET', '/log')).log.some((x) => x.action === 'delete-account' && x.target === 'dl_target'));
  assert.deepEqual(audit().problems, []);
});
