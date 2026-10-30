import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../src/worker.js';
import { dayOf, weekStart, normalisePhone, backupPayload, sendBackup, backupStatus, pruneRids } from '../src/logic.js';
import { createD1 } from './d1.js';

const env = { DB: createD1(), TARGET: '100000000' };
let ip = 0;
const call = async (method, path, body, e = env) => {
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
  assert.equal(Number(raw.prepare("SELECT value FROM meta WHERE key = 'total'").get().value), sumDays);
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
  assert.deepEqual(p.people[0], { phone: '+923001111111', name: 'Amina Khan', city: 'Lahore', joined: dayOf() });
  assert.equal(p.daily.find((r) => r.phone === '+923001111111').count, 318, 'all the entries of the day are one row (313 + 5 later)');
  assert.equal(p.totals.total, Number(env.DB.raw.prepare("SELECT value FROM meta WHERE key = 'total'").get().value));
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
  const e = { DB: createD1(), TARGET: '1000' };
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
