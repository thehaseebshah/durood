import { Worker } from 'node:worker_threads';
import { db, tx } from './db.js';
import { CFG, rebuildDayTotals } from './game.js';

const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);

const LEDGER_DAILY = 'SELECT user_id, day, SUM(count) s FROM entries GROUP BY user_id, day HAVING SUM(count) != 0';

/**
 * Re-derives every statistic from the append-only `entries` ledger and compares it with the stored caches.
 * With { fix: true } the caches are rebuilt from the ledger (the ledger itself is never modified).
 */
export function audit({ fix = false } = {}) {
  const problems = [];
  const note = (kind, detail) => { if (problems.length < 100) problems.push({ kind, ...detail }); };

  const users = all(`SELECT u.id, u.username, u.total, u.team_total, u.xp,
      COALESCE((SELECT SUM(count) FROM entries e WHERE e.user_id = u.id), 0) l_total,
      COALESCE((SELECT SUM(e.count) FROM entries e JOIN users hu ON hu.id = e.user_id AND hu.held = 0 JOIN ancestors a ON a.user_id = e.user_id
                WHERE a.ancestor_id = u.id AND a.depth <= ?), 0) l_team,
      u.held, u.tree_active,
      (SELECT COUNT(*) FROM ancestors a2 JOIN users d2 ON d2.id = a2.user_id WHERE a2.ancestor_id = u.id AND a2.depth > 0 AND d2.total > 0) l_tree_active,
      EXISTS(SELECT 1 FROM flags f WHERE f.user_id = u.id AND f.status IN ('open','confirmed') AND f.reason != 'manual') should_hold,
      COALESCE((SELECT SUM(xp) FROM events ev WHERE ev.user_id = u.id), 0) ev_xp
    FROM users u`, CFG.teamMaxDepth);
  for (const u of users) {
    if (u.total !== u.l_total) note('user_total', { user: u.username, stored: u.total, ledger: u.l_total });
    if (!!u.held !== !!u.should_hold) note('held', { user: u.username, held: u.held, shouldHold: u.should_hold });
    if (u.team_total !== u.l_team) note('team_total', { user: u.username, stored: u.team_total, ledger: u.l_team });
    if (u.tree_active !== u.l_tree_active) note('tree_active', { user: u.username, stored: u.tree_active, ledger: u.l_tree_active });
    if (u.xp !== u.l_total + u.ev_xp) note('xp', { user: u.username, stored: u.xp, ledger: u.l_total + u.ev_xp });
  }

  const dailyBad = all(`SELECT d.user_id, d.day, d.count stored, COALESCE(l.s, 0) ledger
      FROM daily d LEFT JOIN (${LEDGER_DAILY}) l ON l.user_id = d.user_id AND l.day = d.day
      WHERE d.count != COALESCE(l.s, 0)
    UNION ALL
    SELECT l.user_id, l.day, 0, l.s FROM (${LEDGER_DAILY}) l
      LEFT JOIN daily d ON d.user_id = l.user_id AND d.day = l.day WHERE d.user_id IS NULL`);
  for (const d of dailyBad) note('daily', d);

  // the per-day public totals must equal the ledger of members who are not on hold
  for (const d of all(`SELECT t.day, t.total stored, COALESCE(l.s, 0) ledger FROM day_totals t
        LEFT JOIN (SELECT e.day, SUM(e.count) s FROM entries e JOIN users u ON u.id = e.user_id AND u.held = 0 GROUP BY e.day) l ON l.day = t.day
        WHERE t.total != COALESCE(l.s, 0)
      UNION ALL SELECT l.day, 0, l.s FROM (SELECT e.day, SUM(e.count) s FROM entries e JOIN users u ON u.id = e.user_id AND u.held = 0 GROUP BY e.day HAVING s != 0) l
        LEFT JOIN day_totals t ON t.day = l.day WHERE t.day IS NULL`)) note('day_totals', d);

  // edits: every reversing entry negates exactly one standing entry of the same member and day, and every replacement
  // points at an entry that was reversed
  for (const r of all(`SELECT e.id, e.kind, e.count, e.day, e.user_id, p.count pcount, p.day pday, p.user_id puser, p.kind pkind,
        EXISTS(SELECT 1 FROM entries x WHERE x.kind = 'reverse' AND x.ref_id = e.ref_id) was_reversed
      FROM entries e LEFT JOIN entries p ON p.id = e.ref_id WHERE e.kind IN ('reverse','replace')`)) {
    if (!r.pkind || r.puser !== r.user_id || r.pday !== r.day || r.pkind === 'reverse') note('edit_chain', { entry: r.id, problem: 'points at a missing or foreign entry' });
    else if (r.kind === 'reverse' && r.count !== -r.pcount) note('edit_chain', { entry: r.id, problem: 'does not negate the entry it reverses', count: r.count, reversed: r.pcount });
    else if (r.kind === 'replace' && !r.was_reversed) note('edit_chain', { entry: r.id, problem: 'replaces an entry that was never reversed' });
  }

  // photos: every post paid its reward exactly once, in the step that created it
  for (const p of all(`SELECT p.id, p.likes, (SELECT COUNT(*) FROM events e WHERE e.kind IN ('sunnah','class') AND e.ref = CAST(p.id AS TEXT)) paid,
        (SELECT COUNT(*) FROM likes l WHERE l.kind = 'post' AND l.item_id = p.id) l FROM posts p`)) {
    if (p.paid !== 1) note('post_payout', { post: p.id, paid: p.paid });
    if (p.likes !== p.l) note('post_likes', { post: p.id, stored: p.likes, ledger: p.l });
  }
  for (const r of all(`SELECT r.id, r.likes, (SELECT COUNT(*) FROM likes l WHERE l.kind = 'reflection' AND l.item_id = r.id) l FROM reflections r`)) {
    if (r.likes !== r.l) note('reflection_likes', { reflection: r.id, stored: r.likes, ledger: r.l });
  }
  // like points: the poster earned likeXp for each of the first likeCap likes on every item, and nothing else
  const likeEvents = one("SELECT COUNT(*) n FROM events WHERE kind = 'like'").n;
  const likeExpected = one(`SELECT COALESCE(SUM(MIN(likes, ?)), 0) n FROM (SELECT likes FROM posts UNION ALL SELECT likes FROM reflections UNION ALL SELECT likes FROM lecture_comments)`, CFG.likeCap).n;
  if (likeEvents !== likeExpected) note('like_payout', { events: likeEvents, expected: likeExpected });

  const national = {
    stored: one('SELECT COALESCE(SUM(total), 0) n FROM users').n,
    ledger: one('SELECT COALESCE(SUM(count), 0) n FROM entries').n,
  };
  if (national.stored !== national.ledger) note('national', national);

  const ok = problems.length === 0;
  if (!ok && fix) {
    tx(() => {
      db.exec('DELETE FROM daily');
      db.exec('INSERT INTO daily (user_id, day, count) SELECT user_id, day, SUM(count) FROM entries GROUP BY user_id, day');
      db.exec(`UPDATE users SET total = COALESCE((SELECT SUM(count) FROM entries e WHERE e.user_id = users.id), 0)`);
      db.exec(`UPDATE users SET held = EXISTS(SELECT 1 FROM flags f WHERE f.user_id = users.id AND f.status IN ('open','confirmed') AND f.reason != 'manual')`);
      db.prepare(`UPDATE users SET team_total = COALESCE((SELECT SUM(e.count) FROM entries e JOIN users hu ON hu.id = e.user_id AND hu.held = 0 JOIN ancestors a ON a.user_id = e.user_id
                  WHERE a.ancestor_id = users.id AND a.depth <= ?), 0)`).run(CFG.teamMaxDepth);
      rebuildDayTotals();
      db.exec(`UPDATE users SET tree_active = (SELECT COUNT(*) FROM ancestors a JOIN users u ON u.id = a.user_id WHERE a.ancestor_id = users.id AND a.depth > 0 AND u.total > 0)`);
      db.exec(`UPDATE users SET xp = total + COALESCE((SELECT SUM(xp) FROM events ev WHERE ev.user_id = users.id), 0)`);
    });
  }
  return { ok, fixed: !ok && fix, users: users.length, ledgerTotal: national.ledger, problems };
}

/**
 * The audit scans the whole ledger, which blocks the server for seconds on a big database. This runs it on a worker thread with
 * its own connection (SQLite lets readers and the writer work at once). An in-memory database cannot be shared, so tests and
 * development run it inline.
 */
export function auditAsync() {
  const t0 = Date.now();
  if (!process.env.DB_PATH || process.env.DB_PATH === ':memory:') return Promise.resolve({ ...audit(), ms: Date.now() - t0 });
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./audit-worker.js', import.meta.url));
    w.once('message', (r) => resolve({ ...r, ms: Date.now() - t0 }));
    w.once('error', reject);
    w.once('exit', (c) => { if (c !== 0) reject(new Error(`audit worker exited with ${c}`)); });
  });
}

if (process.argv[1]?.endsWith('audit.js')) {
  const r = audit({ fix: process.argv.includes('--fix') });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok || r.fixed ? 0 : 1);
}
