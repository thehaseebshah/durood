import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../src/worker.js';
import { backupPayload } from '../src/logic.js';
import { parseCsv, restoreSql } from '../scripts/restore-sql.mjs';
import { createD1 } from './d1.js';

const csvOf = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');

test('restore: a new database gets the people and the counts back from the two CSV downloads, and doing it twice changes nothing', async () => {
  const old = { DB: createD1() };
  const entry = (b) => worker.fetch(new Request('https://x.test/api/entry', { method: 'POST', body: JSON.stringify({ rid: crypto.randomUUID(), caravan: old.DB.raw.prepare('SELECT slug FROM caravans ORDER BY id').get().slug, ...b }), headers: { 'CF-Connecting-IP': '1.1.1.1' } }), old);
  await entry({ phone: '0300 1000001', count: 313, name: 'Amina', city: 'Lahore' });
  await entry({ phone: '0300 1000002', count: 4500, name: "Bilal O'Neil, \"the\" second", city: 'Multan' });
  await entry({ phone: '0300 1000001', count: 100 });
  const p = await backupPayload(old.DB);
  const peopleCsv = csvOf([['phone', 'name', 'city', 'joined', 'caravan'], ...p.people.map((x) => [x.phone, x.name, x.city, x.joined, x.caravan])]);
  const dailyCsv = csvOf([['day', 'phone', 'count', 'caravan'], ...p.daily.map((x) => [x.day, x.phone, x.count, x.caravan])]);
  assert.equal(parseCsv(peopleCsv)[2][1], "Bilal O'Neil, \"the\" second");

  const fresh = createD1();
  const carCsv = csvOf([['slug', 'name', 'target'], ...p.caravans.map((c) => [c.slug, c.name, c.target])]);
  const sql = restoreSql(parseCsv(peopleCsv), parseCsv(dailyCsv), parseCsv(carCsv));
  fresh.raw.exec(sql);
  const total = () => Number(fresh.raw.prepare('SELECT SUM(total) t FROM caravans').get().t);
  assert.equal(total(), 4913);
  assert.equal(fresh.raw.prepare('SELECT COUNT(*) n FROM people').get().n, 2);
  assert.equal(fresh.raw.prepare("SELECT name FROM people WHERE phone = '+923001000002'").get().name, "Bilal O'Neil, \"the\" second");
  assert.equal(fresh.raw.prepare("SELECT total FROM people WHERE phone = '+923001000001'").get().total, 413);
  fresh.raw.exec(sql);
  assert.equal(total(), 4913, 'again changes nothing');
  assert.equal(fresh.raw.prepare('SELECT COUNT(*) n FROM person_days').get().n, 2);
  // the restored database works: the next entry adds on top
  const next = await worker.fetch(new Request('https://x.test/api/entry', { method: 'POST', body: JSON.stringify({ rid: crypto.randomUUID(), caravan: fresh.raw.prepare('SELECT slug FROM caravans ORDER BY id').get().slug, phone: '0300 1000001', count: 7 }), headers: { 'CF-Connecting-IP': '1.1.1.2' } }), { DB: fresh });
  assert.equal((await next.json()).you.today, 420);
});

test('restore ignores broken rows and cannot be used for SQL injection', () => {
  const sql = restoreSql([['phone', 'name', 'city', 'joined'], ['+923009999999', "x'); DROP TABLE people; --", 'Lahore', '2026-10-01'], ['not a phone', 'n', 'c', 'j']], [['day', 'phone', 'count'], ['2026-10-01', '+923009999999', '5'], ['bad', '+923009999999', '5'], ['2026-10-02', '+923009999999', '-3']]);
  const db = createD1();
  db.raw.exec(sql);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM people').get().n, 1);
  assert.equal(db.raw.prepare('SELECT name FROM people').get().name, "x'); DROP TABLE people; --");
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM person_days').get().n, 1);
});

test('restore puts every caravan back, with the same phone number kept apart in each', async () => {
  const old = { DB: createD1() };
  old.DB.raw.exec("INSERT INTO caravans (slug, name, target, total, created_at) VALUES ('team-a-abcde', 'Team A', 5000, 0, 0)");
  const entry = (b) => worker.fetch(new Request('https://x.test/api/entry', { method: 'POST', body: JSON.stringify({ rid: crypto.randomUUID(), caravan: old.DB.raw.prepare('SELECT slug FROM caravans ORDER BY id').get().slug, ...b }), headers: { 'CF-Connecting-IP': '2.2.2.2' } }), old);
  await entry({ phone: '0300 1000009', count: 10, name: 'Sana', city: 'Lahore' });
  await entry({ phone: '0300 1000009', count: 70, name: 'Sana', city: 'Lahore', caravan: 'team-a-abcde' });
  const p = await backupPayload(old.DB);
  const first = p.caravans[0].slug;
  assert.deepEqual(p.caravans.map((c) => c.slug), [first, 'team-a-abcde']);
  const peopleCsv = csvOf([['phone', 'name', 'city', 'joined', 'caravan'], ...p.people.map((x) => [x.phone, x.name, x.city, x.joined, x.caravan])]);
  const dailyCsv = csvOf([['day', 'phone', 'count', 'caravan'], ...p.daily.map((x) => [x.day, x.phone, x.count, x.caravan])]);
  const carCsv = csvOf([['slug', 'name', 'target'], ...p.caravans.map((c) => [c.slug, c.name, c.target])]);
  const fresh = createD1();
  fresh.raw.exec(restoreSql(parseCsv(peopleCsv), parseCsv(dailyCsv), parseCsv(carCsv)));
  const rows = fresh.raw.prepare('SELECT c.slug, c.name, c.target, c.total ctotal, p.total ptotal FROM caravans c JOIN people p ON p.caravan_id = c.id ORDER BY c.id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ slug: first, name: 'Tasbeeh', target: 100000000, ctotal: 10, ptotal: 10 }, { slug: 'team-a-abcde', name: 'Team A', target: 5000, ctotal: 70, ptotal: 70 }]);
});
