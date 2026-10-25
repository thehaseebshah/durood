// Caravans: a group a member creates and names. Members join by the owner's invitation, or by asking and the owner agreeing.
// One caravan per member, no size limit. The referral tree ("Qabila") is separate (game.js) and untouched by any of this.
import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import { avatarUrl } from './auth.js';
import { CFG, hooks, deleteHooks, award, evalBadges, dayOf, dayNum, dayStr, weekStart, challengeConfig, cachedBoard, person } from './game.js';
import { validHandle, handleTaken } from './handles.js';
import { caravanHooks } from './compete.js';
import { suspendHooks } from './access.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

export const MIN_BOARD_MEMBERS = 2;         // a caravan appears on the boards once it has this many members
const MAX_PENDING = 100;                    // open invitations and requests per caravan
const MAX_MY_REQUESTS = 5;                  // open requests one member may have
const LIVE = 'u.deleted_at IS NULL AND u.suspended = 0';

const caravanOf = (userId) => one(`SELECT c.*, cm.joined_at FROM caravan_members cm JOIN caravans c ON c.id = cm.caravan_id WHERE cm.user_id = ?`, userId);
const cleanName = (raw) => {
  const n = String(raw ?? '').trim();
  if (!validHandle(n)) throw new HttpError(400, 'bad_caravan_name');
  return n;
};
const userByName = (username) => one(`SELECT u.id, u.username FROM users u WHERE u.username = ? AND ${LIVE}`, String(username ?? '').trim());

// ---- membership --------------------------------------------------------------------------------------------------------------
function join(caravanId, userId) {
  run('INSERT INTO caravan_members (user_id, caravan_id, joined_at) VALUES (?,?,?)', userId, caravanId, Date.now());
  run('DELETE FROM caravan_invites WHERE user_id = ?', userId);       // everything else pending for this member is now moot
  evalBadges(userId, []);                                              // a caravan that is already past a total milestone shares it with the newcomer
}

export function create(userId, rawName) {
  const name = cleanName(rawName);
  return tx(() => {
    if (caravanOf(userId)) throw new HttpError(409, 'already_in_caravan');
    if (handleTaken(name)) throw new HttpError(409, 'caravan_name_taken');
    const id = Number(run('INSERT INTO caravans (name, owner_id, created_at) VALUES (?,?,?)', name, userId, Date.now()).lastInsertRowid);
    join(id, userId);
    return { id };
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

/** The owner asks a member by username. If that member had already asked to join, they simply join. */
export function invite(ownerId, username) {
  return tx(() => {
    const c = caravanOf(ownerId);
    if (!c || c.owner_id !== ownerId) throw new HttpError(403, 'owner_only');
    const u = userByName(username);
    if (!u) throw new HttpError(404, 'member_not_found');
    if (u.id === ownerId) throw new HttpError(400, 'own_invite');
    if (one('SELECT 1 FROM caravan_members WHERE user_id = ?', u.id)) throw new HttpError(409, 'in_a_caravan');
    const open = one('SELECT kind FROM caravan_invites WHERE caravan_id = ? AND user_id = ?', c.id, u.id);
    if (open?.kind === 'request') { join(c.id, u.id); return { joined: true }; }
    if (open) throw new HttpError(409, 'already_invited');
    if (one('SELECT COUNT(*) n FROM caravan_invites WHERE caravan_id = ?', c.id).n >= MAX_PENDING) throw new HttpError(429, 'too_many_pending');
    run("INSERT INTO caravan_invites (caravan_id, user_id, kind, created_at) VALUES (?,?,'invite',?)", c.id, u.id, Date.now());
    return { joined: false };
  });
}

/** A member asks to join a caravan by its name. If the owner had already invited them, they simply join. */
export function requestJoin(userId, rawName) {
  const name = String(rawName ?? '').trim();
  return tx(() => {
    if (caravanOf(userId)) throw new HttpError(409, 'already_in_caravan');
    const c = one('SELECT id FROM caravans WHERE name = ?', name);
    if (!c) throw new HttpError(404, 'caravan_not_found');
    const open = one('SELECT kind FROM caravan_invites WHERE caravan_id = ? AND user_id = ?', c.id, userId);
    if (open?.kind === 'invite') { join(c.id, userId); return { joined: true }; }
    if (open) throw new HttpError(409, 'already_requested');
    if (one("SELECT COUNT(*) n FROM caravan_invites WHERE user_id = ? AND kind = 'request'", userId).n >= MAX_MY_REQUESTS) throw new HttpError(429, 'too_many_requests');
    if (one('SELECT COUNT(*) n FROM caravan_invites WHERE caravan_id = ?', c.id).n >= MAX_PENDING) throw new HttpError(429, 'too_many_pending');
    run("INSERT INTO caravan_invites (caravan_id, user_id, kind, created_at) VALUES (?,?,'request',?)", c.id, userId, Date.now());
    return { joined: false };
  });
}

/** The invited member answers an invitation. */
export function answerInvitation(userId, caravanId, accept) {
  return tx(() => {
    const row = one("SELECT 1 FROM caravan_invites WHERE caravan_id = ? AND user_id = ? AND kind = 'invite'", caravanId, userId);
    if (!row) throw new HttpError(404, 'not_found');
    if (!accept) { run('DELETE FROM caravan_invites WHERE caravan_id = ? AND user_id = ?', caravanId, userId); return { ok: true }; }
    if (caravanOf(userId)) throw new HttpError(409, 'already_in_caravan');
    join(caravanId, userId);
    return { ok: true };
  });
}

/** The owner answers a request to join. */
export function answerRequest(ownerId, username, accept) {
  return tx(() => {
    const c = caravanOf(ownerId);
    if (!c || c.owner_id !== ownerId) throw new HttpError(403, 'owner_only');
    const u = userByName(username);
    const row = u && one("SELECT 1 FROM caravan_invites WHERE caravan_id = ? AND user_id = ? AND kind = 'request'", c.id, u.id);
    if (!row) throw new HttpError(404, 'not_found');
    if (!accept) { run('DELETE FROM caravan_invites WHERE caravan_id = ? AND user_id = ?', c.id, u.id); return { ok: true }; }
    if (caravanOf(u.id)) { run('DELETE FROM caravan_invites WHERE caravan_id = ? AND user_id = ?', c.id, u.id); throw new HttpError(409, 'in_a_caravan'); }
    join(c.id, u.id);
    return { ok: true };
  });
}

/** Withdraw an invitation (owner) or one's own request (member). */
export function cancelPending(userId, { username, caravanId }) {
  if (username) {
    const c = caravanOf(userId);
    if (!c || c.owner_id !== userId) throw new HttpError(403, 'owner_only');
    const u = userByName(username);
    if (!u || !run('DELETE FROM caravan_invites WHERE caravan_id = ? AND user_id = ?', c.id, u.id).changes) throw new HttpError(404, 'not_found');
  } else if (!run("DELETE FROM caravan_invites WHERE caravan_id = ? AND user_id = ? AND kind = 'request'", Number(caravanId), userId).changes) throw new HttpError(404, 'not_found');
  return { ok: true };
}

/** Leaving hands the caravan to the longest-standing member, and closes it when nobody is left. */
function removeMember(caravanId, userId) {
  run('DELETE FROM caravan_members WHERE user_id = ? AND caravan_id = ?', userId, caravanId);
  const c = one('SELECT owner_id FROM caravans WHERE id = ?', caravanId);
  if (!c) return;
  const next = one(`SELECT cm.user_id FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE} ORDER BY cm.joined_at, cm.user_id LIMIT 1`, caravanId);
  if (!next) { dissolve(caravanId); return; }
  if (c.owner_id === userId) run('UPDATE caravans SET owner_id = ? WHERE id = ?', next.user_id, caravanId);
}
function dissolve(caravanId) {
  run('DELETE FROM caravan_invites WHERE caravan_id = ?', caravanId);
  run('DELETE FROM caravan_members WHERE caravan_id = ?', caravanId);
  run('DELETE FROM caravans WHERE id = ?', caravanId);
}
export function leave(userId) {
  return tx(() => {
    const c = caravanOf(userId);
    if (!c) throw new HttpError(404, 'not_found');
    removeMember(c.id, userId);
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
  run('DELETE FROM caravan_invites WHERE user_id = ?', userId);
});

// a suspended owner can't look after the caravan: the owner role passes to the longest-standing active member, and the suspended
// person stays a plain member (so they don't get it back on return). A caravan with nobody else active is left as it is.
suspendHooks.push((userId) => {
  const c = one('SELECT id FROM caravans WHERE owner_id = ?', userId);
  if (!c) return;
  const next = one(`SELECT cm.user_id FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE} ORDER BY cm.joined_at, cm.user_id LIMIT 1`, c.id);
  if (next) run('UPDATE caravans SET owner_id = ? WHERE id = ?', next.user_id, c.id);
});

/** Members who could be invited: not in any caravan, matching the start of what was typed. */
export function searchInvitees(userId, q) {
  const s = String(q ?? '').trim().replace(/[^a-z0-9_]/gi, '');
  if (s.length < 2) return [];
  return all(`SELECT u.username FROM users u WHERE u.username LIKE ? ESCAPE '\\' AND ${LIVE} AND u.id != ?
              AND NOT EXISTS (SELECT 1 FROM caravan_members cm WHERE cm.user_id = u.id) ORDER BY u.username LIMIT 8`, `${s}%`, userId).map((r) => r.username);
}
export function searchCaravans(q) {
  const s = String(q ?? '').trim().replace(/[^a-z0-9_]/gi, '');
  if (s.length < 2) return [];
  return all(`SELECT c.name, (SELECT COUNT(*) FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = c.id AND ${LIVE}) members
              FROM caravans c WHERE c.name LIKE ? ESCAPE '\\' ORDER BY c.name LIMIT 8`, `${s}%`);
}

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
    const did = new Map(); // day -> set of members who recited, counted only from the day they joined
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const r of all(`SELECT d.user_id, d.day FROM daily d WHERE d.user_id IN (SELECT cm.user_id FROM caravan_members cm WHERE cm.caravan_id = ?) AND d.day >= ? AND d.count > 0`, caravanId, from)) {
      const m = byId.get(r.user_id);
      if (!m || m.joined > r.day) continue;
      if (!did.has(r.day)) did.set(r.day, new Set());
      did.get(r.day).add(r.user_id);
    }
    const met = (d) => { const size = members.filter((m) => m.joined <= d).length; return size >= 3 && (did.get(d)?.size || 0) * 2 >= size; };
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
  for (const m of all(`SELECT u.id FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE} AND u.total >= ?`, caravanId, CFG.referralMin)) award(m.id, code, fresh); // active members only
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
export function view(userId) {
  const c = caravanOf(userId);
  const invitations = all(`SELECT c.id, c.name, (SELECT COUNT(*) FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = c.id AND ${LIVE}) members, ci.created_at at
                           FROM caravan_invites ci JOIN caravans c ON c.id = ci.caravan_id WHERE ci.user_id = ? AND ci.kind = 'invite' ORDER BY ci.created_at DESC LIMIT 20`, userId);
  if (!c) {
    const requests = all(`SELECT c.id, c.name FROM caravan_invites ci JOIN caravans c ON c.id = ci.caravan_id WHERE ci.user_id = ? AND ci.kind = 'request' ORDER BY ci.created_at DESC`, userId);
    return { caravan: null, invitations, requests };
  }
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
    caravan: { id: c.id, name: c.name, owner, ownerName: one('SELECT username FROM users WHERE id = ?', c.owner_id).username, members: agg.members, total: agg.total, week: wagg.week, active: wagg.active,
      next: MILESTONES.find((x) => x > agg.total) || MILESTONES.at(-1), prev: MILESTONES.filter((x) => x <= agg.total).at(-1) || 0 },
    streak: streakStatus(c.id),
    members: members.map((m) => ({ username: m.username, displayName: m.dn, avatar: avatarUrl(m.uid, m.av), city: m.city, total: m.total, week: m.week, today: !!m.today, owner: false, joinedAt: m.joined_at })),
  };
  for (const m of out.members) m.owner = m.username === out.caravan.ownerName;
  if (owner) out.pending = all(`SELECT u.id uid, u.avatar_v av, u.username, u.city, ci.kind, ci.created_at at FROM caravan_invites ci JOIN users u ON u.id = ci.user_id WHERE ci.caravan_id = ? AND ${LIVE} ORDER BY ci.created_at DESC LIMIT 100`, c.id).map(person);
  return out;
}
/** Small summary for the profile: which caravan, and how many invitations are waiting. */
hooks.profileExtra = (userId) => summary(userId);
export function summary(userId) {
  const c = caravanOf(userId);
  const invites = one("SELECT COUNT(*) n FROM caravan_invites WHERE user_id = ? AND kind = 'invite'", userId).n;
  const requests = c && c.owner_id === userId ? one("SELECT COUNT(*) n FROM caravan_invites WHERE caravan_id = ? AND kind = 'request'", c.id).n : 0;
  if (!c) return { caravan: null, caravanInvites: invites, caravanRequests: 0 };
  return { caravanInvites: invites, caravanRequests: requests, caravan: { id: c.id, name: c.name, owner: c.owner_id === userId, members: one(`SELECT COUNT(*) n FROM caravan_members cm JOIN users u ON u.id = cm.user_id WHERE cm.caravan_id = ? AND ${LIVE}`, c.id).n }, };
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
    const names = new Map(all('SELECT id, name FROM caravans').map((r) => [r.id, r.name]));
    return sums.filter((r) => (members.get(r.id) || 0) >= MIN_BOARD_MEMBERS && (metric === 'growth' ? r.score !== 0 : r.score > 0))
      .map((r) => ({ id: r.id, name: names.get(r.id), members: members.get(r.id), active: r.active, score: r.score }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 50);
  });
  return { rows: rows.map((r, i) => ({ rank: i + 1, ...r, me: r.id === mine })), weekStart: wk, metric, minMembers: MIN_BOARD_MEMBERS };
}

// ---- administration ---------------------------------------------------------------------------------------------------------------------
export const adminList = (q = '') => {
  const like = `%${String(q).trim().slice(0, 30).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return all(`SELECT c.id, c.name, u.username owner, c.created_at,
    (SELECT COUNT(*) FROM caravan_members cm WHERE cm.caravan_id = c.id) members,
    (SELECT GROUP_CONCAT(x.username, ', ') FROM (SELECT m.username FROM caravan_members cm JOIN users m ON m.id = cm.user_id WHERE cm.caravan_id = c.id ORDER BY cm.joined_at LIMIT 6) x) sample
    FROM caravans c JOIN users u ON u.id = c.owner_id WHERE c.name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' ORDER BY c.id DESC LIMIT 200`, like, like);
};
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
