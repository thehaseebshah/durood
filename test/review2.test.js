// Regression tests for the adversarial review: XP economy, flags, leagues, lecture delete, phone parsing, streak display.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';
process.env.MAX_DAILY_NEW = '50000';

const { createServer, normalizePhone } = await import('../server/index.js');
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
const signup = (username, invite = 'TESTFOUND') => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0306${String(3000000 + n)}`, password: 'secret1', cityId: 1172451, invite } }); };
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

test('a new account with a big day is held for a look; a cleared flag is raised again only for a clearly bigger day', async () => {
  const old = FLAG.newHigh; FLAG.newHigh = 5000;
  try {
    const u = await signup('nf_u');
    await log(u, 6000);
    assert.equal(db.prepare('SELECT held FROM users WHERE username = ?').get('nf_u').held, 1);
    const f = db.prepare("SELECT * FROM flags WHERE user_id = ?").get(uid('nf_u'));
    assert.equal(f.day_total, 6000);
    await api('POST', `/api/admin/flags/${f.id}`, { headers: admin, body: { action: 'clear' } });
    assert.equal(db.prepare('SELECT held FROM users WHERE username = ?').get('nf_u').held, 0);
    await log(u, 1000);                                          // 7,000 is not 1.5x the cleared 6,000
    assert.equal(db.prepare('SELECT held FROM users WHERE username = ?').get('nf_u').held, 0);
    await log(u, 4000);                                          // 11,000 is
    assert.equal(db.prepare('SELECT held FROM users WHERE username = ?').get('nf_u').held, 1);
    // an established account is not caught by the new-account rule
    const v = await signup('nf_old'); age('nf_old', 30);
    await log(v, 6000);
    assert.equal(db.prepare('SELECT held FROM users WHERE username = ?').get('nf_old').held, 0);
  } finally { FLAG.newHigh = old; }
});

test('an inviter is paid only when the invitee has really recited, not for a sign-up that logs one durood', async () => {
  const a = await signup('rf_a');
  const b = await signup('rf_b', 'rf_a');
  const base0 = await xp(a);
  await log(b, 1);
  assert.equal(await xp(a), base0, 'one durood earns the inviter nothing');
  await log(b, CFG.referralMin - 1);
  const paid = (await xp(a)) - base0;
  assert.ok(paid >= CFG.referralXp, 'the reward arrives when the invitee reaches the minimum (plus the weekly invite quest)');
  await log(b, 50);
  assert.equal((await xp(a)) - base0, paid, 'and only once');
  const inviteQuest = (await api('GET', '/api/me', { token: a.token })).quests.find((q) => q.id === 'invite');
  assert.equal(inviteQuest.cur, 1);
  assert.deepEqual(audit().problems, []);
});

test('the invite quest ignores sign-ups that never recited', async () => {
  const a = await signup('iq_a');
  await signup('iq_b', 'iq_a');
  assert.equal((await api('GET', '/api/me', { token: a.token })).quests.find((q) => q.id === 'invite').cur, 0);
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

test('deleting a lecture with comments, replies and likes works, all or nothing', async () => {
  const lec = await api('POST', '/api/admin/lectures', { headers: admin, body: { youtube_id: 'dQw4w9WgXcQ', title_en: 'To delete', min_seconds: 30 } });
  const a = await signup('ld_a'), b = await signup('ld_b');
  db.prepare("INSERT INTO lecture_starts (user_id, lecture_id, started_at) VALUES (?,?,1)").run(uid('ld_a'), lec.id);
  await api('POST', `/api/lectures/${lec.id}/complete`, { token: a.token });
  db.prepare('UPDATE lecture_starts SET started_at = 1').run();
  const done = await api('POST', `/api/lectures/${lec.id}/complete`, { token: a.token });
  assert.ok(done.xpGained >= 0);
  const c = await api('POST', `/api/lectures/${lec.id}/comment`, { token: a.token, body: { text: 'nice' } });
  if (c.id) {
    await api('POST', '/api/like', { token: b.token, body: { kind: 'comment', id: c.id } });
    await api('POST', '/api/replies', { token: b.token, body: { kind: 'comment', id: c.id, text: 'agreed' } });
  }
  assert.equal((await api('DELETE', `/api/admin/lectures/${lec.id}`, { headers: admin })).ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lectures WHERE id = ?').get(lec.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lecture_comments WHERE lecture_id = ?').get(lec.id).n, 0);
  assert.deepEqual(audit().problems, []);
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
