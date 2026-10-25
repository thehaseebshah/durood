// Competition beyond the personal board: cities, weekly leagues, the caravan streak, and the weekly close that decides them.
import { db, tx, getSetting, setSetting } from './db.js';
import { CFG, dayOf, dayNum, dayStr, weekStart, hooks, award, grant, evalBadges, person } from './game.js';
import { cityLabel } from './geo.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

export const LEAGUE_SIZE = 30;
export const TIERS = 4;                       // Bronze, Silver, Gold, Diamond
const VISIBLE = 'u.hidden_from_ranks = 0 AND u.suspended = 0 AND u.deleted_at IS NULL AND u.held = 0';
const prevWeek = (w = weekStart()) => dayStr(dayNum(w) - 7);
const weekEnd = (w) => dayStr(dayNum(w) + 6);

// ---- cities ------------------------------------------------------------------------------------------------------------------
const boardCache = new Map();
function cached(key, compute) {
  const ttl = Number(process.env.PUBLIC_CACHE_MS ?? 30_000), k = `${key}|${dayOf()}`, hit = boardCache.get(k);
  if (ttl > 0 && hit && Date.now() - hit.at < ttl) return hit.v;
  const v = compute();
  if (ttl > 0) { if (boardCache.size > 30) boardCache.clear(); boardCache.set(k, { at: Date.now(), v }); }
  return v;
}

/** Per-city sums for a week: total, the week before, how many members recited, and the city's size. Only cities with enough active members. */
function cityWeek(from, to, prevFrom) {
  return all(`WITH w AS (
      SELECT d.user_id, SUM(CASE WHEN d.day >= ? AND d.day <= ? THEN d.count ELSE 0 END) wk, SUM(CASE WHEN d.day < ? THEN d.count ELSE 0 END) last,
             MAX(CASE WHEN d.day >= ? AND d.day <= ? AND d.count > 0 THEN 1 ELSE 0 END) active
      FROM daily d JOIN users hu ON hu.id = d.user_id AND hu.held = 0 WHERE d.day >= ? AND d.day <= ? GROUP BY d.user_id)
    SELECT c.id, c.name, c.region, c.cc, SUM(w.wk) week, SUM(w.last) last, SUM(w.active) active,
           (SELECT COUNT(*) FROM users x WHERE x.city_id = c.id AND x.deleted_at IS NULL) members
    FROM w JOIN users u ON u.id = w.user_id AND u.deleted_at IS NULL AND u.suspended = 0 JOIN cities c ON c.id = u.city_id
    GROUP BY c.id HAVING SUM(w.active) >= ?`, from, to, from, from, to, prevFrom, to, CFG.cityMinActive);
}

/** City boards for the current week: Total, Average per active member, Growth over last week. */
export function cityBoard(userId, metric = 'total') {
  const wk = weekStart(), prev = prevWeek(wk);
  const myCity = one('SELECT city_id FROM users WHERE id = ?', userId)?.city_id ?? null;
  const rows = cached(`city:${metric}`, () => cityWeek(wk, '9999-12-31', prev).map((r) => ({
    cityId: r.id, username: r.name, city: [r.region && r.region !== r.name ? r.region : '', r.cc].filter(Boolean).join(' · '), label: cityLabel(r), members: r.members, active: r.active,
    score: metric === 'growth' ? r.week - r.last : metric === 'average' ? Math.round(r.week / r.active) : r.week,
  })).filter((r) => (metric === 'growth' ? r.score !== 0 : r.score > 0))
    .sort((x, y) => y.score - x.score || x.username.localeCompare(y.username)).slice(0, 50));
  return { rows: rows.map((r, i) => ({ rank: i + 1, ...r, me: r.cityId === myCity })), weekStart: wk, metric, minActive: CFG.cityMinActive };
}

/** Last closed week's top cities (for the feed and the cities screen). */
export const cityPodium = () => all(`SELECT w.week, w.rank, w.score, w.closed_at, c.name, c.region, c.cc FROM city_weeks w JOIN cities c ON c.id = w.city_id
  ORDER BY w.closed_at DESC, w.rank LIMIT 6`).map((r) => ({ week: r.week, rank: r.rank, score: r.score, at: r.closed_at, label: cityLabel(r) }));

// ---- leagues -----------------------------------------------------------------------------------------------------------------
/** Called when a member reports durood: puts them in this week's league group (at their tier) the first time. */
export function joinLeague(userId, week = weekStart()) {
  if (one('SELECT 1 FROM league_members WHERE week = ? AND user_id = ?', week, userId)) return;
  const tier = one('SELECT league FROM users WHERE id = ?', userId).league;
  const open = one('SELECT grp FROM league_members WHERE week = ? AND tier = ? GROUP BY grp HAVING COUNT(*) < ? ORDER BY grp LIMIT 1', week, tier, LEAGUE_SIZE);
  const grp = open ? open.grp : one('SELECT COALESCE(MAX(grp), 0) + 1 g FROM league_members WHERE week = ? AND tier = ?', week, tier).g;
  run('INSERT INTO league_members (week, user_id, tier, grp) VALUES (?,?,?,?)', week, userId, tier, grp);
}

const groupRows = (week, tier, grp) => all(`SELECT lm.user_id id, u.username, u.city, u.id uid, u.avatar_v av, u.display_name dn,
    COALESCE((SELECT SUM(d.count) FROM daily d WHERE d.user_id = lm.user_id AND d.day >= ? AND d.day <= ?), 0) score
  FROM league_members lm JOIN users u ON u.id = lm.user_id
  WHERE lm.week = ? AND lm.tier = ? AND lm.grp = ? AND ${VISIBLE}
  ORDER BY score DESC, u.username`, week, weekEnd(week), week, tier, grp).map((r, i) => ({ ...person(r), id: r.id, rank: i + 1 }));
const zone = (n) => Math.min(5, Math.floor(n / 3));        // how many move up, and how many move down

/** The member's league this week (their group's standings), and what happened to them last week. */
export function leagueView(userId) {
  const week = weekStart(), tier = one('SELECT league FROM users WHERE id = ?', userId).league;
  const mine = one('SELECT * FROM league_members WHERE week = ? AND user_id = ?', week, userId);
  const out = { tier, week, daysLeft: dayNum(weekEnd(week)) - dayNum(dayOf()) + 1, joined: !!mine, size: LEAGUE_SIZE, tiers: TIERS };
  if (mine) {
    const rows = groupRows(week, mine.tier, mine.grp);
    const k = zone(rows.length);
    out.rows = rows.map((r) => ({ rank: r.rank, username: r.username, avatar: r.avatar, displayName: r.displayName, city: r.city, score: r.score, me: r.id === userId, up: mine.tier < TIERS - 1 && r.rank <= k && r.score > 0, down: mine.tier > 0 && r.rank > rows.length - k }));
  }
  const last = one('SELECT * FROM league_members WHERE week = ? AND user_id = ?', prevWeek(week), userId);
  if (last?.result) out.last = { result: last.result, rank: last.rank, tier: last.tier };
  return out;
}

function closeLeagues(week) {
  const groups = all('SELECT DISTINCT tier, grp FROM league_members WHERE week = ? ORDER BY tier, grp', week);
  let moved = 0;
  for (const { tier, grp } of groups) {
    const rows = groupRows(week, tier, grp), k = zone(rows.length);
    rows.forEach((r) => {
      let result = 'stay', to = tier;
      if (tier < TIERS - 1 && r.rank <= k && r.score > 0) { result = 'up'; to = tier + 1; }
      else if (tier > 0 && r.rank > rows.length - k) { result = 'down'; to = tier - 1; }
      run('UPDATE league_members SET rank = ?, result = ? WHERE week = ? AND user_id = ?', r.rank, result, week, r.id);
      if (to !== tier) {
        run('UPDATE users SET league = ? WHERE id = ?', to, r.id);
        if (result === 'up') { grant(r.id, 'league', week, 100 * to); evalBadges(r.id, []); }
        moved += 1;
      }
    });
  }
  return { groups: groups.length, moved };
}

function closeCities(week) {
  const rows = cityWeek(week, weekEnd(week), prevWeek(week)).map((r) => ({ id: r.id, avg: r.week / r.active })).sort((a, b) => b.avg - a.avg || a.id - b.id).slice(0, 3);
  rows.forEach((c, i) => {
    run('INSERT OR IGNORE INTO city_weeks (week, rank, city_id, score, closed_at) VALUES (?,?,?,?,?)', week, i + 1, c.id, Math.round(c.avg), Date.now());
    for (const m of all(`SELECT DISTINCT d.user_id id FROM daily d JOIN users u ON u.id = d.user_id WHERE u.city_id = ? AND u.held = 0 AND u.deleted_at IS NULL AND d.day >= ? AND d.day <= ? AND d.count > 0`, c.id, week, weekEnd(week))) {
      award(m.id, 'city_podium');
      if (i === 0) award(m.id, 'city_champion');
    }
  });
  return rows.length;
}

/**
 * Closes last week once, and any earlier week that was never closed (up to four back, oldest first): league promotions and the city podium.
 * Safe to call as often as you like. It runs before a member's first durood of a new week, so the group they join is at their new tier.
 */
export function ensureWeekClosed() {
  const todo = [];
  for (let w = prevWeek(), i = 0; i < 4 && !getSetting(`week_closed:${w}`); w = prevWeek(w), i++) todo.unshift(w);
  if (!todo.length) return null;
  let last = null;
  for (const week of todo) {
    last = tx(() => {
      if (getSetting(`week_closed:${week}`)) return null;
      const leagues = closeLeagues(week), cities = closeCities(week);
      setSetting(`week_closed:${week}`, Date.now());
      return { week, leagues, cities };
    });
  }
  return last;
}

// runs inside the transaction that records durood
hooks.inTx = (userId, referrerId, fresh) => {
  joinLeague(userId);
  caravanHooks.afterLog?.(userId, fresh); // the caravan's shared milestones (caravan.js)
};
/** caravan.js registers itself here (it imports compete's neighbours, so a direct import would be circular). */
export const caravanHooks = { afterLog: null };
