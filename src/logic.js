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

// ---- caravans ----
export const DEFAULT_TARGET = 100_000_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The caravan a link belongs to. Every link names one: with no (or a wrong) name there is nothing to count into. */
export async function getCaravan(db, slug) {
  const s = String(slug || '').toLowerCase();
  const row = SLUG.test(s) ? await db.prepare('SELECT id, slug, name, target FROM caravans WHERE slug = ?').bind(s).first() : null;
  if (!row) throw new Bad(404, 'no_caravan');
  return row;
}

const slugOf = (name) => String(name).normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'caravan';
const randomPart = (n = 5) => { const a = crypto.getRandomValues(new Uint8Array(n)); return [...a].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); };

/** Admin: a new caravan with a link nobody can guess from the name alone (name + a few random letters). */
export async function createCaravan(db, { name, target }, defaultTarget = DEFAULT_TARGET, now = Date.now()) {
  const nm = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if ([...nm].length < 2 || [...nm].length > 60) throw new Bad(422, 'need_name');
  const tg = target === undefined || target === '' || target === null ? defaultTarget : Number(target);
  if (!Number.isInteger(tg) || tg < 1 || tg > 1e12) throw new Bad(422, 'bad_target');
  for (let i = 0; i < 5; i++) {
    const slug = `${slugOf(nm)}-${randomPart()}`;
    try {
      await db.prepare('INSERT INTO caravans (slug, name, target, total, created_at) VALUES (?, ?, ?, 0, ?)').bind(slug, nm, tg, now).run();
      return { slug, name: nm, target: tg };
    } catch (e) { if (!/UNIQUE|constraint/i.test(String(e?.message || e))) throw e; }
  }
  throw new Bad(500, 'server_error');
}

/** Admin: every caravan with its size. */
export async function listCaravans(db, now = Date.now()) {
  const today = dayOf(now);
  const rows = (await db.prepare(`SELECT c.slug, c.name, c.target, c.total, c.created_at,
      (SELECT COUNT(*) FROM people p WHERE p.caravan_id = c.id) members,
      COALESCE((SELECT total FROM day_totals d WHERE d.caravan_id = c.id AND d.day = ?), 0) today
    FROM caravans c ORDER BY c.id`).bind(today).all()).results;
  return rows.map((r) => ({ slug: r.slug, name: r.name, target: r.target, total: num(r.total), members: num(r.members), today: num(r.today), created: dayOf(r.created_at) }));
}

/** Today, this week and the overall figures for a person and for everyone in the caravan. A few rows each, however many people there are. */
export async function stats(db, personId, caravan, now = Date.now()) {
  const today = dayOf(now), wk = weekStart(today);
  const [youToday, youWeek, youTotal, allToday, allWeek, allTotal] = await Promise.all([
    db.prepare('SELECT count n FROM person_days WHERE person_id = ? AND day = ?').bind(personId, today).first(),
    db.prepare('SELECT COALESCE(SUM(count), 0) n FROM person_days WHERE person_id = ? AND day >= ?').bind(personId, wk).first(),
    db.prepare('SELECT total n FROM people WHERE id = ?').bind(personId).first(),
    db.prepare('SELECT total n FROM day_totals WHERE caravan_id = ? AND day = ?').bind(caravan.id, today).first(),
    db.prepare('SELECT COALESCE(SUM(total), 0) n FROM day_totals WHERE caravan_id = ? AND day >= ?').bind(caravan.id, wk).first(),
    db.prepare('SELECT total n FROM caravans WHERE id = ?').bind(caravan.id).first(),
  ]);
  return {
    you: { today: num(youToday?.n), week: num(youWeek?.n), total: num(youTotal?.n) },
    everyone: { today: num(allToday?.n), week: num(allWeek?.n), total: num(allTotal?.n) },
    target: caravan.target,
    caravan: { slug: caravan.slug, name: caravan.name },
  };
}

export async function check(db, { phone }, caravan) {
  const p = normalisePhone(phone);
  if (!p) throw new Bad(400, 'bad_phone');
  return { known: !!(await db.prepare('SELECT 1 x FROM people WHERE phone = ? AND caravan_id = ?').bind(p, caravan.id).first()) };
}

/** Adds today's count. A number we do not know in this caravan must come with a name and a city from the list. */
export async function addEntry(db, { phone, count, rid, name, city }, caravan, now = Date.now()) {
  const p = normalisePhone(phone);
  if (!p) throw new Bad(400, 'bad_phone');
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > MAX_ONE_ENTRY) throw new Bad(400, 'bad_count');
  if (typeof rid !== 'string' || !/^[\w-]{8,64}$/.test(rid)) throw new Bad(400, 'bad_request');
  const today = dayOf(now), cid = caravan.id;
  const find = () => db.prepare('SELECT id FROM people WHERE phone = ? AND caravan_id = ?').bind(p, cid).first();
  let person = await find();
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
      db.prepare('INSERT OR IGNORE INTO people (caravan_id, phone, name, city, created_at, total) VALUES (?, ?, ?, ?, ?, 0)').bind(cid, p, nm || 'unknown', ct || OTHER_CITY, now),
      db.prepare('INSERT INTO person_days (person_id, day, count) SELECT id, ?, ? FROM people WHERE phone = ? AND caravan_id = ? ON CONFLICT(person_id, day) DO UPDATE SET count = count + excluded.count').bind(today, n, p, cid),
      db.prepare('UPDATE people SET total = total + ? WHERE phone = ? AND caravan_id = ?').bind(n, p, cid),
      db.prepare('INSERT INTO day_totals (caravan_id, day, total) VALUES (?, ?, ?) ON CONFLICT(caravan_id, day) DO UPDATE SET total = total + excluded.total').bind(cid, today, n),
      db.prepare('UPDATE caravans SET total = total + ? WHERE id = ?').bind(n, cid),
    ]);
  } catch (e) {
    if (!/UNIQUE|constraint/i.test(String(e?.message || e))) throw e;
    person = await find();
    return { ok: true, created: false, duplicate: true, ...(person ? await stats(db, person.id, caravan, now) : {}) };
  }
  person = await find();
  return { ok: true, created: nm !== '', duplicate: false, ...(await stats(db, person.id, caravan, now)) };
}

/** What the Google Sheet gets: every caravan, everyone in them, each person's total per day for the last few days, and the overall figures. */
export async function backupPayload(db, { now = Date.now(), days = 3 } = {}) {
  const today = dayOf(now), from = dayOf(now - (days - 1) * 86400e3);
  const caravans = (await db.prepare('SELECT slug, name, target FROM caravans ORDER BY id').all()).results.map((r) => ({ slug: r.slug, name: r.name, target: r.target }));
  const people = (await db.prepare('SELECT p.phone, p.name, p.city, p.created_at, c.slug FROM people p JOIN caravans c ON c.id = p.caravan_id ORDER BY p.id').all()).results
    .map((r) => ({ phone: r.phone, name: r.name, city: r.city, joined: dayOf(r.created_at), caravan: r.slug }));
  const daily = (await db.prepare('SELECT d.day, p.phone, d.count, c.slug FROM person_days d JOIN people p ON p.id = d.person_id JOIN caravans c ON c.id = p.caravan_id WHERE d.day >= ? ORDER BY d.day, p.id').bind(from).all()).results
    .map((r) => ({ day: r.day, phone: r.phone, count: r.count, caravan: r.slug }));
  const total = num((await db.prepare('SELECT COALESCE(SUM(total), 0) n FROM caravans').first())?.n);
  const todayTotal = num((await db.prepare('SELECT COALESCE(SUM(total), 0) n FROM day_totals WHERE day = ?').bind(today).first())?.n);
  return { sentAt: new Date(now).toISOString(), from, today, caravans, people, daily, totals: { people: people.length, total, today: todayTotal } };
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

async function rankings(db, caravan, salt, now) {
  const today = dayOf(now), wk = weekStart(today), cid = caravan.id;
  const top = (rows) => rows.results.map((r, i) => ({ rank: i + 1, name: alias(r.id, salt), count: r.n }));
  const [all, week, day, cities, active] = await Promise.all([
    db.prepare('SELECT id, total n FROM people WHERE caravan_id = ? AND total > 0 ORDER BY total DESC, id LIMIT 10').bind(cid).all(),
    db.prepare('SELECT d.person_id id, SUM(d.count) n FROM person_days d JOIN people p ON p.id = d.person_id WHERE p.caravan_id = ? AND d.day >= ? GROUP BY d.person_id ORDER BY n DESC, id LIMIT 10').bind(cid, wk).all(),
    db.prepare('SELECT d.person_id id, d.count n FROM person_days d JOIN people p ON p.id = d.person_id WHERE p.caravan_id = ? AND d.day = ? ORDER BY d.count DESC, d.person_id LIMIT 10').bind(cid, today).all(),
    db.prepare(`SELECT p.city, COUNT(*) members, SUM(p.total) total,
        COALESCE(SUM(w.week), 0) week, COALESCE(SUM(w.today), 0) today
      FROM people p LEFT JOIN (SELECT person_id, SUM(count) week, SUM(CASE WHEN day = ? THEN count ELSE 0 END) today FROM person_days WHERE day >= ? GROUP BY person_id) w ON w.person_id = p.id
      WHERE p.caravan_id = ? GROUP BY p.city ORDER BY total DESC`).bind(today, wk, cid).all(),
    db.prepare('SELECT COUNT(DISTINCT d.person_id) week, COUNT(DISTINCT CASE WHEN d.day = ? THEN d.person_id END) today FROM person_days d JOIN people p ON p.id = d.person_id WHERE p.caravan_id = ? AND d.day >= ?').bind(today, cid, wk).first(),
  ]);
  return {
    at: now,
    top: { today: top(day), week: top(week), all: top(all) },
    cities: cities.results.map((r, i) => ({ rank: i + 1, city: r.city, members: r.members, total: num(r.total), week: num(r.week), today: num(r.today) })),
    active: { today: num(active?.today), week: num(active?.week) },
  };
}

// Everyone, across all caravans: the same shapes as one caravan, plus the caravans ranked against each other (never their link names).
async function globalRankings(db, salt, now) {
  const today = dayOf(now), wk = weekStart(today);
  const top = (rows) => rows.results.map((r, i) => ({ rank: i + 1, name: alias(r.id, salt), count: r.n }));
  const [all, week, day, cities, active, cars, carDays, members] = await Promise.all([
    db.prepare('SELECT id, total n FROM people WHERE total > 0 ORDER BY total DESC, id LIMIT 10').all(),
    db.prepare('SELECT person_id id, SUM(count) n FROM person_days WHERE day >= ? GROUP BY person_id ORDER BY n DESC, id LIMIT 10').bind(wk).all(),
    db.prepare('SELECT person_id id, count n FROM person_days WHERE day = ? ORDER BY count DESC, person_id LIMIT 10').bind(today).all(),
    db.prepare(`SELECT p.city, COUNT(*) members, SUM(p.total) total, COALESCE(SUM(w.week), 0) week, COALESCE(SUM(w.today), 0) today
      FROM people p LEFT JOIN (SELECT person_id, SUM(count) week, SUM(CASE WHEN day = ? THEN count ELSE 0 END) today FROM person_days WHERE day >= ? GROUP BY person_id) w ON w.person_id = p.id
      GROUP BY p.city ORDER BY total DESC`).bind(today, wk).all(),
    db.prepare('SELECT COUNT(DISTINCT person_id) week, COUNT(DISTINCT CASE WHEN day = ? THEN person_id END) today FROM person_days WHERE day >= ?').bind(today, wk).first(),
    db.prepare('SELECT c.id, c.slug, c.name, c.target, c.total, COUNT(p.id) members FROM caravans c LEFT JOIN people p ON p.caravan_id = c.id GROUP BY c.id ORDER BY c.total DESC, c.id').all(),
    db.prepare('SELECT caravan_id id, SUM(total) week, SUM(CASE WHEN day = ? THEN total ELSE 0 END) today FROM day_totals WHERE day >= ? GROUP BY caravan_id').bind(today, wk).all(),
    db.prepare('SELECT COUNT(*) n FROM people').first(),
  ]);
  const byCar = new Map(carDays.results.map((r) => [r.id, r]));
  return {
    at: now, members: num(members?.n),
    top: { today: top(day), week: top(week), all: top(all) },
    cities: cities.results.map((r, i) => ({ rank: i + 1, city: r.city, members: r.members, total: num(r.total), week: num(r.week), today: num(r.today) })),
    active: { today: num(active?.today), week: num(active?.week) },
    caravans: cars.results.map((r) => ({ slug: r.slug, name: r.name, target: r.target, members: num(r.members), total: num(r.total), week: num(byCar.get(r.id)?.week), today: num(byCar.get(r.id)?.today) })),
  };
}

async function snapshot(db, key, today, now, compute) {
  const saved = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  let snap = null;
  try { snap = saved ? JSON.parse(saved.value) : null; } catch { /* recompute */ }
  if (!snap || snap.at > now || now - snap.at > SNAPSHOT_MS || snap.day !== today) {
    snap = { ...(await compute()), day: today };
    await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(snap)).run().catch(() => {});
  }
  return snap;
}

const lastDays = (rows, now, days) => {
  const byDay = new Map(rows.map((r) => [r.day, num(r.total)]));
  const series = [];
  for (let t = now - (days - 1) * 86400e3; series.length < days; t += 86400e3) { const d = dayOf(t); series.push({ day: d, total: byDay.get(d) || 0 }); }
  return series;
};

/**
 * Everything the public page shows: this caravan, everyone (`global`), and the caravans ranked against each other (`caravans`, with the viewer's own marked).
 * Totals and the daily charts are live; rankings come from snapshots at most 15 minutes old.
 */
export async function publicStats(db, { caravan, salt = '', now = Date.now(), days = 14 }) {
  const today = dayOf(now), wk = weekStart(today), from = dayOf(now - (days - 1) * 86400e3), cid = caravan.id;
  const [total, members, daily, gTotal, gDaily] = await Promise.all([
    db.prepare('SELECT total n FROM caravans WHERE id = ?').bind(cid).first(),
    db.prepare('SELECT COUNT(*) n FROM people WHERE caravan_id = ?').bind(cid).first(),
    db.prepare('SELECT day, total FROM day_totals WHERE caravan_id = ? AND day >= ? ORDER BY day').bind(cid, from).all(),
    db.prepare('SELECT COALESCE(SUM(total), 0) n, COALESCE(SUM(target), 0) t FROM caravans').first(),
    db.prepare('SELECT day, SUM(total) total FROM day_totals WHERE day >= ? GROUP BY day ORDER BY day').bind(from).all(),
  ]);
  const snap = await snapshot(db, `public_rankings:${cid}`, today, now, () => rankings(db, caravan, salt, now));
  const gsnap = await snapshot(db, 'public_global', today, now, () => globalRankings(db, salt, now));
  const series = lastDays(daily.results, now, days), gseries = lastDays(gDaily.results, now, days);
  const sumWeek = (ser) => ser.filter((x) => x.day >= wk).reduce((a, x) => a + x.total, 0);
  return {
    target: caravan.target, name: caravan.name, total: num(total?.n), members: num(members?.n), today: series.at(-1).total, week: sumWeek(series), daily: series,
    active: snap.active, top: snap.top, cities: snap.cities, updated: snap.at,
    global: {
      target: num(gTotal?.t), name: 'everyone', total: num(gTotal?.n), members: gsnap.members, today: gseries.at(-1).total, week: sumWeek(gseries), daily: gseries,
      active: gsnap.active, top: gsnap.top, cities: gsnap.cities,
    },
    caravans: gsnap.caravans.map(({ slug, ...c }) => ({ ...c, mine: slug === caravan.slug })),
  };
}
