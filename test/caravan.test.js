// Caravans: a named group, one per member, joined by the owner's invitation or by asking; separate from the Qabila (invite tree).
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
const signup = (username, invite = 'TESTFOUND') => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0305${String(4000000 + n)}`, password: 'secret1', cityId: 1172451, invite } }); };
const log = (u, count) => api('POST', '/api/log', { token: u.token, body: { count, rid: crypto.randomUUID() } });
const view = (u) => api('GET', '/api/caravan', { token: u.token });
const make = (u, name) => api('POST', '/api/caravan', { token: u.token, body: { name } });
const invite = (owner, member) => api('POST', '/api/caravan/invite', { token: owner.token, body: { username: member.me.username } });
const accept = async (member, yes = true) => { const v = await view(member); return api('POST', `/api/caravan/invitations/${v.invitations[0].id}`, { token: member.token, body: { accept: yes } }); };
const joined = async (owner, member) => { await invite(owner, member); return accept(member); };
const cid = (name) => db.prepare('SELECT id FROM caravans WHERE name = ?').get(name).id;
const age = (name, days) => db.prepare('UPDATE users SET created_day = ? WHERE username = ?').run(dayStr(dayNum(dayOf()) - days), name);

test('create, name rules and the shared name space with usernames', async () => {
  const a = await signup('cv_a'), b = await signup('cv_b');
  assert.equal((await make(a, 'ab')).error, 'bad_caravan_name');
  assert.equal((await make(a, 'admin')).error, 'bad_caravan_name');
  assert.equal((await make(a, '12345')).error, 'bad_caravan_name', 'all digits could pass for a phone number');
  assert.equal((await make(a, 'cv_b')).error, 'caravan_name_taken', "a member's username");
  assert.equal((await make(a, 'cv_a')).error, 'caravan_name_taken', 'even your own username');
  const made = await make(a, 'Noor_Caravan');
  assert.ok(made.id, JSON.stringify(made).slice(0, 200));
  assert.equal(made.view.caravan.name, 'Noor_Caravan');
  assert.equal(made.view.caravan.owner, true);
  assert.equal(made.me.caravan.name, 'Noor_Caravan');
  assert.equal((await make(b, 'noor_caravan')).error, 'caravan_name_taken', 'case does not matter');
  assert.equal((await make(a, 'Another_One')).error, 'already_in_caravan', 'one caravan each');
  assert.equal((await api('GET', '/api/username-check?u=noor_caravan')).ok, false, 'a caravan name cannot be taken as a username');
  const reg = await signup('Noor_Caravan');
  assert.equal(reg.error, 'username_taken');
  assert.equal((await api('GET', '/api/caravan/name-check?u=noor_caravan', { token: b.token })).ok, false);
  assert.equal((await api('GET', '/api/caravan/name-check?u=free_name_1', { token: b.token })).ok, true);
});

test('the owner invites by username and the person accepts; nobody is added without saying yes', async () => {
  const o = await signup('iv_o'), m = await signup('iv_m'), other = await signup('iv_other');
  await make(o, 'iv_caravan');
  assert.equal((await api('POST', '/api/caravan/invite', { token: o.token, body: { username: 'nobody_here' } })).error, 'member_not_found');
  assert.equal((await api('POST', '/api/caravan/invite', { token: o.token, body: { username: 'iv_o' } })).error, 'own_invite');
  assert.equal((await invite(o, m)).joined, false);
  assert.equal((await invite(o, m)).error, 'already_invited');
  assert.equal((await api('GET', '/api/me', { token: m.token })).caravanInvites, 1);
  assert.equal((await view(m)).caravan, null, 'invited is not joined');
  assert.equal((await view(m)).invitations[0].name, 'iv_caravan');
  // only the owner can invite
  assert.equal((await api('POST', '/api/caravan/invite', { token: other.token, body: { username: 'iv_m' } })).error, 'owner_only');
  assert.equal((await accept(m)).ok, true);
  const v = await view(o);
  assert.deepEqual(v.members.map((x) => x.username).sort(), ['iv_m', 'iv_o']);
  assert.equal(v.caravan.members, 2);
  assert.equal((await api('GET', '/api/me', { token: m.token })).caravan.name, 'iv_caravan');
  // a member of a caravan cannot be invited elsewhere, and a decline removes the invitation
  assert.equal((await invite(o, m)).error, 'in_a_caravan');
  const o2 = await signup('iv_o2'); await make(o2, 'iv_other_caravan');
  assert.equal((await invite(o2, m)).error, 'in_a_caravan');
  await invite(o2, other);
  assert.equal((await accept(other, false)).ok, true);
  assert.equal((await view(other)).invitations.length, 0);
  assert.deepEqual(audit().problems, []);
});

test('asking to join by name: the owner agrees or refuses; asking after being invited just joins', async () => {
  const o = await signup('rq_o'), m = await signup('rq_m'), m2 = await signup('rq_m2'), m3 = await signup('rq_m3');
  await make(o, 'rq_caravan');
  assert.equal((await api('POST', '/api/caravan/join', { token: m.token, body: { name: 'no_such_one' } })).error, 'caravan_not_found');
  assert.equal((await api('POST', '/api/caravan/join', { token: m.token, body: { name: 'RQ_CARAVAN' } })).joined, false);
  assert.equal((await api('POST', '/api/caravan/join', { token: m.token, body: { name: 'rq_caravan' } })).error, 'already_requested');
  assert.equal((await view(m)).requests[0].name, 'rq_caravan');
  const ov = await view(o);
  assert.deepEqual(ov.pending.map((p) => [p.username, p.kind]), [['rq_m', 'request']]);
  assert.equal((await api('GET', '/api/me', { token: o.token })).caravanRequests, 1);
  assert.equal((await api('POST', '/api/caravan/requests/rq_m', { token: m.token, body: { accept: true } })).error, 'owner_only', 'the asker cannot approve themselves');
  assert.equal((await api('POST', '/api/caravan/requests/rq_m', { token: o.token, body: { accept: true } })).ok, true);
  assert.equal((await view(m)).caravan.name, 'rq_caravan');
  // refused
  await api('POST', '/api/caravan/join', { token: m2.token, body: { name: 'rq_caravan' } });
  await api('POST', '/api/caravan/requests/rq_m2', { token: o.token, body: { accept: false } });
  assert.equal((await view(m2)).caravan, null);
  assert.equal((await view(m2)).requests.length, 0);
  // a request withdrawn by its maker
  await api('POST', '/api/caravan/join', { token: m3.token, body: { name: 'rq_caravan' } });
  const cancel = await api('POST', '/api/caravan/cancel', { token: m3.token, body: { caravanId: cid('rq_caravan') } });
  assert.equal(cancel.view.requests.length, 0);
  // a member who asked and is then invited (or the reverse) joins at once
  await api('POST', '/api/caravan/join', { token: m3.token, body: { name: 'rq_caravan' } });
  assert.equal((await invite(o, m3)).joined, true);
  assert.equal((await view(m3)).caravan.name, 'rq_caravan');
  // the owner can withdraw an invitation
  const x = await signup('rq_x'); await invite(o, x);
  assert.equal((await api('POST', '/api/caravan/cancel', { token: o.token, body: { username: 'rq_x' } })).ok, true);
  assert.equal((await view(x)).invitations.length, 0);
});

test('owner powers: rename and remove; members can leave; ownership passes to the longest-standing member; an empty caravan closes', async () => {
  const o = await signup('ow_o'), a = await signup('ow_a'), b = await signup('ow_b'), c = await signup('ow_c');
  await make(o, 'ow_caravan'); await joined(o, a); await joined(o, b); await joined(o, c);
  db.prepare('UPDATE caravan_members SET joined_at = ? WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(1000, 'ow_b'); // b has been there longest after the owner
  assert.equal((await api('PUT', '/api/caravan/name', { token: a.token, body: { name: 'hijack' } })).error, 'owner_only');
  assert.equal((await api('PUT', '/api/caravan/name', { token: o.token, body: { name: 'ow_a' } })).error, 'caravan_name_taken');
  assert.equal((await api('PUT', '/api/caravan/name', { token: o.token, body: { name: 'ow_renamed' } })).view.caravan.name, 'ow_renamed');
  assert.equal((await api('PUT', '/api/caravan/name', { token: o.token, body: { name: 'OW_RENAMED' } })).view.caravan.name, 'OW_RENAMED', 'changing only the case is fine');
  assert.equal((await api('POST', '/api/caravan/remove', { token: a.token, body: { username: 'ow_b' } })).error, 'owner_only');
  assert.equal((await api('POST', '/api/caravan/remove', { token: o.token, body: { username: 'ow_o' } })).error, 'not_found', 'the owner leaves instead of removing themselves');
  assert.equal((await api('POST', '/api/caravan/remove', { token: o.token, body: { username: 'ow_c' } })).ok, true);
  assert.equal((await view(c)).caravan, null);
  assert.equal((await make(c, 'ow_c_own')).id > 0, true, 'a removed member can start their own');
  // the owner leaves: b (longest-standing) takes over
  assert.equal((await api('POST', '/api/caravan/leave', { token: o.token })).ok, true);
  const vb = await view(b);
  assert.equal(vb.caravan.ownerName, 'ow_b');
  assert.equal(vb.caravan.owner, true);
  assert.equal((await view(o)).caravan, null);
  assert.equal((await api('POST', '/api/caravan/leave', { token: o.token })).error, 'not_found');
  // everyone leaves: the caravan closes and its name is free again
  await api('POST', '/api/caravan/leave', { token: a.token });
  await api('POST', '/api/caravan/leave', { token: b.token });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caravans WHERE name = 'OW_RENAMED'").get().n, 0);
  assert.ok((await make(o, 'OW_RENAMED')).id);
});

test('a deleted account leaves its caravan; the owner role passes on', async () => {
  const o = await signup('dl_o'), m = await signup('dl_m');
  await make(o, 'dl_caravan'); await joined(o, m);
  assert.equal((await api('DELETE', '/api/me', { token: o.token, body: { password: 'secret1' } })).status, 200);
  assert.equal((await view(m)).caravan.ownerName, 'dl_m');
  assert.deepEqual((await view(m)).members.map((x) => x.username), ['dl_m']);
});

test('a suspended owner hands the caravan on and stays a plain member, also after returning; alone, the caravan is left as it is', async () => {
  const o = await signup('su_o'), m = await signup('su_m');
  await make(o, 'su_caravan'); await joined(o, m);
  assert.equal((await api('POST', '/api/admin/members/su_o', { headers: admin, body: { action: 'suspend' } })).ok, true);
  assert.equal((await view(m)).caravan.ownerName, 'su_m');
  assert.equal((await view(m)).caravan.owner, true);
  await api('POST', '/api/admin/members/su_o', { headers: admin, body: { action: 'unsuspend' } });
  assert.equal((await view(o)).caravan.ownerName, 'su_m');
  assert.equal((await view(o)).caravan.owner, false);
  const solo = await signup('su_solo');
  await make(solo, 'su_solo_caravan');
  await api('POST', '/api/admin/members/su_solo', { headers: admin, body: { action: 'suspend' } });
  assert.equal(db.prepare("SELECT u.username FROM caravans c JOIN users u ON u.id = c.owner_id WHERE c.name = 'su_solo_caravan'").get().username, 'su_solo');
  assert.deepEqual(audit().problems, []);
});

test('rankings: a caravan appears with two members; totals, average and growth count its members only; the invite tree is separate', async () => {
  const a = await signup('rb_a'), b = await signup('rb_b'), c = await signup('rb_c'), solo = await signup('rb_solo');
  await make(a, 'rb_caravan'); await joined(a, b); await joined(a, c);
  await make(solo, 'rb_solo_caravan');
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
  // held durood is left out, like everywhere else
  db.prepare("UPDATE users SET held = 1 WHERE username = 'rb_b'").run();
  assert.equal(row(await rows()).score, 100);
  db.prepare("UPDATE users SET held = 0 WHERE username = 'rb_b'").run();
});

test('a caravan total milestone is shared by every member who recites, once, and by anyone who joins later', async () => {
  const o = await signup('tb_o'), a = await signup('tb_a'), z = await signup('tb_z');
  await make(o, 'tb_caravan'); await joined(o, a);
  await log(o, 100); await log(a, 100);
  await log(o, 9900);                                                                 // the caravan: 10,100
  for (const u of [o, a]) assert.ok((await api('GET', '/api/me', { token: u.token })).badges.includes('group10k'), u.me.username);
  const xpBefore = (await api('GET', '/api/me', { token: a.token })).xp;
  await log(o, 100);
  assert.equal((await api('GET', '/api/me', { token: a.token })).xp, xpBefore, 'paid once');
  await log(z, 200);
  assert.ok(!(await api('GET', '/api/me', { token: z.token })).badges.includes('group10k'));
  await joined(o, z);
  assert.ok((await api('GET', '/api/me', { token: z.token })).badges.includes('group10k'), 'a newcomer who recites shares what the caravan already passed');
  assert.deepEqual(audit().problems, [], JSON.stringify(audit().problems).slice(0, 300));
});

test('the admin can list and remove a caravan, freeing its name', async () => {
  const o = await signup('ad_o'), m = await signup('ad_m');
  await make(o, 'ad_bad_name'); await joined(o, m);
  const list = await api('GET', '/api/admin/caravans', { headers: admin });
  const row = list.caravans.find((c) => c.name === 'ad_bad_name');
  assert.equal(row.members, 2);
  assert.equal((await api('DELETE', `/api/admin/caravans/${row.id}`, { headers: admin })).ok, true);
  assert.equal((await view(o)).caravan, null);
  assert.equal((await view(m)).caravan, null);
  assert.ok((await make(o, 'ad_bad_name')).id, 'the name is free again');
  assert.equal((await api('DELETE', '/api/admin/caravans/999999', { headers: admin })).status, 404);
});

test('searching for people to invite and caravans to ask', async () => {
  const o = await signup('sr_owner'), f = await signup('sr_friend'), g = await signup('sr_group_member');
  await make(g, 'sr_famous_caravan');
  await make(o, 'sr_my_caravan');
  assert.ok((await api('GET', '/api/caravan/search?q=sr_fr', { token: o.token })).usernames.includes('sr_friend'));
  assert.ok(!(await api('GET', '/api/caravan/search?q=sr_gr', { token: o.token })).usernames.includes('sr_group_member'), 'people already in a caravan are not offered');
  assert.deepEqual((await api('GET', '/api/caravan/search?q=sr_fam', { token: f.token })).caravans.map((c) => c.name), ['sr_famous_caravan']);
  assert.deepEqual((await api('GET', '/api/caravan/search?q=s', { token: f.token })).usernames, [], 'too short');
});

// last: it writes days straight into the tables, which the audit would (rightly) flag in tests that run after it
test('the caravan streak: three or more members, half of them reciting each day, counted from the day each joined; badges at 7 and 30 for everyone', async () => {
  const o = await signup('st_o'), a = await signup('st_a'), b = await signup('st_b'), c = await signup('st_c');
  await make(o, 'st_caravan'); await joined(o, a); await joined(o, b); await joined(o, c);
  const id = cid('st_caravan');
  db.prepare('UPDATE caravan_members SET joined_at = ? WHERE caravan_id = ?').run(Date.now() - 40 * 86400e3, id);
  const seed = (u, d) => { const uid = db.prepare('SELECT id FROM users WHERE username = ?').get(u).id; const day = dayStr(dayNum(dayOf()) - d);
    db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,100) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 100').run(uid, day);
    db.prepare('UPDATE users SET total = total + 100, xp = xp + 100 WHERE id = ?').run(uid); db.prepare('INSERT INTO entries (user_id, day, count, rid, created_at) VALUES (?,?,100,?,?)').run(uid, day, `s-${u}-${d}-${crypto.randomUUID()}`, Date.now()); };
  const small = await signup('st_small'); await make(small, 'st_small_c'); await joined(small, await signup('st_small2'));
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
  const late = await signup('st_late'); await joined(o, late);
  assert.equal(caravan.streakStatus(id).streak, 1, 'today is now 2 of 5 (not yet half); yesterday still counts, and the newcomer is not counted for it');
});
