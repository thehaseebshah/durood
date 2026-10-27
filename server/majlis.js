// Majalis: a member may belong to one; a member can propose a new one, which an admin approves.
// Majalis are ranked each week like cities.
import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import { weekStart, hooks } from './game.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

db.exec(`CREATE TABLE IF NOT EXISTS majalis (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name_ur     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','pending','rejected')),
  proposed_by INTEGER REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
)`);
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'majlis_id')) db.exec('ALTER TABLE users ADD COLUMN majlis_id INTEGER REFERENCES majalis(id)');

// the default majalis, there from the start ('Ilm e Deen' is now 'Taleem'; 'Other' catches everyone else)
export const DEFAULT_MAJALIS = [['Shabab', 'شباب'], ['Taleem', 'تعلیم'], ['Jamiaat', 'جامعات'], ['Tameeraat', 'تعمیرات'], ['Seerat', 'سیرت'],
  ['Islaah', 'اصلاح'], ['Atfaal', 'اطفال'], ['Qabail', 'قبائل'], ['Aamilah', 'عاملہ'], ['Finance', 'فنانس'], ['Nashriaat', 'نشریات'], ['Other', 'دیگر']];
// a database made before the rename keeps its members: the same row gets the new name
run("UPDATE majalis SET name = 'Taleem', name_ur = 'تعلیم' WHERE name = 'Ilm e Deen' AND NOT EXISTS (SELECT 1 FROM majalis WHERE name = 'Taleem')");
for (const [name, ur] of DEFAULT_MAJALIS) run("INSERT OR IGNORE INTO majalis (name, name_ur, status, created_at) VALUES (?, ?, 'approved', ?)", name, ur, Date.now());

const out = (m) => m && { id: m.id, name: m.name, nameUr: m.name_ur };
export const majlisOf = (userId) => out(one('SELECT m.* FROM users u JOIN majalis m ON m.id = u.majlis_id WHERE u.id = ?', userId));
hooks.majlis = majlisOf;

/** Approved majalis with how many members each has, and the member's own pending proposal if any. */
export function listMajalis(userId) {
  const list = all(`SELECT m.*, (SELECT COUNT(*) FROM users u WHERE u.majlis_id = m.id AND u.deleted_at IS NULL) members
    FROM majalis m WHERE m.status = 'approved' ORDER BY m.id`).map((m) => ({ ...out(m), members: m.members }));
  const mine = one("SELECT name, status FROM majalis WHERE proposed_by = ? AND status != 'approved' ORDER BY created_at DESC LIMIT 1", userId);
  return { majalis: list, mine: majlisOf(userId), proposal: mine ? { name: mine.name, status: mine.status } : null };
}

/** The approved majalis, for the sign-up page (no sign-in needed). */
export const publicMajalis = () => all("SELECT id, name, name_ur FROM majalis WHERE status = 'approved' ORDER BY name = 'Other', id").map((m) => ({ id: m.id, name: m.name, nameUr: m.name_ur }));

const cleanMajlisName = (raw, max = 40) => String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/**
 * A new majlis made by a member: no approval. If one with that name already exists the member simply joins it, so nobody can
 * start a second 'Finance'. Call inside a transaction (sign-up) or on its own. Returns the majlis id.
 */
export function createMajlis(userId, rawName, rawUr = '') {
  const name = cleanMajlisName(rawName), ur = cleanMajlisName(rawUr);
  if ([...name].length < 2 || /(https?:\/\/|www\.)/i.test(name) || /(https?:\/\/|www\.)/i.test(ur)) throw new HttpError(400, 'bad_majlis');
  const have = one("SELECT id FROM majalis WHERE name = ? AND status = 'approved'", name);
  if (have) return have.id;
  if (one("SELECT 1 FROM majalis WHERE name = ?", name)) throw new HttpError(409, 'majlis_taken'); // an old rejected or pending row with that name
  if (one("SELECT COUNT(*) n FROM majalis WHERE proposed_by = ?", userId).n >= 3) throw new HttpError(429, 'majlis_limit'); // a member can start a few, not hundreds
  return Number(run("INSERT INTO majalis (name, name_ur, status, proposed_by, created_at, decided_at) VALUES (?, ?, 'approved', ?, ?, ?)", name, ur, userId, Date.now(), Date.now()).lastInsertRowid);
}

/** Join an approved majlis, or leave (id null). */
export function setMajlis(userId, id) {
  if (id == null || id === '') { run('UPDATE users SET majlis_id = NULL WHERE id = ?', userId); return { ok: true }; }
  if (!one("SELECT 1 FROM majalis WHERE id = ? AND status = 'approved'", Number(id))) throw new HttpError(404, 'not_found');
  run('UPDATE users SET majlis_id = ? WHERE id = ?', Number(id), userId);
  return { ok: true };
}

/** A member starts a new majlis (no approval) and joins it. */
export function proposeMajlis(userId, rawName, rawUr = '') {
  return tx(() => {
    const id = createMajlis(userId, rawName, rawUr);
    run('UPDATE users SET majlis_id = ? WHERE id = ?', id, userId);
    return { ok: true, id };
  });
}

export const adminMajalis = () => all(`SELECT m.id, m.name, m.name_ur, m.status, m.created_at at, u.username proposer,
    (SELECT COUNT(*) FROM users x WHERE x.majlis_id = m.id AND x.deleted_at IS NULL) members
  FROM majalis m LEFT JOIN users u ON u.id = m.proposed_by ORDER BY m.status = 'pending' DESC, m.id`);
export function decideMajlis(id, approve) {
  const m = one("SELECT * FROM majalis WHERE id = ? AND status = 'pending'", Number(id));
  if (!m) throw new HttpError(404, 'not_found');
  tx(() => {
    run('UPDATE majalis SET status = ?, decided_at = ? WHERE id = ?', approve ? 'approved' : 'rejected', Date.now(), m.id);
    if (approve && m.proposed_by) run('UPDATE users SET majlis_id = ? WHERE id = ? AND majlis_id IS NULL', m.id, m.proposed_by); // the proposer joins it
  });
  return { ok: true, name: m.name };
}

// ---- the weekly Majlis board, like the city board: total, average per active member, growth over last week ----------------------
const MIN_ACTIVE = () => Number(process.env.MAJLIS_MIN_ACTIVE) || 3;
const dayStrOf = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10);
export function majlisBoard(userId, metric = 'total') {
  const wk = weekStart(), prev = dayStrOf(wk);
  const rows = all(`WITH w AS (
      SELECT d.user_id, SUM(CASE WHEN d.day >= ? THEN d.count ELSE 0 END) wk, SUM(CASE WHEN d.day < ? THEN d.count ELSE 0 END) last,
             MAX(CASE WHEN d.day >= ? AND d.count > 0 THEN 1 ELSE 0 END) active
      FROM daily d JOIN users hu ON hu.id = d.user_id AND hu.held = 0 WHERE d.day >= ? GROUP BY d.user_id)
    SELECT m.id, m.name, m.name_ur, SUM(w.wk) week, SUM(w.last) last, SUM(w.active) active,
           (SELECT COUNT(*) FROM users x WHERE x.majlis_id = m.id AND x.deleted_at IS NULL) members
    FROM w JOIN users u ON u.id = w.user_id AND u.deleted_at IS NULL AND u.suspended = 0 JOIN majalis m ON m.id = u.majlis_id AND m.status = 'approved'
    GROUP BY m.id HAVING SUM(w.active) >= ?`, wk, wk, wk, prev, MIN_ACTIVE())
    .map((r) => ({ majlisId: r.id, username: r.name, nameUr: r.name_ur, members: r.members, active: r.active,
      score: metric === 'growth' ? r.week - r.last : metric === 'average' ? Math.round(r.week / r.active) : r.week }))
    .filter((r) => (metric === 'growth' ? r.score !== 0 : r.score > 0))
    .sort((x, y) => y.score - x.score || x.username.localeCompare(y.username));
  const mine = one('SELECT majlis_id FROM users WHERE id = ?', userId)?.majlis_id ?? null;
  return { rows: rows.map((r, i) => ({ rank: i + 1, ...r, me: r.majlisId === mine })), weekStart: wk, metric, minActive: MIN_ACTIVE() };
}
