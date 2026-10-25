import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';
process.env.EDITION = 'internal';

const { createServer } = await import('../server/index.js');
const burhan = await import('../server/burhan.js');
const { audit } = await import('../server/audit.js');
const { db } = await import('../server/db.js');
const { dayOf, dayNum, dayStr } = await import('../server/game.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const phoneOf = {};
const signup = async (username) => {
  n += 1;
  const phone = `0309${String(1000000 + n)}`;
  const r = await api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone, password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
  phoneOf[username] = `+92${phone.slice(1)}`;
  return r;
};
// both sides say yes: the salik confirms the person shown, the murabbi accepts
const connect = async (sal, mur, username) => {
  assert.equal((await api('POST', '/api/burhan/murabbi/confirm', { token: sal.token })).murabbi.stage, 'pending');
  assert.equal((await api('POST', `/api/burhan/requests/${username}`, { token: mur.token, body: { accept: true } })).ok, true);
};
const log = (u, count) => api('POST', '/api/log', { token: u.token, body: { count, rid: crypto.randomUUID() } });

// the Mamulaat app, faked: who each member's murabbi is and their daily percentages
const murabbis = {}, percents = {};
let calls = 0;
burhan.setProvider({
  async murabbiOf(phone) { calls++; return murabbis[phone] ?? null; },
  async days(phone) { calls++; return percents[phone] ?? []; },
});

test('public edition hides everything', async () => {
  process.env.EDITION = 'public';
  const a = await signup('pub_a');
  assert.equal((await api('GET', '/api/burhan', { token: a.token })).status, 404);
  assert.equal((await api('POST', '/api/assignments', { token: a.token, body: {} })).status, 404);
  assert.equal((await api('GET', '/api/config')).edition, 'public');
  process.env.EDITION = 'internal';
  assert.equal((await api('GET', '/api/config')).edition, 'internal');
});

test('murabbi: found by WhatsApp number, waits until they sign up, then links by itself', async () => {
  const s = await signup('sal_a');
  const noOne = await api('POST', '/api/burhan/murabbi', { token: s.token });
  assert.equal(noOne.error, 'no_murabbi_set');
  // the Mamulaat app names a murabbi who has no account here yet
  murabbis[phoneOf.sal_a] = { name: 'Hafiz Sahib', whatsapp: '923091999001' };
  const waiting = await api('POST', '/api/burhan/murabbi', { token: s.token });
  assert.equal(waiting.murabbi.waiting, true);
  assert.equal(waiting.murabbi.name, 'Hafiz Sahib');
  assert.equal(waiting.murabbi.username, null);
  // the murabbi signs up with that number
  const m = await api('POST', '/api/register', { body: { username: 'mur_a', email: 'mur_a@x.pk', phone: '03091999001', password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
  assert.ok(m.token);
  const st = await api('GET', '/api/burhan', { token: s.token });
  assert.equal(st.murabbi.username, 'mur_a');
  assert.equal(st.murabbi.stage, 'confirm', 'a number that registered later is shown to the salik, not trusted');
  // nothing is shared yet: the murabbi cannot see the salik until both have said yes
  assert.equal((await api('GET', '/api/burhan/saaliks/sal_a', { token: m.token })).status, 404);
  assert.equal((await api('GET', '/api/burhan', { token: s.token })).mamulaat, null);
  assert.equal((await api('POST', '/api/burhan/requests/sal_a', { token: m.token, body: { accept: true } })).status, 404, 'cannot accept before the salik confirmed');
  await connect(s, m, 'sal_a');
  assert.equal((await api('GET', '/api/burhan', { token: s.token })).murabbi.stage, 'active');
  assert.equal((await api('GET', '/api/burhan', { token: m.token })).roles.saaliks, 1);
  assert.equal((await api('GET', '/api/burhan/saaliks', { token: m.token })).saaliks[0].username, 'sal_a');
  // a murabbi who already exists links at once; the member's own number is refused
  const s2 = await signup('sal_b');
  murabbis[phoneOf.sal_b] = { name: 'Hafiz Sahib', whatsapp: '+92 309 1999001' };
  assert.equal((await api('POST', '/api/burhan/murabbi', { token: s2.token })).murabbi.username, 'mur_a');
  assert.equal((await api('GET', '/api/burhan/requests', { token: m.token })).requests.length, 0, 'no request until the salik confirms');
  await api('POST', '/api/burhan/murabbi/confirm', { token: s2.token });
  assert.deepEqual((await api('GET', '/api/burhan/requests', { token: m.token })).requests.map((r) => r.username), ['sal_b']);
  assert.equal((await api('POST', '/api/burhan/requests/sal_b', { token: m.token, body: { accept: true } })).ok, true);
  const s3 = await signup('sal_c');
  murabbis[phoneOf.sal_c] = { name: 'Self', whatsapp: phoneOf.sal_c };
  assert.equal((await api('POST', '/api/burhan/murabbi', { token: s3.token })).error, 'own_murabbi');
  // a murabbi can refuse, and a stranger posing as a murabbi cannot read anything
  const s4 = await signup('sal_d');
  murabbis[phoneOf.sal_d] = { name: 'Hafiz Sahib', whatsapp: '923091999001' };
  await api('POST', '/api/burhan/murabbi', { token: s4.token });
  await api('POST', '/api/burhan/murabbi/confirm', { token: s4.token });
  assert.equal((await api('POST', '/api/burhan/requests/sal_d', { token: m.token, body: { accept: false } })).ok, true);
  assert.equal((await api('GET', '/api/burhan/saaliks/sal_d', { token: m.token })).status, 404);
  assert.equal((await api('GET', '/api/burhan', { token: s4.token })).murabbi, null);
  // unlinking removes the murabbi's view
  await api('DELETE', '/api/burhan/murabbi', { token: s2.token });
  assert.equal((await api('GET', '/api/burhan/saaliks/sal_b', { token: m.token })).status, 404);
});

test('the murabbi sees everything including mamulaat; others see none of it; the salik sees when they looked', async () => {
  const m = (await api('POST', '/api/login', { body: { id: 'mur_a', password: 'secret1' } }));
  const s = (await api('POST', '/api/login', { body: { id: 'sal_a', password: 'secret1' } }));
  const stranger = await signup('stranger');
  await log(s, 500);
  const today = dayOf(), y = dayStr(dayNum(today) - 1);
  percents[phoneOf.sal_a] = [{ day: today, percent: 80 }, { day: y, percent: 60 }, { day: '1999-01-01', percent: 50 }, { day: today, percent: 140 }];
  db.prepare('DELETE FROM mamulaat_sync').run();               // the earlier look found nothing and is still within the cache time
  const rep = await api('GET', '/api/burhan/saaliks/sal_a', { token: m.token });
  assert.equal(rep.progress.durood.total, 500);
  assert.equal(rep.profile.phone, phoneOf.sal_a);
  assert.equal(rep.mamulaat.today, 80);                       // the valid 80, not the out-of-range 140 and not the old day
  assert.equal(rep.mamulaat.series.length, 14);
  assert.equal(rep.mamulaat.average, 70);
  assert.equal((await api('GET', '/api/burhan/saaliks/sal_a', { token: stranger.token })).status, 404);
  assert.equal((await api('GET', '/api/burhan/razakars/sal_a', { token: m.token })).status, 404);   // being a murabbi is not being a masul
  const mine = await api('GET', '/api/burhan', { token: s.token });
  assert.equal(mine.mamulaat.today, 80);
  assert.ok(mine.murabbi.lastViewed > 0);
  const stranger2 = await api('GET', '/api/burhan', { token: stranger.token });
  assert.equal(stranger2.mamulaat, null);
  // the Mamulaat app being down keeps the last numbers and says they may be old
  burhan.setProvider({ async murabbiOf() { throw new Error('down'); }, async days() { throw new Error('down'); } });
  db.prepare('DELETE FROM mamulaat_sync').run();
  const down = await api('GET', '/api/burhan/saaliks/sal_a', { token: m.token });
  assert.equal(down.mamulaat.stale, true);
  assert.equal(down.mamulaat.today, 80);
  burhan.setProvider({ async murabbiOf(p) { return murabbis[p] ?? null; }, async days(p) { return percents[p] ?? []; } });
});

test('masul: sees tasks, routines and general progress but never mamulaat; razakar ticks without confirmation', async () => {
  const masul = await signup('mas_a'), r = await signup('raz_a'), other = await signup('raz_other');
  murabbis[phoneOf.raz_a] = { name: 'M', whatsapp: '923091999001' };
  await api('POST', '/api/burhan/murabbi', { token: r.token });          // raz_a also has a murabbi, whose data the masul must not get
  await connect(r, (await api('POST', '/api/login', { body: { id: 'mur_a', password: 'secret1' } })), 'raz_a');
  percents[phoneOf.raz_a] = [{ day: dayOf(), percent: 90 }];
  assert.equal((await api('PUT', '/api/burhan/masul', { token: r.token, body: { username: 'raz_a' } })).error, 'own_masul');
  assert.equal((await api('PUT', '/api/burhan/masul', { token: r.token, body: { username: 'nobody_x' } })).error, 'masul_not_found');
  assert.equal((await api('PUT', '/api/burhan/masul', { token: r.token, body: { username: 'mas_a' } })).masul.username, 'mas_a');
  // only the masul of that razakar can assign
  assert.equal((await api('POST', '/api/assignments', { token: other.token, body: { razakar: 'raz_a', kind: 'task', title: 'x' } })).error, 'not_your_razakar');
  const wd = new Date(`${dayOf()}T00:00:00Z`).getUTCDay();
  const routine = await api('POST', '/api/assignments', { token: masul.token, body: { razakar: 'raz_a', kind: 'routine', title: 'Majlis-e-Zikr', weekday: wd } });
  const elsewhere = await api('POST', '/api/assignments', { token: masul.token, body: { razakar: 'raz_a', kind: 'routine', title: 'Other day', weekday: (wd + 3) % 7 } });
  const task = await api('POST', '/api/assignments', { token: masul.token, body: { razakar: 'raz_a', kind: 'task', title: 'Attend the Seerat Circle on Friday', dueDay: '2020-01-01' } });
  assert.equal((await api('POST', '/api/assignments', { token: masul.token, body: { razakar: 'raz_a', kind: 'task', title: 'see https://x.com' } })).error, 'no_links');
  assert.equal((await api('POST', '/api/assignments', { token: masul.token, body: { razakar: 'raz_a', kind: 'routine', title: 'x', weekday: 9 } })).error, 'bad_weekday');
  const mine = await api('GET', '/api/burhan', { token: r.token });
  assert.equal(mine.assignments.length, 3);
  assert.equal(mine.today.length, 2);                                       // today's routine and the open task
  assert.equal(mine.assignments.find((a) => a.id === task.id).overdue, true);
  // ticking
  assert.equal((await api('POST', `/api/assignments/${elsewhere.id}/tick`, { token: r.token })).error, 'not_today');
  assert.equal((await api('POST', `/api/assignments/${routine.id}/tick`, { token: other.token })).error, 'not_found');
  assert.equal((await api('POST', `/api/assignments/${routine.id}/tick`, { token: r.token })).ok, true);
  assert.equal((await api('POST', `/api/assignments/${task.id}/tick`, { token: r.token })).ok, true);
  const after = (await api('GET', '/api/burhan', { token: r.token })).assignments;
  assert.equal(after.find((a) => a.id === routine.id).doneToday, true);
  assert.equal(after.find((a) => a.id === task.id).done, true);
  // the masul's report has no mamulaat anywhere
  const rep = await api('GET', '/api/burhan/razakars/raz_a', { token: masul.token });
  assert.equal(rep.assignments.length, 3);
  assert.ok(!JSON.stringify(rep).toLowerCase().includes('mamulaat'));
  assert.ok(!('phone' in rep) && !('email' in rep));
  assert.equal(rep.assignments.find((a) => a.id === routine.id).last4.done, 1);
  assert.equal((await api('GET', '/api/burhan/razakars', { token: masul.token })).razakars[0].username, 'raz_a');
  assert.equal((await api('GET', '/api/burhan/razakars/raz_a', { token: other.token })).status, 404);
  assert.ok((await api('GET', '/api/burhan', { token: r.token })).masul.lastViewed > 0);
  // the masul can end an assignment; changing masul ends the old one's assignments
  assert.equal((await api('DELETE', `/api/assignments/${elsewhere.id}`, { token: masul.token })).ok, true);
  assert.equal((await api('DELETE', `/api/assignments/${routine.id}`, { token: other.token })).error, 'not_found');
  await api('PUT', '/api/burhan/masul', { token: r.token, body: { username: 'raz_other' } });
  assert.equal((await api('GET', '/api/burhan', { token: r.token })).assignments.length, 0);
  assert.deepEqual(audit().problems, []);
});

test('a squatter on a murabbi\'s number gets nothing until a salik confirms them AND they accept; a changed murabbi must be confirmed again', async () => {
  const sal = await signup('sq_sal');
  murabbis[phoneOf.sq_sal] = { name: 'Real Murabbi', whatsapp: '923091999777' };
  await api('POST', '/api/burhan/murabbi', { token: sal.token });
  const squat = await api('POST', '/api/register', { body: { username: 'sq_squat', email: 'sq_squat@x.pk', phone: '03091999777', password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
  assert.equal((await api('GET', '/api/burhan/saaliks/sq_sal', { token: squat.token })).status, 404);
  assert.equal((await api('GET', '/api/burhan/saaliks', { token: squat.token })).saaliks.length, 0);
  assert.equal((await api('GET', '/api/burhan', { token: squat.token })).roles.saaliks, 0);
  // the salik sees the account that appeared and can decline it by removing the link
  assert.equal((await api('GET', '/api/burhan', { token: sal.token })).murabbi.username, 'sq_squat');
  await api('DELETE', '/api/burhan/murabbi', { token: sal.token });
  // an active link that the Mamulaat app later points elsewhere stops sharing until the new person is confirmed
  const real = await api('POST', '/api/register', { body: { username: 'sq_real', email: 'sq_real@x.pk', phone: '03091999888', password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
  murabbis[phoneOf.sq_sal] = { name: 'Real', whatsapp: '923091999888' };
  await api('POST', '/api/burhan/murabbi', { token: sal.token });
  await connect(sal, real, 'sq_sal');
  assert.equal((await api('GET', '/api/burhan/saaliks/sq_sal', { token: real.token })).status, 200);
  murabbis[phoneOf.sq_sal] = { name: 'Someone else', whatsapp: '923091999777' };
  db.prepare('UPDATE murabbi_links SET checked_at = 0 WHERE user_id = (SELECT id FROM users WHERE username = ?)').run('sq_sal');
  const after = await api('GET', '/api/burhan', { token: sal.token });
  assert.equal(after.murabbi.stage, 'confirm');
  assert.equal(after.murabbi.username, 'sq_squat');
  assert.equal((await api('GET', '/api/burhan/saaliks/sq_sal', { token: real.token })).status, 404, 'the old murabbi lost access at once');
  assert.equal((await api('GET', '/api/burhan/saaliks/sq_sal', { token: squat.token })).status, 404, 'the new one has none until both agree');
});

test('a declined or ended murabbi link is explained to the salik; a masul can remove a razakar; admins can see and break links', async () => {
  const s = await signup('ne_sal'), m = await signup('ne_mur'), r = await signup('ne_raz');
  murabbis[phoneOf.ne_sal] = { name: 'Qari Sahib', whatsapp: phoneOf.ne_mur.slice(1) };
  await api('POST', '/api/burhan/murabbi', { token: s.token });
  await api('POST', '/api/burhan/murabbi/confirm', { token: s.token });
  // declined: the salik is told, and looking again clears the notice
  assert.equal((await api('POST', '/api/burhan/requests/ne_sal', { token: m.token, body: { accept: false } })).ok, true);
  let st = await api('GET', '/api/burhan', { token: s.token });
  assert.equal(st.murabbi, null);
  assert.deepEqual(st.notices.map((x) => [x.kind, x.byName]), [['declined', 'ne_mur']]);
  await api('POST', '/api/burhan/murabbi', { token: s.token });
  assert.deepEqual((await api('GET', '/api/burhan', { token: s.token })).notices, []);
  await connect(s, m, 'ne_sal');
  // the report names the caravan (none yet) and the people they invited, and lists badges
  const rep = await api('GET', '/api/burhan/saaliks/ne_sal', { token: m.token });
  assert.equal(rep.extra.caravan, null);
  assert.equal(rep.extra.invited, 0);
  assert.ok(Array.isArray(rep.extra.badgeList));
  // admins see the link and can break it
  const K = { 'x-admin-key': 'test-admin' };
  const links = await (await fetch(base + '/api/admin/burhan-links', { headers: K })).json();
  assert.equal(links.murabbi.find((l) => l.salik === 'ne_sal').stage, 'active');
  // the murabbi ends it: reports stop at once, and the salik is told
  assert.equal((await api('DELETE', '/api/burhan/saaliks/ne_sal', { token: m.token })).ok, true);
  assert.equal((await api('GET', '/api/burhan/saaliks/ne_sal', { token: m.token })).status, 404);
  st = await api('GET', '/api/burhan', { token: s.token });
  assert.deepEqual(st.notices.map((x) => x.kind), ['ended']);
  assert.equal((await api('DELETE', '/api/burhan/notices/ended', { token: s.token })).ok, true);
  assert.deepEqual((await api('GET', '/api/burhan', { token: s.token })).notices, []);
  // a masul removes a razakar who named them: open work ends, and the razakar is told
  await api('PUT', '/api/burhan/masul', { token: r.token, body: { username: 'ne_mur' } });
  await api('POST', '/api/assignments', { token: m.token, body: { razakar: 'ne_raz', kind: 'task', title: 'Bring the dates' } });
  assert.equal((await api('DELETE', '/api/burhan/razakars/ne_raz', { token: m.token })).ok, true);
  st = await api('GET', '/api/burhan', { token: r.token });
  assert.equal(st.masul, null);
  assert.equal(st.assignments.length, 0);
  assert.deepEqual(st.notices.map((x) => x.kind), ['removed']);
  // and an admin can break a masul link too
  await api('PUT', '/api/burhan/masul', { token: r.token, body: { username: 'ne_mur' } });
  assert.equal((await (await fetch(base + '/api/admin/burhan-links/masul/ne_raz', { method: 'DELETE', headers: K })).json()).ok, true);
  assert.equal((await api('GET', '/api/burhan', { token: r.token })).masul, null);
  assert.deepEqual(audit().problems, []);
});

test('members add their own tasks and routines; their masul and murabbi see them, only the member changes them, and they outlive a change of masul', async () => {
  const me = await signup('ot_me'), ma = await signup('ot_masul'), ma2 = await signup('ot_masul2'), mu = await signup('ot_mur');
  // alone: a personal list
  let st = await api('POST', '/api/tasks', { token: me.token, body: { kind: 'task', title: 'Read one page of Seerah' } });
  assert.equal(st.assignments.length, 1);
  assert.equal(st.assignments[0].own, true);
  assert.equal(st.assignments[0].from, null);
  await api('POST', '/api/tasks', { token: me.token, body: { kind: 'routine', title: 'Visit the masjid', weekday: 5 } });
  // with a masul: the masul sees them (marked as the member's own) and cannot end them
  await api('PUT', '/api/burhan/masul', { token: me.token, body: { username: 'ot_masul' } });
  await api('POST', '/api/assignments', { token: ma.token, body: { razakar: 'ot_me', kind: 'task', title: 'Bring the dates' } });
  let rep = await api('GET', '/api/burhan/razakars/ot_me', { token: ma.token });
  assert.deepEqual(rep.assignments.map((a) => [a.title, a.own]).sort(), [['Bring the dates', false], ['Read one page of Seerah', true], ['Visit the masjid', true]]);
  const ownId = rep.assignments.find((a) => a.own && a.kind === 'task').id;
  assert.equal((await api('DELETE', `/api/assignments/${ownId}`, { token: ma.token })).status, 404);
  assert.equal((await api('GET', '/api/burhan/razakars', { token: ma.token })).razakars[0].openTasks, 2);
  // the member sees who gave what
  st = await api('GET', '/api/burhan', { token: me.token });
  assert.equal(st.assignments.find((a) => a.title === 'Bring the dates').from, 'ot_masul');
  // the murabbi sees all of them
  murabbis[phoneOf.ot_me] = { name: 'Shaykh', whatsapp: phoneOf.ot_mur.slice(1) };
  await api('POST', '/api/burhan/murabbi', { token: me.token });
  await connect(me, mu, 'ot_me');
  assert.equal((await api('GET', '/api/burhan/saaliks/ot_me', { token: mu.token })).assignments.length, 3);
  // a new masul: the old masul's task ends, the member's own stay
  await api('PUT', '/api/burhan/masul', { token: me.token, body: { username: 'ot_masul2' } });
  st = await api('GET', '/api/burhan', { token: me.token });
  assert.deepEqual(st.assignments.map((a) => a.title).sort(), ['Read one page of Seerah', 'Visit the masjid']);
  assert.equal((await api('GET', '/api/burhan/razakars/ot_me', { token: ma2.token })).assignments.length, 2);
  // the member removes their own
  assert.equal((await api('DELETE', `/api/assignments/${ownId}`, { token: me.token })).ok, true);
  assert.equal((await api('GET', '/api/burhan', { token: me.token })).assignments.length, 1);
  assert.deepEqual(audit().problems, []);
});
