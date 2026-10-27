// Regression tests for the adversarial review: XP economy, flags, leagues, lecture delete, phone parsing, streak display.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.MAX_DAILY_NEW = '50000';

const { createServer, normalizePhone } = await import('../server/index.js');
(await import('./helpers.js')).seedCaravan();
const { audit } = await import('../server/audit.js');
const { db } = await import('../server/db.js');
const { CFG, FLAG, dayOf, dayNum, dayStr, weekStart } = await import('../server/game.js');
const compete = await import('../server/compete.js');

let server, base, n = 0;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const admin = { 'x-admin-key': 'test-admin' };
const signup = (username, invite = 'testcv') => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0306${String(3000000 + n)}`, password: 'secret1', cityId: 1172451, invite } }); };
const log = (u, count) => api('POST', '/api/log', { token: u.token, body: { count, rid: crypto.randomUUID() } });
const xp = async (u) => (await api('GET', '/api/me', { token: u.token })).xp;
const uid = (name) => db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
const age = (name, days) => db.prepare('UPDATE users SET created_day = ? WHERE username = ?').run(dayStr(dayNum(dayOf()) - days), name);

test('logging a big number and editing it down gives back the quest XP it earned', async () => {
  const u = await signup('rv_u');
  await log(u, 700);                                   // pays durood plus the daily goal (100) and weekly goal (300) quests
  const high = await xp(u);
  assert.ok(high >= 700 + 100 + 300);
  const entry = (await api('GET', '/api/history', { token: u.token })).days[0].entries[0];
  await api('PATCH', `/api/entries/${entry.id}`, { token: u.token, body: { count: 1 } });
  assert.equal(await xp(u), 1, 'one durood, no quest XP left');
  assert.deepEqual(audit().problems, []);
  // an edit never pays quests (a later log does), so there is no way to bounce up and down for more
  const e2 = (await api('GET', '/api/history', { token: u.token })).days[0].entries[0];
  await api('PATCH', `/api/entries/${e2.id}`, { token: u.token, body: { count: 700 } });
  assert.equal(await xp(u), 700);
  assert.deepEqual(audit().problems, []);
});

test('the week is closed before the first durood of the new week, and weeks missed by downtime are caught up', async () => {
  db.prepare("DELETE FROM settings WHERE key LIKE 'week_closed:%'").run();
  const u = await signup('wk_u');
  await log(u, 10);
  const prev = dayStr(dayNum(weekStart()) - 7);
  assert.ok(db.prepare('SELECT 1 FROM settings WHERE key = ?').get(`week_closed:${prev}`), 'logging closed last week first');
  db.prepare("DELETE FROM settings WHERE key LIKE 'week_closed:%'").run();
  compete.ensureWeekClosed();
  const closed = db.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'week_closed:%'").get().n;
  assert.equal(closed, 4, 'the last four unclosed weeks are closed, oldest first');
  assert.equal(compete.ensureWeekClosed(), null, 'and nothing more happens when called again');
});

test('phone numbers: country code rules apply per country, a pasted full number is not doubled', () => {
  assert.equal(normalizePhone('0300 1234567'), '+923001234567');
  assert.equal(normalizePhone('03001234567', 'PK'), '+923001234567');
  assert.equal(normalizePhone('0300 123 4567', 'GB'), '+443001234567', 'a UK 03 number is not Pakistani');
  assert.equal(normalizePhone('07911 123456', 'GB'), '+447911123456');
  assert.equal(normalizePhone('447911123456', 'GB'), '+447911123456', 'the country code is not added twice');
  assert.equal(normalizePhone('919876543210', 'IN'), '+919876543210');
  assert.equal(normalizePhone('+44 (0)7911 123456'), '+447911123456', 'the bracketed trunk 0 is dropped');
  assert.equal(normalizePhone('+92 300 1234567'), '+923001234567');
  assert.equal(normalizePhone('123'), null);
});

test('the streak shown still counts when a shield would carry it over a missed day', async () => {
  const u = await signup('sh_u');
  const id = uid('sh_u');
  db.prepare('UPDATE users SET streak = 10, shields = 1, last_day = ? WHERE id = ?').run(dayStr(dayNum(dayOf()) - 2), id);
  assert.equal((await api('GET', '/api/me', { token: u.token })).streak, 10);
  db.prepare('UPDATE users SET shields = 0 WHERE id = ?').run(id);
  assert.equal((await api('GET', '/api/me', { token: u.token })).streak, 0);
});

test('the audit reads one snapshot, so logging during a check cannot raise a false alarm', async () => {
  const u = await signup('au_u');
  for (let i = 0; i < 20; i++) { await log(u, 5); assert.deepEqual(audit().problems, []); }
});
