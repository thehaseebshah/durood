import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import { inviteStatus } from './access.js';

// ---- tunables -------------------------------------------------------------
export const CFG = {
  maxSingle: 100_000,        // largest number accepted in one submission
  maxDaily: 500_000,         // anti-cheat ceiling per person per day
  referralXp: 500,           // paid to the referrer when the invitee logs their first durood
  // Durood is the primary activity (1 XP per durood plus the milestone/quest bonuses below). Sunnah and seerah
  // rewards are deliberately small so they can never outweigh reciting.
  circleXp: 300,             // one-time, for registering with a Seerat Circle
  sunnahXp: 60,              // poster, once their photo is verified
  verifyXp: 5,               // each reviewer whose vote matches the final outcome
  confirmsNeeded: 3,         // distinct confirmations that verify a post (same number of rejects rejects it)
  maxVotesPerDay: 30,
  postWindowMs: 72 * 3600e3, // how long a post can collect reviews before it expires
  teamMaxDepth: Math.floor(Number(process.env.TEAM_MAX_DEPTH)) || 1000, // 1000 = effectively unlimited
  nationalTarget: Number(process.env.NATIONAL_TARGET || 100_000_000),
  circleUrl: process.env.CIRCLE_URL || '',
};

// ---- time: everything is bucketed by Pakistan time (UTC+5) -----------------
const PK = 5 * 3600e3;
export const dayOf = (ts = Date.now()) => new Date(ts + PK).toISOString().slice(0, 10);
const dayNum = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 86400e3);
const dayStr = (n) => new Date(n * 86400e3).toISOString().slice(0, 10);
export const weekStart = (d = dayOf()) => {
  const dow = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  return dayStr(dayNum(d) - dow);
};

// ---- levels ---------------------------------------------------------------
export function levelFor(xp) {
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const floor = 100 * (level - 1) ** 2;
  const next = 100 * level ** 2;
  return { level, xp, floor, next, pct: Math.round(((xp - floor) / (next - floor)) * 100) };
}

// ---- badges ---------------------------------------------------------------
const BADGES = {
  first_step: (s) => s.total >= 1,
  d1k: (s) => s.total >= 1_000,
  d10k: (s) => s.total >= 10_000,
  d100k: (s) => s.total >= 100_000,
  d1m: (s) => s.total >= 1_000_000,
  streak7: (s) => s.best_streak >= 7,
  streak30: (s) => s.best_streak >= 30,
  streak100: (s) => s.best_streak >= 100,
  recruit1: (s) => s.referrals >= 1,
  recruit5: (s) => s.referrals >= 5,
  recruit25: (s) => s.referrals >= 25,
  scholar1: (s) => s.lectures >= 1,
  scholar10: (s) => s.lectures >= 10,
  circle: (s) => s.circle,
  sunnah1: (s) => s.sunnahs >= 1,
  sunnah7: (s) => s.sunnahs >= 7,
  sunnah30: (s) => s.sunnahs >= 30,
  verifier10: (s) => s.verifies >= 10,
  verifier100: (s) => s.verifies >= 100,
  caravan10k: (s) => s.downline >= 10_000,
  caravan100k: (s) => s.downline >= 100_000,
  caravan1m: (s) => s.downline >= 1_000_000,
  caravan10m: (s) => s.downline >= 10_000_000,
};
// one-time XP paid when a durood-driven badge is first earned
const MILESTONE_XP = {
  d1k: 100, d10k: 500, d100k: 2_500, d1m: 10_000,
  streak7: 100, streak30: 500, streak100: 2_000,
  caravan10k: 500, caravan100k: 2_500, caravan1m: 10_000, caravan10m: 50_000,
};
export const BADGE_CODES = Object.keys(BADGES);

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

function stats(userId) {
  const u = one('SELECT total, best_streak, team_total FROM users WHERE id = ?', userId);
  const count = (kind) => one('SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = ?', userId, kind).n;
  // collective rewards count only what the people you invited recited, never your own durood a second time
  return { ...u, downline: u.team_total - u.total, referrals: count('referral'), lectures: count('lecture'), sunnahs: count('sunnah'), verifies: count('verify'), circle: count('circle') > 0 };
}

export function evalBadges(userId, fresh) {
  const s = stats(userId);
  for (const [code, test] of Object.entries(BADGES)) {
    if (test(s) && run('INSERT OR IGNORE INTO badges (user_id, code, earned_at) VALUES (?,?,?)', userId, code, Date.now()).changes) {
      fresh.push({ userId, code });
      if (MILESTONE_XP[code]) grant(userId, 'milestone', code, MILESTONE_XP[code]);
    }
  }
}

export function grant(userId, kind, ref, xp) {
  const r = run('INSERT OR IGNORE INTO events (user_id, kind, ref, day, xp, created_at) VALUES (?,?,?,?,?,?)', userId, kind, String(ref), dayOf(), xp, Date.now());
  if (r.changes) run('UPDATE users SET xp = xp + ? WHERE id = ?', xp, userId);
  return r.changes > 0;
}

// ---- quests ---------------------------------------------------------------
function questState(u) {
  const day = dayOf(), wk = weekStart();
  const today = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', u.id, day)?.count ?? 0;
  const weekSum = one('SELECT COALESCE(SUM(count), 0) n FROM daily WHERE user_id = ? AND day >= ?', u.id, wk).n;
  const lecturesToday = one("SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = 'lecture' AND day = ?", u.id, day).n;
  const daysWeek = one('SELECT COUNT(*) n FROM daily WHERE user_id = ? AND day >= ?', u.id, wk).n;
  const invitedWeek = one('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND created_day >= ?', u.id, wk).n;
  const postedToday = one("SELECT COUNT(*) n FROM posts WHERE user_id = ? AND created_day = ? AND status != 'removed'", u.id, day).n;
  const reviewsToday = one('SELECT COUNT(*) n FROM votes WHERE user_id = ? AND day = ?', u.id, day).n;
  const done = (id, key) => !!one("SELECT 1 FROM events WHERE user_id = ? AND kind = 'quest' AND ref = ?", u.id, `${id}:${key}`);
  const q = (id, group, period, xp, cur, goal) => {
    const key = period === 'day' ? day : wk;
    return { id, group, period, xp, cur: Math.min(cur, goal), goal, done: done(id, key), key };
  };
  return [
    // durood quests first and richest; sunnah / seerah quests are small bonuses
    q('goal', 'durood', 'day', 100, today, u.daily_goal),
    q('weekgoal', 'durood', 'week', 300, weekSum, u.daily_goal * 7),
    q('days5', 'durood', 'week', 200, daysWeek, 5),
    q('invite', 'durood', 'week', 250, invitedWeek, 1),
    q('sunnah', 'bonus', 'day', 30, postedToday, 1),
    q('review', 'bonus', 'day', 15, reviewsToday, 3),
    q('lecture', 'bonus', 'day', 30, lecturesToday, 1),
  ];
}

export function settleQuests(userId) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  for (const q of questState(u)) {
    if (!q.done && q.cur >= q.goal) grant(userId, 'quest', `${q.id}:${q.key}`, q.xp);
  }
}

// ---- actions --------------------------------------------------------------
export function logDurood(userId, count, rid) {
  if (!Number.isInteger(count) || count < 1 || count > CFG.maxSingle) throw new HttpError(400, 'bad_count');
  if (typeof rid !== 'string' || !/^[\w-]{8,64}$/.test(rid)) throw new HttpError(400, 'bad_request_id');
  const day = dayOf();
  const fresh = [];
  const before = one('SELECT xp FROM users WHERE id = ?', userId).xp;
  let duplicate = false;

  tx(() => {
    // a retried or double-tapped submission carries the same rid and must never count twice
    if (one('SELECT 1 FROM entries WHERE user_id = ? AND rid = ?', userId, rid)) { duplicate = true; return; }
    const u = one('SELECT * FROM users WHERE id = ?', userId);
    const prev = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', userId, day)?.count ?? 0;
    if (prev + count > CFG.maxDaily) throw new HttpError(400, 'daily_cap');

    run('INSERT INTO entries (user_id, day, count, rid, created_at) VALUES (?,?,?,?,?)', userId, day, count, rid, Date.now());
    run(`INSERT INTO daily (user_id, day, count) VALUES (?,?,?)
         ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count`, userId, day, count);

    // streak: first log of a new day continues, shield-bridges a single missed day, or restarts
    let { streak, shields } = u;
    if (u.last_day !== day) {
      const gap = u.last_day ? dayNum(day) - dayNum(u.last_day) : null;
      if (gap === 1) streak += 1;
      else if (gap === 2 && shields > 0) { shields -= 1; streak += 1; }
      else streak = 1;
      if (streak % 7 === 0) shields = Math.min(shields + 1, 3);
    }
    run(`UPDATE users SET total = total + ?, xp = xp + ?, streak = ?, best_streak = MAX(best_streak, ?),
         shields = ?, last_day = ? WHERE id = ?`, count, count, streak, streak, shields, day, userId);

    run('UPDATE users SET team_total = team_total + ? WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ? AND depth <= ?)', count, userId, CFG.teamMaxDepth);
    evaluateFlags(userId, day);

    // referrer is paid only once the invitee actually recites - blocks fake sign-ups
    if (u.total === 0 && u.referrer_id && grant(u.referrer_id, 'referral', userId, CFG.referralXp)) {
      settleQuests(u.referrer_id);
      evalBadges(u.referrer_id, fresh);
    }

    settleQuests(userId);
    evalBadges(userId, fresh);
    for (const a of all('SELECT ancestor_id id FROM ancestors WHERE user_id = ? AND depth > 0', userId)) evalBadges(a.id, fresh);
  });

  const after = one('SELECT xp FROM users WHERE id = ?', userId).xp;
  return {
    duplicate,
    added: duplicate ? 0 : count,
    xpGained: after - before,
    levelUp: levelFor(after).level > levelFor(before).level ? levelFor(after).level : null,
    newBadges: fresh.filter((b) => b.userId === userId).map((b) => b.code),
  };
}

// ---- flags: implausible totals ----------------------------------------------------------------------------
export const FLAG = {
  daily: 20_000,        // more than this in one day is flagged
  spikeMult: 10,        // or more than 10x the member's average day over the previous 7 days
  spikeMin: 2_000,      // ...but only once the day is at least this big, so 15 -> 200 never trips it
  newMemberDays: 7,     // a member's first 7 days are flagged by the daily line only
};

/** Raises a flag (and hides the member from public ranks) when a day's total looks implausible. Call inside the transaction. */
export function evaluateFlags(userId, day) {
  const dayTotal = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', userId, day)?.count ?? 0;
  const u = one('SELECT created_day FROM users WHERE id = ?', userId);
  let reason = null, detail = '';
  if (dayTotal > FLAG.daily) {
    reason = 'daily_20k'; detail = `${dayTotal} in one day`;
  } else if (dayNum(day) - dayNum(u.created_day) >= FLAG.newMemberDays && dayTotal >= FLAG.spikeMin) {
    const prior = one('SELECT COALESCE(SUM(count), 0) n FROM daily WHERE user_id = ? AND day < ? AND day >= ?', userId, day, dayStr(dayNum(day) - 7)).n;
    const avg = prior / 7;
    if (avg > 0 && dayTotal > FLAG.spikeMult * avg) { reason = 'spike_10x'; detail = `${dayTotal} against a recent average of ${Math.round(avg)} a day`; }
  }
  if (!reason || one('SELECT 1 FROM flags WHERE user_id = ? AND reason = ? AND day = ?', userId, reason, day)) return null;
  run('INSERT INTO flags (user_id, reason, day, detail, created_at) VALUES (?,?,?,?,?)', userId, reason, day, detail, Date.now());
  run('UPDATE users SET hidden_from_ranks = 1 WHERE id = ?', userId);
  return reason;
}

function refreshHidden(userId) {
  const hidden = !!one("SELECT 1 FROM flags WHERE user_id = ? AND status IN ('open','confirmed')", userId);
  run('UPDATE users SET hidden_from_ranks = ? WHERE id = ?', hidden ? 1 : 0, userId);
}

export const listFlags = (status = 'open') => all(`SELECT f.*, u.username, u.city, u.total, u.created_day FROM flags f JOIN users u ON u.id = f.user_id
    WHERE f.status = ? ORDER BY f.created_at DESC LIMIT 200`, status)
  .map((f) => ({ id: f.id, username: f.username, city: f.city, total: f.total, joined: f.created_day, reason: f.reason, day: f.day, detail: f.detail, status: f.status, createdAt: f.created_at }));

/** clear: the numbers are fine, show them again. confirm: keep them hidden until an admin unhides the member. */
export function resolveFlag(id, action) {
  const f = one('SELECT * FROM flags WHERE id = ?', id);
  if (!f) throw new HttpError(404, 'not_found');
  if (action !== 'clear' && action !== 'confirm') throw new HttpError(400, 'bad_action');
  tx(() => {
    run('UPDATE flags SET status = ?, resolved_at = ? WHERE id = ?', action === 'clear' ? 'cleared' : 'confirmed', Date.now(), id);
    refreshHidden(f.user_id);
  });
  return { ok: true };
}

export function setHidden(username, hidden) {
  const u = one('SELECT id FROM users WHERE username = ?', username);
  if (!u) throw new HttpError(404, 'not_found');
  tx(() => {
    if (hidden) {
      run("INSERT INTO flags (user_id, reason, day, detail, status, created_at) VALUES (?, 'manual', ?, 'hidden by an admin', 'confirmed', ?)", u.id, dayOf(), Date.now());
    } else {
      run("UPDATE flags SET status = 'cleared', resolved_at = ? WHERE user_id = ? AND status IN ('open','confirmed')", Date.now(), u.id);
    }
    refreshHidden(u.id);
  });
  return { ok: true };
}

// ---- edits and history -------------------------------------------------------------------------------------
/**
 * Changes one of the member's own entries from today or yesterday. Nothing is overwritten: the ledger gets a reversing
 * entry for the old number and a replacement entry for the new one, so the whole history stays on record.
 * Badges, quest XP and invite rewards already earned are not taken back. A day can't be edited down to nothing.
 */
export function editEntry(userId, entryId, newCount, ridIn) {
  if (!Number.isInteger(newCount) || newCount < 1 || newCount > CFG.maxSingle) throw new HttpError(400, 'bad_count');
  const base = ridIn ?? `edit-${entryId}-${Date.now()}`;
  if (!/^[\w-]{6,50}$/.test(base)) throw new HttpError(400, 'bad_request_id');
  let duplicate = false;

  tx(() => {
    if (one('SELECT 1 FROM entries WHERE user_id = ? AND rid = ?', userId, `${base}:r`)) { duplicate = true; return; }
    const e = one('SELECT * FROM entries WHERE id = ? AND user_id = ?', entryId, userId);
    if (!e || e.kind === 'reverse') throw new HttpError(404, 'not_found');
    if (one("SELECT 1 FROM entries WHERE ref_id = ? AND kind = 'reverse'", e.id)) throw new HttpError(409, 'entry_superseded');
    const today = dayOf(), yesterday = dayStr(dayNum(today) - 1);
    if (e.day !== today && e.day !== yesterday) throw new HttpError(403, 'edit_window');
    const delta = newCount - e.count;
    if (delta === 0) throw new HttpError(400, 'no_change');
    const dayTotal = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', userId, e.day).count;
    if (delta > 0 && dayTotal + delta > CFG.maxDaily) throw new HttpError(400, 'daily_cap');

    const now = Date.now();
    run("INSERT INTO entries (user_id, day, count, rid, created_at, kind, ref_id) VALUES (?,?,?,?,?, 'reverse', ?)", userId, e.day, -e.count, `${base}:r`, now, e.id);
    run("INSERT INTO entries (user_id, day, count, rid, created_at, kind, ref_id) VALUES (?,?,?,?,?, 'replace', ?)", userId, e.day, newCount, `${base}:n`, now, e.id);
    run('UPDATE daily SET count = count + ? WHERE user_id = ? AND day = ?', delta, userId, e.day);
    run('UPDATE users SET total = total + ?, xp = xp + ? WHERE id = ?', delta, delta, userId);
    run('UPDATE users SET team_total = team_total + ? WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ? AND depth <= ?)', delta, userId, CFG.teamMaxDepth);
    evaluateFlags(userId, e.day);
  });
  return { duplicate };
}

/** The last 7 days of the member's entries, newest first, with every edit shown. Today and yesterday are editable. */
export function history(userId) {
  const today = dayOf(), yesterday = dayStr(dayNum(today) - 1), from = dayStr(dayNum(today) - 6);
  const rows = all('SELECT * FROM entries WHERE user_id = ? AND day >= ? ORDER BY id', userId, from);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const reversed = new Set(rows.filter((r) => r.kind === 'reverse').map((r) => r.ref_id));
  const days = new Map();
  for (const r of rows) {
    if (r.kind === 'reverse' || reversed.has(r.id)) continue; // only the entry that currently stands
    const edits = [];
    let e = r;
    while (e.kind === 'replace' && byId.has(e.ref_id)) {
      const prev = byId.get(e.ref_id);
      edits.unshift({ at: e.created_at, from: prev.count, to: e.count });
      e = prev;
    }
    const day = days.get(r.day) ?? { day: r.day, total: 0, editable: r.day === today || r.day === yesterday, entries: [] };
    day.entries.push({ id: r.id, count: r.count, at: r.created_at, original: e.count, edits });
    day.total += r.count;
    days.set(r.day, day);
  }
  return { today, yesterday, days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)) };
}

/** Anonymises an account. The durood stays in every total; the person's name, phone and email are erased. */
export function anonymiseUser(userId, passHash) {
  tx(() => {
    run(`UPDATE users SET username = ?, email = ?, phone = ?, pass = ?, city = '', deleted_at = ?, hidden_from_ranks = 1, suspended = 0
         WHERE id = ?`, `member_${userId}`, `deleted-${userId}@deleted.invalid`, `deleted-${userId}`, passHash, Date.now(), userId);
    run('DELETE FROM tokens WHERE user_id = ?', userId);
  });
}

export function startLecture(userId, lectureId) {
  const l = one('SELECT * FROM lectures WHERE id = ?', lectureId);
  if (!l) throw new HttpError(404, 'not_found');
  run('INSERT OR IGNORE INTO lecture_starts (user_id, lecture_id, started_at) VALUES (?,?,?)', userId, lectureId, Date.now());
  return { minSeconds: l.min_seconds };
}

export function completeLecture(userId, lectureId) {
  const l = one('SELECT * FROM lectures WHERE id = ?', lectureId);
  const s = one('SELECT started_at FROM lecture_starts WHERE user_id = ? AND lecture_id = ?', userId, lectureId);
  if (!l || !s) throw new HttpError(404, 'not_found');
  if (Date.now() - s.started_at < l.min_seconds * 1000) throw new HttpError(400, 'too_soon');
  const fresh = [];
  const ok = tx(() => {
    const g = grant(userId, 'lecture', lectureId, l.xp);
    if (g) { settleQuests(userId); evalBadges(userId, fresh); }
    return g;
  });
  return { xpGained: ok ? l.xp : 0, already: !ok, newBadges: fresh.map((b) => b.code) };
}

export function claimCircle(userId) {
  const fresh = [];
  const ok = tx(() => {
    const g = grant(userId, 'circle', 'join', CFG.circleXp);
    if (g) evalBadges(userId, fresh);
    return g;
  });
  return { xpGained: ok ? CFG.circleXp : 0, already: !ok, newBadges: fresh.map((b) => b.code) };
}

// ---- reads ----------------------------------------------------------------
// exact (summed from users.total, which `audit` proves equals the ledger); cached briefly and stamped with asOf
let natCache = { at: 0, v: null };
export function publicStats() {
  if (Date.now() - natCache.at > Number(process.env.PUBLIC_CACHE_MS ?? 15_000)) {
    const r = one('SELECT COALESCE(SUM(total),0) total, SUM(deleted_at IS NULL) members FROM users');
    natCache = { at: Date.now(), v: { total: r.total, members: r.members, asOf: Date.now() } };
  }
  return { ...natCache.v, target: CFG.nationalTarget, circleUrl: CFG.circleUrl };
}

export function getMe(userId) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  const day = dayOf(), wk = weekStart();
  const today = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', userId, day)?.count ?? 0;
  const week = one('SELECT COALESCE(SUM(count),0) n FROM daily WHERE user_id = ? AND day >= ?', userId, wk).n;
  const team = one(`SELECT COUNT(*) members FROM ancestors WHERE ancestor_id = ? AND depth > 0 AND depth <= ?`, userId, CFG.teamMaxDepth);
  const direct = one('SELECT COUNT(*) n FROM users WHERE referrer_id = ?', userId).n;
  const streakAlive = u.last_day === day || (u.last_day && dayNum(day) - dayNum(u.last_day) === 1);
  return {
    id: u.id, username: u.username, email: u.email, phone: u.phone, lang: u.lang, city: u.city,
    dailyGoal: u.daily_goal, hiddenFromRanks: !!u.hidden_from_ranks, emailVerified: !!u.email_verified_at,
    invites: inviteStatus(userId),
    total: u.total, today, week,
    streak: streakAlive ? u.streak : 0, bestStreak: u.best_streak, shields: u.shields,
    ...levelFor(u.xp),
    badges: all('SELECT code FROM badges WHERE user_id = ? ORDER BY earned_at', userId).map((b) => b.code),
    quests: questState(u).map(({ key, ...q }) => q),
    team: { members: team.members, direct, total: u.team_total },
    sunnah: {
      verified: one("SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = 'sunnah'", userId).n,
      reviews: one('SELECT COUNT(*) n FROM votes WHERE user_id = ?', userId).n,
    },
    pub: publicStats(),
  };
}

export function leaderboard(userId, type, period) {
  const wk = weekStart();
  const me = one('SELECT username FROM users WHERE id = ?', userId).username;
  let rows;
  if (type === 'teams') {
    const base = period === 'week'
      ? `SELECT a.ancestor_id id, SUM(d.count) score FROM daily d JOIN ancestors a ON a.user_id = d.user_id
         WHERE d.day >= ? AND a.depth <= ? GROUP BY a.ancestor_id`
      : 'SELECT id, team_total score FROM users';
    const args = period === 'week' ? [wk, CFG.teamMaxDepth] : [];
    rows = all(`SELECT u.username, u.city, t.score,
                  (SELECT COUNT(*) FROM ancestors x WHERE x.ancestor_id = u.id AND x.depth > 0 AND x.depth <= ${CFG.teamMaxDepth}) members
                FROM (${base}) t JOIN users u ON u.id = t.id
                WHERE u.hidden_from_ranks = 0 AND u.suspended = 0 AND u.deleted_at IS NULL AND t.score > 0 AND EXISTS (SELECT 1 FROM users c WHERE c.referrer_id = u.id)
                ORDER BY t.score DESC LIMIT 50`, ...args);
  } else if (period === 'week') {
    rows = all(`SELECT u.username, u.city, SUM(d.count) score FROM daily d JOIN users u ON u.id = d.user_id
                WHERE d.day >= ? AND u.hidden_from_ranks = 0 AND u.suspended = 0 AND u.deleted_at IS NULL GROUP BY u.id ORDER BY score DESC LIMIT 50`, wk);
  } else {
    rows = all('SELECT username, city, total score FROM users u WHERE u.hidden_from_ranks = 0 AND u.suspended = 0 AND u.deleted_at IS NULL AND total > 0 ORDER BY total DESC LIMIT 50');
  }
  return { rows: rows.map((r, i) => ({ rank: i + 1, ...r, me: r.username === me })), weekStart: wk };
}

export function teamView(userId) {
  const wk = weekStart();
  const direct = all(`SELECT u.username, u.city, u.total, u.team_total, u.created_day,
        COALESCE((SELECT SUM(count) FROM daily d WHERE d.user_id = u.id AND d.day >= ?), 0) week,
        (SELECT COUNT(*) FROM ancestors a WHERE a.ancestor_id = u.id AND a.depth > 0) members
      FROM users u WHERE u.referrer_id = ? ORDER BY u.team_total DESC LIMIT 200`, wk, userId);
  const week = one(`SELECT COALESCE(SUM(d.count),0) n FROM daily d JOIN ancestors a ON a.user_id = d.user_id
                    WHERE a.ancestor_id = ? AND d.day >= ? AND a.depth <= ?`, userId, wk, CFG.teamMaxDepth).n;
  const byDepth = all(`SELECT depth, COUNT(*) n FROM ancestors WHERE ancestor_id = ? AND depth > 0 GROUP BY depth ORDER BY depth LIMIT 20`, userId);
  const total = one('SELECT team_total FROM users WHERE id = ?', userId).team_total;
  return {
    total, week, byDepth,
    // there is no opt-out: inviters see their invitees' name, city and counts
    direct: direct.map((d) => ({
      username: d.username, city: d.city, joined: d.created_day, members: d.members,
      total: d.total, week: d.week, team: d.team_total,
    })),
  };
}
