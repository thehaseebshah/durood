import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.CIRCLE_URL = 'https://example.org/circle';

const { createServer, normalizePhone } = await import('../server/index.js');
const { db } = await import('../server/db.js');

let server, base;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
let n = 0;
const signup = (username, referral) => {
  n += 1;
  return api('POST', '/api/register', {
    body: { username, email: `${username}@x.pk`, phone: `0300${String(1000000 + n)}`, password: 'secret1', lang: 'en', referral },
  });
};

test('phone normalisation', () => {
  assert.equal(normalizePhone('0300 1234567'), '+923001234567');
  assert.equal(normalizePhone('923001234567'), '+923001234567');
  assert.equal(normalizePhone('+44 7700 900123'), '+447700900123');
  assert.equal(normalizePhone('abc'), null);
});

test('registration validates and enforces unique usernames', async () => {
  const a = await signup('ali_khan');
  assert.ok(a.token);
  assert.equal(a.me.username, 'ali_khan');
  assert.equal((await signup('ALI_KHAN')).error, 'username_taken');
  assert.equal((await signup('x')).error, 'bad_username');
  assert.equal((await signup('admin')).error, 'bad_username');
  assert.equal((await signup('bob_x', 'nobody')).error, 'bad_referral');
  assert.equal((await api('GET', '/api/username-check?u=ali_khan')).ok, false);
  assert.equal((await api('GET', '/api/username-check?u=fresh_one')).ok, true);
});

test('login by username, email or phone', async () => {
  const { me } = await signup('login_user');
  for (const id of ['login_user', 'login_user@x.pk', me.phone]) {
    const r = await api('POST', '/api/login', { body: { id, password: 'secret1' } });
    assert.ok(r.token, id);
  }
  assert.equal((await api('POST', '/api/login', { body: { id: 'login_user', password: 'nope' } })).status, 401);
});

test('logging durood: xp, streak, badges, caps', async () => {
  const { token } = await signup('reciter');
  const r = await api('POST', '/api/log', { token, body: { count: 1000 } });
  assert.equal(r.me.today, 1000);
  assert.equal(r.me.total, 1000);
  assert.equal(r.me.streak, 1);
  assert.ok(r.newBadges.includes('first_step') && r.newBadges.includes('d1k'));
  assert.ok(r.me.quests.find((q) => q.id === 'goal').done);
  assert.equal((await api('POST', '/api/log', { token, body: { count: 0 } })).error, 'bad_count');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 1.5 } })).error, 'bad_count');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 999999 } })).error, 'bad_count');
  for (let i = 0; i < 4; i++) await api('POST', '/api/log', { token, body: { count: 100000 } });
  assert.equal((await api('POST', '/api/log', { token, body: { count: 100000 } })).error, 'daily_cap');
  assert.equal((await api('GET', '/api/me')).status, 401);
});

test('referral tree: full-depth team totals, delayed referral reward, opt-out', async () => {
  const a = await signup('root_a');
  const b = await signup('child_b', 'root_a');
  const c = await signup('grand_c', 'child_b');
  // sign-ups alone pay nothing
  assert.equal((await api('GET', '/api/me', { token: a.token })).xp, 0);

  await api('POST', '/api/log', { token: c.token, body: { count: 700 } });
  await api('POST', '/api/log', { token: b.token, body: { count: 200 } });
  const meA = await api('GET', '/api/me', { token: a.token });
  assert.equal(meA.team.total, 900);
  assert.equal(meA.team.members, 2);
  assert.equal(meA.team.direct, 1);
  assert.equal(meA.xp, 500 + 250); // b's first log pays 500; 'invite' weekly quest pays 250; grandchild pays root nothing
  assert.equal((await api('GET', '/api/me', { token: b.token })).xp, 200 + 500 + 250 + 50); // own 200, c's first log, invite quest, goal quest

  const team = await api('GET', '/api/team', { token: a.token });
  assert.equal(team.total, 900);
  assert.equal(team.direct[0].username, 'child_b');
  assert.equal(team.direct[0].team, 900);

  const teams = await api('GET', '/api/leaderboard?type=teams&period=week', { token: a.token });
  assert.equal(teams.rows[0].username, 'root_a');
  assert.equal(teams.rows[0].score, 900);

  await api('PATCH', '/api/me', { token: c.token, body: { isPublic: false } });
  const users = await api('GET', '/api/leaderboard?type=users&period=week', { token: a.token });
  assert.ok(!users.rows.some((r) => r.username === 'grand_c'));
  // still counted for the caravan
  assert.equal((await api('GET', '/api/me', { token: a.token })).team.total, 900);
  const dir = await api('GET', '/api/team', { token: b.token });
  assert.equal(dir.direct[0].total, null);
});

test('lectures: server-enforced watch time, once only; circle claim once', async () => {
  const { token } = await signup('learner');
  assert.equal((await api('POST', '/api/admin/lectures', { body: { youtube_id: 'dQw4w9WgXcQ', title_en: 'T' } })).status, 403);
  const lec = await api('POST', '/api/admin/lectures', { headers: { 'x-admin-key': 'test-admin' }, body: { youtube_id: 'dQw4w9WgXcQ', title_en: 'Seerah 1', min_seconds: 60 } });
  assert.ok(lec.id);
  await api('POST', `/api/lectures/${lec.id}/start`, { token });
  assert.equal((await api('POST', `/api/lectures/${lec.id}/complete`, { token })).error, 'too_soon');
  db.prepare('UPDATE lecture_starts SET started_at = started_at - 120000').run();
  const done = await api('POST', `/api/lectures/${lec.id}/complete`, { token });
  assert.equal(done.xpGained, 300);
  assert.ok(done.newBadges.includes('scholar1'));
  assert.equal((await api('POST', `/api/lectures/${lec.id}/complete`, { token })).already, true);

  const c1 = await api('POST', '/api/circle/claim', { token });
  assert.equal(c1.xpGained, 1000);
  assert.equal((await api('POST', '/api/circle/claim', { token })).already, true);
  assert.equal((await api('GET', '/api/lectures', { token })).circleUrl, 'https://example.org/circle');
});

test('streak continues across days and a shield bridges one missed day', async () => {
  const { token, me } = await signup('streaker');
  const day = (off) => new Date(Date.now() + 5 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
  db.prepare('UPDATE users SET streak = 6, best_streak = 6, last_day = ? WHERE id = ?').run(day(-1), me.id);
  let r = await api('POST', '/api/log', { token, body: { count: 5 } });
  assert.equal(r.me.streak, 7);
  assert.equal(r.me.shields, 1);
  db.prepare('UPDATE users SET last_day = ? WHERE id = ?').run(day(-2), me.id);
  db.prepare('DELETE FROM daily WHERE user_id = ?').run(me.id);
  r = await api('POST', '/api/log', { token, body: { count: 5 } });
  assert.equal(r.me.streak, 8);
  assert.equal(r.me.shields, 0);
  db.prepare('UPDATE users SET last_day = ? WHERE id = ?').run(day(-3), me.id);
  db.prepare('DELETE FROM daily WHERE user_id = ?').run(me.id);
  r = await api('POST', '/api/log', { token, body: { count: 5 } });
  assert.equal(r.me.streak, 1);
});

test('static shell is served', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
});
