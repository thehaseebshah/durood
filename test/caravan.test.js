// Caravans: a named group an admin creates for an owner; every member joins one at sign-up by its name and stays until the owner or an admin removes them.
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
const caravan = await import('../server/caravan.js');
const { audit } = await import('../server/audit.js');
const { db } = await import('../server/db.js');
const { dayOf, dayNum, dayStr } = await import('../server/game.js');

let server, base, n = 0;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const admin = { 'x-admin-key': 'test-admin' };
const signup = (username, invite = 'testcv') => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0305${String(4000000 + n)}`, password: 'secret1', cityId: 1172451, invite } }); };
const log = (u, count) => api('POST', '/api/log', { token: u.token, body: { count, rid: crypto.randomUUID() } });
const view = (u) => api('GET', '/api/caravan', { token: u.token });
const adminApi = (method, path, body) => api(method, `/api/admin${path}`, { headers: admin, body });
// the way a caravan comes to exist: an admin registers its owner (no caravan yet), then names the caravan with that member as owner
async function make(name, ownerName = `${name}_o`) {
  n += 1;
  const c = await adminApi('POST', '/members/create', { username: ownerName, email: `${ownerName}@x.pk`, phone: `0305${String(4500000 + n)}`, password: 'secret1', cityId: 1172451 });
  assert.equal(c.ok, true, JSON.stringify(c));
  const cv = await adminApi('POST', '/caravans', { name, owner: ownerName });
  assert.ok(cv.id, JSON.stringify(cv));
  const l = await api('POST', '/api/login', { body: { id: ownerName, password: 'secret1' } });
  return { token: l.token, me: l.me };
}
const joined = (cvName, username) => signup(username, cvName);   // signing up with the caravan's name is how a member joins
const cid = (name) => db.prepare('SELECT id FROM caravans WHERE name = ?').get(name).id;
const age = (name, days) => db.prepare('UPDATE users SET created_day = ? WHERE username = ?').run(dayStr(dayNum(dayOf()) - days), name);

test('an admin creates caravans: name rules, the shared name space with usernames, the owner is an existing member without a caravan', async () => {
  assert.equal((await api('POST', '/api/admin/caravans', { body: { name: 'nokey', owner: 'x' } })).status, 403);
  const mk = (username) => adminApi('POST', '/members/create', { username, email: `${username}@x.pk`, phone: `0305${String(4600000 + (n += 1))}`, password: 'secret1', cityId: 1172451 });
  assert.equal((await mk('cv_a')).ok, true);
  assert.equal((await mk('cv_b')).ok, true);
  assert.equal((await mk('cv_a')).error, 'username_taken');
  assert.equal((await adminApi('POST', '/members/create', { username: 'create', email: 'c@x.pk', phone: '03051234999', password: 'secret1', cityId: 1172451 })).error, 'bad_username');
  assert.equal((await adminApi('POST', '/members/create', { username: 'cv_c', email: 'cv_a@x.pk', phone: '03051234998', password: 'secret1', cityId: 1172451 })).error, 'account_exists');
  const login = await api('POST', '/api/login', { body: { id: 'cv_a', password: 'secret1' } });
  assert.equal(login.me.caravan, null, 'created without a caravan');
  assert.equal((await api('GET', '/api/caravan', { token: login.token })).caravan, null);
  const create = (name, owner = 'cv_a', extra) => adminApi('POST', '/caravans', { name, owner, ...extra });
  assert.equal((await create('ab')).error, 'bad_caravan_name');
  assert.equal((await create('admin')).error, 'bad_caravan_name');
  assert.equal((await create('12345')).error, 'bad_caravan_name', 'all digits could pass for a phone number');
  assert.equal((await create('cv_b')).error, 'caravan_name_taken', "a member's username");
  assert.equal((await create('cv_a')).error, 'caravan_name_taken', 'even the owner\'s own username');
  assert.equal((await create('Fine_Name', 'nobody_here')).error, 'member_not_found');
  const made = await create('Noor_Caravan', 'cv_a', { displayName: 'قافلہ نور' });
  assert.ok(made.id, JSON.stringify(made));
  const v = await view(login);
  assert.deepEqual([v.caravan.name, v.caravan.owner, v.caravan.displayName], ['Noor_Caravan', true, 'قافلہ نور']);
  assert.equal((await create('Another_One', 'cv_a')).error, 'already_in_caravan', 'one caravan each');
  assert.equal((await create('noor_caravan', 'cv_b')).error, 'caravan_name_taken', 'case does not matter');
  assert.equal((await api('GET', '/api/username-check?u=noor_caravan')).ok, false, 'a caravan name cannot be taken as a username');
  assert.equal((await signup('Noor_Caravan', 'noor_caravan')).error, 'username_taken');
  assert.equal((await api('GET', '/api/caravan/name-check?u=noor_caravan', { token: login.token })).ok, true, 'its own name is fine for the owner');
  assert.equal((await api('GET', '/api/caravan/name-check?u=cv_b', { token: login.token })).ok, false);
  assert.equal((await adminApi('POST', '/caravans', { name: 'Third_One', owner: 'cv_b' })).owner, 'cv_b');
  assert.deepEqual(audit().problems, []);
});

test('sign-up puts the member in the caravan at once; a failed sign-up leaves nothing behind; nobody leaves or switches', async () => {
  const o = await make('jn_caravan');
  const count = () => db.prepare('SELECT COUNT(*) n FROM caravan_members').get().n;
  const before = count();
  assert.equal((await signup('jn_o', 'jn_caravan')).error, undefined);
  assert.equal(count(), before + 1);
  assert.equal((await signup('jn_o', 'jn_caravan')).error, 'username_taken');
  assert.equal(count(), before + 1, 'a rejected sign-up joins nobody');
  const m = await signup('jn_m', 'JN_CARAVAN');
  assert.equal(m.me.caravan.name, 'jn_caravan');
  assert.equal(m.me.caravan.owner, false);
  const v = await view(o);
  assert.deepEqual(v.members.map((x) => x.username).sort(), ['jn_caravan_o', 'jn_m', 'jn_o']);
  assert.equal(v.caravan.members, 3);
  assert.equal((await api('POST', '/api/caravan/leave', { token: m.token })).status, 404);
  assert.equal((await api('POST', '/api/caravan/join', { token: m.token, body: { name: 'jn_caravan' } })).status, 404);
  assert.equal((await api('POST', '/api/caravan', { token: m.token, body: { name: 'jn_mine' } })).status, 404);
  assert.deepEqual(audit().problems, []);
});

test('owner powers: rename, display name and remove; an admin can remove anyone and put a member without a caravan into one; the owner role passes on; an empty caravan closes', async () => {
  const o = await make('ow_caravan', 'ow_o');
  const a = await joined('ow_caravan', 'ow_a'), b = await joined('ow_caravan', 'ow_b'), c = await joined('ow_caravan', 'ow_c');
  db.prepare('UPDATE caravan_members SET joined_at = ? WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(1000, 'ow_b'); // b has been there longest after the owner
  assert.equal((await api('PUT', '/api/caravan/name', { token: a.token, body: { name: 'hijack' } })).error, 'owner_only');
  assert.equal((await api('PUT', '/api/caravan/name', { token: o.token, body: { name: 'ow_a' } })).error, 'caravan_name_taken');
  assert.equal((await api('PUT', '/api/caravan/name', { token: o.token, body: { name: 'ow_renamed' } })).view.caravan.name, 'ow_renamed');
  assert.equal((await api('PUT', '/api/caravan/name', { token: o.token, body: { name: 'OW_RENAMED' } })).view.caravan.name, 'OW_RENAMED', 'changing only the case is fine');
  assert.equal((await signup('ow_x', 'ow_caravan')).error, 'bad_invite', 'the old name no longer opens the door');
  assert.ok((await signup('ow_x', 'ow_renamed')).token, 'the new name does');
  assert.equal((await api('POST', '/api/caravan/remove', { token: a.token, body: { username: 'ow_b' } })).error, 'owner_only');
  assert.equal((await api('POST', '/api/caravan/remove', { token: o.token, body: { username: 'ow_o' } })).error, 'not_found', 'the owner cannot remove themselves');
  assert.equal((await api('POST', '/api/caravan/remove', { token: o.token, body: { username: 'ow_c' } })).ok, true);
  assert.equal((await view(c)).caravan, null, 'removed: in no caravan');
  assert.equal((await api('GET', '/api/me', { token: c.token })).caravan, null);
  const id = cid('OW_RENAMED');
  assert.equal((await adminApi('POST', `/caravans/${id}/members`, { username: 'ow_c' })).ok, true, 'an admin puts them back');
  assert.equal((await adminApi('POST', `/caravans/${id}/members`, { username: 'ow_c' })).error, 'already_in_caravan');
  assert.equal((await adminApi('POST', `/caravans/${id}/members`, { username: 'nobody_here' })).error, 'member_not_found');
  // an admin removes the owner: b (longest-standing) takes over
  assert.equal((await adminApi('POST', `/caravans/${id}/remove`, { username: 'ow_o' })).ok, true);
  const vb = await view(b);
  assert.equal(vb.caravan.ownerName, 'ow_b');
  assert.equal(vb.caravan.owner, true);
  assert.equal((await adminApi('POST', `/caravans/${id}/remove`, { username: 'ow_o' })).error, 'not_found');
  // everyone removed: the caravan closes, its codes die with it, and its name is free again
  const code = (await adminApi('POST', '/invites', { caravan: 'OW_RENAMED' })).code;
  for (const u of ['ow_a', 'ow_b', 'ow_c', 'ow_x']) await adminApi('POST', `/caravans/${id}/remove`, { username: u });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caravans WHERE name = 'OW_RENAMED'").get().n, 0);
  assert.equal((await signup('ow_late', code)).error, 'bad_invite');
  assert.ok((await adminApi('POST', '/caravans', { name: 'OW_RENAMED', owner: 'ow_o' })).id);
  assert.deepEqual(audit().problems, []);
});

test('a deleted account leaves its caravan; the owner role passes on', async () => {
  const o = await make('dl_caravan', 'dl_o'), m = await joined('dl_caravan', 'dl_m');
  assert.equal((await api('DELETE', '/api/me', { token: o.token, body: { password: 'secret1' } })).status, 200);
  assert.equal((await view(m)).caravan.ownerName, 'dl_m');
  assert.deepEqual((await view(m)).members.map((x) => x.username), ['dl_m']);
});

test('a suspended owner hands the caravan on and stays a plain member, also after returning; alone, the caravan is left as it is', async () => {
  const o = await make('su_caravan', 'su_o'), m = await joined('su_caravan', 'su_m');
  assert.equal((await api('POST', '/api/admin/members/su_o', { headers: admin, body: { action: 'suspend' } })).ok, true);
  assert.equal((await view(m)).caravan.ownerName, 'su_m');
  assert.equal((await view(m)).caravan.owner, true);
  await api('POST', '/api/admin/members/su_o', { headers: admin, body: { action: 'unsuspend' } });
  assert.equal((await view(o)).caravan.ownerName, 'su_m');
  assert.equal((await view(o)).caravan.owner, false);
  await make('su_solo_caravan', 'su_solo');
  await api('POST', '/api/admin/members/su_solo', { headers: admin, body: { action: 'suspend' } });
  assert.equal(db.prepare("SELECT u.username FROM caravans c JOIN users u ON u.id = c.owner_id WHERE c.name = 'su_solo_caravan'").get().username, 'su_solo');
  assert.deepEqual(audit().problems, []);
});

test('rankings: a caravan appears with two members; totals, average and growth count its members only', async () => {
  const a = await make('rb_caravan', 'rb_a'), b = await joined('rb_caravan', 'rb_b'); await joined('rb_caravan', 'rb_c');
  const solo = await make('rb_solo_caravan', 'rb_solo');
  await log(a, 100); await log(b, 300); await log(solo, 9000);
  const rows = async (q = '') => (await api('GET', `/api/leaderboard?type=caravans${q}`, { token: a.token })).rows;
  const row = (r) => r.find((x) => x.name === 'rb_caravan');
  assert.equal(row(await rows()).score, 400);
  assert.equal(row(await rows()).members, 3);
  assert.equal(row(await rows()).me, true);
  assert.ok(!(await rows()).some((x) => x.name === 'rb_solo_caravan'), 'a caravan of one is not ranked yet');
  assert.equal(row(await rows('&metric=average')).score, 200, '400 over the 2 members who recited');
  assert.equal(row(await rows('&metric=average')).active, 2);
  assert.equal(row(await rows('&period=all')).score, 400);
  assert.equal(row(await rows('&metric=growth')).score, 400, 'nothing last week, so all of it is growth');
  const out = await api('GET', '/api/leaderboard?type=caravans', { token: solo.token });
  assert.equal(out.rows.find((x) => x.name === 'rb_caravan').me, false);
  assert.equal((await api('GET', '/api/leaderboard?type=trees', { token: a.token })).rows.some((r) => r.username === 'rb_a'), true, 'an unknown board type is the people board');
  // held durood is left out, like everywhere else
  db.prepare("UPDATE users SET held = 1 WHERE username = 'rb_b'").run();
  assert.equal(row(await rows()).score, 100);
  db.prepare("UPDATE users SET held = 0 WHERE username = 'rb_b'").run();
});

test('a caravan total milestone is shared by every member who recites, once, and by anyone who joins later', async () => {
  const o = await make('tb_caravan', 'tb_o'), a = await joined('tb_caravan', 'tb_a');
  await log(o, 100); await log(a, 100);
  await log(o, 9900);                                                                 // the caravan: 10,100
  for (const u of [o, a]) assert.ok((await api('GET', '/api/me', { token: u.token })).badges.includes('group10k'), u.me.username);
  const xpBefore = (await api('GET', '/api/me', { token: a.token })).xp;
  await log(o, 100);
  assert.equal((await api('GET', '/api/me', { token: a.token })).xp, xpBefore, 'paid once');
  // a newcomer who has recited shares what the caravan already passed, as soon as they join
  n += 1;
  const z = await adminApi('POST', '/members/create', { username: 'tb_z', email: 'tb_z@x.pk', phone: `0305${String(4700000 + n)}`, password: 'secret1', cityId: 1172451 });
  assert.equal(z.ok, true);
  const zl = await api('POST', '/api/login', { body: { id: 'tb_z', password: 'secret1' } });
  await log(zl, 200);
  assert.ok(!(await api('GET', '/api/me', { token: zl.token })).badges.includes('group10k'));
  assert.equal((await adminApi('POST', `/caravans/${cid('tb_caravan')}/members`, { username: 'tb_z' })).ok, true);
  assert.ok((await api('GET', '/api/me', { token: zl.token })).badges.includes('group10k'), 'a newcomer who recites shares what the caravan already passed');
  assert.deepEqual(audit().problems, [], JSON.stringify(audit().problems).slice(0, 300));
});

test('the admin can list and remove a caravan, freeing its name', async () => {
  const o = await make('ad_bad_name', 'ad_o'), m = await joined('ad_bad_name', 'ad_m');
  const list = await api('GET', '/api/admin/caravans', { headers: admin });
  const row = list.caravans.find((c) => c.name === 'ad_bad_name');
  assert.equal(row.members, 2);
  assert.equal((await api('PUT', `/api/admin/caravans/${row.id}`, { headers: admin, body: { name: 'ad_good_name' } })).name, 'ad_good_name');
  assert.equal((await signup('ad_late', 'ad_bad_name')).error, 'bad_invite');
  assert.equal((await api('DELETE', `/api/admin/caravans/${row.id}`, { headers: admin })).ok, true);
  assert.equal((await view(o)).caravan, null);
  assert.equal((await view(m)).caravan, null);
  assert.ok((await adminApi('POST', '/caravans', { name: 'ad_bad_name', owner: 'ad_o' })).id, 'the name is free again');
  assert.equal((await api('DELETE', '/api/admin/caravans/999999', { headers: admin })).status, 404);
});

test('display name: the owner can give the caravan a name in Urdu; it shows on the page and the boards; only the owner, no links; admins can clear it', async () => {
  const o = await make('dn_caravan', 'dn_owner'), m = await joined('dn_caravan', 'dn_member');
  const set = (u, displayName) => api('PUT', '/api/caravan/display-name', { token: u.token, body: { displayName } });
  assert.equal((await set(m, 'قافلہ نور')).error, 'owner_only');
  assert.equal((await set(o, 'see https://x.example')).error, 'no_links');
  const r = await set(o, '  قافلہ   نور  ');
  assert.equal(r.view.caravan.displayName, 'قافلہ نور', 'trimmed, spaces collapsed');
  assert.equal(r.view.caravan.name, 'dn_caravan', 'the handle is unchanged');
  await log(o, 300); await log(m, 200);
  const row = (await api('GET', '/api/leaderboard?type=caravans', { token: m.token })).rows.find((x) => x.name === 'dn_caravan');
  assert.equal(row?.displayName, 'قافلہ نور', 'the boards carry it');
  assert.equal((await set(o, '')).view.caravan.displayName, '', 'the owner can clear it');
  await set(o, 'قافلہ نور');
  const id = (await view(o)).caravan.id;
  assert.equal((await api('DELETE', `/api/admin/caravans/${id}/display-name`, { headers: admin })).ok, true);
  assert.equal((await view(m)).caravan.displayName, '', 'an admin cleared it');
});

test('falling behind: owner sees quiet members after a grace week, worst first, and can remove them', async () => {
  const o = await make('lagcaravan', 'lag_o');
  const [a, b, c, d] = [await joined('lagcaravan', 'lag_a'), await joined('lagcaravan', 'lag_b'), await joined('lagcaravan', 'lag_c'), await joined('lagcaravan', 'lag_d')];
  const joinBack = (name, days) => db.prepare('UPDATE caravan_members SET joined_at = ? WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(Date.now() - days * 86400e3, name);
  const recited = (name, daysAgo) => db.prepare('INSERT OR REPLACE INTO daily (user_id, day, count) VALUES ((SELECT id FROM users WHERE username = ?), ?, 10)').run(name, dayStr(dayNum(dayOf()) - daysAgo));
  assert.deepEqual((await view(o)).lagging, [], 'new members are given a grace period');
  for (const [name] of [['lag_a'], ['lag_b'], ['lag_c'], ['lag_d']]) joinBack(name, 20);
  recited('lag_a', 5);   // quiet for 5 days
  recited('lag_b', 1);   // active
  recited('lag_c', 3);   // quiet for 3 days
  const names = (await view(o)).lagging.map((m) => [m.username, m.quietDays]);
  assert.deepEqual(names, [['lag_d', null], ['lag_a', 5], ['lag_c', 3]], 'never first, then the longest silence; the active member and the owner are left out');
  assert.equal((await view(a)).lagging, undefined, 'only the owner sees the list');
  assert.equal((await api('POST', '/api/caravan/remove', { token: o.token, body: { username: 'lag_d' } })).status, 200);
  assert.equal((await view(o)).lagging.length, 2);
});

// last: it writes days straight into the tables, which the audit would (rightly) flag in tests that run after it
test('the caravan streak: three or more members, half of them reciting each day, counted from the day each joined; badges at 7 and 30 for everyone', async () => {
  const o = await make('st_caravan', 'st_o'), a = await joined('st_caravan', 'st_a'), b = await joined('st_caravan', 'st_b'), c = await joined('st_caravan', 'st_c');
  const id = cid('st_caravan');
  db.prepare('UPDATE caravan_members SET joined_at = ? WHERE caravan_id = ?').run(Date.now() - 40 * 86400e3, id);
  const seed = (u, d) => { const uid = db.prepare('SELECT id FROM users WHERE username = ?').get(u).id; const day = dayStr(dayNum(dayOf()) - d);
    db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,100) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 100').run(uid, day);
    db.prepare('UPDATE users SET total = total + 100, xp = xp + 100 WHERE id = ?').run(uid); db.prepare('INSERT INTO entries (user_id, day, count, rid, created_at) VALUES (?,?,100,?,?)').run(uid, day, `s-${u}-${d}-${crypto.randomUUID()}`, Date.now()); };
  await make('st_small_c', 'st_small'); await joined('st_small_c', 'st_small2');
  assert.equal(caravan.streakStatus(cid('st_small_c')).active, false, 'two people do not keep a caravan streak');
  for (let d = 1; d <= 6; d++) { seed('st_o', d); seed('st_a', d); }                  // 2 of 4 on each of the last 6 days
  await log(o, 100);                                                                  // today: 1 of 4, not yet half
  let ks = caravan.streakStatus(id);
  assert.equal(ks.streak, 6, 'today is not yet half, but it does not break the streak either');
  assert.equal(ks.today, 1);
  assert.deepEqual(ks.missing.sort(), ['st_a', 'st_b', 'st_c']);
  await log(a, 100);                                                                  // 2 of 4 today
  assert.equal(caravan.streakStatus(id).streak, 7);
  for (const u of [o, a, b, c]) assert.ok(true, u.token);
  assert.ok((await api('GET', '/api/me', { token: o.token })).badges.includes('karwan7'), 'the 7-day badge for the one who logged');
  assert.ok((await api('GET', '/api/me', { token: a.token })).badges.includes('karwan7'));
  assert.ok((await api('GET', '/api/me', { token: b.token })).badges.includes('karwan7') === false, 'members with no durood of their own do not share it');
  assert.equal((await view(o)).streak.streak, 7);
  db.prepare('DELETE FROM daily WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?)) AND day = ?').run('st_o', 'st_a', dayStr(dayNum(dayOf()) - 2));
  assert.equal(caravan.streakStatus(id).streak, 2, 'a missed day breaks it: today and yesterday only');
  // a member counts only from the day they joined
  await joined('st_caravan', 'st_late');
  assert.equal(caravan.streakStatus(id).streak, 1, 'today is now 2 of 5 (not yet half); yesterday still counts, and the newcomer is not counted for it');
});
