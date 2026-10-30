import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../server.js';

let app, base;
before(async () => { app = createApp({ dbPath: ':memory:' }); await new Promise((r) => app.server.listen(0, r)); base = `http://127.0.0.1:${app.server.address().port}`; });
after(() => app.server.close());
const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
const entry = (b) => post('/api/entry', { rid: crypto.randomUUID(), ...b });

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
  const ok = await entry({ phone, count: 10, name: '  Bilal   Ahmad ', city: 'Other' });
  assert.equal(ok.status, 200);
  assert.equal(app.db.prepare('SELECT name FROM people WHERE phone = ?').get('+923002222222').name, 'Bilal Ahmad');
});

test('a known number only needs the count; the same person is found however the number is written', async () => {
  for (const phone of ['0300-1111111', '+92 300 1111111', '923001111111', '00923001111111', '٠٣٠٠١١١١١١١']) {
    const r = await entry({ phone, count: 1 });
    assert.equal(r.status, 200, phone);
    assert.equal(r.created, false);
  }
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM people WHERE phone = ?').get('+923001111111').n, 1);
});

test('the answer carries today, this week and the overall target, for the person and for everyone', async () => {
  const a = await entry({ phone: '0301 3333333', count: 100, name: 'Sara', city: 'Karachi' });
  const b = await entry({ phone: '0301 4444444', count: 250, name: 'Omar', city: 'Multan' });
  assert.equal(b.you.today, 250);
  assert.equal(b.you.week, 250);
  assert.equal(b.everyone.today, a.everyone.today + 250, 'everyone grows by what was added');
  assert.ok(b.everyone.total >= b.everyone.week && b.everyone.week >= b.everyone.today);
  assert.equal(b.target, 100_000_000);
  const more = await entry({ phone: '0301 4444444', count: 50 });
  assert.equal(more.you.today, 300, 'a second entry the same day adds up');
});

test('there is no limit per day; only one absurd entry is refused', async () => {
  const phone = '0302 5555555';
  assert.equal((await entry({ phone, count: 4500, name: 'Hamza', city: 'Quetta' })).you.today, 4500);
  assert.equal((await entry({ phone, count: 6600 })).you.today, 11100, 'a second batch the same day is fine');
  assert.equal((await entry({ phone, count: 1_000_001 })).error, 'bad_count');
  for (const count of [0, -5, 1.5, 'x', null]) assert.equal((await entry({ phone, count })).error, 'bad_count', String(count));
});

test('pressing the button twice counts once (same request id)', async () => {
  const phone = '0302 6666666', rid = crypto.randomUUID();
  const first = await post('/api/entry', { phone, count: 70, rid, name: 'Zainab', city: 'Gujrat' });
  const second = await post('/api/entry', { phone, count: 70, rid });
  assert.equal(first.you.today, 70);
  assert.equal(second.duplicate, true);
  assert.equal(second.you.today, 70);
  assert.equal((await post('/api/entry', { phone, count: 70, rid: 'x' })).error, 'bad_request');
});

test('the weeks start on Monday and days are Pakistan time', () => {
  assert.equal(app.weekStart('2026-10-26'), '2026-10-26'); // a Monday
  assert.equal(app.weekStart('2026-11-01'), '2026-10-26'); // the Sunday before the next Monday
  assert.equal(app.weekStart('2026-11-02'), '2026-11-02');
  assert.equal(app.dayOf(Date.parse('2026-10-26T19:30:00Z')), '2026-10-27', '00:30 in Pakistan is already the next day');
});

test('the page, its files and the city list are served; nothing else on the disk is', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Phone number/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  const { cities } = await (await fetch(base + '/api/cities')).json();
  assert.ok(cities.includes('Lahore') && cities.at(-1) === 'Other' && cities.length > 90);
  assert.equal((await fetch(base + '/server.js')).status, 404);
  assert.equal((await fetch(base + '/..%2fserver.js')).status, 404);
  assert.equal((await fetch(base + '/../package.json')).status, 404);
  assert.equal((await fetch(base + '/healthz')).status, 200);
});

test('too many tries in a minute are slowed down', async () => {
  let last;
  for (let i = 0; i < 70; i++) last = await post('/api/check', { phone: '0300 9999999' });
  assert.equal(last.status, 429);
});
