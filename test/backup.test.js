import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../server.js';
import { buildPayload, sendBackup, startBackups } from '../backup.js';
import { restore, parseCsv } from '../restore.mjs';

const app = createApp({ dbPath: ':memory:' });
await new Promise((r) => app.server.listen(0, r));
const base = `http://127.0.0.1:${app.server.address().port}`;
after(() => app.server.close());
const entry = async (b) => (await fetch(base + '/api/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rid: crypto.randomUUID(), ...b }) })).json();

// a stand-in for the Google Apps Script web app
function receiver(answer = { ok: true, rows: 3 }) {
  const got = [];
  const server = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; got.push(JSON.parse(b)); res.writeHead(answer.ok ? 200 : 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(answer)); });
  return new Promise((r) => server.listen(0, () => r({ got, url: `http://127.0.0.1:${server.address().port}/exec`, close: () => server.close() })));
}

await entry({ phone: '0300 1000001', count: 313, name: 'Amina', city: 'Lahore' });
await entry({ phone: '0300 1000002', count: 4500, name: 'Bilal, "the" second', city: 'Multan' });
await entry({ phone: '0300 1000001', count: 100 });

test('the payload has everyone, the recent days per person, and the totals', () => {
  const p = buildPayload(app.db);
  assert.equal(p.people.length, 2);
  assert.deepEqual(p.people[0], { phone: '+923001000001', name: 'Amina', city: 'Lahore', joined: app.dayOf() });
  const amina = p.daily.find((r) => r.phone === '+923001000001');
  assert.equal(amina.count, 413, 'two entries the same day are one row');
  assert.deepEqual(p.totals, { people: 2, total: 4913, today: 4913 });
  assert.equal(p.from, app.dayOf(Date.now() - 2 * 86400e3), 'the last three days');
});

test('a backup is posted with the secret token; the sheet answering ok is a success', async () => {
  const r = await receiver();
  const out = await sendBackup({ db: app.db, url: r.url, token: 'sekrit' });
  assert.deepEqual(out, { ok: true, rows: 3 });
  assert.equal(r.got[0].token, 'sekrit');
  assert.equal(r.got[0].people.length, 2);
  r.close();
});

test('failures never throw: a refusing sheet, no address, no network', async () => {
  const bad = await receiver({ ok: false, error: 'bad token' });
  assert.match((await sendBackup({ db: app.db, url: bad.url, token: 'x' })).error, /bad token/);
  bad.close();
  assert.equal((await sendBackup({ db: app.db, url: '', token: 'x' })).error, 'not_configured');
  assert.equal((await sendBackup({ db: app.db, url: 'http://127.0.0.1:1/none', token: 'x' })).ok, false);
});

test('the scheduler records the last good backup and the last error, and shows it on /healthz', async () => {
  const good = await receiver();
  const quiet = { log() {}, error() {} };
  const b = startBackups({ db: app.db, url: good.url, token: 't', hours: '6,18', log: quiet });
  assert.equal((await b.runNow()).ok, true);
  assert.ok(b.status().lastOkAt > Date.now() - 5000);
  assert.deepEqual(b.status().hours, [6, 18]);
  b.stop(); good.close();
  const off = startBackups({ db: app.db, url: '', log: quiet });
  assert.equal(off.status().configured, false);
  const health = await (await fetch(base + '/healthz')).json();
  assert.equal(health.ok, true);
  assert.equal(health.backup.configured, false);
});

test('restore: a new server gets the people and the counts back from the two CSV downloads, and doing it twice adds nothing', async () => {
  const csvOf = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
  const p = buildPayload(app.db);
  const peopleCsv = csvOf([['phone', 'name', 'city', 'joined'], ...p.people.map((x) => [x.phone, x.name, x.city, x.joined])]);
  const dailyCsv = csvOf([['day', 'phone', 'count'], ...p.daily.map((x) => [x.day, x.phone, x.count])]);
  assert.equal(parseCsv(peopleCsv)[2][1], 'Bilal, "the" second', 'quotes and commas survive');
  const fresh = createApp({ dbPath: ':memory:' });
  const r1 = restore(fresh.db, parseCsv(peopleCsv), parseCsv(dailyCsv));
  assert.deepEqual(r1, { people: 2, days: 2 });
  const total = () => fresh.db.prepare('SELECT COALESCE(SUM(count), 0) n FROM entries').get().n;
  assert.equal(total(), 4913);
  assert.deepEqual(restore(fresh.db, parseCsv(peopleCsv), parseCsv(dailyCsv)), { people: 0, days: 0 }, 'again changes nothing');
  assert.equal(total(), 4913);
  fresh.server.close();
});
