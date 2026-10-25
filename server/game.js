import { db, tx, getSetting, setSetting } from './db.js';
import { HttpError, avatarUrl } from './auth.js';
import { inviteStatus } from './access.js';

export const LINK_DAYS = 14; // a member who joined without a member's code can name who invited them within this many days

// ---- tunables -------------------------------------------------------------
export const CFG = {
  maxDaily: Number(process.env.MAX_DAILY) || 50_000,          // ceiling per person per day (about 8 hours at 100 a minute)
  maxDailyNew: Number(process.env.MAX_DAILY_NEW) || 10_000,   // ceiling during a member's first 7 days
  newMemberDays: 7,
  referralXp: 500,           // paid to the referrer when the invitee has recited this many in all (referralMin)...
  referralMin: 100,          // ...so a sign-up that logs one durood earns the inviter nothing
  // Durood is the primary activity (1 XP per durood plus the milestone/quest bonuses below). Sunnah and seerah
  // rewards are deliberately small so they can never outweigh reciting.
  specialXp: 150,            // the bonus quest on a special day (every Friday, and days the admin marks)
  cityMinActive: 5,          // a city appears on the city boards only with this many members who recited this week
  circleXp: 300,             // one-time, for registering with a Seerat Circle (self-declared)
  circleTeachXp: 1_000,      // one-time, for teaching a Seerat Circle, once an organiser confirms it
  sunnahTickXp: 20,          // "I did today's sunnah"
  sunnahXp: 40,              // added when the photo is verified, so a verified day is worth 3x the tick (60)
  replyXp: 2,                // for a short reply, never on your own post...
  replyDailyCap: 5,          // ...and for at most this many replies a day
  questMinDurood: 100,       // a durood quest needs at least this many a day, whatever personal goal a member sets (a goal of 1 must not pay)
  lectureXp: 150,            // default for a weekly lecture (admin can set up to lectureXpMax)
  lectureXpMax: 200,
  lectureQuestXp: 50,        // the daily "watch a lecture" quest, on top of the lecture itself
  commentXp: 20,             // for a lecture comment (once per lecture)
  likeXp: 2,                 // the poster earns this for each like on a photo or reflection...
  likeCap: 10,               // ...for the first 10 likes on each (liking itself earns nothing)
  reflectXp: 15,             // the daily written reflection (a quest)
  teamMaxDepth: Math.floor(Number(process.env.TEAM_MAX_DEPTH)) || 1000, // 1000 = effectively unlimited
  nationalTarget: Number(process.env.NATIONAL_TARGET || 100_000_000),
  circleUrl: process.env.CIRCLE_URL || '',
};

CFG.maxSingle = CFG.maxDaily; // one submission can never exceed the daily ceiling

// ---- time: everything is bucketed by Pakistan time (UTC+5) -----------------
const PK = 5 * 3600e3;
/** The Seerat Circle sign-up link: set by an organiser on the admin page, or CIRCLE_URL. Empty hides the card. */
export const circleUrl = () => getSetting('circle_url', '') || CFG.circleUrl;
export function setCircleUrl(url) {
  const u = String(url ?? '').trim();
  if (u && !/^https:\/\/[^\s]{4,300}$/.test(u)) throw new HttpError(400, 'bad_url');
  setSetting('circle_url', u);
  return { circleUrl: circleUrl() };
}
export const dayOf = (ts = Date.now()) => new Date(ts + PK).toISOString().slice(0, 10);
export const dayNum = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 86400e3);
export const dayStr = (n) => new Date(n * 86400e3).toISOString().slice(0, 10);
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
  circle_teacher: (s) => s.teacher,
  sunnah1: (s) => s.sunnahs >= 1,
  sunnah7: (s) => s.sunnahs >= 7,
  sunnah30: (s) => s.sunnahs >= 30,
  karwan7: (s) => s.karwanStreak >= 7,
  karwan30: (s) => s.karwanStreak >= 30,
  qabila10: (s) => s.treeActive >= 10,
  qabila50: (s) => s.treeActive >= 50,
  qabila250: (s) => s.treeActive >= 250,
  league_silver: (s) => s.league >= 1,
  league_gold: (s) => s.league >= 2,
  league_diamond: (s) => s.league >= 3,
  city_podium: (s) => s.cityPodiums >= 1,
  city_champion: (s) => s.cityWins >= 1,
  group10k: (s) => s.caravanTotal >= 10_000 && s.total >= CFG.referralMin,        // the named caravan's total, for members who recite themselves
  group100k: (s) => s.caravanTotal >= 100_000 && s.total >= CFG.referralMin,
  group1m: (s) => s.caravanTotal >= 1_000_000 && s.total >= CFG.referralMin,
  caravan10k: (s) => s.downline >= 10_000,
  caravan100k: (s) => s.downline >= 100_000,
  caravan1m: (s) => s.downline >= 1_000_000,
  caravan10m: (s) => s.downline >= 10_000_000,
};
// one-time XP paid when a durood-driven badge is first earned
const MILESTONE_XP = {
  d1k: 100, d10k: 500, d100k: 2_500, d1m: 10_000,
  streak7: 100, streak30: 500, streak100: 2_000,
  group10k: 300, group100k: 1_500, group1m: 6_000,
  karwan7: 150, karwan30: 600, qabila10: 200, qabila50: 800, qabila250: 3_000,
  league_silver: 150, league_gold: 300, league_diamond: 600, city_podium: 200, city_champion: 500,
  caravan10k: 500, caravan100k: 2_500, caravan1m: 10_000, caravan10m: 50_000, // the whole referral tree (internally: qabila)
};
export const BADGE_CODES = Object.keys(BADGES);
// badges announced to a member's caravan in the feed (the personal and group milestones, not the small ones)
const FEED_BADGES = new Set(['d1k', 'd10k', 'd100k', 'd1m', 'streak7', 'streak30', 'streak100', 'recruit1', 'recruit5', 'recruit25', 'group10k', 'group100k', 'group1m', 'karwan7', 'karwan30', 'qabila10', 'qabila50', 'qabila250', 'league_silver', 'league_gold', 'league_diamond', 'city_podium', 'city_champion', 'caravan10k', 'caravan100k', 'caravan1m', 'caravan10m']);

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

function stats(userId) {
  const u = one('SELECT total, best_streak, team_total, league, tree_active FROM users WHERE id = ?', userId);
  const count = (kind) => one('SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = ?', userId, kind).n;
  // caravanTotal = everyone in the member's named caravan; downline = the whole referral tree (Qabila). Durood on hold is left out of both.
  const caravanTotal = one(`SELECT COALESCE(SUM(u.total), 0) n FROM caravan_members me JOIN caravan_members cm ON cm.caravan_id = me.caravan_id JOIN users u ON u.id = cm.user_id
                           WHERE me.user_id = ? AND u.held = 0 AND u.deleted_at IS NULL AND u.suspended = 0`, userId).n;
  return { ...u, treeActive: u.tree_active, caravanTotal, downline: u.team_total - u.total, referrals: count('referral'), lectures: count('lecture'), sunnahs: count('sunnah'), circle: count('circle') > 0, teacher: count('circle_teach') > 0 };
}

const bumpDay = (day, delta) => run('INSERT INTO day_totals (day, total) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET total = total + excluded.total', day, delta);
/** Rebuilds the per-day public totals from the daily rows (first start after an upgrade, and the audit's repair). */
export function rebuildDayTotals() {
  run('DELETE FROM day_totals');
  run('INSERT INTO day_totals (day, total) SELECT d.day, SUM(d.count) FROM daily d JOIN users u ON u.id = d.user_id AND u.held = 0 GROUP BY d.day');
}

/** Side effects that must not run inside a write transaction (push messages) hook in here. */
export const hooks = { milestone: null, badge: null, inTx: null, profileExtra: null, majlis: null };
/** Functions that run first when an account is deleted (leave the caravan, remove the profile picture...). */
export const deleteHooks = [];

/** Gives a badge once, with its one-time points, a feed line for the member's caravan and (for group badges) a push. Returns true when it was new. */
export function award(userId, code, fresh = []) {
  if (!run('INSERT OR IGNORE INTO badges (user_id, code, earned_at) VALUES (?,?,?)', userId, code, Date.now()).changes) return false;
  fresh.push({ userId, code });
  if (MILESTONE_XP[code]) grant(userId, 'milestone', code, MILESTONE_XP[code]);
  if (code.startsWith('caravan') || code.startsWith('group')) hooks.badge?.(userId, code);
  if (FEED_BADGES.has(code)) run('INSERT OR IGNORE INTO feed_events (user_id, kind, ref, created_at) VALUES (?,?,?,?)', userId, 'badge', code, Date.now());
  return true;
}

// badges that rest on a durood total, which an edit can lower: logging a big number and editing it down must not keep them
const DUROOD_BADGES = ['recruit1', 'recruit5', 'recruit25', 'd1k', 'd10k', 'd100k', 'd1m', 'group10k', 'group100k', 'group1m', 'caravan10k', 'caravan100k', 'caravan1m', 'caravan10m'];
function revokeDuroodBadges(userId) {
  const held = all(`SELECT code FROM badges WHERE user_id = ? AND code IN (${DUROOD_BADGES.map(() => '?').join(',')})`, userId, ...DUROOD_BADGES);
  if (!held.length) return;
  const s = stats(userId);
  for (const { code } of held) {
    if (BADGES[code](s)) continue;
    run('DELETE FROM badges WHERE user_id = ? AND code = ?', userId, code);
    run("DELETE FROM feed_events WHERE user_id = ? AND kind = 'badge' AND ref = ?", userId, code);
    const ev = one("SELECT xp FROM events WHERE user_id = ? AND kind = 'milestone' AND ref = ?", userId, code);
    if (ev) { run("DELETE FROM events WHERE user_id = ? AND kind = 'milestone' AND ref = ?", userId, code); run('UPDATE users SET xp = xp - ? WHERE id = ?', ev.xp, userId); }
  }
}

/** `extra` carries numbers that are expensive to work out for everyone (the caravan streak, city podiums). */
export function evalBadges(userId, fresh, extra = {}) {
  const s = { ...stats(userId), ...extra };
  for (const [code, test] of Object.entries(BADGES)) if (test(s)) award(userId, code, fresh);
}

export function grant(userId, kind, ref, xp) {
  const r = run('INSERT OR IGNORE INTO events (user_id, kind, ref, day, xp, created_at) VALUES (?,?,?,?,?,?)', userId, kind, String(ref), dayOf(), xp, Date.now());
  if (r.changes) run('UPDATE users SET xp = xp + ? WHERE id = ?', xp, userId);
  return r.changes > 0;
}

// ---- "Who invited you?": a member who joined through the public or a founder code links up to the person who brought them --------
/** Whether the member may still name their inviter: no inviter yet, joined in the last LINK_DAYS, and nobody below them yet. */
export function canLinkInviter(u) {
  return !u.referrer_id && Date.now() - u.created_at < LINK_DAYS * 864e5 && !one('SELECT 1 FROM users WHERE referrer_id = ?', u.id);
}
/** Puts the member under their inviter: the tree, team totals and the referral reward all follow as if they had used that code. */
export function linkInviter(userId, rawName) {
  return tx(() => {
    const u = one('SELECT * FROM users WHERE id = ?', userId);
    if (!canLinkInviter(u)) throw new HttpError(409, 'link_closed');
    const r = one('SELECT id, username, suspended, deleted_at FROM users WHERE username = ?', String(rawName ?? '').trim().replace(/^@/, ''));
    if (!r || r.suspended || r.deleted_at || r.id === u.id) throw new HttpError(404, 'inviter_unknown');
    if (inviteStatus(r.id).left <= 0) throw new HttpError(409, 'invite_full');
    run('UPDATE users SET referrer_id = ? WHERE id = ?', r.id, u.id);
    // nobody is below the member yet (canLinkInviter), so only their own ancestry changes
    run('INSERT INTO ancestors (user_id, ancestor_id, depth) SELECT ?, ancestor_id, depth + 1 FROM ancestors WHERE user_id = ?', u.id, r.id);
    if (!u.held && u.total) run('UPDATE users SET team_total = team_total + ? WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ? AND depth > 0 AND depth <= ?)', u.total, u.id, CFG.teamMaxDepth);
    if (u.total > 0) run('UPDATE users SET tree_active = tree_active + 1 WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ? AND depth > 0)', u.id);
    const fresh = [];
    if (u.total >= CFG.referralMin && grant(r.id, 'referral', String(u.id), CFG.referralXp)) settleQuests(r.id);
    for (const a of all('SELECT ancestor_id id FROM ancestors WHERE user_id = ? AND depth > 0', u.id)) evalBadges(a.id, fresh);
    return { ok: true, inviter: r.username, inviterId: r.id };
  });
}

// ---- special days: Fridays automatically, other days (Ramadan, Rabi ul Awwal...) added by the admin ----------------------------
export function specialToday(day = dayOf()) {
  const row = one('SELECT * FROM special_days WHERE day = ?', day);
  if (row) return { day, nameEn: row.name_en, nameUr: row.name_ur };
  if (new Date(`${day}T00:00:00Z`).getUTCDay() === 5) return { day, nameEn: 'Jumu‘ah', nameUr: 'جمعہ' };
  return null;
}
export function setSpecialDay({ day, name_en, name_ur }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !String(name_en || '').trim()) throw new HttpError(400, 'bad_special');
  run(`INSERT INTO special_days (day, name_en, name_ur) VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET name_en = excluded.name_en, name_ur = excluded.name_ur`,
    day, String(name_en).trim().slice(0, 60), String(name_ur || '').trim().slice(0, 60));
  return { ok: true };
}
export const deleteSpecialDay = (day) => { run('DELETE FROM special_days WHERE day = ?', String(day)); return { ok: true }; };
export const listSpecialDays = () => all('SELECT * FROM special_days ORDER BY day DESC LIMIT 60');

// ---- quests ---------------------------------------------------------------
function questState(u) {
  const day = dayOf(), wk = weekStart();
  const today = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', u.id, day)?.count ?? 0;
  const weekSum = one('SELECT COALESCE(SUM(count), 0) n FROM daily WHERE user_id = ? AND day >= ?', u.id, wk).n;
  const lecturesToday = one("SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = 'lecture' AND day = ?", u.id, day).n;
  const daysWeek = one('SELECT COUNT(*) n FROM daily WHERE user_id = ? AND day >= ? AND count >= ?', u.id, wk, CFG.questMinDurood).n;
  const goal = Math.max(u.daily_goal, CFG.questMinDurood);
  const invitedWeek = one('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND created_day >= ? AND total >= ?', u.id, wk, CFG.referralMin).n; // an invitee counts once they have really recited
  const tickedToday = one("SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = 'sunnah_tick' AND day = ?", u.id, day).n;
  const reflectedToday = one('SELECT COUNT(*) n FROM reflections WHERE user_id = ? AND day = ?', u.id, day).n;
  const done = (id, key) => !!one("SELECT 1 FROM events WHERE user_id = ? AND kind = 'quest' AND ref = ?", u.id, `${id}:${key}`);
  // an "info" quest is a view of something paid elsewhere (the tick), so it never pays a second time
  const q = (id, group, period, xp, cur, goal, info = false) => {
    const key = period === 'day' ? day : wk;
    return { id, group, period, xp, cur: Math.min(cur, goal), goal, done: info ? cur >= goal : done(id, key), key, info };
  };
  return [
    // durood quests first and richest; sunnah / seerah quests are small bonuses
    q('goal', 'durood', 'day', 100, today, goal),
    q('weekgoal', 'durood', 'week', 300, weekSum, goal * 7),
    q('days5', 'durood', 'week', 200, daysWeek, 5),
    q('invite', 'durood', 'week', 250, invitedWeek, 1),
    ...(specialToday(day) ? [q('special', 'durood', 'day', CFG.specialXp, today, goal)] : []),
    q('sunnah', 'bonus', 'day', CFG.sunnahTickXp, tickedToday, 1, true),
    q('reflect', 'bonus', 'day', CFG.reflectXp, reflectedToday, 1),
    q('lecture', 'bonus', 'day', CFG.lectureQuestXp, lecturesToday, 1),
  ];
}

/**
 * After a number is edited down, quest rewards whose condition no longer holds are taken back (the day's goal and special quests for that
 * day, the weekly ones for its week), so logging a big number and editing it down cannot keep the payout.
 */
function revokeQuests(userId, day) {
  const u = one('SELECT daily_goal FROM users WHERE id = ?', userId);
  const goal = Math.max(u.daily_goal, CFG.questMinDurood), wk = weekStart(day);
  const count = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', userId, day)?.count ?? 0;
  const weekSum = one('SELECT COALESCE(SUM(count), 0) n FROM daily WHERE user_id = ? AND day >= ? AND day < ?', userId, wk, dayStr(dayNum(wk) + 7)).n;
  const daysWeek = one('SELECT COUNT(*) n FROM daily WHERE user_id = ? AND day >= ? AND day < ? AND count >= ?', userId, wk, dayStr(dayNum(wk) + 7), CFG.questMinDurood).n;
  const holds = { [`goal:${day}`]: count >= goal, [`special:${day}`]: count >= goal, [`weekgoal:${wk}`]: weekSum >= goal * 7, [`days5:${wk}`]: daysWeek >= 5 };
  for (const [ref, ok] of Object.entries(holds)) {
    if (ok) continue;
    const ev = one("SELECT xp FROM events WHERE user_id = ? AND kind = 'quest' AND ref = ?", userId, ref);
    if (!ev) continue;
    run("DELETE FROM events WHERE user_id = ? AND kind = 'quest' AND ref = ?", userId, ref);
    run('UPDATE users SET xp = xp - ? WHERE id = ?', ev.xp, userId);
  }
}

/**
 * When an invitee's total is edited back under referralMin, the inviter's referral reward and the weekly invite quest it completed are taken back,
 * so a fake account that logs 100 and edits it down to 1 earns its inviter nothing. They are paid again if the invitee really reaches the line.
 */
function revokeReferral(userId) {
  const u = one('SELECT total, referrer_id FROM users WHERE id = ?', userId);
  if (!u.referrer_id || u.total >= CFG.referralMin) return;
  const take = (kind, ref) => {
    const ev = one('SELECT xp FROM events WHERE user_id = ? AND kind = ? AND ref = ?', u.referrer_id, kind, ref);
    if (!ev) return;
    run('DELETE FROM events WHERE user_id = ? AND kind = ? AND ref = ?', u.referrer_id, kind, ref);
    run('UPDATE users SET xp = xp - ? WHERE id = ?', ev.xp, u.referrer_id);
  };
  take('referral', String(userId));
  const today = dayOf();
  for (const wk of new Set([weekStart(today), weekStart(dayStr(dayNum(today) - 1))])) { // the edit window reaches yesterday, which may be last week
    const still = one('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND created_day >= ? AND total >= ?', u.referrer_id, wk, CFG.referralMin).n;
    if (!still) take('quest', `invite:${wk}`);
  }
}

export function settleQuests(userId) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  for (const q of questState(u)) {
    if (!q.info && !q.done && q.cur >= q.goal) grant(userId, 'quest', `${q.id}:${q.key}`, q.xp);
  }
}

// ---- actions --------------------------------------------------------------
/** The most a member may have reported on one day: lower while they are new, because new accounts are the easiest to fake. */
const dailyLimit = (u, day) => (dayNum(day) - dayNum(u.created_day) < CFG.newMemberDays ? CFG.maxDailyNew : CFG.maxDaily);

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
    if (prev + count > dailyLimit(u, day)) throw new HttpError(400, 'daily_cap');

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

    if (!u.held) {
      run('UPDATE users SET team_total = team_total + ? WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ? AND depth <= ?)', count, userId, CFG.teamMaxDepth);
      bumpDay(day, count);
    }
    evaluateFlags(userId, day);

    // the first durood a member ever reports: it counts them as an active person in every tree above them
    if (u.total === 0) run('UPDATE users SET tree_active = tree_active + 1 WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ? AND depth > 0)', userId);
    // the referrer is paid only once the invitee has really recited (referralMin in all): a fake sign-up that logs 1 earns nothing
    if (u.total < CFG.referralMin && u.total + count >= CFG.referralMin && u.referrer_id && grant(u.referrer_id, 'referral', userId, CFG.referralXp)) {
      settleQuests(u.referrer_id);
      evalBadges(u.referrer_id, fresh);
    }

    settleQuests(userId);
    evalBadges(userId, fresh);
    for (const a of all('SELECT ancestor_id id FROM ancestors WHERE user_id = ? AND depth > 0', userId)) evalBadges(a.id, fresh);
    hooks.inTx?.(userId, u.referrer_id, fresh); // weekly league, caravan streak
  });

  if (!duplicate) recordChallenge();
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
  newHigh: Number(process.env.FLAG_NEW_HIGH) || 5_000, // a new account (under newWindow days old) with this much in one day is held for a look
  newWindow: 14,
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
  } else if (dayNum(day) - dayNum(u.created_day) < FLAG.newWindow && dayTotal >= FLAG.newHigh) {
    reason = 'spike_10x'; detail = `new account (${dayNum(day) - dayNum(u.created_day)} days old): ${dayTotal} in one day`; // the cheapest way to fake numbers is a fresh account
  } else if (dayNum(day) - dayNum(u.created_day) >= FLAG.newMemberDays && dayTotal >= FLAG.spikeMin) {
    const prior = one('SELECT COALESCE(SUM(count), 0) n FROM daily WHERE user_id = ? AND day < ? AND day >= ?', userId, day, dayStr(dayNum(day) - 7)).n;
    const avg = prior / 7;
    if (avg > 0 && dayTotal > FLAG.spikeMult * avg) { reason = 'spike_10x'; detail = `${dayTotal} against a recent average of ${Math.round(avg)} a day`; }
  }
  if (!reason) return null;
  // one open flag per reason and day; after an admin cleared one, a clearly bigger day (half as much again) is looked at again
  if (one("SELECT 1 FROM flags WHERE user_id = ? AND reason = ? AND day = ? AND status IN ('open','confirmed')", userId, reason, day)) return null;
  const cleared = one("SELECT MAX(day_total) m FROM flags WHERE user_id = ? AND reason = ? AND day = ? AND status = 'cleared'", userId, reason, day).m;
  if (cleared && dayTotal <= cleared * 1.5) return null;
  run('INSERT INTO flags (user_id, reason, day, detail, day_total, created_at) VALUES (?,?,?,?,?,?)', userId, reason, day, detail, dayTotal, Date.now());
  run('UPDATE users SET hidden_from_ranks = 1 WHERE id = ?', userId);
  setHeld(userId, true);
  return reason;
}

/**
 * Puts a member's durood on hold (or releases it). Held durood stays in their own total and in the ledger, but is left out of
 * the national and challenge totals, the caravan totals above them and the caravan boards until an admin clears the flag.
 * Their ancestors' team_total is corrected by the member's whole total, so the caches stay exact.
 */
export function setHeld(userId, held) {
  const u = one('SELECT total, held FROM users WHERE id = ?', userId);
  if (!u || !!u.held === held) return;
  run('UPDATE users SET team_total = team_total + ? WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ? AND depth <= ?)', held ? -u.total : u.total, userId, CFG.teamMaxDepth);
  run('UPDATE users SET held = ? WHERE id = ?', held ? 1 : 0, userId);
  for (const d of all('SELECT day, count FROM daily WHERE user_id = ?', userId)) bumpDay(d.day, held ? -d.count : d.count);
}

function refreshHidden(userId) {
  const hidden = !!one("SELECT 1 FROM flags WHERE user_id = ? AND status IN ('open','confirmed')", userId);
  run('UPDATE users SET hidden_from_ranks = ? WHERE id = ?', hidden ? 1 : 0, userId);
  setHeld(userId, !!one("SELECT 1 FROM flags WHERE user_id = ? AND status IN ('open','confirmed') AND reason != 'manual'", userId));
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
 * Quest rewards whose condition no longer holds are taken back (revokeQuests); so are the inviter's referral reward and invite quest when the total falls back under referralMin (revokeReferral), and durood badges no longer met, for the member and the groups above them (revokeDuroodBadges). A day can't be edited down to nothing.
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
    if (getSetting(`week_closed:${weekStart(e.day)}`)) throw new HttpError(403, 'edit_window'); // a week whose leagues and city podium are decided is final
    const delta = newCount - e.count;
    if (delta === 0) throw new HttpError(400, 'no_change');
    const dayTotal = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', userId, e.day).count;
    const eu = one('SELECT created_day, held FROM users WHERE id = ?', userId);
    if (delta > 0 && dayTotal + delta > dailyLimit(eu, e.day)) throw new HttpError(400, 'daily_cap');

    const now = Date.now();
    run("INSERT INTO entries (user_id, day, count, rid, created_at, kind, ref_id) VALUES (?,?,?,?,?, 'reverse', ?)", userId, e.day, -e.count, `${base}:r`, now, e.id);
    run("INSERT INTO entries (user_id, day, count, rid, created_at, kind, ref_id) VALUES (?,?,?,?,?, 'replace', ?)", userId, e.day, newCount, `${base}:n`, now, e.id);
    run('UPDATE daily SET count = count + ? WHERE user_id = ? AND day = ?', delta, userId, e.day);
    run('UPDATE users SET total = total + ?, xp = xp + ? WHERE id = ?', delta, delta, userId);
    if (!eu.held) {
      run('UPDATE users SET team_total = team_total + ? WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ? AND depth <= ?)', delta, userId, CFG.teamMaxDepth);
      bumpDay(e.day, delta);
    }
    evaluateFlags(userId, e.day);
    if (delta < 0) {
      revokeQuests(userId, e.day); revokeReferral(userId);
      // durood badges no longer met are taken back, for the member and for everyone whose group total this number counted in
      const touched = [userId, ...all('SELECT ancestor_id id FROM ancestors WHERE user_id = ? AND depth > 0', userId).map((r) => r.id),
        ...all('SELECT cm.user_id id FROM caravan_members cm WHERE cm.caravan_id = (SELECT caravan_id FROM caravan_members WHERE user_id = ?)', userId).map((r) => r.id)];
      for (const id of new Set(touched)) revokeDuroodBadges(id);
    } else {
      // edited back up: what the number really supports is paid again, the same as when it is first logged
      const now = one('SELECT total, referrer_id FROM users WHERE id = ?', userId);
      if (now.referrer_id && now.total - delta < CFG.referralMin && now.total >= CFG.referralMin && grant(now.referrer_id, 'referral', String(userId), CFG.referralXp)) {
        settleQuests(now.referrer_id); evalBadges(now.referrer_id, []);
      }
      // (the member's own quests are not paid by an edit, only by a later log: a standing rule, so editing up and down can't be used to bounce)
      for (const id of [userId, ...all('SELECT ancestor_id id FROM ancestors WHERE user_id = ? AND depth > 0', userId).map((r) => r.id)]) evalBadges(id, []);
    }
  });
  if (!duplicate) recordChallenge();
  return { duplicate };
}

const HISTORY_ROWS = 600;
/** The last 7 days of the member's entries, newest first, with every edit shown. Today and yesterday are editable. */
export function history(userId) {
  const today = dayOf(), yesterday = dayStr(dayNum(today) - 1), from = dayStr(dayNum(today) - 6);
  // the newest HISTORY_ROWS entries only: a member who logs one at a time all week must not make this answer megabytes long
  const rows = all('SELECT * FROM entries WHERE user_id = ? AND day >= ? ORDER BY id DESC LIMIT ?', userId, from, HISTORY_ROWS).reverse();
  const totals = new Map(all('SELECT day, count FROM daily WHERE user_id = ? AND day >= ?', userId, from).map((d) => [d.day, d.count]));
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
    const day = days.get(r.day) ?? { day: r.day, total: 0, editable: (r.day === today || r.day === yesterday) && !getSetting(`week_closed:${weekStart(r.day)}`), entries: [] };
    day.entries.push({ id: r.id, count: r.count, at: r.created_at, original: e.count, edits });
    day.total = totals.get(r.day) ?? 0; // from the daily total, so a cut-off list still shows the right number
    days.set(r.day, day);
  }
  return { today, yesterday, days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)) };
}

/** Anonymises an account. The durood stays in every total; the person's name, phone and email are erased. */
export function anonymiseUser(userId, passHash) {
  tx(() => {
    for (const fn of deleteHooks) fn(userId); // leave the caravan, remove the profile picture, ...
    run(`UPDATE users SET display_name = '', bio = '', avatar_v = -ABS(avatar_v), username = ?, email = ?, phone = ?, pass = ?, city = '', deleted_at = ?, hidden_from_ranks = 1, suspended = 0
         WHERE id = ?`, `member_${userId}`, `deleted-${userId}@deleted.invalid`, `deleted-${userId}`, passHash, Date.now(), userId);
    run('DELETE FROM tokens WHERE user_id = ?', userId);
    // everything personal goes with the name: push devices, written text, and all Al-Burhan links, reports and assignments
    run('DELETE FROM push_subs WHERE user_id = ?', userId);
    run("UPDATE reflections SET body = '', status = 'removed' WHERE user_id = ?", userId);
    run("UPDATE lecture_comments SET body = '', status = 'removed' WHERE user_id = ?", userId);
    run("UPDATE replies SET body = '', status = 'removed' WHERE user_id = ?", userId);
    run('DELETE FROM mamulaat_days WHERE user_id = ?', userId);
    run('DELETE FROM mamulaat_sync WHERE user_id = ?', userId);
    run('DELETE FROM murabbi_links WHERE user_id = ?', userId);
    run("UPDATE murabbi_links SET murabbi_id = NULL, murabbi_phone = '', murabbi_name = '' WHERE murabbi_id = ?", userId);
    run('DELETE FROM masul_links WHERE razakar_id = ? OR masul_id = ?', userId, userId);
    run('DELETE FROM assignment_ticks WHERE assignment_id IN (SELECT id FROM assignments WHERE masul_id = ? OR razakar_id = ?)', userId, userId);
    run('DELETE FROM assignments WHERE masul_id = ? OR razakar_id = ?', userId, userId);
    run('DELETE FROM burhan_views WHERE viewer_id = ? OR subject_id = ?', userId, userId);
  });
}

// ---- seerah lectures: watch, pass the quiz, claim ---------------------------------------------------------------
/** Validates quiz questions supplied by an admin. Each question: q_en, optional q_ur, 2-5 options per language, answer = index. */
export function parseQuestions(raw) {
  if (raw == null || raw === '') return [];
  if (!Array.isArray(raw) || raw.length > 10) throw new HttpError(400, 'bad_quiz');
  return raw.map((q) => {
    const opts = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 200)).filter(Boolean) : []);
    const en = opts(q.options_en), ur = opts(q.options_ur);
    if (!String(q.q_en || '').trim() || en.length < 2 || en.length > 5 || (ur.length && ur.length !== en.length)) throw new HttpError(400, 'bad_quiz');
    const answer = Number(q.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= en.length) throw new HttpError(400, 'bad_quiz');
    return { q_en: String(q.q_en).trim().slice(0, 300), q_ur: String(q.q_ur || '').trim().slice(0, 300), options_en: en, options_ur: ur, answer };
  });
}
const quizOf = (l) => { try { return l.questions ? JSON.parse(l.questions) : []; } catch { return []; } };
/** What members may see: the questions and options, never the answers. */
export const publicQuiz = (l) => quizOf(l).map(({ answer, ...q }) => q);

// a lecture scheduled for a later week can't be watched, answered or claimed before its week (the id is easy to guess)
const liveLecture = (lectureId) => one('SELECT * FROM lectures WHERE id = ? AND (week_start IS NULL OR week_start <= ?)', lectureId, weekStart());
export function startLecture(userId, lectureId) {
  const l = liveLecture(lectureId);
  if (!l) throw new HttpError(404, 'not_found');
  run('INSERT OR IGNORE INTO lecture_starts (user_id, lecture_id, started_at) VALUES (?,?,?)', userId, lectureId, Date.now());
  return { minSeconds: l.min_seconds };
}

/** Marks which answers are wrong (by position) but never reveals the right ones, so a member can think again and retry. */
export function answerQuiz(userId, lectureId, answers) {
  const l = liveLecture(lectureId);
  if (!l || !one('SELECT 1 FROM lecture_starts WHERE user_id = ? AND lecture_id = ?', userId, lectureId)) throw new HttpError(404, 'not_found'); // answered while watching
  const quiz = quizOf(l);
  if (!quiz.length) throw new HttpError(400, 'no_quiz');
  if (!Array.isArray(answers) || answers.length !== quiz.length) throw new HttpError(400, 'bad_answers');
  const wrong = quiz.map((q, i) => (Number(answers[i]) === q.answer ? -1 : i)).filter((i) => i >= 0);
  if (!wrong.length) run('INSERT OR IGNORE INTO lecture_quiz (user_id, lecture_id, passed_at) VALUES (?,?,?)', userId, lectureId, Date.now());
  return { passed: wrong.length === 0, wrong };
}
export const quizPassed = (userId, lectureId) => !!one('SELECT 1 FROM lecture_quiz WHERE user_id = ? AND lecture_id = ?', userId, lectureId);

export function completeLecture(userId, lectureId) {
  const l = liveLecture(lectureId);
  const s = one('SELECT started_at FROM lecture_starts WHERE user_id = ? AND lecture_id = ?', userId, lectureId);
  if (!l || !s) throw new HttpError(404, 'not_found');
  if (Date.now() - s.started_at < l.min_seconds * 1000) throw new HttpError(400, 'too_soon');
  if (quizOf(l).length && !quizPassed(userId, lectureId)) throw new HttpError(400, 'quiz_needed');
  const fresh = [];
  const ok = tx(() => {
    const g = grant(userId, 'lecture', lectureId, l.xp);
    if (g) { settleQuests(userId); evalBadges(userId, fresh); }
    return g;
  });
  return { xpGained: ok ? l.xp : 0, already: !ok, newBadges: fresh.map((b) => b.code) };
}

/** "I did today's sunnah": a small, private, self-declared reward. A verified photo later adds the rest. */
export function tickSunnah(userId, sunnahId) {
  const ok = tx(() => {
    const g = grant(userId, 'sunnah_tick', sunnahId, CFG.sunnahTickXp);
    if (g) settleQuests(userId);
    return g;
  });
  return { xpGained: ok ? CFG.sunnahTickXp : 0, already: !ok };
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

/** "I teach a Seerat Circle": waits for an organiser, who knows the teachers. A refused request can be made again. */
export function requestTeach(userId, note = '') {
  const cur = one('SELECT status FROM circle_teachers WHERE user_id = ?', userId);
  if (cur?.status === 'approved') throw new HttpError(409, 'already_teacher');
  run(`INSERT INTO circle_teachers (user_id, status, note, created_at) VALUES (?, 'pending', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET status = 'pending', note = excluded.note, created_at = excluded.created_at, decided_at = NULL`, userId, String(note ?? '').trim().slice(0, 200), Date.now());
  return { teach: 'pending' };
}
export const teachStatus = (userId) => one('SELECT status FROM circle_teachers WHERE user_id = ?', userId)?.status ?? null;
export const listTeachRequests = () => all(`SELECT u.username, u.city, c.status, c.note, c.created_at at, c.decided_at FROM circle_teachers c JOIN users u ON u.id = c.user_id
  WHERE u.deleted_at IS NULL ORDER BY c.status = 'pending' DESC, c.created_at DESC LIMIT 200`);
export function decideTeach(username, approve) {
  const u = one('SELECT u.id FROM users u JOIN circle_teachers c ON c.user_id = u.id WHERE u.username = ? AND u.deleted_at IS NULL', String(username));
  if (!u) throw new HttpError(404, 'not_found');
  const fresh = [];
  tx(() => {
    run('UPDATE circle_teachers SET status = ?, decided_at = ? WHERE user_id = ?', approve ? 'approved' : 'rejected', Date.now(), u.id);
    if (approve && grant(u.id, 'circle_teach', 'teach', CFG.circleTeachXp)) evalBadges(u.id, fresh);
  });
  return { ok: true };
}

// ---- the 40-day challenge ---------------------------------------------------------------------------------
// 10 crore (100,000,000) durood in 40 days. The clock starts when the first member joins; an admin can correct the date.
// The meter counts everything reported since the start day and keeps counting after day 40. Challenge boards cover the
// 40 days only and freeze at the end.
export const CRORE = 10_000_000;

export function challengeConfig() {
  return {
    start: getSetting('challenge_start'),
    days: Number(getSetting('challenge_days', 40)),
    target: Number(getSetting('challenge_target', CFG.nationalTarget)),
  };
}

/** Day 1 is the Pakistan-time day of the first sign-up. */
export function startChallengeIfNeeded() {
  if (!getSetting('challenge_start')) setSetting('challenge_start', dayOf());
}

export function setChallenge({ start, days, target, clearMilestones }) {
  if (start !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start)) || Number.isNaN(Date.parse(start + 'T00:00:00Z'))) throw new HttpError(400, 'bad_date');
    setSetting('challenge_start', start);
  }
  if (days !== undefined) {
    const d = Number(days);
    if (!Number.isInteger(d) || d < 1 || d > 365) throw new HttpError(400, 'bad_days');
    setSetting('challenge_days', d);
  }
  if (target !== undefined) {
    const t = Number(target);
    if (!Number.isInteger(t) || t < 1_000_000 || t > 10_000_000_000) throw new HttpError(400, 'bad_target');
    setSetting('challenge_target', t);
  }
  if (clearMilestones) db.prepare("DELETE FROM settings WHERE key LIKE 'ch_m_%' OR key = 'ch_done_at'").run();
  return challengeSummary();
}

const milestoneList = (upTo) => {
  const out = [];
  for (let k = 1; k <= upTo; k++) {
    const at = getSetting(`ch_m_${k}`);
    if (at) out.push({ k, at: Number(at) });
  }
  return out;
};

/** Where the community stands: totals, today's required pace, ahead/behind, and a projection from the recent average. */
export function challengeSummary(now = Date.now()) {
  const { start, days, target } = challengeConfig();
  if (!start) return { state: 'waiting', days, target, total: 0, remaining: target, crores: 0, reached: 0, milestones: [] };
  const today = dayOf(now);
  const idx = dayNum(today) - dayNum(start) + 1;                 // 1 on the first day
  const end = dayStr(dayNum(start) + days - 1);
  const total = one('SELECT COALESCE(SUM(total), 0) n FROM day_totals WHERE day >= ?', start).n;
  const todayCount = idx >= 1 ? (one('SELECT total FROM day_totals WHERE day = ?', today)?.total ?? 0) : 0;
  const before = total - todayCount;                             // reported before today
  const crores = Math.floor(total / CRORE);
  const milestones = milestoneList(Math.max(crores, Math.floor(target / CRORE)));
  const out = {
    days, target, start, end, total, today: todayCount, crores, milestones,
    reached: milestones.length ? milestones.at(-1).k : 0,
    remaining: Math.max(0, target - total),
    plannedPerDay: Math.round(target / days),
    doneAt: getSetting('ch_done_at') ? Number(getSetting('ch_done_at')) : null,
    dayIndex: Math.max(idx, 0),
  };
  if (total >= target) return { ...out, state: 'done' };
  if (idx < 1) return { ...out, state: 'upcoming', startsIn: 1 - idx };
  if (idx > days) return { ...out, state: 'over', daysOver: idx - days, short: target - total };
  const daysLeft = days - idx + 1;                               // includes today
  const completeDays = Math.min(7, idx - 1);
  let projectedTotal = null;
  if (completeDays > 0) {
    const from = dayStr(dayNum(today) - completeDays);
    const recent = one('SELECT COALESCE(SUM(total), 0) n FROM day_totals WHERE day >= ? AND day < ?', from, today).n;
    projectedTotal = Math.round(before + (recent / completeDays) * daysLeft);
  }
  return {
    ...out, state: 'running', daysLeft,
    neededToday: Math.max(0, Math.ceil((target - before) / daysLeft)),   // to finish exactly on the last day from where we really are
    gap: before - Math.round((target * (idx - 1)) / days),               // positive = ahead of a straight line at the start of today
    projectedTotal,
  };
}

/** Records each crore (and the finish) the moment the total passes it. Called after every write; milestones never un-happen. */
export function recordChallenge() {
  const { start, target } = challengeConfig();
  if (!start) return;
  const total = one('SELECT COALESCE(SUM(total), 0) n FROM day_totals WHERE day >= ?', start).n;
  const now = Date.now();
  const crores = Math.floor(total / CRORE), seen = Number(getSetting('ch_m_max', '0'));
  if (crores > seen) { // only look at crores not yet recorded; ch_m_max is cleared together with the milestones
    for (let k = seen + 1; k <= crores; k++) if (!getSetting(`ch_m_${k}`)) { setSetting(`ch_m_${k}`, now); hooks.milestone?.(k); }
    setSetting('ch_m_max', crores);
  }
  if (total >= target && !getSetting('ch_done_at')) setSetting('ch_done_at', now);
}

/** Daily totals since the start, for the chart. */
export const challengeSeries = () => {
  const { start } = challengeConfig();
  if (!start) return [];
  return all('SELECT day, total FROM day_totals WHERE day >= ? ORDER BY day LIMIT 400', start);
};

// ---- reads ----------------------------------------------------------------
// exact (summed from users.total, which `audit` proves equals the ledger); cached briefly and stamped with asOf
let natCache = { at: 0, v: null };
export function publicStats() {
  if (Date.now() - natCache.at > Number(process.env.PUBLIC_CACHE_MS ?? 15_000)) {
    const r = one('SELECT COALESCE(SUM(CASE WHEN held = 0 THEN total END),0) total, COALESCE(SUM(CASE WHEN held = 1 THEN total END),0) pending, SUM(deleted_at IS NULL) members FROM users');
    const live = { today: one('SELECT COALESCE((SELECT total FROM day_totals WHERE day = ?), 0) n', dayOf()).n, membersToday: one('SELECT COUNT(*) n FROM daily d JOIN users u ON u.id = d.user_id AND u.held = 0 WHERE d.day = ? AND d.count > 0', dayOf()).n };
    natCache = { at: Date.now(), v: { total: r.total, pending: r.pending, members: r.members, ...live, asOf: Date.now(), challenge: challengeSummary() } };
  }
  return { ...natCache.v, target: CFG.nationalTarget, circleUrl: circleUrl() };
}

export function getMe(userId) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  const day = dayOf(), wk = weekStart();
  const today = one('SELECT count FROM daily WHERE user_id = ? AND day = ?', userId, day)?.count ?? 0;
  const week = one('SELECT COALESCE(SUM(count),0) n FROM daily WHERE user_id = ? AND day >= ?', userId, wk).n;
  const team = one(`SELECT COUNT(*) members FROM ancestors WHERE ancestor_id = ? AND depth > 0 AND depth <= ?`, userId, CFG.teamMaxDepth);
  const direct = one('SELECT COUNT(*) n FROM users WHERE referrer_id = ?', userId).n;
  const gapDays = u.last_day ? dayNum(day) - dayNum(u.last_day) : null;
  const streakAlive = gapDays === 0 || gapDays === 1 || (gapDays === 2 && u.shields > 0); // a shield bridges one missed day
  return {
    id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, avatar: avatarUrl(u.id, u.avatar_v), email: u.email, phone: u.phone, lang: u.lang, city: u.city, cityId: u.city_id, country: u.country, needsCity: !u.city_id,
    dailyGoal: u.daily_goal, hiddenFromRanks: !!u.hidden_from_ranks,
    // 'decided' once an organiser looked and kept it out ("keep held"), so the member isn't told "being checked" for ever
    flagState: !u.hidden_from_ranks ? null : one("SELECT 1 FROM flags WHERE user_id = ? AND status = 'open'", u.id) ? 'open' : one("SELECT 1 FROM flags WHERE user_id = ? AND status = 'confirmed'", u.id) ? 'decided' : 'open', emailVerified: !!u.email_verified_at,
    invites: inviteStatus(userId),
    inviter: u.referrer_id ? one('SELECT username FROM users WHERE id = ?', u.referrer_id)?.username ?? null : null, canLinkInviter: canLinkInviter(u),
    total: u.total, today, week,
    streak: streakAlive ? u.streak : 0, bestStreak: u.best_streak, shields: u.shields,
    ...levelFor(u.xp),
    badges: all('SELECT code FROM badges WHERE user_id = ? ORDER BY earned_at', userId).map((b) => b.code).filter((c) => BADGE_CODES.includes(c)),
    quests: questState(u).map(({ key, info, ...q }) => q),
    // team = the whole referral tree (Qabila); the caravan summary is added by the route (caravan.js)
    team: { members: team.members, direct, total: u.team_total },
    sunnah: { posted: one("SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = 'sunnah'", userId).n },
    pub: publicStats(),
    circleUrl: circleUrl(), circleTeach: teachStatus(u.id), reminderTime: u.reminder_time, special: specialToday(), league: u.league,
    unreadNews: one('SELECT COUNT(*) n FROM announcements WHERE created_at > ?', u.news_seen_at).n,
    ...(hooks.profileExtra?.(userId) || { caravan: null, caravanInvites: 0, caravanRequests: 0 }), // caravan summary (caravan.js)
    majlis: hooks.majlis?.(userId) ?? null, // Al-Burhan department (majlis.js)
  };
}

// Boards are the same for everyone except the "this is you" marker, so the rows are computed once and shared for a short time.
// Admin actions (hide, suspend, clear a flag) show up on boards within PUBLIC_CACHE_MS (default 30 s).
const boardCache = new Map();
export function cachedBoard(key, compute) {
  const ttl = Number(process.env.PUBLIC_CACHE_MS ?? 30_000);
  const k = `${key}|${dayOf()}`, hit = boardCache.get(k);
  if (ttl > 0 && hit && Date.now() - hit.at < ttl) return hit.rows;
  const rows = compute();
  if (ttl > 0) { if (boardCache.size > 60) boardCache.clear(); boardCache.set(k, { at: Date.now(), rows }); }
  return rows;
}
export const withMe = (rows, me) => rows.map((r, i) => ({ rank: i + 1, ...r, me: r.username === me }));
/** Turns the picture and name columns of a row (uid, av, dn) into what the client shows. */
export const person = ({ uid, av, dn, ...r }) => ({ ...r, avatar: avatarUrl(uid, av), displayName: dn || '' });
export const VISIBLE = 'u.hidden_from_ranks = 0 AND u.suspended = 0 AND u.deleted_at IS NULL';

/**
Two kinds of ranking here: people (type 'users') and referral trees (everyone under a member, at any depth: the Qabila, type 'trees').
 * Caravans are named groups and are ranked in caravan.js.
 */
const membersOf = () => `(SELECT COUNT(*) FROM ancestors x WHERE x.ancestor_id = u.id AND x.depth > 0 AND x.depth <= ${CFG.teamMaxDepth})`;

export function leaderboard(userId, type, period) {
  if (type === 'teams') type = 'trees';
  const wk = weekStart();
  const ch = challengeConfig();
  const chFrom = ch.start || '9999-12-31', chTo = ch.start ? dayStr(dayNum(ch.start) + ch.days - 1) : '0000-01-01';
  const me = one('SELECT username FROM users WHERE id = ?', userId).username;
  const rows = cachedBoard(`${type}:${period}`, () => {
    if (type === 'trees') {
      // add up each member's days first (one row per member), then spread those totals up the tree: far fewer rows than joining every day
      const from = period === 'week' ? wk : chFrom, to = period === 'week' ? '9999-12-31' : chTo;
      const base = period !== 'all'
        ? `WITH w AS (SELECT d.user_id, SUM(d.count) s FROM daily d JOIN users hu ON hu.id = d.user_id AND hu.held = 0 WHERE d.day >= ? AND d.day <= ? GROUP BY d.user_id)
           SELECT a.ancestor_id id, SUM(w.s) score FROM w JOIN ancestors a ON a.user_id = w.user_id AND a.depth <= ${CFG.teamMaxDepth} GROUP BY a.ancestor_id`
        : 'SELECT id, team_total score FROM users';
      return all(`SELECT u.username, u.city, t.score, ${membersOf()} members
                  FROM (${base}) t JOIN users u ON u.id = t.id
                  WHERE ${VISIBLE} AND t.score > 0 AND EXISTS (SELECT 1 FROM users c WHERE c.referrer_id = u.id)
                  ORDER BY t.score DESC LIMIT 50`, ...(period === 'all' ? [] : [from, to]));
    }
    if (period === 'week' || period === 'challenge') {
      const [from, to] = period === 'week' ? [wk, '9999-12-31'] : [chFrom, chTo];
      return all(`SELECT u.username, u.city, u.id uid, u.avatar_v av, u.display_name dn, SUM(d.count) score FROM daily d JOIN users u ON u.id = d.user_id
                  WHERE d.day >= ? AND d.day <= ? AND ${VISIBLE} GROUP BY u.id ORDER BY score DESC LIMIT 50`, from, to).map(person);
    }
    return all(`SELECT username, city, id uid, avatar_v av, display_name dn, total score FROM users u WHERE ${VISIBLE} AND total > 0 ORDER BY total DESC LIMIT 50`).map(person);
  });
  return { rows: withMe(rows, me), weekStart: wk };
}

/**
 * Group boards by metric. 'average' = this week's durood per active member (active = recited on any day this week, the group
 * owner included); 'growth' = this week's total minus last week's. Counts everyone under the owner (the Qabila). Same visibility rules as the total board; only groups with at least one invitee appear.
 */
export function qabilaBoard(userId, metric) {
  const wk = weekStart(), prev = dayStr(dayNum(wk) - 7);
  const me = one('SELECT username FROM users WHERE id = ?', userId).username;
  const rows = cachedBoard(`tree:${metric}`, () => {
    const raw = all(`WITH w AS (
        SELECT d.user_id, SUM(CASE WHEN d.day >= ? THEN d.count ELSE 0 END) wk, SUM(CASE WHEN d.day < ? THEN d.count ELSE 0 END) last,
               MAX(CASE WHEN d.day >= ? AND d.count > 0 THEN 1 ELSE 0 END) active
        FROM daily d JOIN users hu ON hu.id = d.user_id AND hu.held = 0 WHERE d.day >= ? GROUP BY d.user_id),
      t AS (SELECT a.ancestor_id id, SUM(w.wk) week, SUM(w.last) last, SUM(w.active) active
            FROM w JOIN ancestors a ON a.user_id = w.user_id AND a.depth <= ${CFG.teamMaxDepth} GROUP BY a.ancestor_id)
      SELECT u.username, u.city, t.week, t.last, t.active, ${membersOf()} members
      FROM t JOIN users u ON u.id = t.id
      WHERE ${VISIBLE} AND EXISTS (SELECT 1 FROM users c WHERE c.referrer_id = u.id)`, wk, wk, wk, prev);
    return raw.map((r) => ({
      username: r.username, city: r.city, members: r.members, active: r.active,
      score: metric === 'growth' ? r.week - r.last : r.active ? Math.round(r.week / r.active) : 0,
    })).filter((r) => (metric === 'growth' ? r.score !== 0 : r.score > 0))
      .sort((x, y) => y.score - x.score || x.username.localeCompare(y.username)).slice(0, 50);
  });
  return { rows: withMe(rows, me), weekStart: wk, metric };
}

export function teamView(userId) {
  const wk = weekStart();
  const direct = all(`SELECT u.username, u.city, u.id uid, u.avatar_v av, u.display_name dn, u.total, u.team_total, u.created_day,
        COALESCE((SELECT SUM(count) FROM daily d WHERE d.user_id = u.id AND d.day >= ?), 0) week,
        (SELECT COUNT(*) FROM ancestors a WHERE a.ancestor_id = u.id AND a.depth > 0) members
      FROM users u WHERE u.referrer_id = ? AND u.deleted_at IS NULL AND u.suspended = 0 ORDER BY u.team_total DESC LIMIT 200`, wk, userId);
  const week = one(`SELECT COALESCE(SUM(d.count),0) n FROM daily d JOIN users hu ON hu.id = d.user_id AND hu.held = 0 JOIN ancestors a ON a.user_id = d.user_id
                    WHERE a.ancestor_id = ? AND d.day >= ? AND a.depth <= ?`, userId, wk, CFG.teamMaxDepth).n;
  const byDepth = all(`SELECT depth, COUNT(*) n FROM ancestors WHERE ancestor_id = ? AND depth > 0 GROUP BY depth ORDER BY depth LIMIT 20`, userId);
  const total = one('SELECT team_total FROM users WHERE id = ?', userId).team_total;
  // the people above this member, nearest first; they already see this member's name, city and counts
  const upline = all(`SELECT u.username, u.city, u.team_total, a.depth,
        (SELECT COUNT(*) FROM ancestors x WHERE x.ancestor_id = u.id AND x.depth > 0) members
      FROM ancestors a JOIN users u ON u.id = a.ancestor_id
      WHERE a.user_id = ? AND a.depth > 0 AND u.deleted_at IS NULL ORDER BY a.depth LIMIT 20`, userId)
    .map((u) => ({ username: u.username, city: u.city, team: u.team_total, members: u.members, depth: u.depth }));
  const active = one(`SELECT COUNT(DISTINCT d.user_id) n FROM daily d JOIN users hu ON hu.id = d.user_id AND hu.held = 0 JOIN ancestors a ON a.user_id = d.user_id
                      WHERE a.ancestor_id = ? AND a.depth > 0 AND a.depth <= ? AND d.day >= ? AND d.count > 0`, userId, CFG.teamMaxDepth, wk).n;
  return {
    total, week, byDepth, upline, active,
    // there is no opt-out: inviters see their invitees' name, city and counts
    direct: direct.map((d) => ({
      username: d.username, displayName: d.dn, avatar: avatarUrl(d.uid, d.av), city: d.city, joined: d.created_day, members: d.members,
      total: d.total, week: d.week, team: d.team_total,
    })),
  };
}

// first start after an upgrade: build the per-day public totals once
if (!one('SELECT 1 FROM day_totals LIMIT 1') && one('SELECT 1 FROM daily LIMIT 1')) tx(() => rebuildDayTotals());

// first start after an upgrade: count the active people under every member once
if (getSetting('tree_active_v') !== '1') {
  tx(() => {
    db.exec(`UPDATE users SET tree_active = (SELECT COUNT(*) FROM ancestors a JOIN users u ON u.id = a.user_id WHERE a.ancestor_id = users.id AND a.depth > 0 AND u.total > 0)`);
    setSetting('tree_active_v', '1');
  });
}
