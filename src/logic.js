// Everything the page needs, written against Cloudflare D1's API (prepare / bind / first / all / run / batch), so it runs on Workers
// and, with a small stand-in for D1, in the unit tests.
import CITIES from '../public/cities.json' with { type: 'json' };

export const OTHER_CITY = 'Other';
export const MAX_ONE_ENTRY = 1_000_000;   // only a guard against an extra zero; there is no limit per day
export class Bad extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

// days are Pakistan time (UTC+5); the week starts on Monday
export const dayOf = (t = Date.now()) => new Date(t + 5 * 3600e3).toISOString().slice(0, 10);
export const weekStart = (day = dayOf()) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

/** '0300 1234567', '+92 300 1234567', '923001234567' -> '+923001234567'; null when it is not a plausible number. */
export function normalisePhone(raw) {
  let d = String(raw ?? '').replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x06f0).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `92${d.slice(1)}`;               // a local Pakistani number
  return d.length >= 10 && d.length <= 15 ? `+${d}` : null;
}

export const cityList = () => [...CITIES, OTHER_CITY];

const num = (v) => Number(v ?? 0);

/** Today, this week and the overall figures for a person and for everyone. A few rows each, however many people there are. */
export async function stats(db, personId, target, now = Date.now()) {
  const today = dayOf(now), wk = weekStart(today);
  const [youToday, youWeek, youTotal, allToday, allWeek, allTotal] = await Promise.all([
    db.prepare('SELECT count n FROM person_days WHERE person_id = ? AND day = ?').bind(personId, today).first(),
    db.prepare('SELECT COALESCE(SUM(count), 0) n FROM person_days WHERE person_id = ? AND day >= ?').bind(personId, wk).first(),
    db.prepare('SELECT total n FROM people WHERE id = ?').bind(personId).first(),
    db.prepare('SELECT total n FROM day_totals WHERE day = ?').bind(today).first(),
    db.prepare('SELECT COALESCE(SUM(total), 0) n FROM day_totals WHERE day >= ?').bind(wk).first(),
    db.prepare("SELECT value n FROM meta WHERE key = 'total'").first(),
  ]);
  return {
    you: { today: num(youToday?.n), week: num(youWeek?.n), total: num(youTotal?.n) },
    everyone: { today: num(allToday?.n), week: num(allWeek?.n), total: num(allTotal?.n) },
    target,
  };
}

export async function check(db, { phone }) {
  const p = normalisePhone(phone);
  if (!p) throw new Bad(400, 'bad_phone');
  return { known: !!(await db.prepare('SELECT 1 x FROM people WHERE phone = ?').bind(p).first()) };
}

/** Adds today's count. A number we do not know must come with a name and a city from the list. */
export async function addEntry(db, { phone, count, rid, name, city }, target, now = Date.now()) {
  const p = normalisePhone(phone);
  if (!p) throw new Bad(400, 'bad_phone');
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > MAX_ONE_ENTRY) throw new Bad(400, 'bad_count');
  if (typeof rid !== 'string' || !/^[\w-]{8,64}$/.test(rid)) throw new Bad(400, 'bad_request');
  const today = dayOf(now);
  let person = await db.prepare('SELECT id FROM people WHERE phone = ?').bind(p).first();
  let nm = '', ct = '';
  if (!person) {
    nm = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if ([...nm].length < 2 || [...nm].length > 60) throw new Bad(422, 'need_name');
    if (!CITIES.includes(city) && city !== OTHER_CITY) throw new Bad(422, 'need_city');
    ct = city;
  }
  // one batch = one transaction. The first statement fails when this request id was already used, which undoes everything: a retry counts once.
  try {
    await db.batch([
      db.prepare('INSERT INTO rids (rid, created_at) VALUES (?, ?)').bind(rid, now),
      db.prepare('INSERT OR IGNORE INTO people (phone, name, city, created_at, total) VALUES (?, ?, ?, ?, 0)').bind(p, nm || 'unknown', ct || OTHER_CITY, now),
      db.prepare('INSERT INTO person_days (person_id, day, count) SELECT id, ?, ? FROM people WHERE phone = ? ON CONFLICT(person_id, day) DO UPDATE SET count = count + excluded.count').bind(today, n, p),
      db.prepare('UPDATE people SET total = total + ? WHERE phone = ?').bind(n, p),
      db.prepare('INSERT INTO day_totals (day, total) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET total = total + excluded.total').bind(today, n),
      db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + ? WHERE key = 'total'").bind(n),
    ]);
  } catch (e) {
    if (!/UNIQUE|constraint/i.test(String(e?.message || e))) throw e;
    person = await db.prepare('SELECT id FROM people WHERE phone = ?').bind(p).first();
    return { ok: true, created: false, duplicate: true, ...(person ? await stats(db, person.id, target, now) : {}) };
  }
  person = await db.prepare('SELECT id FROM people WHERE phone = ?').bind(p).first();
  return { ok: true, created: nm !== '', duplicate: false, ...(await stats(db, person.id, target, now)) };
}

/** What the Google Sheet gets: everyone, each person's total per day for the last few days, and the overall figures. */
export async function backupPayload(db, { now = Date.now(), days = 3 } = {}) {
  const today = dayOf(now), from = dayOf(now - (days - 1) * 86400e3);
  const people = (await db.prepare('SELECT phone, name, city, created_at FROM people ORDER BY id').all()).results
    .map((r) => ({ phone: r.phone, name: r.name, city: r.city, joined: dayOf(r.created_at) }));
  const daily = (await db.prepare('SELECT d.day, p.phone, d.count FROM person_days d JOIN people p ON p.id = d.person_id WHERE d.day >= ? ORDER BY d.day, p.id').bind(from).all()).results
    .map((r) => ({ day: r.day, phone: r.phone, count: r.count }));
  const total = num((await db.prepare("SELECT value n FROM meta WHERE key = 'total'").first())?.n);
  const todayTotal = num((await db.prepare('SELECT total n FROM day_totals WHERE day = ?').bind(today).first())?.n);
  return { sentAt: new Date(now).toISOString(), from, today, people, daily, totals: { people: people.length, total, today: todayTotal } };
}

/** One backup to the sheet; never throws. Records the result in `meta` so /healthz can show it. */
export async function sendBackup(db, { url, token, fetchImpl = fetch, now = Date.now() }) {
  if (!url) return { ok: false, error: 'not_configured' };
  const record = (ok, error) => db.batch([
    db.prepare("INSERT INTO meta (key, value) VALUES ('backup_ok_at', ?) ON CONFLICT(key) DO UPDATE SET value = CASE WHEN ? THEN excluded.value ELSE value END").bind(String(now), ok ? 1 : 0),
    db.prepare("INSERT INTO meta (key, value) VALUES ('backup_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(ok ? '' : String(error).slice(0, 200)),
  ]).catch(() => {});
  try {
    const res = await fetchImpl(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, ...(await backupPayload(db, { now })) }), signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let out; try { out = JSON.parse(text); } catch { out = null; }
    if (!res.ok || !out?.ok) { const error = `the sheet answered ${res.status}: ${(out?.error || text).slice(0, 120)}`; await record(false, error); return { ok: false, error }; }
    await record(true);
    return { ok: true, rows: out.rows ?? null };
  } catch (e) { const error = String(e?.message || e).slice(0, 160); await record(false, error); return { ok: false, error }; }
}

export async function backupStatus(db, configured) {
  const rows = (await db.prepare("SELECT key, value FROM meta WHERE key IN ('backup_ok_at', 'backup_error')").all()).results;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { configured, lastOkAt: Number(m.backup_ok_at) || null, lastError: m.backup_error || null };
}

export const pruneRids = (db, now = Date.now()) => db.prepare('DELETE FROM rids WHERE created_at < ?').bind(now - 2 * 86400e3).run();

// ---- the public stats page ----
// People are shown only under made-up names. The name comes from a hash of the person's id (and a secret salt), so it is stable from day to day
// but cannot be traced back to a phone number or a real name.
const ADJ = ['Calm', 'Humble', 'Radiant', 'Gentle', 'Steady', 'Swift', 'Bright', 'Noble', 'Quiet', 'Grateful', 'Patient', 'Golden', 'Silver', 'Kind', 'Wise', 'Brave',
  'Faithful', 'Serene', 'Joyful', 'Luminous', 'Generous', 'Tender', 'Mindful', 'Devoted', 'Graceful', 'Sincere', 'Peaceful', 'Blessed', 'Hopeful', 'Gleaming', 'Thankful', 'Cheerful'];
const NOUN = ['Falcon', 'Lantern', 'Crescent', 'Garden', 'River', 'Star', 'Palm', 'Pearl', 'Olive', 'Jasmine', 'Dove', 'Moon', 'Dawn', 'Oasis', 'Cedar', 'Compass',
  'Rose', 'Sparrow', 'Meadow', 'Lotus', 'Horizon', 'Candle', 'Breeze', 'Fig', 'Willow', 'Amber', 'Comet', 'Orchard', 'Canyon', 'Fountain', 'Summit', 'Harbor'];
export function alias(id, salt = '') {
  let h = 0x811c9dc5;
  for (const c of `${salt}:${id}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return `${ADJ[h % 32]} ${NOUN[(h >>> 5) % 32]} ${100 + ((h >>> 10) % 900)}`;
}

export const SNAPSHOT_MS = 15 * 60e3;   // the rankings are worked out at most this often (they scan every member), everything else is live

async function rankings(db, salt, now) {
  const today = dayOf(now), wk = weekStart(today);
  const top = (rows) => rows.results.map((r, i) => ({ rank: i + 1, name: alias(r.id, salt), count: r.n }));
  const [all, week, day, cities, active] = await Promise.all([
    db.prepare('SELECT id, total n FROM people WHERE total > 0 ORDER BY total DESC, id LIMIT 10').all(),
    db.prepare('SELECT person_id id, SUM(count) n FROM person_days WHERE day >= ? GROUP BY person_id ORDER BY n DESC, id LIMIT 10').bind(wk).all(),
    db.prepare('SELECT person_id id, count n FROM person_days WHERE day = ? ORDER BY count DESC, person_id LIMIT 10').bind(today).all(),
    db.prepare(`SELECT p.city, COUNT(*) members, SUM(p.total) total,
        COALESCE(SUM(w.week), 0) week, COALESCE(SUM(w.today), 0) today
      FROM people p LEFT JOIN (SELECT person_id, SUM(count) week, SUM(CASE WHEN day = ? THEN count ELSE 0 END) today FROM person_days WHERE day >= ? GROUP BY person_id) w ON w.person_id = p.id
      GROUP BY p.city ORDER BY total DESC`).bind(today, wk).all(),
    db.prepare('SELECT COUNT(DISTINCT person_id) week, COUNT(DISTINCT CASE WHEN day = ? THEN person_id END) today FROM person_days WHERE day >= ?').bind(today, wk).first(),
  ]);
  return {
    at: now,
    top: { today: top(day), week: top(week), all: top(all) },
    cities: cities.results.map((r, i) => ({ rank: i + 1, city: r.city, members: r.members, total: num(r.total), week: num(r.week), today: num(r.today) })),
    active: { today: num(active?.today), week: num(active?.week) },
  };
}

/** Everything the public page shows. Totals and the daily chart are live; rankings come from a snapshot at most 15 minutes old. */
export async function publicStats(db, { target, salt = '', now = Date.now(), days = 14 }) {
  const today = dayOf(now), wk = weekStart(today), from = dayOf(now - (days - 1) * 86400e3);
  const [total, members, daily, saved] = await Promise.all([
    db.prepare("SELECT value n FROM meta WHERE key = 'total'").first(),
    db.prepare('SELECT COUNT(*) n FROM people').first(),
    db.prepare('SELECT day, total FROM day_totals WHERE day >= ? ORDER BY day').bind(from).all(),
    db.prepare("SELECT value FROM meta WHERE key = 'public_rankings'").first(),
  ]);
  let snap = null;
  try { snap = saved ? JSON.parse(saved.value) : null; } catch { /* recompute */ }
  if (!snap || snap.at > now || now - snap.at > SNAPSHOT_MS || snap.day !== today) {
    snap = { ...(await rankings(db, salt, now)), day: today };
    await db.prepare("INSERT INTO meta (key, value) VALUES ('public_rankings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(snap)).run().catch(() => {});
  }
  const byDay = new Map(daily.results.map((r) => [r.day, r.total]));
  const series = [];
  for (let t = now - (days - 1) * 86400e3; series.length < days; t += 86400e3) { const d = dayOf(t); series.push({ day: d, total: num(byDay.get(d)) }); }
  const todayTotal = num(byDay.get(today));
  const week = series.filter((s) => s.day >= wk).reduce((a, s) => a + s.total, 0);
  return {
    target, total: num(total?.n), members: num(members?.n), today: todayTotal, week, daily: series,
    active: snap.active, top: snap.top, cities: snap.cities, updated: snap.at,
  };
}
