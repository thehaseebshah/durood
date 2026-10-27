// Caravans: a named group an admin creates for an owner. A member joins one caravan at sign-up (its name is the invite code) and stays
// until the owner or an admin removes them. One caravan per member, no size limit.
import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import { avatarUrl } from './auth.js';
import { CFG, hooks, deleteHooks, award, evalBadges, dayOf, dayNum, dayStr, weekStart, challengeConfig, cachedBoard } from './game.js';
import { validHandle, handleTaken } from './handles.js';
import { caravanHooks } from './compete.js';
import { suspendHooks } from './access.js';
import { plain, NAME_MAX } from './profile.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

export const MIN_BOARD_MEMBERS = 2;         // a caravan appears on the boards once it has this many members
const LIVE = 'u.deleted_at IS NULL AND u.suspended = 0';

const caravanOf = (userId) => one(`SELECT c.*, cm.joined_at FROM caravan_members cm JOIN caravans c ON c.id = cm.caravan_id WHERE cm.user_id = ?`, userId);
const cleanName = (raw) => {
  const n = String(raw ?? '').trim();
  if (!validHandle(n)) throw new HttpError(400, 'bad_caravan_name');
  return n;
};
const userByName = (username) => one(`SELECT u.id, u.username FROM users u WHERE u.username = ? AND ${LIVE}`, String(username ?? '').trim());

// ---- membership --------------------------------------------------------------------------------------------------------------
/** Puts a member into a caravan. Call inside the transaction that creates or changes the member. */
export function join(caravanId, userId) {
  run('INSERT INTO caravan_members (user_id, caravan_id, joined_at) VALUES (?,?,?)', userId, caravanId, Date.now());
  evalBadges(userId, []);                                              // a caravan that is already past a total milestone shares it with the newcomer
}

/** An admin creates a caravan and makes an existing member (who is in no caravan yet) its owner. */
/** Creates a caravan with `userId` as its owner and first member. Call inside a transaction. */
export function createWithOwner(userId, rawName, displayName = '') {
  const name = cleanName(rawName);
  const dn = displayName === undefined || displayName === '' ? '' : plain(displayName, NAME_MAX, 2);
  if (caravanOf(userId)) throw new HttpError(409, 'already_in_caravan');
  if (handleTaken(name)) throw new HttpError(409, 'caravan_name_taken');
  const id = Number(run('INSERT INTO caravans (name, display_name, owner_id, created_at) VALUES (?,?,?,?)', name, dn, userId, Date.now()).lastInsertRowid);
  join(id, userId);
  return { id, name };
}

/** An admin creates a caravan and makes an existing member (who is in no caravan yet) its owner. */
export function adminCreate({ name, owner, displayName }) {
  return tx(() => {
    const u = userByName(owner);
    if (!u) throw new HttpError(404, 'member_not_found');
    return { ...createWithOwner(u.id, name, displayName), owner: u.username };
  });
}

/** An admin puts a member who is in no caravan (a new owner, or someone removed) into one. */
export function adminAddMember(caravanId, username) {
  return tx(() => {
    if (!one('SELECT 1 FROM caravans WHERE id = ?', caravanId)) throw new HttpError(404, 'not_found');
    const u = userByName(username);
    if (!u) throw new HttpError(404, 'member_not_found');
    if (caravanOf(u.id)) throw new HttpError(409, 'already_in_caravan');
    join(caravanId, u.id);
    return { ok: true };
  });
}

export function rename(userId, rawName) {
  const name = cleanName(rawName);
  return tx(() => {
    const c = caravanOf(userId);
    if (!c || c.owner_id !== userId) throw new HttpError(403, 'owner_only');
    if (handleTaken(name, { exceptCaravanId: c.id })) throw new HttpError(409, 'caravan_name_taken');
    run('UPDATE caravans SET name = ? WHERE id = ?', name, c.id);
    return { ok: true };
  });
}

/** The owner gives the caravan a display name in any script (Urdu, say), or clears it; the unique handle is unchanged. Same rules as a member's display name. */
export function setDisplayName(userId, raw) {
  const dn = plain(raw, NAME_MAX, 2);
  const c = caravanOf(userId);
  if (!c || c.owner_id !== userId) throw new HttpError(403, 'owner_only');
  run('UPDATE caravans SET display_name = ? WHERE id = ?', dn, c.id);
  return { ok: true };
}

/** Removing a member (or an account being deleted) hands the caravan on to the longest-standing member if it was the owner's, and closes it when nobody is left. */
function removeMember(caravanId, userId) {
  const was = one('SELECT joined_at FROM caravan_members WHERE user_id = ? AND caravan_id = ?', userId, caravanId);
  if (was) run('INSERT INTO caravan_past (caravan_id, user_id, joined_at, left_at) VALUES (?,?,?,?)', caravanId, userId, was.joined_at, Date.now());
  run('DELETE FROM caravan_members WHERE user_id = ? AND caravan_id = ?', userId, caravanId);
  const c = one('SELECT owner_id FROM caravans WHERE id = ?', caravanId);
  if (!c) return;
  const next = one(`SELECT cm.user_id FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE} ORDER BY cm.joined_at, cm.user_id LIMIT 1`, caravanId);
  if (!next) { dissolve(caravanId); return; }
  if (c.owner_id === userId) run('UPDATE caravans SET owner_id = ? WHERE id = ?', next.user_id, caravanId);
}
function dissolve(caravanId) {
  run('DELETE FROM invites WHERE caravan_id = ?', caravanId);
  run('DELETE FROM caravan_members WHERE caravan_id = ?', caravanId);
  run('DELETE FROM caravan_past WHERE caravan_id = ?', caravanId);
  run('DELETE FROM caravans WHERE id = ?', caravanId);
}
/** An admin removes a member from a caravan (the owner too: the role passes on). */
export function adminRemove(caravanId, username) {
  return tx(() => {
    const u = userByName(username);
    if (!u || !one('SELECT 1 FROM caravan_members WHERE user_id = ? AND caravan_id = ?', u.id, caravanId)) throw new HttpError(404, 'not_found');
    removeMember(caravanId, u.id);
    return { ok: true };
  });
}
export function removeByOwner(ownerId, username) {
  return tx(() => {
    const c = caravanOf(ownerId);
    if (!c || c.owner_id !== ownerId) throw new HttpError(403, 'owner_only');
    const u = userByName(username);
    if (!u || u.id === ownerId || !one('SELECT 1 FROM caravan_members WHERE user_id = ? AND caravan_id = ?', u.id, c.id)) throw new HttpError(404, 'not_found');
    removeMember(c.id, u.id);
    return { ok: true };
  });
}
// an account that is deleted leaves its caravan first (the owner role passes on)
deleteHooks.push((userId) => {
  const c = caravanOf(userId);
  if (c) removeMember(c.id, userId);
});

// a suspended owner can't look after the caravan: the owner role passes to the longest-standing active member, and the suspended
// person stays a plain member (so they don't get it back on return). A caravan with nobody else active is left as it is.
suspendHooks.push((userId) => {
  const c = one('SELECT id FROM caravans WHERE owner_id = ?', userId);
  if (!c) return;
  const next = one(`SELECT cm.user_id FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE} ORDER BY cm.joined_at, cm.user_id LIMIT 1`, c.id);
  if (next) run('UPDATE caravans SET owner_id = ? WHERE id = ?', next.user_id, c.id);
});

// ---- the caravan streak -------------------------------------------------------------------------------------------------------
const streakCache = new Map();
/**
 * A caravan (at least 3 members) keeps a streak for every day that half or more of its members recited. Today does not break the
 * streak until it is over. A member counts from the day they joined. Durood on hold does not count, for or against.
 */
export function streakStatus(caravanId, today = dayOf()) {
  const ttl = Number(process.env.PUBLIC_CACHE_MS ?? 60_000), hit = streakCache.get(caravanId);
  if (ttl > 0 && hit && Date.now() - hit.at < ttl && hit.day === today) return hit.v;
  const members = all(`SELECT u.id, u.username, cm.joined_at FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE} AND u.held = 0`, caravanId)
    .map((m) => ({ ...m, joined: dayOf(m.joined_at) }));
  let v;
  if (members.length < 3) v = { active: false, size: members.length, streak: 0, today: 0, missing: [] };
  else {
    const from = dayStr(dayNum(today) - 60);
    // members who have left still count, for and against, on the days they belonged: removing those who missed days can't mend the past
    const past = all(`SELECT p.user_id id, p.joined_at, p.left_at FROM caravan_past p JOIN users u ON u.id = p.user_id WHERE p.caravan_id = ? AND p.left_at >= ? AND u.held = 0`,
      caravanId, Date.parse(from + 'T00:00:00Z') - 86400e3).map((p) => ({ id: p.id, joined: dayOf(p.joined_at), left: dayOf(p.left_at) }));
    const spans = [...members.map((m) => ({ id: m.id, joined: m.joined, left: null })), ...past];
    const belongs = (s, d) => s.joined <= d && (s.left === null || d < s.left);
    const did = new Map(); // day -> set of members who recited on a day they belonged
    const ids = [...new Set(spans.map((s) => s.id))];
    for (const r of all(`SELECT d.user_id, d.day FROM daily d WHERE d.user_id IN (${ids.map(() => '?').join(',')}) AND d.day >= ? AND d.count > 0`, ...ids, from)) {
      if (!spans.some((s) => s.id === r.user_id && belongs(s, r.day))) continue;
      if (!did.has(r.day)) did.set(r.day, new Set());
      did.get(r.day).add(r.user_id);
    }
    const met = (d) => { const size = new Set(spans.filter((s) => belongs(s, d)).map((s) => s.id)).size; return size >= 3 && (did.get(d)?.size || 0) * 2 >= size; };
    let streak = 0, d = today;
    if (met(d)) streak = 1;
    for (let i = 1; i <= 60; i++) { d = dayStr(dayNum(today) - i); if (!met(d)) break; streak += 1; }
    const t = did.get(today) || new Set();
    v = { active: true, size: members.length, streak, today: t.size, missing: members.length <= 40 ? members.filter((m) => !t.has(m.id)).map((m) => m.username).slice(0, 8) : [] };
  }
  if (ttl > 0) { if (streakCache.size > 500) streakCache.clear(); streakCache.set(caravanId, { at: Date.now(), day: today, v }); }
  return v;
}

// ---- badges shared by a whole caravan -------------------------------------------------------------------------------------------
const TOTAL_BADGES = [[10_000, 'group10k'], [100_000, 'group100k'], [1_000_000, 'group1m']];
const STREAK_BADGES = [[7, 'karwan7'], [30, 'karwan30']];
function awardAll(caravanId, code, fresh) {
  for (const m of all(`SELECT u.id FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE} AND u.total >= ?`, caravanId, CFG.activeMin)) award(m.id, code, fresh); // active members only
}
/** Runs inside the transaction that records durood: shares a crossed total or streak milestone with every member, once. */
export function afterLog(userId, fresh) {
  const c = caravanOf(userId);
  if (!c) return;
  const total = one(`SELECT COALESCE(SUM(u.total), 0) n FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE} AND u.held = 0`, c.id).n;
  for (const [thr, code] of TOTAL_BADGES) if (total >= thr && c.total_awarded < thr) { awardAll(c.id, code, fresh); run('UPDATE caravans SET total_awarded = ? WHERE id = ?', thr, c.id); c.total_awarded = thr; }
  const ks = streakStatus(c.id);
  if (ks.active) for (const [thr, code] of STREAK_BADGES) if (ks.streak >= thr && c.streak_awarded < thr) { awardAll(c.id, code, fresh); run('UPDATE caravans SET streak_awarded = ? WHERE id = ?', thr, c.id); c.streak_awarded = thr; }
}

caravanHooks.afterLog = afterLog;

// ---- what a member sees ---------------------------------------------------------------------------------------------------------
const MILESTONES = [10_000, 100_000, 1_000_000];
/** Owner's list of members who have gone quiet: nothing recited for LAG_DAYS days (or ever), after a grace period from joining. Worst first. */
const LAG_DAYS = 3, GRACE_DAYS = 7;
function lagging(caravanId, members, ownerName, today) {
  const out = [];
  for (const m of members) {
    if (m.username === ownerName || m.held) continue;
    if (dayNum(today) - dayNum(dayOf(m.joined_at)) < GRACE_DAYS) continue;
    const last = one('SELECT MAX(day) d FROM daily WHERE user_id = ? AND count > 0', m.uid)?.d || null;
    const quiet = last ? dayNum(today) - dayNum(last) : null;
    if (quiet !== null && quiet < LAG_DAYS) continue;
    out.push({ username: m.username, displayName: m.dn, avatar: avatarUrl(m.uid, m.av), quietDays: quiet, week: m.week });
  }
  // never recited first, then the longest silence
  return out.sort((x, y) => (y.quietDays ?? 1e9) - (x.quietDays ?? 1e9) || x.username.localeCompare(y.username));
}
export function view(userId) {
  const c = caravanOf(userId);
  if (!c) return { caravan: null };
  const wk = weekStart(), today = dayOf();
  const members = all(`SELECT u.id uid, u.username, u.city, u.total, u.held, u.avatar_v av, u.display_name dn, cm.joined_at,
        COALESCE((SELECT SUM(d.count) FROM daily d WHERE d.user_id = u.id AND d.day >= ?), 0) week,
        EXISTS(SELECT 1 FROM daily d WHERE d.user_id = u.id AND d.day = ? AND d.count > 0) today
      FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE}
      ORDER BY week DESC, u.username LIMIT 200`, wk, today, c.id);
  const agg = one(`SELECT COUNT(*) members, COALESCE(SUM(CASE WHEN u.held = 0 THEN u.total ELSE 0 END), 0) total FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE}`, c.id);
  const wagg = one(`SELECT COALESCE(SUM(d.count), 0) week, COUNT(DISTINCT d.user_id) active FROM daily d JOIN caravan_members cm ON cm.user_id = d.user_id JOIN users u ON u.id = d.user_id
                    WHERE cm.caravan_id = ? AND ${LIVE} AND u.held = 0 AND d.day >= ? AND d.count > 0`, c.id, wk);
  const owner = c.owner_id === userId;
  const out = {
    caravan: { id: c.id, name: c.name, displayName: c.display_name || '', owner, ownerName: one('SELECT username FROM users WHERE id = ?', c.owner_id).username, members: agg.members, total: agg.total, week: wagg.week, active: wagg.active,
      next: MILESTONES.find((x) => x > agg.total) || MILESTONES.at(-1), prev: MILESTONES.filter((x) => x <= agg.total).at(-1) || 0 },
    streak: streakStatus(c.id),
    members: members.map((m) => ({ username: m.username, displayName: m.dn, avatar: avatarUrl(m.uid, m.av), city: m.city, total: m.total, week: m.week, today: !!m.today, owner: false, joinedAt: m.joined_at })),
  };
  for (const m of out.members) m.owner = m.username === out.caravan.ownerName;
  if (owner) out.lagging = lagging(c.id, members, out.caravan.ownerName, today);
  return out;
}
/** Small summary for the profile: which caravan the member belongs to (null only for a member an admin created or removed from one). */
hooks.profileExtra = (userId) => summary(userId);
export function summary(userId) {
  const c = caravanOf(userId);
  if (!c) return { caravan: null };
  return { caravan: { id: c.id, name: c.name, displayName: c.display_name || '', owner: c.owner_id === userId, members: one(`SELECT COUNT(*) n FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE}`, c.id).n } };
}

// ---- rankings ----------------------------------------------------------------------------------------------------------------------
/** Caravans ranked by durood. metric 'total' (for the period), 'average' (this week per active member) or 'growth' (this week against last week). */
export function board(userId, period = 'week', metric = 'total') {
  const mine = caravanOf(userId)?.id ?? 0;
  const wk = weekStart(), prev = dayStr(dayNum(wk) - 7);
  const ch = challengeConfig();
  const chFrom = ch.start || '9999-12-31', chTo = ch.start ? dayStr(dayNum(ch.start) + ch.days - 1) : '0000-01-01';
  const rows = cachedBoard(`cv:${period}:${metric}`, () => {
    const members = new Map(all(`SELECT cm.caravan_id id, COUNT(*) n FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE ${LIVE} GROUP BY cm.caravan_id`).map((r) => [r.id, r.n]));
    let sums;
    if (metric === 'total' && period === 'all') {
      sums = all(`SELECT cm.caravan_id id, SUM(u.total) score, 0 active FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE ${LIVE} AND u.held = 0 GROUP BY cm.caravan_id`);
    } else {
      const [from, to] = metric !== 'total' || period === 'week' ? [prev, '9999-12-31'] : [chFrom, chTo];
      sums = all(`WITH w AS (SELECT d.user_id, SUM(CASE WHEN d.day >= ? THEN d.count ELSE 0 END) wk, SUM(CASE WHEN d.day < ? THEN d.count ELSE 0 END) last,
                                   MAX(CASE WHEN d.day >= ? AND d.count > 0 THEN 1 ELSE 0 END) active, SUM(d.count) any
                            FROM daily d JOIN users hu ON hu.id = d.user_id AND hu.held = 0 WHERE d.day >= ? AND d.day <= ? GROUP BY d.user_id)
                  SELECT cm.caravan_id id, SUM(w.wk) wk, SUM(w.last) last, SUM(w.active) active, SUM(w.any) any
                  FROM w JOIN caravan_members cm ON cm.user_id = w.user_id JOIN users u ON u.id = w.user_id WHERE ${LIVE} GROUP BY cm.caravan_id`, wk, wk, wk, from, to)
        .map((r) => ({ id: r.id, active: r.active, score: metric === 'growth' ? r.wk - r.last : metric === 'average' ? (r.active ? Math.round(r.wk / r.active) : 0) : period === 'week' ? r.wk : r.any }));
    }
    const names = new Map(all('SELECT id, name, display_name FROM caravans').map((r) => [r.id, r]));
    return sums.filter((r) => (members.get(r.id) || 0) >= MIN_BOARD_MEMBERS && (metric === 'growth' ? r.score !== 0 : r.score > 0))
      .map((r) => ({ id: r.id, name: names.get(r.id).name, displayName: names.get(r.id).display_name || '', members: members.get(r.id), active: r.active, score: r.score }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 50);
  });
  return { rows: rows.map((r, i) => ({ rank: i + 1, ...r, me: r.id === mine })), weekStart: wk, metric, minMembers: MIN_BOARD_MEMBERS };
}

// ---- administration ---------------------------------------------------------------------------------------------------------------------
export const adminList = (q = '') => {
  const like = `%${String(q).trim().slice(0, 30).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return all(`SELECT c.id, c.name, c.display_name, u.username owner, c.created_at,
    (SELECT COUNT(*) FROM caravan_members cm WHERE cm.caravan_id = c.id) members,
    (SELECT GROUP_CONCAT(x.username, ', ') FROM (SELECT m.username FROM caravan_members cm JOIN users m ON m.id = cm.user_id WHERE cm.caravan_id = c.id ORDER BY cm.joined_at LIMIT 6) x) sample
    FROM caravans c JOIN users u ON u.id = c.owner_id WHERE c.name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' ORDER BY c.id DESC LIMIT 200`, like, like);
};
/** An admin clears a caravan's display name (an offensive one, say). */
export function adminClearDisplayName(id) {
  if (!one('SELECT 1 FROM caravans WHERE id = ?', id)) throw new HttpError(404, 'not_found');
  run("UPDATE caravans SET display_name = '' WHERE id = ?", id);
  return { ok: true };
}

/** An admin renames a caravan (an offensive name, say). The same name rules and name space apply. */
export function adminRename(id, rawName) {
  const name = cleanName(rawName);
  return tx(() => {
    if (!one('SELECT 1 FROM caravans WHERE id = ?', id)) throw new HttpError(404, 'not_found');
    if (handleTaken(name, { exceptCaravanId: id })) throw new HttpError(409, 'caravan_name_taken');
    run('UPDATE caravans SET name = ? WHERE id = ?', name, id);
    return { ok: true, name };
  });
}
export function adminDelete(id) {
  return tx(() => { const c = one('SELECT name FROM caravans WHERE id = ?', id); if (!c) throw new HttpError(404, 'not_found'); dissolve(id); return { ok: true, name: c.name }; });
}
