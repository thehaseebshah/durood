import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../src/worker.js';
import { dayOf, weekStart, normalisePhone, backupPayload, sendBackup, backupStatus, pruneRids } from '../src/logic.js';
import { createD1 } from './d1.js';

const env = { DB: createD1(), TARGET: '100000000' };
let ip = 0;
// every link names a caravan, so the tests name the first one unless a test says otherwise
const firstSlug = (e) => e.DB.raw.prepare('SELECT slug FROM caravans ORDER BY id').get().slug;
const call = async (method, path, body, e = env) => {
  if (method === 'GET' && /^\/api\/(stats|caravan)(\?|$)/.test(path) && !/[?&]c=/.test(path)) path += `${path.includes('?') ? '&' : '?'}c=${firstSlug(e)}`;
  if (method === 'POST' && body && !('caravan' in body) && /^\/api\/(check|entry)$/.test(path)) body = { ...body, caravan: firstSlug(e) };
  const res = await worker.fetch(new Request(`https://x.test${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'CF-Connecting-IP': `10.0.0.${++ip % 250}` } }), e);
  return { status: res.status, headers: res.headers, ...(await res.json()) };
};
const post = (p, b, e) => call('POST', p, b, e);
const entry = (b, e) => post('/api/entry', { rid: crypto.randomUUID(), ...b }, e);

test('a number we do not know is new; once it has an entry it is known', async () => {
  assert.equal((await post('/api/check', { phone: '0300 1111111' })).known, false);
  assert.equal((await post('/api/check', { phone: 'abc' })).error, 'bad_phone');
  const r = await entry({ phone: '0300 1111111', count: 313, name: 'Amina Khan', city: 'Lahore' });
  assert.equal(r.status, 200);
  assert.equal(r.created, true);
  assert.equal((await post('/api/check', { phone: '0300 1111111' })).known, true);
});

test('a new number must come with a name and a city from the list; nothing is saved without them', async () => {
  const phone = '0300 2222222';
  assert.equal((await entry({ phone, count: 10 })).error, 'need_name');
  assert.equal((await entry({ phone, count: 10, name: 'A' })).error, 'need_name', 'too short');
  assert.equal((await entry({ phone, count: 10, name: 'Bilal' })).error, 'need_city');
  assert.equal((await entry({ phone, count: 10, name: 'Bilal', city: 'Atlantis' })).error, 'need_city', 'the city must be one of the list');
  assert.equal((await post('/api/check', { phone })).known, false, 'a refused entry creates nobody');
  assert.equal((await entry({ phone, count: 10, name: '  Bilal   Ahmad ', city: 'Other' })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT name FROM people WHERE phone = ?').get('+923002222222').name, 'Bilal Ahmad');
});

test('a known number only needs the count; the same person is found however the number is written', async () => {
  for (const phone of ['0300-1111111', '+92 300 1111111', '923001111111', '00923001111111', '٠٣٠٠١١١١١١١']) {
    const r = await entry({ phone, count: 1 });
    assert.equal(r.status, 200, phone);
    assert.equal(r.created, false);
  }
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM people WHERE phone = ?').get('+923001111111').n, 1);
});

test('the answer carries today, this week and the overall target, for the person and for everyone', async () => {
  const a = await entry({ phone: '0301 3333333', count: 100, name: 'Sara', city: 'Karachi' });
  const b = await entry({ phone: '0301 4444444', count: 250, name: 'Omar', city: 'Multan' });
  assert.equal(b.you.today, 250);
  assert.equal(b.you.week, 250);
  assert.equal(b.everyone.today, a.everyone.today + 250);
  assert.ok(b.everyone.total >= b.everyone.week && b.everyone.week >= b.everyone.today);
  assert.equal(b.target, 100_000_000);
  assert.equal((await entry({ phone: '0301 4444444', count: 50 })).you.today, 300, 'a second entry the same day adds up');
});

test('the figures stay exact: the overall total equals everything added, and each person\'s total equals their days', async () => {
  const raw = env.DB.raw;
  const sumDays = raw.prepare('SELECT SUM(count) n FROM person_days').get().n;
  assert.equal(Number(raw.prepare('SELECT total FROM caravans WHERE id = 1').get().total), sumDays);
  assert.equal(raw.prepare('SELECT SUM(total) n FROM day_totals').get().n, sumDays);
  assert.equal(raw.prepare('SELECT SUM(total) n FROM people').get().n, sumDays);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM people p WHERE p.total != (SELECT SUM(count) FROM person_days d WHERE d.person_id = p.id)').get().n, 0);
});

test('there is no limit per day; only one absurd entry is refused', async () => {
  const phone = '0302 5555555';
  assert.equal((await entry({ phone, count: 4500, name: 'Hamza', city: 'Quetta' })).you.today, 4500);
  assert.equal((await entry({ phone, count: 6600 })).you.today, 11100, 'a second batch the same day is fine');
  assert.equal((await entry({ phone, count: 1_000_001 })).error, 'bad_count');
  for (const count of [0, -5, 1.5, 'x', null]) assert.equal((await entry({ phone, count })).error, 'bad_count', String(count));
});

test('pressing the button twice counts once (same request id), even for a brand new number', async () => {
  const phone = '0302 6666666', rid = crypto.randomUUID();
  const first = await post('/api/entry', { phone, count: 70, rid, name: 'Zainab', city: 'Gujrat' });
  const second = await post('/api/entry', { phone, count: 70, rid, name: 'Zainab', city: 'Gujrat' });
  assert.equal(first.you.today, 70);
  assert.equal(second.duplicate, true);
  assert.equal(second.you.today, 70);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM people WHERE phone = ?').get('+923026666666').n, 1);
  assert.equal((await post('/api/entry', { phone, count: 70, rid: 'x' })).error, 'bad_request');
});

test('weeks start on Monday and days are Pakistan time', () => {
  assert.equal(weekStart('2026-10-26'), '2026-10-26');
  assert.equal(weekStart('2026-11-01'), '2026-10-26');
  assert.equal(weekStart('2026-11-02'), '2026-11-02');
  assert.equal(dayOf(Date.parse('2026-10-26T19:30:00Z')), '2026-10-27');
  assert.equal(normalisePhone('0300 1234567'), '+923001234567');
  assert.equal(normalisePhone('12'), null);
});

test('the city list and the health check are served; bad bodies and big bodies are refused', async () => {
  const c = await call('GET', '/api/cities');
  assert.ok(c.cities.includes('Lahore') && c.cities.at(-1) === 'Other' && c.cities.length > 90);
  const h = await call('GET', '/healthz');
  assert.equal(h.ok, true);
  assert.equal(h.backup.configured, false);
  const res = await worker.fetch(new Request('https://x.test/api/check', { method: 'POST', body: '{nope', headers: { 'CF-Connecting-IP': '9.9.9.9' } }), env);
  assert.equal(res.status, 400);
  const big = await worker.fetch(new Request('https://x.test/api/check', { method: 'POST', body: 'x'.repeat(5000), headers: { 'CF-Connecting-IP': '9.9.9.8' } }), env);
  assert.equal(big.status, 413);
  assert.equal((await call('GET', '/nothing')).status, 404);
});

test('too many tries from one address in a minute are slowed down', async () => {
  let last;
  for (let i = 0; i < 70; i++) last = await worker.fetch(new Request('https://x.test/api/check', { method: 'POST', body: '{"phone":"0300 9999999"}', headers: { 'CF-Connecting-IP': '8.8.8.8' } }), env);
  assert.equal(last.status, 429);
});

test('the backup payload has everyone, the recent days per person and the totals', async () => {
  const p = await backupPayload(env.DB);
  assert.ok(p.people.length >= 6);
  assert.deepEqual(p.people[0], { phone: '+923001111111', name: 'Amina Khan', city: 'Lahore', joined: dayOf(), caravan: firstSlug(env) });
  assert.equal(p.daily.find((r) => r.phone === '+923001111111').count, 318, 'all the entries of the day are one row (313 + 5 later)');
  assert.equal(p.totals.total, Number(env.DB.raw.prepare('SELECT SUM(total) t FROM caravans').get().t));
  assert.equal(p.from, dayOf(Date.now() - 2 * 86400e3));
});

test('sending a backup: the token goes with it; the result is recorded; failures never throw', async () => {
  const sent = [];
  const good = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, rows: 7 })); };
  assert.deepEqual(await sendBackup(env.DB, { url: 'https://sheet.test/exec', token: 'sekrit', fetchImpl: good }), { ok: true, rows: 7 });
  assert.equal(sent[0].token, 'sekrit');
  let st = await backupStatus(env.DB, true);
  assert.ok(st.lastOkAt > Date.now() - 5000 && st.lastError === null || st.lastError === '');
  const bad = async () => new Response(JSON.stringify({ ok: false, error: 'bad token' }), { status: 200 });
  assert.match((await sendBackup(env.DB, { url: 'https://sheet.test/exec', token: 'x', fetchImpl: bad })).error, /bad token/);
  st = await backupStatus(env.DB, true);
  assert.match(st.lastError, /bad token/);
  assert.ok(st.lastOkAt, 'a failure does not erase the last good time');
  assert.equal((await sendBackup(env.DB, { url: '', token: 'x' })).error, 'not_configured');
  const down = async () => { throw new Error('network down'); };
  assert.equal((await sendBackup(env.DB, { url: 'https://sheet.test/exec', token: 'x', fetchImpl: down })).ok, false);
});

test('the scheduled run backs up and prunes old request ids', async () => {
  const sent = [];
  const e2 = { DB: env.DB, SHEETS_URL: 'https://sheet.test/exec', SHEETS_TOKEN: 't' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true })); };
  try {
    const waits = [];
    await worker.scheduled({}, e2, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(sent.length, 1);
  env.DB.raw.prepare('INSERT INTO rids (rid, created_at) VALUES (?, ?)').run('old-request-id', Date.now() - 3 * 86400e3);
  await pruneRids(env.DB);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM rids WHERE rid = 'old-request-id'").get().n, 0);
});

test('/api/backup runs a backup only for the holder of the secret', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, rows: 4 })); };
  try {
    const e2 = { DB: env.DB, SHEETS_URL: 'https://sheet.test/exec', SHEETS_TOKEN: 'sekrit' };
    const ask = (headers) => worker.fetch(new Request('https://x.test/api/backup', { method: 'POST', headers }), e2);
    assert.equal((await ask({})).status, 403, 'no secret');
    assert.equal((await ask({ 'x-backup-token': 'wrong' })).status, 403);
    assert.equal((await ask({ 'x-backup-token': 'sekrit!' })).status, 403, 'a longer guess');
    assert.equal(sent.length, 0);
    const ok = await ask({ 'x-backup-token': 'sekrit' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, rows: 4 });
    assert.equal(sent.length, 1);
    const none = await worker.fetch(new Request('https://x.test/api/backup', { method: 'POST', headers: { 'x-backup-token': '' } }), { DB: env.DB });
    assert.equal(none.status, 403, 'with no secret configured nobody gets in');
  } finally { globalThis.fetch = realFetch; }
});

test('the public stats show made-up names, cities and totals, and no phone numbers or real names', async () => {
  const e = { DB: createD1() };
  e.DB.raw.exec('UPDATE caravans SET target = 1000');
  await entry({ phone: '0300 5550001', count: 500, name: 'Zainab Secret', city: 'Lahore' }, e);
  await entry({ phone: '0300 5550002', count: 200, name: 'Hamza Private', city: 'Lahore' }, e);
  await entry({ phone: '0300 5550003', count: 50, name: 'Idris Hidden', city: 'Karachi' }, e);
  const r = await call('GET', '/api/stats', null, e);
  assert.equal(r.status, 200);
  assert.equal(r.total, 750); assert.equal(r.today, 750); assert.equal(r.members, 3); assert.equal(r.target, 1000);
  assert.deepEqual(r.cities.map((c) => [c.city, c.total, c.members]), [['Lahore', 700, 2], ['Karachi', 50, 1]]);
  assert.deepEqual(r.top.all.map((p) => p.count), [500, 200, 50]);
  assert.equal(r.daily.length, 14); assert.equal(r.daily.at(-1).total, 750);
  assert.equal(r.active.today, 3);
  const text = JSON.stringify(r);
  for (const secret of ['Zainab', 'Secret', 'Hamza', 'Idris', '555000', '+92']) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.match(r.top.all[0].name, /^[A-Z][a-z]+ [A-Z][a-z]+ \d{3}$/);
  assert.equal(r.top.all[0].name, (await call('GET', '/api/stats', null, e)).top.all[0].name, 'the same person keeps the same name');
});

// ---- caravans ----
const ADMIN = { ADMIN_KEY: 'a-long-admin-key' };
const admin = async (method, body, key = ADMIN.ADMIN_KEY, e) => {
  const res = await worker.fetch(new Request('https://x.test/api/admin/caravans', { method, body: body ? JSON.stringify(body) : undefined, headers: { 'x-admin-key': key, 'CF-Connecting-IP': `10.1.0.${++ip % 250}` } }), { ...e, ...ADMIN });
  return { status: res.status, ...(await res.json()) };
};

test('admin: only the admin key creates or lists caravans', async () => {
  const e = { DB: createD1() };
  assert.equal((await admin('GET', null, 'wrong', e)).status, 403);
  assert.equal((await admin('POST', { name: 'Hack' }, '', e)).status, 403);
  const noKey = await worker.fetch(new Request('https://x.test/api/admin/caravans', { headers: { 'CF-Connecting-IP': '10.9.9.9' } }), { DB: e.DB });
  assert.equal(noKey.status, 403, 'with no key set on the server nobody gets in');
  const made = await admin('POST', { name: 'Faisalabad Team' }, undefined, e);
  assert.equal(made.status, 200);
  assert.equal(made.slug, 'faisalabad-team');
  assert.equal((await admin('POST', { name: 'Faisalabad  Team' }, undefined, e)).slug, 'faisalabad-team-2', 'a name that is taken gets a number');
  assert.equal(made.target, 100_000_000);
  assert.equal((await admin('POST', { name: 'X' }, undefined, e)).error, 'need_name');
  assert.equal((await admin('POST', { name: 'Big', target: 'lots' }, undefined, e)).error, 'bad_target');
  assert.equal((await admin('POST', { name: 'Small', target: 500 }, undefined, e)).target, 500);
  const list = await admin('GET', null, undefined, e);
  assert.deepEqual(list.caravans.map((c) => c.name), ['Tasbeeh', 'Faisalabad Team', 'Faisalabad  Team'.replace(/\s+/g, ' '), 'Small']);
});

test('caravans are separate: members, counts, stats, and the same number can be in two', async () => {
  const e = { DB: createD1() };
  const a = await admin('POST', { name: 'Team A', target: 1000 }, undefined, e);
  const b = await admin('POST', { name: 'Team B' }, undefined, e);
  const go = (path, body, caravan) => call('POST', path, { caravan, ...body }, e);
  const phone = '0300 7770001';
  assert.equal((await go('/api/entry', { rid: crypto.randomUUID(), phone, count: 100, name: 'Sana', city: 'Lahore' }, a.slug)).you.total, 100);
  assert.equal((await go('/api/check', { phone }, a.slug)).known, true);
  assert.equal((await go('/api/check', { phone }, b.slug)).known, false, 'not a member of B yet');
  assert.equal((await go('/api/check', { phone }, firstSlug(e))).known, false, 'nor of the first caravan');
  assert.equal((await go('/api/entry', { rid: crypto.randomUUID(), phone, count: 7 }, b.slug)).error, 'need_name');
  const inB = await go('/api/entry', { rid: crypto.randomUUID(), phone, count: 7, name: 'Sana', city: 'Karachi' }, b.slug);
  assert.deepEqual([inB.you.total, inB.everyone.total, inB.caravan.name], [7, 7, 'Team B']);
  const inA = await go('/api/entry', { rid: crypto.randomUUID(), phone, count: 5 }, a.slug);
  assert.deepEqual([inA.you.total, inA.everyone.total, inA.target], [105, 105, 1000]);
  const sa = await call('GET', `/api/stats?c=${a.slug}`, null, e), sb = await call('GET', `/api/stats?c=${b.slug}`, null, e), sm = await call('GET', `/api/stats?c=${firstSlug(e)}`, null, e);
  assert.deepEqual([sa.total, sb.total, sm.total], [105, 7, 0]);
  assert.deepEqual([sa.members, sb.members, sm.members], [1, 1, 0]);
  assert.deepEqual(sa.cities.map((c) => c.city), ['Lahore']);
  assert.deepEqual(sb.cities.map((c) => c.city), ['Karachi']);
  assert.equal(sa.name, 'Team A');
});

test('an unknown or malformed caravan link is refused, and the caravan pages are served for a link', async () => {
  const e = { DB: createD1(), ASSETS: { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`) } };
  assert.equal((await call('GET', '/api/caravan?c=nope-12345', null, e)).error, 'no_caravan');
  assert.equal((await call('GET', '/api/caravan?c=../etc', null, e)).error, 'no_caravan');
  assert.equal((await call('POST', '/api/check', { caravan: 'nope-12345', phone: '0300 1112223' }, e)).error, 'no_caravan');
  assert.equal((await call('GET', '/api/caravan', null, e)).name, 'Tasbeeh');
  const text = async (path) => (await worker.fetch(new Request(`https://x.test${path}`), e)).text();
  assert.equal(await text('/c/team-a-abcde'), 'asset /count');
  assert.equal(await text('/c/team-a-abcde/stats'), 'asset /stats');
});

test('there is no caravan-less link: the API needs a caravan, and the plain address is only a landing page', async () => {
  const e = { DB: createD1(), ASSETS: { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`) } };
  const bare = async (method, path, body) => { const r = await worker.fetch(new Request(`https://x.test${path}`, { method, body: body && JSON.stringify(body), headers: { 'CF-Connecting-IP': '10.2.0.1' } }), e); return { status: r.status, text: await r.text() }; };
  for (const [m, p, b] of [['GET', '/api/stats'], ['GET', '/api/caravan'], ['POST', '/api/check', { phone: '0300 1112223' }], ['POST', '/api/entry', { rid: crypto.randomUUID(), phone: '0300 1112223', count: 5, name: 'Ali', city: 'Lahore' }]]) {
    const r = await bare(m, p, b); assert.equal(r.status, 404, `${m} ${p}`); assert.match(r.text, /no_caravan/);
  }
  assert.equal(e.DB.raw.prepare('SELECT COUNT(*) n FROM people').get().n, 0, 'nothing was counted');
  assert.match(firstSlug(e), /^tasbeeh-[0-9a-f]{8}$/, 'the first caravan has an unguessable link of its own');
  assert.equal((await bare('GET', '/')).text, 'asset /');
});

test('the stats page also carries everyone, and the caravans ranked against each other without their link names', async () => {
  const e = { DB: createD1() };
  const a = await admin('POST', { name: 'Team A', target: 1000 }, undefined, e), b = await admin('POST', { name: 'Team B', target: 2000 }, undefined, e);
  const go = (caravan, phone, count, city) => call('POST', '/api/entry', { caravan, rid: crypto.randomUUID(), phone, count, name: 'Person Name', city }, e);
  await go(a.slug, '0300 8880001', 300, 'Lahore'); await go(b.slug, '0300 8880002', 900, 'Karachi'); await go(b.slug, '0300 8880003', 100, 'Lahore');
  const r = await call('GET', `/api/stats?c=${a.slug}`, null, e);
  assert.deepEqual([r.name, r.total, r.members], ['Team A', 300, 1]);
  assert.deepEqual([r.global.total, r.global.members, r.global.today, r.global.target], [1300, 3, 1300, 100_000_000 + 1000 + 2000]);
  assert.deepEqual(r.global.cities.map((c) => [c.city, c.total]), [['Karachi', 900], ['Lahore', 400]]);
  assert.deepEqual(r.global.top.all.map((p) => p.count), [900, 300, 100]);
  assert.deepEqual(r.caravans.map((c) => [c.name, c.total, c.members, c.mine]), [['Team B', 1000, 2, false], ['Team A', 300, 1, true], ['Tasbeeh', 0, 0, false]]);
  const text = JSON.stringify(r);
  assert.ok(!text.includes(a.slug) && !text.includes(b.slug) && !text.includes(firstSlug(e)), 'no caravan link name is ever shown');
  const rb = await call('GET', `/api/stats?c=${b.slug}`, null, e);
  assert.deepEqual(rb.caravans.filter((c) => c.mine).map((c) => c.name), ['Team B']);
});
