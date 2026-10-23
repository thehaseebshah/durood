import { db, tx } from './db.js';
import { CFG } from './game.js';

const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);

const LEDGER_DAILY = 'SELECT user_id, day, SUM(count) s FROM entries GROUP BY user_id, day';

/**
 * Re-derives every statistic from the append-only `entries` ledger and compares it with the stored caches.
 * With { fix: true } the caches are rebuilt from the ledger (the ledger itself is never modified).
 */
export function audit({ fix = false } = {}) {
  const problems = [];
  const note = (kind, detail) => { if (problems.length < 100) problems.push({ kind, ...detail }); };

  const users = all(`SELECT u.id, u.username, u.total, u.team_total, u.xp,
      COALESCE((SELECT SUM(count) FROM entries e WHERE e.user_id = u.id), 0) l_total,
      COALESCE((SELECT SUM(e.count) FROM entries e JOIN ancestors a ON a.user_id = e.user_id
                WHERE a.ancestor_id = u.id AND a.depth <= ?), 0) l_team,
      COALESCE((SELECT SUM(xp) FROM events ev WHERE ev.user_id = u.id), 0) ev_xp
    FROM users u`, CFG.teamMaxDepth);
  for (const u of users) {
    if (u.total !== u.l_total) note('user_total', { user: u.username, stored: u.total, ledger: u.l_total });
    if (u.team_total !== u.l_team) note('team_total', { user: u.username, stored: u.team_total, ledger: u.l_team });
    if (u.xp !== u.l_total + u.ev_xp) note('xp', { user: u.username, stored: u.xp, ledger: u.l_total + u.ev_xp });
  }

  const dailyBad = all(`SELECT d.user_id, d.day, d.count stored, COALESCE(l.s, 0) ledger
      FROM daily d LEFT JOIN (${LEDGER_DAILY}) l ON l.user_id = d.user_id AND l.day = d.day
      WHERE d.count != COALESCE(l.s, 0)
    UNION ALL
    SELECT l.user_id, l.day, 0, l.s FROM (${LEDGER_DAILY}) l
      LEFT JOIN daily d ON d.user_id = l.user_id AND d.day = l.day WHERE d.user_id IS NULL`);
  for (const d of dailyBad) note('daily', d);

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
      db.prepare(`UPDATE users SET team_total = COALESCE((SELECT SUM(e.count) FROM entries e JOIN ancestors a ON a.user_id = e.user_id
                  WHERE a.ancestor_id = users.id AND a.depth <= ?), 0)`).run(CFG.teamMaxDepth);
      db.exec(`UPDATE users SET xp = total + COALESCE((SELECT SUM(xp) FROM events ev WHERE ev.user_id = users.id), 0)`);
    });
  }
  return { ok, fixed: !ok && fix, users: users.length, ledgerTotal: national.ledger, problems };
}

if (process.argv[1]?.endsWith('audit.js')) {
  const r = audit({ fix: process.argv.includes('--fix') });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok || r.fixed ? 0 : 1);
}
