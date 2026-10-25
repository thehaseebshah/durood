import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.MAX_DAILY_NEW = '50000'; // first-week limit is tested on its own
process.env.CIRCLE_URL = 'https://example.org/circle';

const { CFG, specialToday } = await import('../server/game.js');
const FRI = () => (specialToday() ? CFG.specialXp : 0); // on a Friday (or an admin special day) the bonus quest pays on top
const { createServer, normalizePhone } = await import('../server/index.js');
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
const signup = (username, referral) => {
  n += 1;
  return api('POST', '/api/register', {
    body: { username, email: `${username}@x.pk`, phone: `0300${String(1000000 + n)}`, password: 'secret1', cityId: 1172451, lang: 'en', invite: referral || 'TESTFOUND' },
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
  assert.equal(r.me.quests.filter((q) => q.group === 'durood').length, 5 + (FRI() ? 1 : 0));
  assert.equal((await api('POST', '/api/log', { token, body: { count: 0 } })).error, 'bad_count');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 1.5 } })).error, 'bad_count');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 999999 } })).error, 'bad_count');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 50_001 } })).error, 'bad_count', 'one submission can never exceed the daily limit');
  assert.equal((await api('POST', '/api/log', { token, body: { count: 49_000 } })).added, 49_000); // 50,000 for the day
  assert.equal((await api('POST', '/api/log', { token, body: { count: 1 } })).error, 'daily_cap');
  assert.equal((await api('GET', '/api/me')).status, 401);
});

test('referral tree: full-depth team totals, delayed referral reward, no opt-out', async () => {
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
  assert.equal((await api('GET', '/api/me', { token: b.token })).xp, 200 + 500 + 250 + 100 + 5 + FRI()); // own 200, c's first log, invite quest, goal quest, streak day 1

  const team = await api('GET', '/api/team', { token: a.token });
  assert.equal(team.total, 900);
  assert.equal(team.direct[0].username, 'child_b');
  assert.equal(team.direct[0].team, 900);

  const teams = await api('GET', '/api/leaderboard?type=teams&period=week', { token: a.token });
  assert.equal(teams.rows[0].username, 'root_a');
  assert.equal(teams.rows[0].score, 900);

  // there is no opt-out: the inviter sees the invitee's counts
  const dir = await api('GET', '/api/team', { token: b.token });
  assert.equal(dir.direct[0].total, 700);
  assert.equal(dir.direct[0].username, 'grand_c');
  const users = await api('GET', '/api/leaderboard?type=users&period=week', { token: a.token });
  assert.ok(users.rows.some((r) => r.username === 'grand_c'));
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
  assert.equal(done.xpGained, CFG.lectureXp);
  assert.ok(done.newBadges.includes('scholar1'));
  assert.equal((await api('POST', `/api/lectures/${lec.id}/complete`, { token })).already, true);

  const c1 = await api('POST', '/api/circle/claim', { token });
  assert.equal(c1.xpGained, 300);
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
  assert.equal(pub.pending, 50_000, 'the 50,000 day above the 20,000 line is on hold, not lost');

  db.prepare("UPDATE users SET total = total + 1000, xp = xp + 7 WHERE username = 'retrier'").run();
  db.prepare("UPDATE users SET team_total = team_total - 5 WHERE username = 'root_a'").run();
  db.prepare("UPDATE daily SET count = count + 1 WHERE user_id = (SELECT id FROM users WHERE username = 'reciter')").run();
  const bad = audit();
  assert.equal(bad.ok, false);
  assert.deepEqual([...new Set(bad.problems.map((p) => p.kind))].sort(), ['daily', 'national', 'team_total', 'user_total', 'xp']);

  const fixed = audit({ fix: true });
  assert.equal(fixed.fixed, true);
  assert.deepEqual(audit().problems, []);
});

test('durood milestones and the weekly goal quest pay once; sunnah/seerah rewards stay small', async () => {
  const { token, me } = await signup('milestoner');
  await api('PATCH', '/api/me', { token, body: { dailyGoal: 100 } });
  const r = await api('POST', '/api/log', { token, body: { count: 10_000 } });
  assert.ok(r.newBadges.includes('d10k'));
  // 10,000 durood + d1k 100 + d10k 500 + daily goal 100 + weekly goal (700) 300
  assert.equal(r.xpGained, 10_000 + 100 + 500 + 100 + 300 + 5 + FRI());
  const again = await api('POST', '/api/log', { token, body: { count: 50 } });
  assert.equal(again.xpGained, 50); // nothing is paid twice
  const { CFG } = await import('../server/game.js');
  assert.ok(CFG.sunnahXp + CFG.likeCap * CFG.likeXp + CFG.circleXp < 1000);
  assert.deepEqual(audit().problems, []);
});

test('collective milestones reward only what invitees recited, not your own durood twice', async () => {
  const lead = await signup('lead_m');
  const mem = await signup('member_m');
  await api('PATCH', '/api/me', { token: mem.token, body: {} });
  const own = await api('POST', '/api/log', { token: lead.token, body: { count: 10_000 } });
  assert.ok(!own.newBadges.includes('caravan10k'));
  // member joined without a referral here, so link them properly via a fresh invitee
  const kid = await signup('kid_m', 'lead_m');
  const k = await api('POST', '/api/log', { token: kid.token, body: { count: 10_000 } });
  assert.ok(!k.newBadges.includes('caravan10k')); // the invitee's own badge is personal
  const meLead = await api('GET', '/api/me', { token: lead.token });
  assert.ok(meLead.badges.includes('caravan10k')); // the leader earned it from the invitee's durood
  assert.deepEqual(audit().problems, []);
});
