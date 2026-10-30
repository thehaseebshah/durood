// Puts the data back from the two sheets downloaded as CSV: node restore.mjs People.csv Daily.csv
// Safe to run again: people are matched by phone number and each day's count is only added once.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server.js';

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some((x) => x !== '')) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

/** Loads people and daily rows (arrays of cells, header first) into a database. Returns what was added. */
export function restore(db, peopleRows, dailyRows) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  let people = 0, days = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [phone, name, city, joined] of peopleRows.slice(1)) {
      if (!phone || one('SELECT 1 FROM people WHERE phone = ?', phone)) continue;
      const t = Date.parse(`${joined}T00:00:00Z`) || Date.now();
      db.prepare('INSERT INTO people (phone, name, city, created_at) VALUES (?,?,?,?)').run(phone, name, city, t);
      people += 1;
    }
    for (const [day, phone, count] of dailyRows.slice(1)) {
      const p = one('SELECT id FROM people WHERE phone = ?', phone), n = Number(count);
      if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(n) || n < 1) continue;
      const rid = `restore-${day}-${phone}`;
      if (one('SELECT 1 FROM entries WHERE rid = ?', rid)) continue;
      // what is already there for that day (from live use after a partial restore) is topped up to the sheet's figure, never lowered
      const have = one('SELECT COALESCE(SUM(count), 0) n FROM entries WHERE person_id = ? AND day = ?', p.id, day).n;
      if (n > have) { db.prepare('INSERT INTO entries (person_id, day, count, rid, created_at) VALUES (?,?,?,?,?)').run(p.id, day, n - have, rid, Date.now()); days += 1; }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { people, days };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [peopleFile, dailyFile] = process.argv.slice(2);
  if (!peopleFile || !dailyFile) { console.error('Usage: node restore.mjs People.csv Daily.csv'); process.exit(2); }
  const app = createApp();
  const r = restore(app.db, parseCsv(fs.readFileSync(peopleFile, 'utf8')), parseCsv(fs.readFileSync(dailyFile, 'utf8')));
  console.log(`Restored ${r.people} people and ${r.days} day totals.`);
  process.exit(0);
}
