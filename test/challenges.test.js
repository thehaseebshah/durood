// More than one 40-day challenge: scheduled ahead by an admin, the finished one filed away with its result.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.MAX_DAILY_NEW = '50000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';

const { createServer } = await import('../server/index.js');
const { db } = await import('../server/db.js');
const { dayOf, challengeSummary } = await import('../server/game.js');

let server, base;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const A = { 'x-admin-key': 'test-admin' };
const admin = (m, p, body) => api(m, '/api/admin' + p, { headers: A, body });
const shift = (day, d) => new Date(Date.parse(day + 'T00:00:00Z') + d * 86400e3).toISOString().slice(0, 10);

test('plans are validated: dates in the past, bad lengths, overlaps with each other and the running challenge', async () => {
  const today = dayOf();
  await admin('POST', '/challenge', { start: today, days: 40, target: 100_000_000 });
  const plan = (b) => admin('POST', '/challenge/plans', b);
  assert.equal((await plan({ start: shift(today, -1), days: 40 })).error, 'challenge_past_date');
  assert.equal((await plan({ start: 'soon', days: 40 })).error, 'bad_date');
  assert.equal((await plan({ start: shift(today, 100), days: 0 })).error, 'bad_days');
  assert.equal((await plan({ start: shift(today, 100), days: 40, target: 5 })).error, 'bad_target');
  assert.equal((await plan({ start: shift(today, 39), days: 40 })).error, 'challenge_overlap', 'inside the running challenge');
  const ok = await plan({ start: shift(today, 40), days: 30, nameEn: '  Ramadan  challenge ', nameUr: 'رمضان' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.plans.map((p) => [p.nameEn, p.start, p.days]), [['Ramadan challenge', shift(today, 40), 30]]);
  assert.equal((await plan({ start: shift(today, 60), days: 40 })).error, 'challenge_overlap', 'overlaps the plan');
  const two = await plan({ start: shift(today, 70), days: 10 });
  assert.equal(two.status, 200);
  const rm = await admin('DELETE', `/challenge/plans/${two.plans[1].id}`);
  assert.equal(rm.plans.length, 1);
  assert.equal(challengeSummary().next.nameEn, 'Ramadan challenge', 'members are told what comes next');
  db.prepare('DELETE FROM challenge_plans').run();
});

test('on the start day the finished challenge is filed away with its result and the plan takes over', async () => {
  const today = dayOf();
  const mk = await api('POST', '/api/register', { body: { username: 'chm_a', email: 'chm_a@x.pk', phone: '03031234567', password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get('chm_a').id;
  const old = shift(today, -50);
  const put = (day, count) => {
    db.prepare('INSERT INTO entries (user_id, day, count, rid, created_at) VALUES (?,?,?,?,?)').run(id, day, count, crypto.randomUUID(), Date.now());
    db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count').run(id, day, count);
    db.prepare('INSERT INTO day_totals (day, total) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET total = total + excluded.total').run(day, count);
  };
  await admin('POST', '/challenge', { start: old, days: 40, target: 100_000_000 });
  put(shift(old, 2), 500); put(shift(old, 45), 77);   // the second is after the 40 days
  assert.equal((await admin('POST', '/challenge/plans', { start: today, days: 20, target: 2_000_000, nameEn: 'Second' })).status, 200);
  const s = challengeSummary();
  assert.equal(s.n, 2);
  assert.equal(s.nameEn, 'Second');
  assert.equal(s.start, today);
  assert.equal(s.days, 20);
  assert.equal(s.target, 2_000_000);
  assert.equal(s.total, 0, 'the new challenge starts from nothing');
  assert.equal(s.next, null);
  const past = (await api('GET', '/api/challenges/past', { token: mk.token })).past;
  assert.equal(past.length, 1);
  assert.equal(past[0].n, 1);
  assert.equal(past[0].total, 500, 'final figures cover its own 40 days only');
  assert.equal(past[0].end, shift(old, 39));
  assert.deepEqual(past[0].top.map((t) => [t.username, t.score]), [['chm_a', 500]]);
  assert.equal((await api('GET', '/api/challenges/past')).status, 401);
  assert.equal((await api('POST', '/api/admin/challenge/plans', { body: { start: today } })).status, 403);
});

test('naming the running challenge; a blank name goes back to the default', async () => {
  const r = await admin('PUT', '/challenge/name', { nameEn: 'Hajj 40', nameUr: '' });
  assert.equal(r.summary.nameEn, 'Hajj 40');
  assert.equal((await admin('PUT', '/challenge/name', { nameEn: '', nameUr: '' })).summary.nameEn, '');
});
