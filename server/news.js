import { db, getSetting, setSetting } from './db.js';
import { HttpError } from './auth.js';
import { purgeOldPhotos } from './sunnah.js';
import { backupIfDue } from './backup.js';
import { auditAsync } from './audit.js';
import { ensureWeekClosed } from './compete.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

// ---- announcements ---------------------------------------------------------------------------------------------
export function listNews(userId) {
  const seen = one('SELECT news_seen_at s FROM users WHERE id = ?', userId).s;
  const items = all('SELECT * FROM announcements ORDER BY id DESC LIMIT 50')
    .map((a) => ({ id: a.id, titleEn: a.title_en, titleUr: a.title_ur, bodyEn: a.body_en, bodyUr: a.body_ur, at: a.created_at, unread: a.created_at > seen }));
  return { items, unread: items.filter((i) => i.unread).length };
}
export const markNewsSeen = (userId) => { run('UPDATE users SET news_seen_at = ? WHERE id = ?', Date.now(), userId); return { ok: true }; };

export function postNews({ title_en, title_ur, body_en, body_ur }) {
  const te = String(title_en || '').trim();
  if (!te || te.length > 120) throw new HttpError(400, 'bad_news');
  const r = run('INSERT INTO announcements (title_en, title_ur, body_en, body_ur, created_at) VALUES (?,?,?,?,?)',
    te, String(title_ur || '').trim().slice(0, 120), String(body_en || '').trim().slice(0, 600), String(body_ur || '').trim().slice(0, 600), Date.now());
  return { id: Number(r.lastInsertRowid) };
}
export const deleteNews = (id) => { run('DELETE FROM announcements WHERE id = ?', id); return { ok: true }; };

/** After 03:00 Pakistan time, once a day: re-check every total against the ledger on a worker thread (never blocks members). */
export async function nightlyAudit(now = Date.now()) {
  const day = new Date(now + 5 * 3600e3).toISOString().slice(0, 10);
  if (new Date(now + 5 * 3600e3).getUTCHours() < 3 || getSetting('last_audit_day') === day) return null;
  setSetting('last_audit_day', day);
  const r = await auditAsync();
  setSetting('last_audit', JSON.stringify({ at: Date.now(), ok: r.ok, problems: r.problems.length, ms: r.ms }));
  if (!r.ok) console.error(`NIGHTLY AUDIT FOUND ${r.problems.length} PROBLEM(S):`, JSON.stringify(r.problems.slice(0, 5)));
  return r;
}

/** Hourly housekeeping: delete old photos, take the nightly backup when due, close finished weeks, run the nightly audit. */
export function startScheduler() {
  const housekeeping = () => {
    try { purgeOldPhotos(); } catch (e) { console.error('photo purge', e); }
    try { backupIfDue(); } catch (e) { console.error('backup', e); }
    try { ensureWeekClosed(); } catch (e) { console.error('week close', e); }
    nightlyAudit().catch((e) => console.error('audit', e));
  };
  const h = setInterval(housekeeping, 3600e3);
  h.unref();
  setTimeout(housekeeping, 30_000).unref();
  return h;
}

// ---- admin exports (CSV) ----------------------------------------------------------------------------------------
const csvCell = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) || /[",\n]/.test(s) ? `"${(/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
const toCsv = (head, rows) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

/** Totals as reported. Deleted members stay in the totals (their durood stays on the record) under a blank city. */
export function exportCsv(kind) {
  if (kind === 'cities') {
    return toCsv(['city', 'country', 'members', 'durood_total'], all(`SELECT COALESCE(NULLIF(city, ''), '(none)') c, country, COUNT(*) m, SUM(total) t FROM users GROUP BY COALESCE(city_id, city), c, country ORDER BY t DESC`).map((r) => [r.c, r.country, r.m, r.t]));
  }
  if (kind === 'caravans') {
    return toCsv(['caravan', 'owner', 'members', 'durood_total'], all(`SELECT c.name, o.username owner, COUNT(cm.user_id) m, COALESCE(SUM(CASE WHEN u.held = 0 THEN u.total ELSE 0 END), 0) t
      FROM caravans c JOIN users o ON o.id = c.owner_id JOIN caravan_members cm ON cm.caravan_id = c.id JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL GROUP BY c.id ORDER BY t DESC`).map((r) => [r.name, r.owner, r.m, r.t]));
  }
  if (kind === 'weeks') {
    return toCsv(['week_start', 'active_members', 'durood_total'], all(`SELECT date(julianday(day) - ((CAST(strftime('%w', day) AS INTEGER) + 6) % 7)) w, COUNT(DISTINCT user_id) m, SUM(count) t
      FROM daily GROUP BY w ORDER BY w DESC`).map((r) => [r.w, r.m, r.t]));
  }
  throw new HttpError(400, 'bad_export');
}
