import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';
process.env.EDITION = 'internal';

const { createServer } = await import('../server/index.js');
const { db } = await import('../server/db.js');

let server, base, port, n = 0;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); port = server.address().port; base = `http://127.0.0.1:${port}`; });
after(() => server.close());
async function api(method, path, { token, body, raw } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: raw ?? (body && JSON.stringify(body)) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const signup = (username, phone) => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: phone || `0307${String(2000000 + n)}`, password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } }); };

test('an oversized upload gets 413 and does not wedge the next request on the same connection', async () => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const u = await signup('big_u');
  const call = (body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/reflections', method: 'POST', agent, headers: { 'content-type': 'application/json', authorization: `Bearer ${u.token}` } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, d })); });
    req.setTimeout(4000, () => { req.destroy(); reject(new Error('hung')); });
    req.on('error', (e) => resolve({ status: -1, d: String(e) }));
    req.end(body);
  });
  assert.equal((await call(JSON.stringify({ text: 'x'.repeat(100000) }))).status, 413);
  const next = await call(JSON.stringify({ text: 'a real reflection' }));
  assert.equal(next.status, 200);
  agent.destroy();
});

test('malformed requests are 4xx, never 500', async () => {
  const u = await signup('mal_u');
  for (const raw of ['null', '[]', '"x"', '{', '123']) assert.equal((await api('POST', '/api/log', { token: u.token, raw })).status, 400, raw);
  assert.equal((await api('GET', '/api/burhan/saaliks/%E0%A4%A', { token: u.token })).status, 400);
  for (const kind of ['constructor', '__proto__', 'toString']) {
    assert.equal((await api('POST', '/api/like', { token: u.token, body: { kind, id: 1 } })).status, 400, kind);
    assert.equal((await api('GET', `/api/replies?kind=${kind}&id=1`, { token: u.token })).status, 400, kind);
  }
});

test('the email check is linear: a hostile address cannot freeze the server', async () => {
  const bad = `a@${'.'.repeat(32000)}@`;
  const t0 = Date.now();
  const r = await api('POST', '/api/password/forgot', { body: { email: bad } });
  assert.equal(r.status, 400);
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms`);
  assert.equal((await api('POST', '/api/password/forgot', { body: { email: `${'a'.repeat(250)}@x.pk` } })).status, 400);
});

test('login: the throttle counts failures per account however it is named, and cannot lock out the owner', async () => {
  await signup('thr_u', '03071112222');
  for (const id of ['thr_u', 'thr_u@x.pk', '0307 1112222', '0307-1112222', 'THR_U@X.PK']) {
    const r = await api('POST', '/api/login', { body: { id, password: 'wrong-pass' } });
    assert.equal(r.status, 401, id);
  }
  for (let i = 0; i < 6; i++) await api('POST', '/api/login', { body: { id: ['thr_u', '03071112222', 'thr_u@x.pk'][i % 3], password: 'nope-nope' } });
  assert.equal((await api('POST', '/api/login', { body: { id: '03071112222', password: 'secret1' } })).status, 429, 'ten failures lock the account for a while');
  // someone else hammering a different name does not touch this account's counter
  const other = await signup('thr_o', '03071113333');
  for (let i = 0; i < 12; i++) await api('POST', '/api/login', { body: { id: 'thr_nobody', password: 'x' } });
  assert.ok((await api('POST', '/api/login', { body: { id: 'thr_o', password: 'secret1' } })).token, 'an unrelated failure counter does not block a correct login');
  assert.ok(other.token);
});

test('a username cannot look like a phone number, so it cannot shadow a phone login', async () => {
  assert.equal((await signup('03079990001')).error, 'bad_username');
  assert.equal((await api('GET', '/api/username-check?u=03079990001')).ok, false);
  const v = await signup('phone_v', '03079990001');
  assert.ok((await api('POST', '/api/login', { body: { id: '03079990001', password: 'secret1' } })).token);
  assert.ok(v.token);
});

test('changing email needs the password and is rate limited; a bad field leaves the others untouched', async () => {
  const u = await signup('em_u');
  assert.equal((await api('PATCH', '/api/me', { token: u.token, body: { email: 'em_new@x.pk' } })).error, 'password_needed');
  assert.equal((await api('PATCH', '/api/me', { token: u.token, body: { email: 'em_new@x.pk', dailyGoal: -5, password: 'secret1' } })).error, 'bad_count');
  assert.equal(db.prepare('SELECT email FROM users WHERE username = ?').get('em_u').email, 'em_u@x.pk', 'nothing was half-applied');
  let last;
  for (let i = 0; i < 5; i++) last = await api('PATCH', '/api/me', { token: u.token, body: { email: `em_new${i}@x.pk`, password: 'secret1' } });
  assert.equal(last.status, 429);
});

test('a city can be changed once a fortnight', async () => {
  const u = await signup('city_u');
  assert.equal((await api('PATCH', '/api/me', { token: u.token, body: { cityId: 1174872 } })).cityId, 1174872);
  assert.equal((await api('PATCH', '/api/me', { token: u.token, body: { cityId: 1172451 } })).error, 'city_locked');
  db.prepare('UPDATE users SET city_changed_at = ? WHERE username = ?').run(Date.now() - 15 * 86400e3, 'city_u');
  assert.equal((await api('PATCH', '/api/me', { token: u.token, body: { cityId: 1172451 } })).cityId, 1172451);
});

test('deleting an account erases its Al-Burhan data, written text and push devices', async () => {
  const u = await signup('del_u');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get('del_u').id;
  db.prepare("INSERT INTO murabbi_links (user_id, murabbi_phone, murabbi_name, checked_at, created_at) VALUES (?, '+923000000000', 'Hafiz', 1, 1)").run(id);
  db.prepare("INSERT INTO mamulaat_days (user_id, day, percent) VALUES (?, '2026-10-20', 70)").run(id);
  db.prepare("INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES ('https://fcm.googleapis.com/x', ?, 'a', 'b', 1)").run(id);
  await api('POST', '/api/reflections', { token: u.token, body: { text: 'a private thought' } });
  assert.equal((await api('DELETE', '/api/me', { token: u.token, body: { password: 'secret1' } })).status, 200);
  for (const t of ['murabbi_links', 'mamulaat_days', 'push_subs']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`).get(id).n, 0, t);
  assert.equal(db.prepare('SELECT body FROM reflections WHERE user_id = ?').get(id).body, '');
});

test('a malformed stored password is a wrong password, not a crash', async () => {
  const { checkPassword, hashPassword } = await import('../server/auth.js');
  for (const bad of ['x', '', null, undefined, 'zz:zz', 'abcd:', ':abcd', '00'.repeat(16) + ':' + '11'.repeat(10)]) assert.equal(await checkPassword('secret1', bad), false);
  const good = await hashPassword('secret1');
  assert.equal(await checkPassword('secret1', good), true);
  assert.equal(await checkPassword('wrong', good), false);
  assert.equal(await checkPassword(null, good), false);
});
