// Turns the two sheets, downloaded as CSV, into SQL that puts the data back:
//   node scripts/restore-sql.mjs People.csv Daily.csv > restore.sql
//   npx wrangler d1 execute tasbeeh --remote --file=restore.sql
// Safe to run again: people are matched by phone number, and a day's count is never lowered, so nothing is counted twice.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const q = (v) => `'${String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/'/g, "''")}'`;

export function restoreSql(peopleRows, dailyRows) {
  const out = [];
  for (const [phone, name, city, joined] of peopleRows.slice(1)) {
    if (!/^\+\d{10,15}$/.test(phone || '')) continue;
    const t = Date.parse(`${joined}T00:00:00Z`) || Date.now();
    out.push(`INSERT OR IGNORE INTO people (phone, name, city, created_at, total) VALUES (${q(phone)}, ${q(name)}, ${q(city)}, ${t}, 0);`);
  }
  for (const [day, phone, count] of dailyRows.slice(1)) {
    const n = Number(count);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !/^\+\d{10,15}$/.test(phone || '') || !Number.isInteger(n) || n < 1) continue;
    out.push(`INSERT INTO person_days (person_id, day, count) SELECT id, ${q(day)}, ${n} FROM people WHERE phone = ${q(phone)} ON CONFLICT(person_id, day) DO UPDATE SET count = MAX(count, excluded.count);`);
  }
  // the totals are rebuilt from the days, so they are exact whatever was there before
  out.push(
    'UPDATE people SET total = (SELECT COALESCE(SUM(count), 0) FROM person_days WHERE person_id = people.id);',
    'DELETE FROM day_totals;',
    'INSERT INTO day_totals (day, total) SELECT day, SUM(count) FROM person_days GROUP BY day;',
    "UPDATE meta SET value = (SELECT COALESCE(SUM(count), 0) FROM person_days) WHERE key = 'total';",
  );
  return out.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [peopleFile, dailyFile] = process.argv.slice(2);
  if (!peopleFile || !dailyFile) { console.error('Usage: node scripts/restore-sql.mjs People.csv Daily.csv > restore.sql'); process.exit(2); }
  process.stdout.write(restoreSql(parseCsv(fs.readFileSync(peopleFile, 'utf8')), parseCsv(fs.readFileSync(dailyFile, 'utf8'))));
}
