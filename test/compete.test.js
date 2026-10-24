import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';
process.env.MAX_DAILY_NEW = '50000';

const { createServer } = await import('../server/index.js');
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
const signup = (username, invite = 'TESTFOUND', cityId = LAHORE) => {
  n += 1;
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0308${String(9000000 + n)}`, password: 'secret1', cityId, invite } });
};
const log = (u, count) => api('POST', '/api/log', { token: u.token, body: { count, rid: crypto.randomUUID() } });
const uid = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
// writes durood for a past day straight into the ledger and its caches, consistently
function seed(username, daysAgo, count) {
  const id = uid(username), day = dayStr(dayNum(dayOf()) - daysAgo);
  if (db.prepare('SELECT total FROM users WHERE id = ?').get(id).total === 0) db.prepare('UPDATE users SET tree_active = tree_active + 1 WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ? AND depth > 0)').run(id);
  db.prepare('INSERT INTO entries (user_id, day, count, rid, created_at) VALUES (?,?,?,?,?)').run(id, day, count, `seed-${username}-${daysAgo}-${crypto.randomUUID()}`, Date.now());
  db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count').run(id, day, count);
  db.prepare('UPDATE users SET total = total + ?, xp = xp + ? WHERE id = ?').run(count, count, id);
  db.prepare('UPDATE users SET team_total = team_total + ? WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ?)').run(count, id);
  db.prepare('INSERT INTO day_totals (day, total) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET total = total + excluded.total').run(day, count);
}
const age = (username, days = 40) => db.prepare('UPDATE users SET created_day = ? WHERE username = ?').run(dayStr(dayNum(dayOf()) - days), username);

test('city boards: total, average and growth, only for cities with 5 members who recited this week, my city marked', async () => {
  const lah = [], mul = [];
  for (let i = 0; i < 6; i++) { lah.push(await signup(`cl_${i}`, 'TESTFOUND', LAHORE)); await log(lah[i], 100 + i * 10); }
  for (let i = 0; i < 5; i++) { mul.push(await signup(`cm_${i}`, 'TESTFOUND', MULTAN)); await log(mul[i], 400); }
  const few = []; for (let i = 0; i < 3; i++) { few.push(await signup(`ck_${i}`, 'TESTFOUND', KARACHI)); await log(few[i], 5000); }
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
  const mk = async (prefix, cityId, count, per) => { const out = []; for (let i = 0; i < count; i++) { const u = await signup(`${prefix}_${i}`, 'TESTFOUND', cityId); out.push(u); const id = uid(`${prefix}_${i}`); db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,?)').run(id, prev, per); } return out; };
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
  const items = (await api('GET', '/api/feed', { token: a[0].token })).items.filter((i) => i.type === 'city');
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

test('a caravan of three or more keeps a streak for every day half its members recited; badges at 7 and 30', async () => {
  const owner = await signup('kw_owner'), a = await signup('kw_a', 'kw_owner'), b = await signup('kw_b', 'kw_owner'), c = await signup('kw_c', 'kw_owner');
  for (const u of ['kw_owner', 'kw_a', 'kw_b', 'kw_c']) age(u);
  assert.equal(compete.karwanStatus(uid('kw_owner')).active, true);
  const small = await signup('kw_small'), only = await signup('kw_only', 'kw_small');
  assert.equal(compete.karwanStatus(uid('kw_small')).active, false, 'two people is not a caravan streak');
  for (let d = 1; d <= 6; d++) { seed('kw_owner', d, 100); seed('kw_a', d, 100); }   // 2 of 4 recited on each of the last 6 days
  await log(owner, 100);                                                        // today: 1 of 4, not yet half
  let ks = compete.karwanStatus(uid('kw_owner'));
  assert.equal(ks.streak, 6, 'today is not yet half, but it does not break the streak either');
  assert.equal(ks.today, 1); assert.deepEqual(ks.missing.sort(), ['kw_a', 'kw_b', 'kw_c']);
  await log(a, 100);                                                            // 2 of 4 today
  ks = compete.karwanStatus(uid('kw_owner'));
  assert.equal(ks.streak, 7);
  assert.ok((await api('GET', '/api/me', { token: owner.token })).badges.includes('karwan7'), 'the 7-day badge');
  assert.equal((await api('GET', '/api/team', { token: owner.token })).karwan.streak, 7);
  seed('kw_b', 3, 100); seed('kw_c', 3, 100);                                  // a day with 4 of 4 does not change the count
  assert.equal(compete.karwanStatus(uid('kw_owner')).streak, 7);
  db.prepare('DELETE FROM daily WHERE user_id = ? AND day = ?').run(uid('kw_a'), dayStr(dayNum(dayOf()) - 2));
  db.prepare('DELETE FROM daily WHERE user_id = ? AND day = ?').run(uid('kw_owner'), dayStr(dayNum(dayOf()) - 2));
  assert.equal(compete.karwanStatus(uid('kw_owner')).streak, 2, 'a missed day breaks it: today and yesterday only');
  assert.ok(b.token && c.token && small.token && only.token);
});

test('people in a Qabila who recited are counted for Qabila badges, and the audit agrees', async () => {
  const root = await signup('qb_root');
  for (let i = 0; i < 10; i++) { const u = await signup(`qb_${i}`, i < 5 ? 'qb_root' : 'qb_0'); await log(u, 10); }
  const me = await api('GET', '/api/me', { token: root.token });
  assert.ok(me.badges.includes('qabila10'), '10 people under me, at any depth');
  assert.ok(!me.badges.includes('qabila50'));
  assert.deepEqual(audit().problems.filter((p) => p.kind === 'tree_active'), []);
  db.prepare("UPDATE users SET tree_active = tree_active + 1 WHERE username = 'qb_root'").run();
  assert.ok(audit().problems.some((p) => p.kind === 'tree_active'));
  db.prepare("UPDATE users SET tree_active = tree_active - 1 WHERE username = 'qb_root'").run();
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

test('caravan names are unique and share one namespace with usernames', async () => {
  const a = await signup('cn_a'), b = await signup('cn_b');
  const name = (u, n) => api('PUT', '/api/caravan/name', { token: u.token, body: { name: n } });
  assert.equal((await name(a, 'cn_b')).error, 'caravan_name_taken');      // a member's username
  assert.equal((await name(a, 'cn_a')).error, 'caravan_name_taken');      // my own username too
  assert.equal((await name(a, 'ab')).error, 'bad_caravan_name');
  assert.equal((await name(a, 'admin')).error, 'bad_caravan_name');
  assert.equal((await name(a, 'Noor_Caravan')).me.caravanName, 'Noor_Caravan');
  assert.equal((await name(b, 'noor_caravan')).error, 'caravan_name_taken'); // case-insensitive
  assert.equal((await name(a, 'Noor_Caravan')).me.caravanName, 'Noor_Caravan'); // saving the same name again is fine
  assert.equal((await api('GET', '/api/caravan-name-check?u=noor_caravan', { token: b.token })).ok, false);
  // nobody can register a username that a caravan already uses
  const reg = await api('POST', '/api/register', { body: { username: 'noor_caravan', email: 'x1@x.pk', phone: '03111111111', password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
  assert.equal(reg.error, 'username_taken');
  assert.equal((await api('GET', '/api/username-check?u=noor_caravan')).ok, false);
  assert.equal((await name(a, '')).me.caravanName, null);                  // clearing frees the name
  assert.equal((await name(b, 'noor_caravan')).me.caravanName, 'noor_caravan');
});
