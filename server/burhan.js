// Al-Burhan edition: murabbi (mentor of a salik), masul (manager of a razakar), mamulaat percentages from the Mamulaat app,
// and the tasks and routines a masul gives. Nothing here exists in the public edition (see docs/SPEC.md section 19).
import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import { dayOf, dayNum, dayStr, weekStart, levelFor } from './game.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

/** 'internal' (Al-Burhan members) or 'public'. Public is the default so a forgotten setting never exposes a murabbi's view. */
export const edition = () => (process.env.EDITION === 'internal' ? 'internal' : 'public');
export const internal = () => edition() === 'internal';
export function guard() { if (!internal()) throw new HttpError(404, 'not_found'); }

// ---- the Mamulaat app (a separate system run by another developer; contract in docs/BURHAN-API.md) -------------------------
const TTL_MS = Number(process.env.MAMULAAT_TTL_MS) || 30 * 60e3;       // how long fetched percentages count as fresh
const MURABBI_RECHECK_MS = 24 * 3600e3;                                 // the murabbi is asked for again at most once a day
const digits = (e164) => String(e164).replace(/\D/g, '');
const toE164 = (raw) => {
  let p = String(raw ?? '').replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  p = p.replace(/^\+/, '');
  return /^[1-9]\d{7,14}$/.test(p) ? `+${p}` : null;
};

async function call(path, params) {
  const base = process.env.MAMULAAT_API_URL;
  if (!base) throw new HttpError(503, 'mamulaat_unavailable');
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${process.env.MAMULAAT_API_KEY || ''}`, accept: 'application/json' }, signal: AbortSignal.timeout(6000), redirect: 'error' });
  } catch { throw new HttpError(503, 'mamulaat_unavailable'); }
  if (res.status === 404) throw new HttpError(404, 'not_in_mamulaat_app');
  if (!res.ok) throw new HttpError(503, 'mamulaat_unavailable');
  return res.json().catch(() => { throw new HttpError(503, 'mamulaat_unavailable'); });
}
const httpProvider = {
  async murabbiOf(phone) { return (await call('v1/murabbi', { phone: digits(phone) })).murabbi ?? null; },
  async days(phone, from, to) { return (await call('v1/mamulaat', { phone: digits(phone), from, to })).days ?? []; },
};
let provider = httpProvider;
/** Tests swap the Mamulaat app for a fake. */
export const setProvider = (p) => { provider = p ?? httpProvider; };

const userRow = (id) => one('SELECT id, username, phone, email, city, country, created_day, created_at, lang, deleted_at, suspended FROM users WHERE id = ?', id);
const livePerson = (id) => { const u = userRow(id); return u && !u.deleted_at ? u : null; };

// ---- murabbi ---------------------------------------------------------------------------------------------------------
/**
 * Asks the Mamulaat app who this member's murabbi is, then finds that person here by WhatsApp number. When the murabbi has no account yet
 * the link waits (and the member is told to ask them to sign up); it completes by itself when that number registers.
 */
export async function activateMurabbi(userId) {
  const me = userRow(userId);
  const found = await provider.murabbiOf(me.phone).catch((e) => { throw e; });
  if (!found) throw new HttpError(404, 'no_murabbi_set');
  const phone = toE164(found.whatsapp);
  if (!phone) throw new HttpError(502, 'mamulaat_bad_reply');
  if (phone === me.phone) throw new HttpError(400, 'own_murabbi');
  const name = String(found.name ?? '').trim().slice(0, 80);
  tx(() => {
    const m = one('SELECT id FROM users WHERE phone = ? AND deleted_at IS NULL AND suspended = 0', phone);
    const now = Date.now();
    run(`INSERT INTO murabbi_links (user_id, murabbi_phone, murabbi_name, murabbi_id, checked_at, created_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET murabbi_phone = excluded.murabbi_phone, murabbi_name = excluded.murabbi_name, murabbi_id = excluded.murabbi_id, checked_at = excluded.checked_at`,
      userId, phone, name, m?.id ?? null, now, now);
  });
  return murabbiState(userId);
}
export function unlinkMurabbi(userId) {
  tx(() => { run('DELETE FROM murabbi_links WHERE user_id = ?', userId); run('DELETE FROM burhan_views WHERE subject_id = ? AND kind = ?', userId, 'murabbi'); });
  return { ok: true };
}
/** A new account with this phone number completes any waiting murabbi links. Runs inside the sign-up transaction. */
export function linkWaitingMurabbis(newUserId, phone) {
  run('UPDATE murabbi_links SET murabbi_id = ? WHERE murabbi_phone = ? AND murabbi_id IS NULL AND user_id != ?', newUserId, phone, newUserId);
}
export function murabbiState(userId) {
  const l = one('SELECT * FROM murabbi_links WHERE user_id = ?', userId);
  if (!l) return null;
  const m = l.murabbi_id ? livePerson(l.murabbi_id) : null;
  const seen = m && one("SELECT at FROM burhan_views WHERE viewer_id = ? AND subject_id = ? AND kind = 'murabbi'", m.id, userId);
  return { name: l.murabbi_name, username: m?.username ?? null, waiting: !m, lastViewed: seen?.at ?? null };
}
/** Re-asks the Mamulaat app (at most daily) so a change of murabbi there reaches this app. Failures keep the current link. */
export async function refreshMurabbi(userId) {
  const l = one('SELECT checked_at FROM murabbi_links WHERE user_id = ?', userId);
  if (!l || Date.now() - l.checked_at < MURABBI_RECHECK_MS) return;
  run('UPDATE murabbi_links SET checked_at = ? WHERE user_id = ?', Date.now(), userId); // also spaces out retries when the app is down
  try { await activateMurabbi(userId); } catch (e) { if (e.code === 'no_murabbi_set') unlinkMurabbi(userId); }
}

// ---- mamulaat percentages --------------------------------------------------------------------------------------------------
/** Fetches the last 14 days for a member (cached for TTL_MS). The Mamulaat app is the only source; only a daily percentage is stored. */
export async function syncMamulaat(userId, { force = false } = {}) {
  const s = one('SELECT fetched_at FROM mamulaat_sync WHERE user_id = ?', userId);
  if (!force && s && Date.now() - s.fetched_at < TTL_MS) return { stale: false };
  const me = userRow(userId);
  const to = dayOf(), from = dayStr(dayNum(to) - 13);
  try {
    const days = await provider.days(me.phone, from, to);
    tx(() => {
      run('DELETE FROM mamulaat_days WHERE user_id = ? AND day >= ?', userId, from);
      for (const d of days) {
        const pct = Math.round(Number(d.percent));
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(d.day)) && d.day >= from && d.day <= to && pct >= 0 && pct <= 100) {
          run('INSERT OR REPLACE INTO mamulaat_days (user_id, day, percent) VALUES (?,?,?)', userId, d.day, pct);
        }
      }
      run('INSERT INTO mamulaat_sync (user_id, fetched_at) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET fetched_at = excluded.fetched_at', userId, Date.now());
    });
    return { stale: false };
  } catch { return { stale: true }; }
}
export function mamulaatSeries(userId) {
  const to = dayOf(), n = dayNum(to);
  const have = new Map(all('SELECT day, percent FROM mamulaat_days WHERE user_id = ? AND day >= ?', userId, dayStr(n - 13)).map((r) => [r.day, r.percent]));
  const series = [];
  for (let i = 13; i >= 0; i--) { const d = dayStr(n - i); series.push({ day: d, percent: have.has(d) ? have.get(d) : null }); }
  const vals = series.filter((x) => x.percent !== null).map((x) => x.percent);
  return { series, today: have.get(to) ?? null, average: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null };
}

// ---- masul -----------------------------------------------------------------------------------------------------------------
export function setMasul(userId, username) {
  const m = one('SELECT id FROM users WHERE username = ? AND deleted_at IS NULL AND suspended = 0', String(username ?? '').trim());
  if (!m) throw new HttpError(404, 'masul_not_found');
  if (m.id === userId) throw new HttpError(400, 'own_masul');
  tx(() => {
    const cur = one('SELECT masul_id FROM masul_links WHERE razakar_id = ?', userId);
    if (cur && cur.masul_id !== m.id) endAll(userId);
    run(`INSERT INTO masul_links (razakar_id, masul_id, created_at) VALUES (?,?,?) ON CONFLICT(razakar_id) DO UPDATE SET masul_id = excluded.masul_id`, userId, m.id, Date.now());
  });
  return masulState(userId);
}
const endAll = (razakarId) => run('UPDATE assignments SET ended_at = ? WHERE razakar_id = ? AND ended_at IS NULL', Date.now(), razakarId);
export function clearMasul(userId) {
  tx(() => { endAll(userId); run('DELETE FROM masul_links WHERE razakar_id = ?', userId); run("DELETE FROM burhan_views WHERE subject_id = ? AND kind = 'masul'", userId); });
  return { ok: true };
}
export function masulState(userId) {
  const l = one('SELECT masul_id FROM masul_links WHERE razakar_id = ?', userId);
  const m = l && livePerson(l.masul_id);
  if (!m) return null;
  const seen = one("SELECT at FROM burhan_views WHERE viewer_id = ? AND subject_id = ? AND kind = 'masul'", m.id, userId);
  return { username: m.username, lastViewed: seen?.at ?? null };
}
export const searchUsernames = (q, userId) => {
  const s = String(q ?? '').trim().replace(/[^a-z0-9_]/gi, '');
  if (s.length < 2) return [];
  return all("SELECT username FROM users WHERE username LIKE ? ESCAPE '\\' AND deleted_at IS NULL AND suspended = 0 AND id != ? ORDER BY username LIMIT 8", `${s}%`, userId).map((r) => r.username);
};

// ---- tasks (once) and routines (every week on a day) ------------------------------------------------------------------------
const TITLE_MAX = 80, ACTIVE_MAX = 30;
const LINK = /(https?:\/\/|www\.)/i;
const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

export function addAssignment(masulId, razakarUsername, { kind, title, weekday, dueDay }) {
  const r = one('SELECT u.id FROM users u JOIN masul_links l ON l.razakar_id = u.id WHERE u.username = ? AND l.masul_id = ? AND u.deleted_at IS NULL', String(razakarUsername ?? ''), masulId);
  if (!r) throw new HttpError(403, 'not_your_razakar');
  const t = String(title ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) throw new HttpError(400, 'empty_text');
  if ([...t].length > TITLE_MAX) throw new HttpError(400, 'text_too_long');
  if (LINK.test(t)) throw new HttpError(400, 'no_links');
  if (kind !== 'task' && kind !== 'routine') throw new HttpError(400, 'bad_kind');
  let wd = null, due = null;
  if (kind === 'routine') {
    wd = Number(weekday);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw new HttpError(400, 'bad_weekday');
  } else if (dueDay) {
    due = String(dueDay);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`))) throw new HttpError(400, 'bad_day');
  }
  return tx(() => {
    if (one('SELECT COUNT(*) n FROM assignments WHERE razakar_id = ? AND ended_at IS NULL', r.id).n >= ACTIVE_MAX) throw new HttpError(429, 'too_many_assignments');
    const res = run('INSERT INTO assignments (masul_id, razakar_id, kind, title, weekday, due_day, created_at) VALUES (?,?,?,?,?,?,?)', masulId, r.id, kind, t, wd, due, Date.now());
    return { id: Number(res.lastInsertRowid) };
  });
}
export function endAssignment(masulId, id) {
  if (!run('UPDATE assignments SET ended_at = ? WHERE id = ? AND masul_id = ? AND ended_at IS NULL', Date.now(), id, masulId).changes) throw new HttpError(404, 'not_found');
  return { ok: true };
}
/** The razakar ticks it themselves, without confirmation. A routine can be ticked on its day; a task any day until it is done. */
export function tickAssignment(razakarId, id, done = true) {
  const a = one('SELECT * FROM assignments WHERE id = ? AND razakar_id = ? AND ended_at IS NULL', id, razakarId);
  if (!a) throw new HttpError(404, 'not_found');
  const today = dayOf();
  if (a.kind === 'routine' && weekdayOf(today) !== a.weekday) throw new HttpError(400, 'not_today');
  tx(() => {
    if (done) {
      if (a.kind === 'task' && one('SELECT 1 FROM assignment_ticks WHERE assignment_id = ?', id)) return;
      run('INSERT OR IGNORE INTO assignment_ticks (assignment_id, day, created_at) VALUES (?,?,?)', id, today, Date.now());
    } else run('DELETE FROM assignment_ticks WHERE assignment_id = ? AND day = ?', id, today); // undo a mistaken tick, same day only
  });
  return { ok: true };
}
const ROUTINE_WEEKS = 4;
/** How many times a routine fell due in the last four weeks (never before it was assigned) and how many were ticked. Today counts only once ticked. */
function routineStats(a, today) {
  const start = Math.max(dayNum(dayOf(a.created_at)), dayNum(today) - ROUTINE_WEEKS * 7 + 1);
  const ticks = new Set(all('SELECT day FROM assignment_ticks WHERE assignment_id = ?', a.id).map((t) => t.day));
  let due = 0, done = 0;
  for (let n = start; n <= dayNum(today); n++) {
    const d = dayStr(n);
    if (weekdayOf(d) !== a.weekday) continue;
    if (ticks.has(d)) { due++; done++; } else if (d < today) due++;
  }
  return { due, done, doneToday: ticks.has(today) };
}
function assignmentOut(a, today) {
  const base = { id: a.id, kind: a.kind, title: a.title };
  if (a.kind === 'routine') {
    const st = routineStats(a, today);
    return { ...base, weekday: a.weekday, dueToday: weekdayOf(today) === a.weekday, doneToday: st.doneToday, last4: { due: st.due, done: st.done } };
  }
  const t = one('SELECT day FROM assignment_ticks WHERE assignment_id = ? ORDER BY day LIMIT 1', a.id);
  return { ...base, dueDay: a.due_day, done: !!t, doneOn: t?.day ?? null, overdue: !t && !!a.due_day && a.due_day < today };
}
/** What a razakar sees: everything their masul has given them that is still active. */
export function myAssignments(userId) {
  const today = dayOf();
  const rows = all('SELECT * FROM assignments WHERE razakar_id = ? AND ended_at IS NULL ORDER BY kind DESC, id', userId);
  return rows.map((a) => assignmentOut(a, today));
}

// ---- the two views people with a role get --------------------------------------------------------------------------------------
/** Durood, XP and the like, the "general Seerah Quest progress" both a masul and a murabbi may see. */
export function generalProgress(userId) {
  const u = one('SELECT total, xp, streak, best_streak, last_day FROM users WHERE id = ?', userId);
  const day = dayOf(), wk = weekStart();
  const cnt = (kind) => one('SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = ?', userId, kind).n;
  const alive = u.last_day && dayNum(day) - dayNum(u.last_day) <= 1;
  return {
    durood: { total: u.total, today: one('SELECT count FROM daily WHERE user_id = ? AND day = ?', userId, day)?.count ?? 0,
      week: one('SELECT COALESCE(SUM(count),0) n FROM daily WHERE user_id = ? AND day >= ?', userId, wk).n,
      daysThisWeek: one('SELECT COUNT(*) n FROM daily WHERE user_id = ? AND day >= ? AND count > 0', userId, wk).n },
    streak: alive ? u.streak : 0, bestStreak: u.best_streak, xp: u.xp, level: levelFor(u.xp).level,
    sunnahs: cnt('sunnah_tick'), sunnahPhotos: cnt('sunnah'), lectures: cnt('lecture'),
    reflections: one('SELECT COUNT(*) n FROM reflections WHERE user_id = ?', userId).n,
  };
}
const touchView = (viewerId, subjectId, kind) => run(`INSERT INTO burhan_views (viewer_id, subject_id, kind, at) VALUES (?,?,?,?)
  ON CONFLICT(viewer_id, subject_id, kind) DO UPDATE SET at = excluded.at`, viewerId, subjectId, kind, Date.now());

/** A masul's report on one razakar: tasks, routines and the general progress. Never mamulaat. */
export function razakarReport(masulId, username) {
  const r = one(`SELECT u.id FROM users u JOIN masul_links l ON l.razakar_id = u.id WHERE u.username = ? AND l.masul_id = ? AND u.deleted_at IS NULL`, String(username), masulId);
  if (!r) throw new HttpError(404, 'not_found');
  touchView(masulId, r.id, 'masul');
  const u = livePerson(r.id), today = dayOf();
  const items = all('SELECT * FROM assignments WHERE razakar_id = ? AND masul_id = ? AND ended_at IS NULL ORDER BY kind DESC, id', r.id, masulId).map((a) => assignmentOut(a, today));
  return { username: u.username, city: u.city, joined: u.created_day, progress: generalProgress(r.id), assignments: items };
}
export function razakarList(masulId) {
  const today = dayOf();
  return all(`SELECT u.id, u.username, u.city FROM masul_links l JOIN users u ON u.id = l.razakar_id WHERE l.masul_id = ? AND u.deleted_at IS NULL ORDER BY u.username`, masulId).map((u) => {
    const items = all('SELECT * FROM assignments WHERE razakar_id = ? AND masul_id = ? AND ended_at IS NULL', u.id, masulId).map((a) => assignmentOut(a, today));
    const tasks = items.filter((i) => i.kind === 'task'), routines = items.filter((i) => i.kind === 'routine');
    const due = routines.reduce((n, i) => n + i.last4.due, 0), done = routines.reduce((n, i) => n + i.last4.done, 0);
    const g = generalProgress(u.id);
    return { username: u.username, city: u.city, openTasks: tasks.filter((t) => !t.done).length, overdue: tasks.filter((t) => t.overdue).length,
      routinePercent: due ? Math.round((done / due) * 100) : null, duroodWeek: g.durood.week, streak: g.streak };
  });
}

/** A murabbi's report on one salik: the whole profile, all progress, mamulaat, and any tasks and routines they carry. */
export async function saalikReport(murabbiId, username) {
  const s = one(`SELECT u.id FROM users u JOIN murabbi_links l ON l.user_id = u.id WHERE u.username = ? AND l.murabbi_id = ? AND u.deleted_at IS NULL`, String(username), murabbiId);
  if (!s) throw new HttpError(404, 'not_found');
  touchView(murabbiId, s.id, 'murabbi');
  const sync = await syncMamulaat(s.id);
  const u = livePerson(s.id), today = dayOf();
  const g = generalProgress(s.id);
  const extra = {
    badges: one('SELECT COUNT(*) n FROM badges WHERE user_id = ?', s.id)?.n ?? 0,
    caravan: one('SELECT COUNT(*) n FROM users WHERE referrer_id = ?', s.id).n,
    qabila: one('SELECT COUNT(*) n FROM ancestors WHERE ancestor_id = ? AND depth > 0', s.id).n,
  };
  const masul = masulState(s.id);
  const items = all('SELECT * FROM assignments WHERE razakar_id = ? AND ended_at IS NULL ORDER BY kind DESC, id', s.id).map((a) => assignmentOut(a, today));
  return { profile: { username: u.username, phone: u.phone, email: u.email, city: u.city, country: u.country, joined: u.created_day, lang: u.lang },
    progress: g, extra, mamulaat: { ...mamulaatSeries(s.id), stale: sync.stale }, masul: masul?.username ?? null, assignments: items };
}
export function saalikList(murabbiId) {
  return all(`SELECT u.id, u.username, u.city FROM murabbi_links l JOIN users u ON u.id = l.user_id WHERE l.murabbi_id = ? AND u.deleted_at IS NULL ORDER BY u.username`, murabbiId).map((u) => {
    const g = generalProgress(u.id), m = mamulaatSeries(u.id);
    return { username: u.username, city: u.city, duroodToday: g.durood.today, duroodWeek: g.durood.week, streak: g.streak, mamulaatToday: m.today, mamulaatAverage: m.average };
  });
}

// ---- everything the app needs on one screen --------------------------------------------------------------------------------------
export async function burhanState(userId) {
  await refreshMurabbi(userId);
  const murabbi = murabbiState(userId);
  if (murabbi && !murabbi.waiting) await syncMamulaat(userId);
  const assignments = myAssignments(userId);
  const today = assignments.filter((a) => (a.kind === 'routine' ? a.dueToday : !a.done));
  return {
    edition: edition(), murabbi, masul: masulState(userId),
    mamulaat: murabbi ? mamulaatSeries(userId) : null,
    assignments, today,
    roles: { saaliks: one('SELECT COUNT(*) n FROM murabbi_links l JOIN users u ON u.id = l.user_id WHERE l.murabbi_id = ? AND u.deleted_at IS NULL', userId).n,
      razakars: one('SELECT COUNT(*) n FROM masul_links l JOIN users u ON u.id = l.razakar_id WHERE l.masul_id = ? AND u.deleted_at IS NULL', userId).n },
  };
}
