import { db } from './db.js';
import { HttpError } from './auth.js';
import { dayOf, dayNum, hooks } from './game.js';
import { sendPush, vapidPublicKey } from './push.js';
import { purgeOldPhotos } from './sunnah.js';
import { backupIfDue } from './backup.js';

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

export function postNews({ title_en, title_ur, body_en, body_ur, push }) {
  const te = String(title_en || '').trim();
  if (!te || te.length > 120) throw new HttpError(400, 'bad_news');
  const r = run('INSERT INTO announcements (title_en, title_ur, body_en, body_ur, created_at) VALUES (?,?,?,?,?)',
    te, String(title_ur || '').trim().slice(0, 120), String(body_en || '').trim().slice(0, 600), String(body_ur || '').trim().slice(0, 600), Date.now());
  const id = Number(r.lastInsertRowid);
  if (push) notifyAll(`news:${id}`, (lang) => ({ title: lang === 'ur' ? (title_ur || te) : te, body: lang === 'ur' ? (body_ur || body_en || '') : (body_en || ''), tag: 'news' }));
  return { id };
}
export const deleteNews = (id) => { run('DELETE FROM announcements WHERE id = ?', id); return { ok: true }; };

// ---- push -------------------------------------------------------------------------------------------------------
export const pushKey = () => ({ key: vapidPublicKey() });

// A subscription is a URL the server will POST to, so it must be a real browser push service, never an arbitrary address.
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'push.apple.com', 'notify.windows.com', 'wns.windows.com'];
export function allowedPushEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const extra = (process.env.PUSH_HOSTS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return [...PUSH_HOSTS, ...extra].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

export function subscribe(userId, sub) {
  const ok = sub && typeof sub.endpoint === 'string' && sub.endpoint.length < 1000 && allowedPushEndpoint(sub.endpoint)
    && typeof sub.keys?.p256dh === 'string' && typeof sub.keys?.auth === 'string';
  if (!ok) throw new HttpError(400, 'bad_subscription');
  run(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth, Date.now());
  return { ok: true };
}
export const unsubscribe = (userId) => { run('DELETE FROM push_subs WHERE user_id = ?', userId); return { ok: true }; };

export function setReminder(userId, value) {
  const v = String(value ?? '');
  if (v !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new HttpError(400, 'bad_time');
  run('UPDATE users SET reminder_time = ? WHERE id = ?', v, userId);
}

// Every push goes through this seam so tests can capture messages instead of calling a push service.
let sender = sendPush;
export const setSender = (fn) => { sender = fn || sendPush; };

const MSG = {
  remind: { en: ['Time for durood', 'Take a moment to send salawat on the Prophet ﷺ today.'], ur: ['درود کا وقت', 'آج نبی ﷺ پر درود بھیجنے کے لیے کچھ لمحے نکالیں۔'] },
  streak: { en: ['Your streak is about to break', 'You have not recited today. A few durood keep your streak alive.'], ur: ['آپ کا سلسلہ ٹوٹنے والا ہے', 'آج آپ نے درود نہیں پڑھا۔ چند درود سے سلسلہ قائم رہتا ہے۔'] },
  joined: (who) => ({ en: ['Someone joined your caravan', `${who} joined with your code.`], ur: ['آپ کے قافلے میں کوئی شامل ہوا', `${who} آپ کے کوڈ سے شامل ہوا۔`] }),
  crore: (k) => ({ en: [`${k} crore reached`, `Together we have recited ${k} crore durood in the challenge.`], ur: [`${k} کروڑ مکمل`, `سب نے مل کر چیلنج میں ${k} کروڑ درود پڑھ لیا۔`] }),
  caravan: { en: ['Your caravan reached a milestone', 'Open the app to see the new badge.'], ur: ['آپ کے قافلے نے سنگِ میل عبور کیا', 'نیا بیج دیکھنے کے لیے ایپ کھولیں۔'] },
};
const pack = (m, lang, tag) => ({ title: m[lang][0], body: m[lang][1], tag, url: '/' });

/** Sends to every device of one member unless this (kind, ref) already went out. Dead subscriptions are removed. */
export async function notify(userId, kind, ref, message) {
  const u = one('SELECT lang, suspended, deleted_at FROM users WHERE id = ?', userId);
  if (!u || u.suspended || u.deleted_at) return 0;
  const subs = all('SELECT * FROM push_subs WHERE user_id = ?', userId);
  if (!subs.length) return 0;
  if (!run('INSERT OR IGNORE INTO push_log (user_id, kind, ref, at) VALUES (?,?,?,?)', userId, kind, String(ref), Date.now()).changes) return 0;
  const payload = typeof message === 'function' ? message(u.lang) : pack(message, u.lang, kind);
  let sent = 0;
  for (const s of subs) {
    const r = await sender(s, payload);
    if (r === 'gone') run('DELETE FROM push_subs WHERE endpoint = ?', s.endpoint);
    else if (r === 'ok') sent += 1;
  }
  return sent;
}
async function notifyAll(ref, message) {
  for (const { user_id } of all('SELECT DISTINCT user_id FROM push_subs')) await notify(user_id, 'broadcast', ref, message);
}

/**
 * The scheduled part. Run once a minute: the daily reminder at each member's chosen time, and a streak warning at 20:00
 * Pakistan time for anyone whose streak of two or more days would break tonight.
 */
export async function runReminders(now = Date.now()) {
  const hm = new Date(now + 5 * 3600e3).toISOString().slice(11, 16);
  const day = new Date(now + 5 * 3600e3).toISOString().slice(0, 10);
  const rows = all(`SELECT DISTINCT u.id, u.reminder_time, u.streak, u.last_day FROM users u JOIN push_subs p ON p.user_id = u.id
                    WHERE u.suspended = 0 AND u.deleted_at IS NULL`);
  let sent = 0;
  for (const u of rows) {
    if (u.last_day === day) continue; // already recited today
    if (u.reminder_time && hm >= u.reminder_time) sent += await notify(u.id, 'remind', day, MSG.remind);
    if (hm >= '20:00' && u.streak >= 2 && u.last_day && dayNum(day) - dayNum(u.last_day) === 1) sent += await notify(u.id, 'streak', day, MSG.streak);
  }
  return sent;
}

export function startScheduler() {
  // one run at a time: a slow push service must not stack runs on top of each other
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runReminders(); } catch (e) { console.error('reminders', e); } finally { busy = false; }
  };
  const t = setInterval(tick, 60_000);
  t.unref();
  // hourly housekeeping: delete old photos, take the nightly backup when due
  const housekeeping = () => {
    try { purgeOldPhotos(); } catch (e) { console.error('photo purge', e); }
    try { backupIfDue(); } catch (e) { console.error('backup', e); }
  };
  const h = setInterval(housekeeping, 3600e3);
  h.unref();
  setTimeout(housekeeping, 30_000).unref();
  return t;
}

// ---- event-driven messages --------------------------------------------------------------------------------------
export const notifyJoined = (referrerId, who) => notify(referrerId, 'joined', who, MSG.joined(who)).catch(() => {});
hooks.milestone = (k) => setImmediate(() => notifyAll(`crore:${k}`, (lang) => pack(MSG.crore(k), lang, 'crore')).catch(() => {}));
hooks.badge = (userId, code) => setImmediate(() => notify(userId, 'caravan', code, MSG.caravan).catch(() => {}));

// ---- admin exports (CSV) ----------------------------------------------------------------------------------------
const csvCell = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) || /[",\n]/.test(s) ? `"${(/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
const toCsv = (head, rows) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

/** Totals as reported. Deleted members stay in the totals (their durood stays on the record) under a blank city. */
export function exportCsv(kind) {
  if (kind === 'cities') {
    return toCsv(['city', 'members', 'durood_total'], all(`SELECT COALESCE(NULLIF(city, ''), '(none)') c, COUNT(*) m, SUM(total) t FROM users GROUP BY c ORDER BY t DESC`).map((r) => [r.c, r.m, r.t]));
  }
  if (kind === 'caravans') {
    return toCsv(['caravan_owner', 'city', 'members_below', 'caravan_total'], all(`SELECT u.username, u.city, (SELECT COUNT(*) FROM ancestors a WHERE a.ancestor_id = u.id AND a.depth > 0) m, u.team_total t
      FROM users u WHERE u.referrer_id IS NULL AND u.deleted_at IS NULL AND EXISTS (SELECT 1 FROM users c WHERE c.referrer_id = u.id) ORDER BY t DESC`).map((r) => [r.username, r.city, r.m, r.t]));
  }
  if (kind === 'weeks') {
    return toCsv(['week_start', 'active_members', 'durood_total'], all(`SELECT date(julianday(day) - ((CAST(strftime('%w', day) AS INTEGER) + 6) % 7)) w, COUNT(DISTINCT user_id) m, SUM(count) t
      FROM daily GROUP BY w ORDER BY w DESC`).map((r) => [r.w, r.m, r.t]));
  }
  throw new HttpError(400, 'bad_export');
}
