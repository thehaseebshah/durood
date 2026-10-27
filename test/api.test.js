import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.PUBLIC_CACHE_MS = '0';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.MAX_DAILY_NEW = '50000'; // first-week limit is tested on its own

const { CFG, specialToday } = await import('../server/game.js');
const FRI = () => (specialToday() ? CFG.specialXp : 0); // on a Friday (or an admin special day) the bonus quest pays on top
const { createServer, normalizePhone } = await import('../server/index.js');
(await import('./helpers.js')).seedCaravan();
const { db } = await import('../server/db.js');
const { audit } = await import('../server/audit.js');

let server, base;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  if (path === '/api/log' && body && body.rid === undefined) body = { ...body, rid: randomUUID() };
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
let n = 0;
const signup = (username, invite) => {
  n += 1;
  return api('POST', '/api/register', {
    body: { username, email: `${username}@x.pk`, phone: `0300${String(1000000 + n)}`, password: 'secret1', cityId: 1172451, lang: 'en', invite: invite || 'testcv' },
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
  assert.equal((await signup('bob_x', 'nobody')).error, 'bad_invite');
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
  assert.equal(r.xpGained, 1000 + 100 + 100 + 300 + 5 + FRI()); // durood + 1,000 milestone + daily goal + weekly goal (700) quests + streak day 1
  assert.equal(r.me.quests.filter((q) => q.group === 'durood').length, 4 + (FRI() ? 1 : 0));
  assert.deepEqual(r.me.quests.map((q) => q.id).filter((id) => !['goal', 'weekgoal', 'days5', 'streak', 'special'].includes(id)), ['sunnah'], 'only durood and Sunnah quests remain');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 0 } })).error, 'bad_count');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 1.5 } })).error, 'bad_count');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 999999 } })).error, 'bad_count');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 50_001 } })).error, 'bad_count', 'one submission can never exceed the daily limit');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 49_000 } })).added, 49_000); // 50,000 for the day
  assert.equal((await api('POST', '/api/log', { token, body: { count: 1 } })).error, 'daily_cap');
  assert.equal((await api('GET', '/api/me')).status, 401);
});

test('streak continues across days and a shield bridges one missed day', async () => {
  const { token, me } = await signup('streaker');
  const day = (off) => new Date(Date.now() + 5 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
  db.prepare('UPDATE users SET streak = 6, best_streak = 6, last_day = ? WHERE id = ?').run(day(-1), me.id);
  let r = await api('POST', '/api/log', { token, body: { count: 5 } });
  assert.equal(r.me.streak, 7);
  assert.equal(r.me.shields, 1);
  db.prepare('UPDATE users SET last_day = ? WHERE id = ?').run(day(-2), me.id);
  r = await api('POST', '/api/log', { token, body: { count: 5 } });
  assert.equal(r.me.streak, 8);
  assert.equal(r.me.shields, 0);
  db.prepare('UPDATE users SET last_day = ? WHERE id = ?').run(day(-3), me.id);
  r = await api('POST', '/api/log', { token, body: { count: 5 } });
  assert.equal(r.me.streak, 1);
});

test('static shell is served', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
});

test('a retried submission with the same request id is counted exactly once', async () => {
  const { token } = await signup('retrier');
  const rid = randomUUID();
  const a = await api('POST', '/api/log', { token, body: { count: 300, rid } });
  const b = await api('POST', '/api/log', { token, body: { count: 300, rid } });
  assert.equal(a.added, 300);
  assert.equal(b.duplicate, true);
  assert.equal(b.added, 0);
  assert.equal(b.me.total, 300);
  assert.equal((await api('POST', '/api/log', { token, body: { count: 5, rid: 'x' } })).error, 'bad_request_id');
});

test('the ledger is append-only', () => {
  assert.throws(() => db.prepare('UPDATE entries SET count = count + 1').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM entries').run(), /append-only/);
});

test('audit: every statistic reconciles with the ledger, detects tampering, and repairs it', async () => {
  assert.deepEqual(audit().problems, []);
  assert.equal(audit().ok, true);
  const pub = await api('GET', '/api/public');
  assert.equal(pub.total + pub.pending, audit().ledgerTotal, 'public total plus durood on hold equals the ledger');
  assert.equal(pub.pending, 0, 'nothing is held back: all members are trusted');

  db.prepare("UPDATE users SET total = total + 1000, xp = xp + 7 WHERE username = 'retrier'").run();
  db.prepare("UPDATE daily SET count = count + 1 WHERE user_id = (SELECT id FROM users WHERE username = 'reciter')").run();
  const bad = audit();
  assert.equal(bad.ok, false);
  assert.deepEqual([...new Set(bad.problems.map((p) => p.kind))].sort(), ['daily', 'national', 'user_total', 'xp']);

  const fixed = audit({ fix: true });
  assert.equal(fixed.fixed, true);
  assert.deepEqual(audit().problems, []);
});

test('durood milestones and the weekly goal quest pay once; sunnah rewards stay small', async () => {
  const { token, me } = await signup('milestoner');
  await api('PATCH', '/api/me', { token, body: { dailyGoal: 100 } });
  const r = await api('POST', '/api/log', { token, body: { count: 10_000 } });
  assert.ok(r.newBadges.includes('d10k'));
  // 10,000 durood + d1k 100 + d10k 500 + daily goal 100 + weekly goal (700) 300
  // plus 300 when the caravan (everyone shares one here) is past 10,000 and the group badge is shared with them
  assert.equal(r.xpGained, 10_000 + 100 + 500 + 100 + 300 + 5 + FRI() + (r.newBadges.includes('group10k') ? 300 : 0));
  const again = await api('POST', '/api/log', { token, body: { count: 50 } });
  assert.equal(again.xpGained, 50); // nothing is paid twice
  const { CFG } = await import('../server/game.js');
  assert.ok(CFG.sunnahXp + CFG.likeCap * CFG.likeXp < 1000);
  assert.deepEqual(audit().problems, []);
});
