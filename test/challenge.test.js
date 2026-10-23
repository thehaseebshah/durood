import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';

const { createServer } = await import('../server/index.js');
const { db } = await import('../server/db.js');
const { dayOf, challengeSummary } = await import('../server/game.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  if (path === '/api/log' && body && body.rid === undefined) body = { ...body, rid: crypto.randomUUID() };
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const A = { 'x-admin-key': 'test-admin' };
const admin = (m, p, body) => api(m, '/api/admin' + p, { headers: A, body });
const signup = (username, invite = 'TESTFOUND') => {
  n += 1;
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0303${String(4000000 + n)}`, password: 'secret1', invite } });
};
const shift = (day, d) => new Date(Date.parse(day + 'T00:00:00Z') + d * 86400e3).toISOString().slice(0, 10);
const uid = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
function seedDay(username, daysAgo, count) {
  const id = uid(username), day = shift(dayOf(), -daysAgo);
  db.prepare('INSERT INTO entries (user_id, day, count, rid, created_at) VALUES (?,?,?,?,?)').run(id, day, count, `seed-${username}-${daysAgo}-${crypto.randomUUID()}`, Date.now());
  db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count').run(id, day, count);
  db.prepare('UPDATE users SET total = total + ?, xp = xp + ? WHERE id = ?').run(count, count, id);
  db.prepare('UPDATE users SET team_total = team_total + ? WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ?)').run(count, id);
}
const clearDaily = () => { db.exec('DELETE FROM daily'); db.exec('UPDATE users SET total = 0, team_total = 0, xp = 0'); };

test('the clock waits for the first member, starts on their day, and a later sign-up does not move it', async () => {
  assert.equal(challengeSummary().state, 'waiting');
  assert.equal(challengeSummary().target, 100_000_000, '10 crore');
  assert.equal(challengeSummary().days, 40);
  await signup('first_member');
  assert.equal(challengeSummary().start, dayOf());
  assert.equal(challengeSummary().state, 'running');
  assert.equal(challengeSummary().dayIndex, 1);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'challenge_start'").run(shift(dayOf(), -3));
  await signup('second_member');
  assert.equal(challengeSummary().start, shift(dayOf(), -3), 'only the first sign-up sets the start');
});

test('pace maths on day 10 of 40: needed today, ahead or behind, projection from the recent average', async () => {
  await admin('POST', '/challenge', { start: shift(dayOf(), -9), days: 40, target: 100_000_000 });
  clearDaily();
  for (let d = 9; d >= 1; d--) seedDay('first_member', d, 2_000_000);   // 18,000,000 before today
  seedDay('second_member', 0, 500_000);                                // reported today
  const c = (await api('GET', '/api/challenge', { token: (await api('POST', '/api/login', { body: { id: 'first_member', password: 'secret1' } })).token })).summary;
  assert.equal(c.state, 'running');
  assert.equal(c.dayIndex, 10);
  assert.equal(c.daysLeft, 31);
  assert.equal(c.total, 18_500_000);
  assert.equal(c.today, 500_000);
  assert.equal(c.plannedPerDay, 2_500_000);
  assert.equal(c.neededToday, Math.ceil((100_000_000 - 18_000_000) / 31), '(target - reported before today) / days left, rounded up');
  assert.equal(c.neededToday, 2_645_162);
  assert.equal(c.gap, 18_000_000 - 22_500_000, 'behind a straight line by 4.5 million at the start of today');
  assert.equal(c.projectedTotal, 18_000_000 + 2_000_000 * 31, 'the last 7 complete days averaged 2,000,000');
  assert.equal(c.remaining, 100_000_000 - 18_500_000);
  assert.equal(c.end, shift(dayOf(), 30));
});

test('on day 1 there is no projection yet, and being ahead gives a positive gap', async () => {
  await admin('POST', '/challenge', { start: dayOf() });
  clearDaily();
  seedDay('first_member', 0, 3_000_000);
  let c = challengeSummary();
  assert.equal(c.dayIndex, 1);
  assert.equal(c.projectedTotal, null);
  assert.equal(c.neededToday, 2_500_000);
  assert.equal(c.gap, 0);
  await admin('POST', '/challenge', { start: shift(dayOf(), -2) });
  clearDaily();
  seedDay('first_member', 2, 4_000_000); seedDay('first_member', 1, 4_000_000);   // 8M before today; plan says 5M
  c = challengeSummary();
  assert.equal(c.gap, 8_000_000 - 5_000_000);
});

test('upcoming, running, over and done states; counting continues after day 40', async () => {
  clearDaily();
  await admin('POST', '/challenge', { start: shift(dayOf(), 3) });
  let c = challengeSummary();
  assert.equal(c.state, 'upcoming');
  assert.equal(c.startsIn, 3);
  await admin('POST', '/challenge', { start: shift(dayOf(), -44) });
  seedDay('first_member', 5, 30_000_000);
  c = challengeSummary();
  assert.equal(c.state, 'over');
  assert.equal(c.daysOver, 5, 'day 45 of 40');
  assert.equal(c.short, 70_000_000);
  seedDay('first_member', 0, 1_000_000);
  assert.equal(challengeSummary().total, 31_000_000, 'the meter keeps counting after day 40');
  seedDay('first_member', 1, 70_000_000);
  c = challengeSummary();
  assert.equal(c.state, 'done');
  assert.equal(c.remaining, 0);
});

test('each crore is recorded when the total passes it and never un-happens, even if an edit lowers the total', async () => {
  await admin('POST', '/challenge', { start: shift(dayOf(), -5), clearMilestones: true });
  clearDaily();
  db.exec("DELETE FROM settings WHERE key LIKE 'ch_m_%' OR key = 'ch_done_at'");
  seedDay('second_member', 3, 9_999_000);
  const u = (await api('POST', '/api/login', { body: { id: 'first_member', password: 'secret1' } })).token;
  assert.equal(challengeSummary().milestones.length, 0);
  const r = await api('POST', '/api/log', { token: u, body: { count: 2000 } });       // crosses 1 crore
  assert.equal(r.me.pub.challenge.total, 10_001_000);
  let c = (await api('GET', '/api/challenge', { token: u })).summary;
  assert.equal(c.reached, 1);
  assert.equal(c.milestones[0].k, 1);
  const first = c.milestones[0].at;
  await api('POST', '/api/log', { token: u, body: { count: 500 } });
  c = (await api('GET', '/api/challenge', { token: u })).summary;
  assert.equal(c.milestones.length, 1, 'recorded once');
  assert.equal(c.milestones[0].at, first);
  const entry = (await api('GET', '/api/history', { token: u })).days[0].entries[0];
  await api('PATCH', `/api/entries/${entry.id}`, { token: u, body: { count: 1 } });  // an edit that takes the total back under a crore
  c = (await api('GET', '/api/challenge', { token: u })).summary;
  assert.ok(c.total < 10_000_000);
  assert.equal(c.crores, 0);
  assert.equal(c.reached, 1, 'the crore that was reached stays reached');
});

test('the finish is recorded once when the target is reached', async () => {
  await admin('POST', '/challenge', { start: dayOf(), target: 1_000_000, clearMilestones: true });
  clearDaily();
  const u = (await api('POST', '/api/login', { body: { id: 'second_member', password: 'secret1' } })).token;
  const v = (await api('POST', '/api/login', { body: { id: 'first_member', password: 'secret1' } })).token;
  // one member can report at most 500,000 a day, so two members share the million
  for (let i = 0; i < 5; i++) { await api('POST', '/api/log', { token: u, body: { count: 100_000 } }); await api('POST', '/api/log', { token: v, body: { count: 100_000 } }); }
  const c = (await api('GET', '/api/challenge', { token: u })).summary;
  assert.equal(c.state, 'done');
  assert.ok(c.doneAt > 0);
  const at = c.doneAt;
  await api('POST', '/api/log', { token: u, body: { count: 5 } });
  assert.equal((await api('GET', '/api/challenge', { token: u })).summary.doneAt, at, 'recorded once');
});

test('challenge boards cover the 40 days only and freeze after the end; all-time and week are unaffected', async () => {
  await admin('POST', '/challenge', { start: shift(dayOf(), -20), days: 10, target: 100_000_000, clearMilestones: true });
  clearDaily();
  const root = await signup('ch_root');
  const kid = await signup('ch_kid', 'ch_root');
  const out = await signup('ch_outside');
  seedDay('ch_root', 25, 777);           // before the challenge: not counted
  seedDay('ch_root', 15, 300);           // inside
  seedDay('ch_kid', 12, 200);            // inside (a day into the challenge from the start)
  seedDay('ch_outside', 5, 5000);        // after the 10-day window ended: frozen out
  const tok = root.token;
  const ind = await api('GET', '/api/leaderboard?type=users&period=challenge', { token: tok });
  const score = (rows, u) => rows.find((r) => r.username === u)?.score;
  assert.equal(score(ind.rows, 'ch_root'), 300);
  assert.equal(score(ind.rows, 'ch_kid'), 200);
  assert.equal(score(ind.rows, 'ch_outside'), undefined, 'activity after day 10 is outside the challenge boards');
  const teams = await api('GET', '/api/leaderboard?type=teams&period=challenge', { token: tok });
  assert.equal(score(teams.rows, 'ch_root'), 500, 'a caravan counts its members inside the window');
  const all = await api('GET', '/api/leaderboard?type=users&period=all', { token: tok });
  assert.equal(score(all.rows, 'ch_root'), 1077, 'all-time still counts everything');
  assert.ok(out.token);
});

test('admin sets the start date, length and target, with validation; members cannot', async () => {
  assert.equal((await api('POST', '/api/admin/challenge', { body: { days: 30 } })).status, 403);
  const ok = await admin('POST', '/challenge', { start: '2026-01-05', days: 30, target: 50_000_000 });
  assert.equal(ok.summary.start, '2026-01-05');
  assert.equal(ok.summary.days, 30);
  assert.equal(ok.summary.target, 50_000_000);
  assert.equal(ok.summary.end, '2026-02-03');
  assert.equal((await admin('POST', '/challenge', { start: '05/01/2026' })).error, 'bad_date');
  assert.equal((await admin('POST', '/challenge', { start: '2026-13-45' })).error, 'bad_date');
  assert.equal((await admin('POST', '/challenge', { days: 0 })).error, 'bad_days');
  assert.equal((await admin('POST', '/challenge', { days: 400 })).error, 'bad_days');
  assert.equal((await admin('POST', '/challenge', { target: 10 })).error, 'bad_target');
  assert.equal((await admin('GET', '/challenge')).summary.target, 50_000_000, 'rejected changes leave the settings alone');
  const me = await api('GET', '/api/me', { token: (await signup('pub_check')).token });
  assert.equal(me.pub.challenge.target, 50_000_000, 'members see the challenge in their profile data');
});
