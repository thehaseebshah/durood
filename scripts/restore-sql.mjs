// Turns the two sheets, downloaded as CSV, into SQL that puts the data back:
//   node scripts/restore-sql.mjs People.csv Daily.csv [Caravans.csv] > restore.sql
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

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const slugOr = (v) => (SLUG.test(v || '') ? v : '');   // an older backup has no caravan column: those rows belong to the first caravan

/** Rows have a trailing `caravan` column (the caravan's link name); older backups without it go to the first caravan. */
export function restoreSql(peopleRows, dailyRows, caravanRows = []) {
  const out = [];
  const known = new Set();
  caravanRows.slice(1).forEach(([slug, name, target], i) => {
    if (!SLUG.test(slug || '')) return;
    known.add(slug);
    // into a brand new database the first caravan takes the old one's name and link, so the links people already have keep working
    if (i === 0) out.push(`UPDATE caravans SET slug = ${q(slug)}, name = ${q(name || slug)}, target = ${Math.max(1, Number(target) || 100000000)} WHERE id = (SELECT MIN(id) FROM caravans) AND (SELECT COUNT(*) FROM caravans) = 1 AND NOT EXISTS (SELECT 1 FROM people) AND NOT EXISTS (SELECT 1 FROM caravans WHERE slug = ${q(slug)});`);
    out.push(`INSERT OR IGNORE INTO caravans (slug, name, target, total, created_at) VALUES (${q(slug)}, ${q(name || slug)}, ${Math.max(1, Number(target) || 100000000)}, 0, ${Date.now()});`);
  });
  const cid = (slug) => (slug ? `(SELECT id FROM caravans WHERE slug = ${q(slug)})` : '(SELECT MIN(id) FROM caravans)');
  for (const [phone, name, city, joined, caravan] of peopleRows.slice(1)) {
    if (!/^\+\d{10,15}$/.test(phone || '')) continue;
    const slug = slugOr(caravan);
    if (slug && !known.has(slug)) { known.add(slug); out.push(`INSERT OR IGNORE INTO caravans (slug, name, target, total, created_at) VALUES (${q(slug)}, ${q(slug)}, 100000000, 0, ${Date.now()});`); }
    const t = Date.parse(`${joined}T00:00:00Z`) || Date.now();
    out.push(`INSERT OR IGNORE INTO people (caravan_id, phone, name, city, created_at, total) VALUES (${cid(slug)}, ${q(phone)}, ${q(name)}, ${q(city)}, ${t}, 0);`);
  }
  for (const [day, phone, count, caravan] of dailyRows.slice(1)) {
    const n = Number(count);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !/^\+\d{10,15}$/.test(phone || '') || !Number.isInteger(n) || n < 1) continue;
    out.push(`INSERT INTO person_days (person_id, day, count) SELECT id, ${q(day)}, ${n} FROM people WHERE phone = ${q(phone)} AND caravan_id = ${cid(slugOr(caravan))} ON CONFLICT(person_id, day) DO UPDATE SET count = MAX(count, excluded.count);`);
  }
  // the totals are rebuilt from the days, so they are exact whatever was there before
  out.push(
    'UPDATE people SET total = (SELECT COALESCE(SUM(count), 0) FROM person_days WHERE person_id = people.id);',
    'DELETE FROM day_totals;',
    'INSERT INTO day_totals (caravan_id, day, total) SELECT p.caravan_id, d.day, SUM(d.count) FROM person_days d JOIN people p ON p.id = d.person_id GROUP BY p.caravan_id, d.day;',
    'UPDATE caravans SET total = COALESCE((SELECT SUM(total) FROM people WHERE caravan_id = caravans.id), 0);',
  );
  return out.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [peopleFile, dailyFile, caravansFile] = process.argv.slice(2);
  if (!peopleFile || !dailyFile) { console.error('Usage: node scripts/restore-sql.mjs People.csv Daily.csv [Caravans.csv] > restore.sql'); process.exit(2); }
  const read = (f) => parseCsv(fs.readFileSync(f, 'utf8'));
  process.stdout.write(restoreSql(read(peopleFile), read(dailyFile), caravansFile ? read(caravansFile) : []));
}
