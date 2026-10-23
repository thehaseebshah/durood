import { db, tx } from './db.js';
import { HttpError } from './auth.js';

// ---- tunables -------------------------------------------------------------
export const CFG = {
  maxSingle: 100_000,        // largest number accepted in one submission
  maxDaily: 500_000,         // anti-cheat ceiling per person per day
  referralXp: 500,           // paid to the referrer when the invitee logs their first durood
  circleXp: 1000,
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
  caravan10k: (s) => s.team_total >= 10_000,
  caravan100k: (s) => s.team_total >= 100_000,
  caravan1m: (s) => s.team_total >= 1_000_000,
  caravan10m: (s) => s.team_total >= 10_000_000,
};
export const BADGE_CODES = Object.keys(BADGES);

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

function stats(userId) {
  const u = one('SELECT total, best_streak, team_total FROM users WHERE id = ?', userId);
  const count = (kind) => one('SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = ?', userId, kind).n;
  return { ...u, referrals: count('referral'), lectures: count('lecture'), circle: count('circle') > 0 };
}

function evalBadges(userId, fresh) {
  const s = stats(userId);
  for (const [code, test] of Object.entries(BADGES)) {
    if (test(s) && run('INSERT OR IGNORE INTO badges (user_id, code, earned_at) VALUES (?,?,?)', userId, code, Date.now()).changes) {
      fresh.push({ userId, code });
    }
  }
}

function grant(userId, kind, ref, xp) {
  const r = run('INSERT OR IGNORE INTO events (user_id, kind, ref, day, xp, created_at) VALUES (?,?,?,?,?,?)', userId, kind, String(ref), dayOf(), xp, Date.now());
  if (r.changes) run('UPDATE users SET xp = xp + ? WHERE id = ?', xp, userId);
  return r.changes > 0;
}

// ---- quests ---------------------------------------------------------------
function questState(u) {
  const day = dayOf(), wk = weekStart();
  const today = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', u.id, day)?.count ?? 0;
  const lecturesToday = one("SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = 'lecture' AND day = ?", u.id, day).n;
  const daysWeek = one('SELECT COUNT(*) n FROM daily WHERE user_id = ? AND day >= ?', u.id, wk).n;
  const invitedWeek = one('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND created_day >= ?', u.id, wk).n;
  const done = (id, key) => !!one("SELECT 1 FROM events WHERE user_id = ? AND kind = 'quest' AND ref = ?", u.id, `${id}:${key}`);
  const q = (id, period, xp, cur, goal) => {
    const key = period === 'day' ? day : wk;
    return { id, period, xp, cur: Math.min(cur, goal), goal, done: done(id, key), key };
  };
  return [
    q('goal', 'day', 50, today, u.daily_goal),
    q('lecture', 'day', 100, lecturesToday, 1),
    q('days5', 'week', 200, daysWeek, 5),
    q('invite', 'week', 250, invitedWeek, 1),
  ];
}

function settleQuests(userId) {
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
    const r = one('SELECT COALESCE(SUM(total),0) total, COUNT(*) members FROM users');
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
    isPublic: !!u.is_public, dailyGoal: u.daily_goal,
    total: u.total, today, week,
    streak: streakAlive ? u.streak : 0, bestStreak: u.best_streak, shields: u.shields,
    ...levelFor(u.xp),
    badges: all('SELECT code FROM badges WHERE user_id = ? ORDER BY earned_at', userId).map((b) => b.code),
    quests: questState(u).map(({ key, ...q }) => q),
    team: { members: team.members, direct, total: u.team_total },
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
                WHERE u.is_public = 1 AND t.score > 0 AND EXISTS (SELECT 1 FROM users c WHERE c.referrer_id = u.id)
                ORDER BY t.score DESC LIMIT 50`, ...args);
  } else if (period === 'week') {
    rows = all(`SELECT u.username, u.city, SUM(d.count) score FROM daily d JOIN users u ON u.id = d.user_id
                WHERE d.day >= ? AND u.is_public = 1 GROUP BY u.id ORDER BY score DESC LIMIT 50`, wk);
  } else {
    rows = all('SELECT username, city, total score FROM users WHERE is_public = 1 AND total > 0 ORDER BY total DESC LIMIT 50');
  }
  return { rows: rows.map((r, i) => ({ rank: i + 1, ...r, me: r.username === me })), weekStart: wk };
}

export function teamView(userId) {
  const wk = weekStart();
  const direct = all(`SELECT u.username, u.is_public, u.total, u.team_total, u.created_day,
        COALESCE((SELECT SUM(count) FROM daily d WHERE d.user_id = u.id AND d.day >= ?), 0) week,
        (SELECT COUNT(*) FROM ancestors a WHERE a.ancestor_id = u.id AND a.depth > 0) members
      FROM users u WHERE u.referrer_id = ? ORDER BY u.team_total DESC LIMIT 200`, wk, userId);
  const week = one(`SELECT COALESCE(SUM(d.count),0) n FROM daily d JOIN ancestors a ON a.user_id = d.user_id
                    WHERE a.ancestor_id = ? AND d.day >= ? AND a.depth <= ?`, userId, wk, CFG.teamMaxDepth).n;
  const byDepth = all(`SELECT depth, COUNT(*) n FROM ancestors WHERE ancestor_id = ? AND depth > 0 GROUP BY depth ORDER BY depth LIMIT 20`, userId);
  const total = one('SELECT team_total FROM users WHERE id = ?', userId).team_total;
  return {
    total, week, byDepth,
    // opted-out members still count toward the caravan but their own numbers stay hidden
    direct: direct.map((d) => ({
      username: d.username, joined: d.created_day, members: d.members,
      total: d.is_public ? d.total : null, week: d.is_public ? d.week : null, team: d.team_total,
    })),
  };
}
