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
  assert.equal(st.murabbi.waiting, false);
  assert.equal((await api('GET', '/api/burhan', { token: m.token })).roles.saaliks, 1);
  assert.equal((await api('GET', '/api/burhan/saaliks', { token: m.token })).saaliks[0].username, 'sal_a');
  // a murabbi who already exists links at once; the member's own number is refused
  const s2 = await signup('sal_b');
  murabbis[phoneOf.sal_b] = { name: 'Hafiz Sahib', whatsapp: '+92 309 1999001' };
  assert.equal((await api('POST', '/api/burhan/murabbi', { token: s2.token })).murabbi.username, 'mur_a');
  const s3 = await signup('sal_c');
  murabbis[phoneOf.sal_c] = { name: 'Self', whatsapp: phoneOf.sal_c };
  assert.equal((await api('POST', '/api/burhan/murabbi', { token: s3.token })).error, 'own_murabbi');
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
