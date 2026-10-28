import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.MAX_DAILY_NEW = '50000';

const { createServer } = await import('../server/index.js');
(await import('./helpers.js')).seedCaravan();
const { audit } = await import('../server/audit.js');
const { db } = await import('../server/db.js');
const { dayOf, dayNum, dayStr, weekStart, specialToday, CFG } = await import('../server/game.js');
const compete = await import('../server/compete.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const admin = { 'x-admin-key': 'test-admin' };
const LAHORE = 1172451, KARACHI = 1174872, MULTAN = 1169825;
const signup = (username, invite = 'testcv', cityId = LAHORE) => {
  n += 1;
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0308${String(9000000 + n)}`, password: 'secret1', cityId, invite } });
};
const log = (u, count) => api('POST', '/api/log', { token: u.token, body: { count, rid: crypto.randomUUID() } });
const uid = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
// writes durood for a past day straight into the ledger and its caches, consistently
function seed(username, daysAgo, count) {
  const id = uid(username), day = dayStr(dayNum(dayOf()) - daysAgo);
  db.prepare('INSERT INTO entries (user_id, day, count, rid, created_at) VALUES (?,?,?,?,?)').run(id, day, count, `seed-${username}-${daysAgo}-${crypto.randomUUID()}`, Date.now());
  db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count').run(id, day, count);
  db.prepare('UPDATE users SET total = total + ?, xp = xp + ? WHERE id = ?').run(count, count, id);
  db.prepare('INSERT INTO day_totals (day, total) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET total = total + excluded.total').run(day, count);
}
const age = (username, days = 40) => db.prepare('UPDATE users SET created_day = ? WHERE username = ?').run(dayStr(dayNum(dayOf()) - days), username);

test('city boards: total, average and growth, only for cities with 5 members who recited this week, my city marked', async () => {
  const lah = [], mul = [];
  for (let i = 0; i < 6; i++) { lah.push(await signup(`cl_${i}`, 'testcv', LAHORE)); await log(lah[i], 100 + i * 10); }
  for (let i = 0; i < 5; i++) { mul.push(await signup(`cm_${i}`, 'testcv', MULTAN)); await log(mul[i], 400); }
  const few = []; for (let i = 0; i < 3; i++) { few.push(await signup(`ck_${i}`, 'testcv', KARACHI)); await log(few[i], 5000); }
  const board = async (metric) => (await api('GET', `/api/leaderboard?type=cities&metric=${metric}`, { token: lah[0].token })).rows;
  const total = await board('total');
  assert.deepEqual(total.map((r) => r.username), ['Multan', 'Lahore'], 'Karachi has only 3 active members, so it is not listed');
  assert.equal(total[0].score, 2000);
  assert.equal(total[1].score, 100 + 110 + 120 + 130 + 140 + 150);
  const avg = await board('average');
  assert.equal(avg[0].username, 'Multan'); assert.equal(avg[0].score, 400);
  assert.equal(avg[1].score, Math.round(750 / 6));
  const grow = await board('growth');
  assert.equal(grow.find((r) => r.username === 'Lahore').score, 750, 'nothing last week, so the whole week is growth');
  assert.equal(total.find((r) => r.me).username, 'Lahore');
  assert.equal(total[1].members, 6);
});

test('the weekly close awards the city podium, once, and the feed announces it', async () => {
  // last week: Lahore 6 members, Multan 5 members, Karachi 5 members, Quetta (id from search) 5 members
  const prev = weekStart(dayStr(dayNum(weekStart()) - 7));
  db.prepare("DELETE FROM settings WHERE key LIKE 'week_closed:%'").run(); // earlier logging already closed the (empty) weeks
  const mk = async (prefix, cityId, count, per) => { const out = []; for (let i = 0; i < count; i++) { const u = await signup(`${prefix}_${i}`, 'testcv', cityId); out.push(u); const id = uid(`${prefix}_${i}`); db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,?)').run(id, prev, per); } return out; };
  const a = await mk('pa', 1174872, 5, 1000), b = await mk('pb', 1169825, 5, 600), c = await mk('pc', 1172451, 5, 300), d = await mk('pd', 1168197, 5, 100);
  const closed = compete.ensureWeekClosed();
  assert.equal(closed.week, prev);
  assert.equal(closed.cities, 3, 'only the top three');
  const podium = db.prepare('SELECT city_id, rank FROM city_weeks WHERE week = ? ORDER BY rank').all(prev).map((r) => r.city_id);
  assert.equal(podium[0], 1174872, 'Karachi won on average per active member');
  const badges = async (u) => (await api('GET', '/api/me', { token: u.token })).badges;
  assert.ok((await badges(a[0])).includes('city_champion') && (await badges(a[0])).includes('city_podium'));
  assert.ok((await badges(b[0])).includes('city_podium') && !(await badges(b[0])).includes('city_champion'));
  assert.ok(!(await badges(d[0])).includes('city_podium'), 'fourth place gets nothing');
  assert.equal(compete.ensureWeekClosed(), null, 'closing twice does nothing');
  // everyone shares one caravan here, so its milestones fill the first pages: read on until the city lines turn up
  const items = [];
  for (let page = await api('GET', '/api/feed', { token: a[0].token }); ; page = await api('GET', `/api/feed?before=${page.next}`, { token: a[0].token })) {
    items.push(...page.items.filter((i) => i.type === 'city'));
    if (!page.next) break;
  }
  assert.equal(items.find((i) => i.rank === 1).label, 'Karachi, Sindh, Pakistan');
  assert.ok(c.length === 5);
});

test('leagues: the first durood of a week joins a group of at most 30; promotion and demotion happen at the weekly close', async () => {
  const users = [];
  for (let i = 0; i < 32; i++) { users.push(await signup(`lg_${i}`)); await log(users[i], 10); }
  const sizes = db.prepare('SELECT grp, COUNT(*) n FROM league_members WHERE week = ? AND user_id IN (SELECT id FROM users WHERE username LIKE ?) GROUP BY grp').all(weekStart(), 'lg_%');
  assert.ok(sizes.every((s) => s.n <= compete.LEAGUE_SIZE), 'no group is bigger than 30');
  assert.ok(sizes.length >= 1);
  const view = await api('GET', '/api/league', { token: users[0].token });
  assert.equal(view.joined, true); assert.equal(view.tier, 0);
  assert.ok(view.rows.some((r) => r.me));

  // a closed week: 12 members in one group with distinct scores
  const prev = weekStart(dayStr(dayNum(weekStart()) - 7));
  const grp = 900, ids = [];
  for (let i = 0; i < 12; i++) {
    const u = await signup(`lc_${i}`); ids.push(u);
    const id = uid(`lc_${i}`);
    db.prepare('UPDATE users SET league = 1 WHERE id = ?').run(id);   // all Silver
    db.prepare('INSERT INTO league_members (week, user_id, tier, grp) VALUES (?,?,?,?)').run(prev, id, 1, grp);
    db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,?)').run(id, prev, (i + 1) * 100);
  }
  db.prepare("DELETE FROM settings WHERE key LIKE 'week_closed:%'").run();
  const xpBefore = (await api('GET', '/api/me', { token: ids[11].token })).xp;
  compete.ensureWeekClosed();
  const tierOf = (name) => db.prepare('SELECT league FROM users WHERE username = ?').get(name).league;
  assert.equal(tierOf('lc_11'), 2, 'the best moves up to Gold');
  assert.equal(tierOf('lc_8'), 2, 'top 4 of 12 move up');
  assert.equal(tierOf('lc_7'), 1, 'the middle stays');
  assert.equal(tierOf('lc_0'), 0, 'the bottom 4 move down to Bronze');
  assert.equal(tierOf('lc_3'), 0);
  assert.equal(tierOf('lc_4'), 1);
  const me = await api('GET', '/api/me', { token: ids[11].token });
  assert.ok(me.badges.includes('league_gold'));
  assert.equal(db.prepare("SELECT xp FROM events WHERE user_id = ? AND kind = 'league'").get(uid('lc_11')).xp, 200, 'league points: 100 x the new tier');
  assert.equal(db.prepare("SELECT xp FROM events WHERE user_id = ? AND kind = 'milestone' AND ref = 'league_gold'").get(uid('lc_11')).xp, 300);
  assert.ok(me.xp > xpBefore);
  const view2 = await api('GET', '/api/league', { token: ids[11].token });
  assert.equal(view2.last.result, 'up'); assert.equal(view2.last.rank, 1);
  assert.deepEqual(audit().problems.filter((p) => !['xp', 'user_total', 'team_total', 'daily', 'national', 'day_totals'].includes(p.kind)), []);
});

test('special days: Fridays automatically, other days added by the admin; a bonus quest and the live counter', async () => {
  const friday = '2031-03-14';
  assert.equal(new Date(`${friday}T00:00:00Z`).getUTCDay(), 5);
  assert.equal(specialToday(friday).nameEn, 'Jumu‘ah');
  assert.equal(specialToday('2031-03-13'), null);
  assert.equal((await api('POST', '/api/admin/special-days', { headers: admin, body: { day: 'x', name_en: 'y' } })).error, 'bad_special');
  await api('POST', '/api/admin/special-days', { headers: admin, body: { day: dayOf(), name_en: '12 Rabi ul Awwal', name_ur: '12 ربیع الاول' } });
  assert.equal(specialToday(dayOf()).nameEn, '12 Rabi ul Awwal');
  const u = await signup('sp_user');
  const me = await api('GET', '/api/me', { token: u.token });
  assert.equal(me.special.nameEn, '12 Rabi ul Awwal');
  assert.ok(me.quests.some((q) => q.id === 'special' && q.xp === CFG.specialXp && !q.done));
  const r = await log(u, 100);
  assert.ok(r.me.quests.find((q) => q.id === 'special').done, 'reaching the goal completes it');
  const pub = await api('GET', '/api/public');
  assert.ok(pub.today >= 100 && pub.membersToday >= 1, 'the live counter');
  assert.ok((await api('GET', '/api/admin/special-days', { headers: admin })).days.some((d) => d.day === dayOf()));
  await api('DELETE', `/api/admin/special-days/${dayOf()}`, { headers: admin });
  assert.equal(specialToday(dayOf())?.nameEn === '12 Rabi ul Awwal', false);
});

test('a member below the top 50 of the people board still sees their own rank and total', async () => {
  const { logDurood } = await import('../server/game.js');
  const ids = [];
  for (let i = 0; i < 52; i++) ids.push((await signup(`deep_${i}`)).token);
  const uidOf = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  for (let i = 0; i < 52; i++) logDurood(uidOf(`deep_${i}`), 2000 - i * 10, `deep-rid-${i}-xxxx`);
  const last = await api('GET', '/api/leaderboard?type=users&period=all', { token: ids[51] });
  assert.ok(!last.rows.some((r) => r.me));
  assert.equal(last.you.score, 2000 - 510);
  assert.ok(last.you.rank >= 52);
  const wk = await api('GET', '/api/leaderboard?type=users&period=week', { token: ids[51] });
  assert.equal(wk.you.score, 2000 - 510);
  const top = await api('GET', '/api/leaderboard?type=users&period=all', { token: ids[0] });
  assert.equal(top.you, undefined); // already on the board
});

test('people rankings hide other members behind made-up names; a signed ref opens the real profile', async () => {
  const { readRef, aliasFor } = await import('../server/auth.js');
  const uidOf = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  const a = await signup('an_a'), b = await signup('an_b');
  await api('PUT', '/api/me/profile', { token: b.token, body: { displayName: 'Bilal Khan', bio: '' } });
  await api('POST', '/api/log', { token: a.token, body: { count: 80_000, rid: crypto.randomUUID() } });
  await api('POST', '/api/log', { token: b.token, body: { count: 90_000, rid: crypto.randomUUID() } });
  for (const q of ['week', 'all', 'challenge']) {
    const rows = (await api('GET', `/api/leaderboard?type=users&period=${q}`, { token: a.token })).rows;
    const mine = rows.find((r) => r.me);
    if (mine) assert.equal(mine.username, 'an_a', 'you see your own username');
    const other = rows.find((r) => r.ref && readRef(r.ref) === uidOf('an_b'));
    if (q === 'challenge' && !other) continue; // outside the window in this test's schedule
    assert.ok(other, q);
    assert.equal(other.username, aliasFor(uidOf('an_b')), 'a made-up name, always the same for the same member');
    assert.notEqual(other.username, 'an_b');
    assert.equal(other.displayName, '', 'no display name');
    assert.equal(other.avatar, null, 'no picture');
    assert.equal(other.me, false);
    assert.ok(!JSON.stringify(rows).includes('an_b') && !JSON.stringify(rows).includes('Bilal'), 'the real name is nowhere in the reply');
  }
  const rows = (await api('GET', '/api/leaderboard?type=users&period=week', { token: a.token })).rows;
  const ref = rows.find((r) => r.ref && readRef(r.ref) === uidOf('an_b')).ref;
  const prof = await api('GET', `/api/members/ref/${ref}`, { token: a.token });
  assert.equal(prof.username, 'an_b', 'tapping the row shows the real profile');
  assert.equal(prof.displayName, 'Bilal Khan');
  assert.equal((await api('GET', `/api/members/ref/${ref.slice(0, -1)}x`, { token: a.token })).status, 404, 'a forged ref is refused');
  assert.equal((await api('GET', '/api/members/ref/zzz.abc', { token: a.token })).status, 404);
  assert.equal((await api('GET', `/api/members/ref/${ref}`)).status, 401, 'signed in only');
  // the alias is the same for everyone looking, and different members get different aliases
  const seenByB = (await api('GET', '/api/leaderboard?type=users&period=week', { token: b.token })).rows.find((r) => r.ref && readRef(r.ref) === uidOf('an_a'));
  assert.equal(seenByB.username, aliasFor(uidOf('an_a')));
  assert.notEqual(aliasFor(uidOf('an_a')), aliasFor(uidOf('an_b')));
});
