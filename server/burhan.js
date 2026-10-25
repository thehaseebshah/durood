// Al-Burhan edition: murabbi (mentor of a salik), masul (manager of a razakar), mamulaat percentages from the Mamulaat app,
// and the tasks and routines a masul gives. Nothing here exists in the public edition (see docs/SPEC.md section 19).
import { db, tx } from './db.js';
import { HttpError, avatarUrl } from './auth.js';
import { dayOf, dayNum, dayStr, weekStart, levelFor, person, grant } from './game.js';

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
// Phone numbers are not verified, so a number alone never grants access. A link has three steps: the Mamulaat app names a number, the salik
// confirms the person found for it, and that person accepts. Reports are shared only when both have said yes.
/**
 * Asks the Mamulaat app who this member's murabbi is, then finds that person here by WhatsApp number. When the murabbi has no account yet
 * the link waits (and the member is told to ask them to sign up). A different murabbi than before starts again from the salik's confirmation.
 */
export async function activateMurabbi(userId) {
  const me = userRow(userId);
  const found = await provider.murabbiOf(me.phone);
  if (!found) throw new HttpError(404, 'no_murabbi_set');
  const phone = toE164(found.whatsapp);
  if (!phone) throw new HttpError(502, 'mamulaat_bad_reply');
  if (phone === me.phone) throw new HttpError(400, 'own_murabbi');
  const name = String(found.name ?? '').trim().slice(0, 80);
  tx(() => {
    const m = one('SELECT id FROM users WHERE phone = ? AND deleted_at IS NULL AND suspended = 0', phone);
    const cur = one('SELECT murabbi_phone, murabbi_id, salik_ok, murabbi_ok FROM murabbi_links WHERE user_id = ?', userId);
    const same = cur && cur.murabbi_phone === phone && cur.murabbi_id === (m?.id ?? null);
    const now = Date.now();
    run(`INSERT INTO murabbi_links (user_id, murabbi_phone, murabbi_name, murabbi_id, salik_ok, murabbi_ok, checked_at, created_at) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET murabbi_phone = excluded.murabbi_phone, murabbi_name = excluded.murabbi_name, murabbi_id = excluded.murabbi_id,
           salik_ok = excluded.salik_ok, murabbi_ok = excluded.murabbi_ok, checked_at = excluded.checked_at`,
      userId, phone, name, m?.id ?? null, same ? cur.salik_ok : 0, same ? cur.murabbi_ok : 0, now, now);
    if (!same) run("DELETE FROM burhan_views WHERE subject_id = ? AND kind = 'murabbi'", userId);
    run("DELETE FROM burhan_notices WHERE user_id = ? AND kind IN ('declined','ended')", userId); // looking again answers the notice
  });
  return murabbiState(userId);
}
/** The salik says: yes, this is my murabbi. Only possible once the person has an account to be shown. */
export function confirmMurabbi(userId) {
  const l = one('SELECT murabbi_id FROM murabbi_links WHERE user_id = ?', userId);
  if (!l || !l.murabbi_id || !livePerson(l.murabbi_id)) throw new HttpError(409, 'murabbi_not_ready');
  run('UPDATE murabbi_links SET salik_ok = 1 WHERE user_id = ?', userId);
  return murabbiState(userId);
}
export function unlinkMurabbi(userId) {
  tx(() => { run('DELETE FROM murabbi_links WHERE user_id = ?', userId); run("DELETE FROM burhan_views WHERE subject_id = ? AND kind = 'murabbi'", userId); });
  return { ok: true };
}
/** A new account with this phone number is shown to the saliks waiting for it, who must confirm it. Nothing is shared by this alone. */
export function linkWaitingMurabbis(newUserId, phone) {
  run('UPDATE murabbi_links SET murabbi_id = ?, salik_ok = 0, murabbi_ok = 0 WHERE murabbi_phone = ? AND murabbi_id IS NULL AND user_id != ?', newUserId, phone, newUserId);
}
export function murabbiState(userId) {
  const l = one('SELECT * FROM murabbi_links WHERE user_id = ?', userId);
  if (!l) return null;
  const m = l.murabbi_id ? livePerson(l.murabbi_id) : null;
  const stage = !m ? 'waiting' : !l.salik_ok ? 'confirm' : !l.murabbi_ok ? 'pending' : 'active';
  const seen = stage === 'active' && one("SELECT at FROM burhan_views WHERE viewer_id = ? AND subject_id = ? AND kind = 'murabbi'", m.id, userId);
  return { name: l.murabbi_name, username: m?.username ?? null, city: m?.city ?? null, stage, waiting: !m, lastViewed: seen?.at ?? null };
}
/** Re-asks the Mamulaat app (at most daily) so a change of murabbi there reaches this app. A different person must be confirmed again. */
export async function refreshMurabbi(userId) {
  const l = one('SELECT checked_at FROM murabbi_links WHERE user_id = ?', userId);
  if (!l || Date.now() - l.checked_at < MURABBI_RECHECK_MS) return;
  run('UPDATE murabbi_links SET checked_at = ? WHERE user_id = ?', Date.now(), userId); // also spaces out retries when the app is down
  try { await activateMurabbi(userId); } catch (e) { if (e.code === 'no_murabbi_set') unlinkMurabbi(userId); }
}
/** The murabbi's side: who is waiting for their yes, and the yes or no itself. A "no" removes the request. */
export const murabbiRequests = (murabbiId) => all(`SELECT u.id uid, u.avatar_v av, u.username, u.city FROM murabbi_links l JOIN users u ON u.id = l.user_id
  WHERE l.murabbi_id = ? AND l.salik_ok = 1 AND l.murabbi_ok = 0 AND u.deleted_at IS NULL ORDER BY l.created_at`, murabbiId).map(person);
export function answerRequest(murabbiId, username, accept) {
  const s = one(`SELECT u.id FROM users u JOIN murabbi_links l ON l.user_id = u.id WHERE u.username = ? AND l.murabbi_id = ? AND l.salik_ok = 1 AND l.murabbi_ok = 0`, String(username), murabbiId);
  if (!s) throw new HttpError(404, 'not_found');
  if (accept) run('UPDATE murabbi_links SET murabbi_ok = 1 WHERE user_id = ?', s.id);
  else tx(() => { run('DELETE FROM murabbi_links WHERE user_id = ?', s.id); notify(s.id, 'declined', murabbiId); }); // the salik is told, not left guessing
  return { ok: true };
}
/** A murabbi stops following a salik. Reports stop at once; the salik sees a short notice and can look up their murabbi again. */
export function dropSaalik(murabbiId, username) {
  const s = one(`SELECT u.id FROM users u JOIN murabbi_links l ON l.user_id = u.id WHERE u.username = ? AND l.murabbi_id = ? AND l.salik_ok = 1 AND l.murabbi_ok = 1`, String(username), murabbiId);
  if (!s) throw new HttpError(404, 'not_found');
  tx(() => {
    run('DELETE FROM murabbi_links WHERE user_id = ?', s.id);
    run("DELETE FROM burhan_views WHERE subject_id = ? AND kind = 'murabbi'", s.id);
    notify(s.id, 'ended', murabbiId);
  });
  return { ok: true };
}
const notify = (userId, kind, byId) => run(`INSERT INTO burhan_notices (user_id, kind, by_name, at) VALUES (?,?,?,?)
  ON CONFLICT(user_id, kind) DO UPDATE SET by_name = excluded.by_name, at = excluded.at`, userId, kind, one('SELECT username FROM users WHERE id = ?', byId)?.username ?? '', Date.now());
export const notices = (userId) => all('SELECT kind, by_name byName, at FROM burhan_notices WHERE user_id = ? ORDER BY at DESC', userId);
export function dismissNotice(userId, kind) { run('DELETE FROM burhan_notices WHERE user_id = ? AND kind = ?', userId, String(kind)); return { ok: true }; }

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
  } catch {
    // back off for a minute instead of retrying a dead service on every screen view
    run('INSERT INTO mamulaat_sync (user_id, fetched_at) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET fetched_at = excluded.fetched_at', userId, Date.now() - TTL_MS + 60e3);
    return { stale: true };
  }
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
    if (one('SELECT COUNT(*) n FROM masul_links WHERE masul_id = ? AND razakar_id != ?', m.id, userId).n >= 200) throw new HttpError(409, 'masul_full');
    const cur = one('SELECT masul_id FROM masul_links WHERE razakar_id = ?', userId);
    if (cur && cur.masul_id !== m.id) { endAll(userId); dropTags(userId); }
    run(`INSERT INTO masul_links (razakar_id, masul_id, created_at) VALUES (?,?,?) ON CONFLICT(razakar_id) DO UPDATE SET masul_id = excluded.masul_id`, userId, m.id, Date.now());
    run("DELETE FROM burhan_notices WHERE user_id = ? AND kind = 'removed'", userId);
  });
  return masulState(userId);
}
const dropTags = (razakarId) => run('DELETE FROM team_tags WHERE razakar_id = ?', razakarId);
const endAll = (razakarId) => run('UPDATE assignments SET ended_at = ? WHERE razakar_id = ? AND masul_id != razakar_id AND ended_at IS NULL', Date.now(), razakarId); // the member's own tasks stay
/** A masul removes a razakar who named them (anyone can name a masul, so the masul must be able to say no). Their open work ends. */
export function removeRazakar(masulId, username) {
  const r = one('SELECT u.id FROM users u JOIN masul_links l ON l.razakar_id = u.id WHERE u.username = ? AND l.masul_id = ?', String(username), masulId);
  if (!r) throw new HttpError(404, 'not_found');
  tx(() => { endAll(r.id); dropTags(r.id); run('DELETE FROM masul_links WHERE razakar_id = ?', r.id); run("DELETE FROM burhan_views WHERE subject_id = ? AND kind = 'masul'", r.id); notify(r.id, 'removed', masulId); });
  return { ok: true };
}
export function clearMasul(userId) {
  tx(() => { endAll(userId); dropTags(userId); run('DELETE FROM masul_links WHERE razakar_id = ?', userId); run("DELETE FROM burhan_views WHERE subject_id = ? AND kind = 'masul'", userId); });
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
// a routine can fall on several weekdays (Saturday and Sunday, or every day)
const maskOf = (a) => a.days ?? (a.weekday == null ? 0 : 1 << a.weekday);
const onDay = (a, day) => (maskOf(a) & (1 << weekdayOf(day))) !== 0;
const daysOf = (mask) => [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (1 << d));
const checkDay = (raw) => {
  const d = String(raw ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new HttpError(400, 'bad_day');
  if (d < dayOf()) throw new HttpError(400, 'day_past');
  if (dayNum(d) - dayNum(dayOf()) > 366) throw new HttpError(400, 'bad_day');
  return d;
};

// ---- points for tasks and routines --------------------------------------------------------------------------------------------
// A task done by its deadline earns its full points. Late, it earns less the longer it waited; each time the deadline was pushed
// later at the doer's wish, it earns less again: a commitment kept is worth more. Daily caps stop a list of tiny tasks being farmed.
export const TASK_XP = {
  masul: 30, own: 10,               // a task your masul gave you / one you set yourself
  routineMasul: 10, routineOwn: 5,  // a routine ticked on its day
  late: [0.6, 0.5, 0.4, 0.3, 0.2],  // 1, 2, 3, 4, 5 days late; after that
  lateFloor: 0.1,
  extension: 0.2, extensionFloor: 0.4, // each pushed deadline takes 20% off, never below 40%
  dailyCapOwn: 3, dailyCapMasul: 5,   // tasks a day that earn points (routines count with them)
};
/** Points for completing this task (or routine) on `day`, before the daily cap. */
export function taskPoints(a, day = dayOf()) {
  const own = a.masul_id === a.razakar_id;
  if (a.kind === 'routine') return own ? TASK_XP.routineOwn : TASK_XP.routineMasul;
  const base = own ? TASK_XP.own : TASK_XP.masul;
  const late = a.due_day && day > a.due_day ? dayNum(day) - dayNum(a.due_day) : 0;
  const timely = late === 0 ? 1 : (TASK_XP.late[late - 1] ?? TASK_XP.lateFloor);
  const kept = Math.max(TASK_XP.extensionFloor, 1 - TASK_XP.extension * (a.extensions || 0));
  return Math.max(1, Math.round(base * timely * kept));
}
const pointsToday = (userId, own) => one(`SELECT COUNT(*) n FROM events e JOIN assignments a ON a.id = CAST(substr(e.ref, 1, instr(e.ref || ':', ':') - 1) AS INTEGER)
  WHERE e.user_id = ? AND e.kind = 'task' AND e.day = ? AND (a.masul_id = a.razakar_id) = ?`, userId, dayOf(), own ? 1 : 0).n;
function payTask(a, day) {
  const own = a.masul_id === a.razakar_id;
  if (pointsToday(a.razakar_id, own) >= (own ? TASK_XP.dailyCapOwn : TASK_XP.dailyCapMasul)) return 0;
  const xp = taskPoints(a, day);
  return grant(a.razakar_id, 'task', a.kind === 'routine' ? `${a.id}:${day}` : String(a.id), xp) ? xp : 0;
}
function unpayTask(a, day) {
  const ref = a.kind === 'routine' ? `${a.id}:${day}` : String(a.id);
  const ev = one("SELECT xp FROM events WHERE user_id = ? AND kind = 'task' AND ref = ?", a.razakar_id, ref);
  if (!ev) return;
  run("DELETE FROM events WHERE user_id = ? AND kind = 'task' AND ref = ?", a.razakar_id, ref);
  run('UPDATE users SET xp = xp - ? WHERE id = ?', ev.xp, a.razakar_id);
}

/** Moving a deadline. Your own task: you move it. A task from your masul: you ask, and the masul agrees (or moves it themselves).
 *  Pushing it later at the doer's wish counts against the points; moving it earlier, or the masul's own change, does not. */
export function changeDue(userId, id, rawDay) {
  const a = one("SELECT * FROM assignments WHERE id = ? AND kind = 'task' AND ended_at IS NULL", id);
  if (!a || (a.razakar_id !== userId && a.masul_id !== userId)) throw new HttpError(404, 'not_found');
  if (one('SELECT 1 FROM assignment_ticks WHERE assignment_id = ?', id)) throw new HttpError(409, 'already_done');
  const day = checkDay(rawDay);
  const own = a.masul_id === a.razakar_id;
  if (!own && userId === a.razakar_id) throw new HttpError(403, 'ask_masul'); // only the masul moves a task they gave
  tx(() => {
    const later = !a.due_day || day > a.due_day;
    run('UPDATE assignments SET due_day = ?, extensions = extensions + ? WHERE id = ?', day, own && later ? 1 : 0, id);
    run('DELETE FROM due_requests WHERE assignment_id = ?', id);
  });
  return { ok: true };
}
export function requestDue(userId, id, rawDay) {
  const a = one("SELECT * FROM assignments WHERE id = ? AND kind = 'task' AND razakar_id = ? AND masul_id != razakar_id AND ended_at IS NULL", id, userId);
  if (!a) throw new HttpError(404, 'not_found');
  if (one('SELECT 1 FROM assignment_ticks WHERE assignment_id = ?', id)) throw new HttpError(409, 'already_done');
  const day = checkDay(rawDay);
  run('INSERT INTO due_requests (assignment_id, day, created_at) VALUES (?,?,?) ON CONFLICT(assignment_id) DO UPDATE SET day = excluded.day, created_at = excluded.created_at', id, day, Date.now());
  return { ok: true, masulId: a.masul_id, title: a.title };
}
/** The masul agrees (the deadline moves, and pushing it later counts against the points, since the razakar asked) or says no. */
export function answerDue(masulId, id, accept) {
  const r = one('SELECT r.day, a.* FROM due_requests r JOIN assignments a ON a.id = r.assignment_id WHERE r.assignment_id = ? AND a.masul_id = ? AND a.ended_at IS NULL', id, masulId);
  if (!r) throw new HttpError(404, 'not_found');
  tx(() => {
    if (accept) run('UPDATE assignments SET due_day = ?, extensions = extensions + ? WHERE id = ?', r.day, !r.due_day || r.day > r.due_day ? 1 : 0, id);
    run('DELETE FROM due_requests WHERE assignment_id = ?', id);
  });
  return { ok: true };
}

// ---- team tags: a masul sorts their razakars into sub-teams (#shabab_lahore, #stage) and can give a whole team a task -----------
const TAG = /^[\p{L}\p{N}_]{2,24}$/u, TAGS_MAX = 5;
const cleanTag = (raw) => String(raw ?? '').trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '_');
export function setTags(masulId, username, tags) {
  const r = one('SELECT u.id FROM users u JOIN masul_links l ON l.razakar_id = u.id WHERE u.username = ? AND l.masul_id = ? AND u.deleted_at IS NULL', String(username ?? ''), masulId);
  if (!r) throw new HttpError(404, 'not_found');
  const list = [...new Set((Array.isArray(tags) ? tags : []).map(cleanTag).filter(Boolean))];
  if (list.length > TAGS_MAX || list.some((x) => !TAG.test(x))) throw new HttpError(400, 'bad_tag');
  tx(() => {
    run('DELETE FROM team_tags WHERE masul_id = ? AND razakar_id = ?', masulId, r.id);
    for (const x of list) run('INSERT INTO team_tags (masul_id, razakar_id, tag) VALUES (?,?,?)', masulId, r.id, x);
  });
  return { tags: list };
}
const tagsOf = (masulId, razakarId) => all('SELECT tag FROM team_tags WHERE masul_id = ? AND razakar_id = ? ORDER BY tag', masulId, razakarId).map((x) => x.tag);
export const masulTags = (masulId) => all('SELECT tag, COUNT(*) n FROM team_tags WHERE masul_id = ? GROUP BY tag ORDER BY tag', masulId);
/** One task (or routine) for every razakar in the team. */
export function assignTeam(masulId, rawTag, fields) {
  const tag = cleanTag(rawTag);
  const ids = all('SELECT t.razakar_id id FROM team_tags t JOIN masul_links l ON l.razakar_id = t.razakar_id AND l.masul_id = t.masul_id JOIN users u ON u.id = t.razakar_id WHERE t.masul_id = ? AND t.tag = ? AND u.deleted_at IS NULL', masulId, tag);
  if (!ids.length) throw new HttpError(404, 'empty_team');
  return tx(() => ({ count: ids.map(({ id }) => insertAssignment(masulId, id, fields)).length }));
}

export function addAssignment(masulId, razakarUsername, fields) {
  const r = one('SELECT u.id FROM users u JOIN masul_links l ON l.razakar_id = u.id WHERE u.username = ? AND l.masul_id = ? AND u.deleted_at IS NULL', String(razakarUsername ?? ''), masulId);
  if (!r) throw new HttpError(403, 'not_your_razakar');
  return insertAssignment(masulId, r.id, fields);
}
/** A member's own task or routine: "assigned" by themselves. Their masul and murabbi see it with the rest; only they can change it. */
export const addOwnAssignment = (userId, fields) => insertAssignment(userId, userId, fields);
function insertAssignment(byId, forId, { kind, title, weekday, weekdays, dueDay }) {
  const t = String(title ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) throw new HttpError(400, 'empty_text');
  if ([...t].length > TITLE_MAX) throw new HttpError(400, 'text_too_long');
  if (LINK.test(t)) throw new HttpError(400, 'no_links');
  if (kind !== 'task' && kind !== 'routine') throw new HttpError(400, 'bad_kind');
  let wd = null, due = null, mask = null;
  if (kind === 'routine') {
    const list = Array.isArray(weekdays) ? weekdays : [weekday];
    if (!list.length || list.some((x) => !Number.isInteger(Number(x)) || Number(x) < 0 || Number(x) > 6)) throw new HttpError(400, 'bad_weekday');
    mask = list.reduce((m, x) => m | (1 << Number(x)), 0);
    wd = daysOf(mask)[0];
  } else {
    if (!dueDay) throw new HttpError(400, 'due_required'); // every task has a deadline: a commitment to a day
    due = checkDay(dueDay);
  }
  const write = () => {
    if (one('SELECT COUNT(*) n FROM assignments WHERE razakar_id = ? AND ended_at IS NULL', forId).n >= ACTIVE_MAX) throw new HttpError(429, 'too_many_assignments');
    const res = run('INSERT INTO assignments (masul_id, razakar_id, kind, title, weekday, days, due_day, created_at) VALUES (?,?,?,?,?,?,?,?)', byId, forId, kind, t, wd, mask, due, Date.now());
    return { id: Number(res.lastInsertRowid) };
  };
  return db.isTransaction ? write() : tx(write); // a team assignment already runs inside one transaction
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
  if (a.kind === 'routine' && !onDay(a, today)) throw new HttpError(400, 'not_today');
  let xp = 0;
  tx(() => {
    if (done) {
      if (a.kind === 'task' && one('SELECT 1 FROM assignment_ticks WHERE assignment_id = ?', id)) return;
      if (!run('INSERT OR IGNORE INTO assignment_ticks (assignment_id, day, created_at) VALUES (?,?,?)', id, today, Date.now()).changes) return;
      run('DELETE FROM due_requests WHERE assignment_id = ?', id);
      xp = payTask(a, today);
    } else if (run('DELETE FROM assignment_ticks WHERE assignment_id = ? AND day = ?', id, today).changes) unpayTask(a, today); // undo a mistaken tick, same day only, points and all
  });
  return { ok: true, xpGained: xp };
}
const ROUTINE_WEEKS = 4;
/** How many times a routine fell due in the last four weeks (never before it was assigned) and how many were ticked. Today counts only once ticked. */
function routineStats(a, today) {
  const start = Math.max(dayNum(dayOf(a.created_at)), dayNum(today) - ROUTINE_WEEKS * 7 + 1);
  const ticks = new Set(all('SELECT day FROM assignment_ticks WHERE assignment_id = ?', a.id).map((t) => t.day));
  let due = 0, done = 0;
  for (let n = start; n <= dayNum(today); n++) {
    const d = dayStr(n);
    if (!onDay(a, d)) continue;
    if (ticks.has(d)) { due++; done++; } else if (d < today) due++;
  }
  return { due, done, doneToday: ticks.has(today) };
}
function assignmentOut(a, today) {
  const base = { id: a.id, kind: a.kind, title: a.title, own: a.masul_id === a.razakar_id };
  if (a.kind === 'routine') {
    const st = routineStats(a, today);
    return { ...base, weekday: a.weekday, weekdays: daysOf(maskOf(a)), dueToday: onDay(a, today), doneToday: st.doneToday, last4: { due: st.due, done: st.done } };
  }
  const t = one('SELECT day FROM assignment_ticks WHERE assignment_id = ? ORDER BY day LIMIT 1', a.id);
  const earned = t && one("SELECT xp FROM events WHERE user_id = ? AND kind = 'task' AND ref = ?", a.razakar_id, String(a.id));
  const req = one('SELECT day FROM due_requests WHERE assignment_id = ?', a.id);
  return { ...base, dueDay: a.due_day, done: !!t, doneOn: t?.day ?? null, overdue: !t && !!a.due_day && a.due_day < today,
    daysLate: !t && a.due_day && a.due_day < today ? dayNum(today) - dayNum(a.due_day) : 0, extensions: a.extensions || 0,
    xpNow: t ? null : taskPoints(a, today), xpFull: taskPoints({ ...a, due_day: null, extensions: 0 }, today), xpEarned: earned?.xp ?? null, askedDay: req?.day ?? null };
}
/** What a razakar sees: everything their masul has given them that is still active. */
export function myAssignments(userId) {
  const today = dayOf();
  const rows = all('SELECT a.*, u.username giver FROM assignments a JOIN users u ON u.id = a.masul_id WHERE a.razakar_id = ? AND a.ended_at IS NULL ORDER BY a.kind DESC, a.id', userId);
  return rows.map((a) => ({ ...assignmentOut(a, today), from: a.masul_id === a.razakar_id ? null : a.giver })); // who gave it, unless it is their own
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
  // what the masul gave, and what the razakar set themselves (the masul can see but not change those)
  const items = all('SELECT * FROM assignments WHERE razakar_id = ? AND masul_id IN (?, razakar_id) AND ended_at IS NULL ORDER BY kind DESC, id', r.id, masulId).map((a) => assignmentOut(a, today));
  return { username: u.username, city: u.city, joined: u.created_day, progress: generalProgress(r.id), assignments: items, tags: tagsOf(masulId, r.id), allTags: masulTags(masulId).map((x) => x.tag) };
}
export function razakarList(masulId) {
  const today = dayOf();
  return all(`SELECT u.id, u.username, u.city, u.avatar_v av FROM masul_links l JOIN users u ON u.id = l.razakar_id WHERE l.masul_id = ? AND u.deleted_at IS NULL ORDER BY u.username`, masulId).map((u) => {
    const items = all('SELECT * FROM assignments WHERE razakar_id = ? AND masul_id IN (?, razakar_id) AND ended_at IS NULL', u.id, masulId).map((a) => assignmentOut(a, today));
    const tasks = items.filter((i) => i.kind === 'task'), routines = items.filter((i) => i.kind === 'routine');
    const due = routines.reduce((n, i) => n + i.last4.due, 0), done = routines.reduce((n, i) => n + i.last4.done, 0);
    const g = generalProgress(u.id);
    return { username: u.username, avatar: avatarUrl(u.id, u.av), city: u.city, openTasks: tasks.filter((t) => !t.done).length, overdue: tasks.filter((t) => t.overdue).length, asks: tasks.filter((t) => t.askedDay && !t.own).length, tags: tagsOf(masulId, u.id),
      routinePercent: due ? Math.round((done / due) * 100) : null, duroodWeek: g.durood.week, streak: g.streak };
  });
}

/** A murabbi's report on one salik: the whole profile, all progress, mamulaat, and any tasks and routines they carry. */
export async function saalikReport(murabbiId, username) {
  const q = `SELECT u.id FROM users u JOIN murabbi_links l ON l.user_id = u.id WHERE u.username = ? AND l.murabbi_id = ? AND l.salik_ok = 1 AND l.murabbi_ok = 1 AND u.deleted_at IS NULL`;
  let s = one(q, String(username), murabbiId);
  if (!s) throw new HttpError(404, 'not_found');
  await refreshMurabbi(s.id);                      // a murabbi the Mamulaat app has since replaced loses access now, not when the salik next opens the app
  s = one(q, String(username), murabbiId);
  if (!s) throw new HttpError(404, 'not_found');
  touchView(murabbiId, s.id, 'murabbi');
  const sync = await syncMamulaat(s.id);
  const u = livePerson(s.id), today = dayOf();
  const g = generalProgress(s.id);
  const extra = {
    badges: one('SELECT COUNT(*) n FROM badges WHERE user_id = ?', s.id)?.n ?? 0,
    badgeList: all('SELECT code FROM badges WHERE user_id = ? ORDER BY earned_at DESC', s.id).map((b) => b.code),
    caravan: one('SELECT c.name FROM caravan_members cm JOIN caravans c ON c.id = cm.caravan_id WHERE cm.user_id = ?', s.id)?.name ?? null, // the named group they belong to
    invited: one('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND deleted_at IS NULL', s.id).n,             // people they brought in themselves
    qabila: one('SELECT COUNT(*) n FROM ancestors WHERE ancestor_id = ? AND depth > 0', s.id).n,
    reflections: all("SELECT day, body FROM reflections WHERE user_id = ? AND status = 'visible' ORDER BY day DESC LIMIT 5", s.id),
  };
  const masul = masulState(s.id);
  const items = all('SELECT * FROM assignments WHERE razakar_id = ? AND ended_at IS NULL ORDER BY kind DESC, id', s.id).map((a) => assignmentOut(a, today));
  return { profile: { username: u.username, phone: u.phone, email: u.email, city: u.city, country: u.country, joined: u.created_day, lang: u.lang },
    progress: g, extra, mamulaat: { ...mamulaatSeries(s.id), stale: sync.stale }, masul: masul?.username ?? null, assignments: items };
}
export async function saalikList(murabbiId) {
  const q = `SELECT u.id, u.username, u.city, u.avatar_v av FROM murabbi_links l JOIN users u ON u.id = l.user_id WHERE l.murabbi_id = ? AND l.salik_ok = 1 AND l.murabbi_ok = 1 AND u.deleted_at IS NULL ORDER BY u.username`;
  for (const u of all(q, murabbiId)) await refreshMurabbi(u.id); // at most daily per salik; a replaced murabbi drops out of the list
  return all(q, murabbiId).map((u) => {
    const g = generalProgress(u.id), m = mamulaatSeries(u.id);
    return { username: u.username, avatar: avatarUrl(u.id, u.av), city: u.city, duroodToday: g.durood.today, duroodWeek: g.durood.week, streak: g.streak, mamulaatToday: m.today, mamulaatAverage: m.average };
  });
}

// ---- admin oversight ---------------------------------------------------------------------------------------------------------
export function adminLinks() {
  const murabbi = all(`SELECT s.username salik, m.username murabbi, l.murabbi_name name, l.salik_ok, l.murabbi_ok, l.created_at FROM murabbi_links l
    JOIN users s ON s.id = l.user_id LEFT JOIN users m ON m.id = l.murabbi_id WHERE s.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 300`)
    .map((r) => ({ salik: r.salik, murabbi: r.murabbi, name: r.name, stage: !r.murabbi ? 'waiting' : !r.salik_ok ? 'confirm' : !r.murabbi_ok ? 'pending' : 'active', at: r.created_at }));
  const masul = all(`SELECT r.username razakar, m.username masul, l.created_at at FROM masul_links l JOIN users r ON r.id = l.razakar_id JOIN users m ON m.id = l.masul_id
    WHERE r.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 300`);
  return { murabbi, masul };
}
/** Breaks a link from the admin page (a wrong murabbi found through someone else's number, an unwanted masul). */
export function adminBreak(kind, username) {
  const u = one('SELECT id FROM users WHERE username = ?', String(username));
  if (!u || !['murabbi', 'masul'].includes(kind)) throw new HttpError(404, 'not_found');
  if (kind === 'murabbi') { if (!one('SELECT 1 FROM murabbi_links WHERE user_id = ?', u.id)) throw new HttpError(404, 'not_found'); unlinkMurabbi(u.id); }
  else { if (!one('SELECT 1 FROM masul_links WHERE razakar_id = ?', u.id)) throw new HttpError(404, 'not_found'); clearMasul(u.id); }
  return { ok: true };
}

// ---- everything the app needs on one screen --------------------------------------------------------------------------------------
export async function burhanState(userId) {
  await refreshMurabbi(userId);
  const murabbi = murabbiState(userId);
  if (murabbi?.stage === 'active') await syncMamulaat(userId);
  const assignments = myAssignments(userId);
  const today = assignments.filter((a) => (a.kind === 'routine' ? a.dueToday : !a.done));
  return {
    edition: edition(), murabbi, masul: masulState(userId), notices: notices(userId),
    mamulaat: murabbi?.stage === 'active' ? mamulaatSeries(userId) : null,
    assignments, today,
    roles: { saaliks: one('SELECT COUNT(*) n FROM murabbi_links l JOIN users u ON u.id = l.user_id WHERE l.murabbi_id = ? AND l.salik_ok = 1 AND l.murabbi_ok = 1 AND u.deleted_at IS NULL', userId).n,
      requests: murabbiRequests(userId).length,
      razakars: one('SELECT COUNT(*) n FROM masul_links l JOIN users u ON u.id = l.razakar_id WHERE l.masul_id = ? AND u.deleted_at IS NULL', userId).n },
  };
}
