import { db, getSetting, setSetting } from './db.js';
import { HttpError } from './auth.js';
import { dayNum, hooks } from './game.js';
import { sendPush, vapidPublicKey } from './push.js';
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
  run('DELETE FROM push_subs WHERE user_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC LIMIT 5)', userId, userId); // a few devices per member
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
  joined: (who) => ({ en: ['Someone joined your Qabila', `${who} joined with your code.`], ur: ['آپ کے قبیلے میں کوئی شامل ہوا', `${who} آپ کے کوڈ سے شامل ہوا۔`] }),
  cvInvite: (who, cv) => ({ en: ['A caravan invitation', `${who} invited you to the caravan ${cv}.`], ur: ['کارواں کی دعوت', `${who} نے آپ کو کارواں ${cv} میں مدعو کیا۔`] }),
  cvRequest: (who, cv) => ({ en: ['Someone wants to join your caravan', `${who} asked to join ${cv}.`], ur: ['کوئی آپ کے کارواں میں آنا چاہتا ہے', `${who} نے ${cv} میں شامل ہونے کی درخواست کی۔`] }),
  dueAsk: (who, task) => ({ en: ['A deadline change was asked', `${who} asks for more time on "${task}".`], ur: ['مدت بدلنے کی درخواست', `${who} نے "${task}" کے لیے مزید وقت مانگا ہے۔`] }),
  cvAccepted: (who, cv) => ({ en: ['You are in the caravan', `${who} accepted you into ${cv}.`], ur: ['آپ کارواں میں شامل ہو گئے', `${who} نے آپ کو ${cv} میں شامل کر لیا۔`] }),
  cvJoined: (who, cv) => ({ en: ['Someone joined your caravan', `${who} joined ${cv}.`], ur: ['آپ کے کارواں میں کوئی شامل ہوا', `${who} ${cv} میں شامل ہو گئے۔`] }),
  crore: (k) => ({ en: [`${k} crore reached`, `Together we have recited ${k} crore durood in the challenge.`], ur: [`${k} کروڑ مکمل`, `سب نے مل کر چیلنج میں ${k} کروڑ درود پڑھ لیا۔`] }),
  caravan: { en: ['Your caravan reached a milestone', 'Open the app to see the new badge.'], ur: ['آپ کے کارواں نے سنگِ میل عبور کیا', 'نیا بیج دیکھنے کے لیے ایپ کھولیں۔'] },
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
  let sent = 0, failed = 0;
  for (const s of subs) {
    const r = await sender(s, payload);
    if (r === 'gone') run('DELETE FROM push_subs WHERE endpoint = ?', s.endpoint);
    else if (r === 'ok') sent += 1;
    else failed += 1;
  }
  // every device failed (push service down, network): forget that we tried so the next run retries, a few times at most
  if (!sent && failed) {
    const k = `${userId}|${kind}|${ref}`, n = (attempts.get(k) || 0) + 1;
    attempts.set(k, n);
    if (attempts.size > 5000) attempts.clear();
    if (n < MAX_ATTEMPTS) run('DELETE FROM push_log WHERE user_id = ? AND kind = ? AND ref = ?', userId, kind, String(ref));
  }
  return sent;
}
const attempts = new Map(), MAX_ATTEMPTS = 4;
async function notifyAll(ref, message) {
  const ids = all('SELECT DISTINCT user_id FROM push_subs').map((r) => r.user_id);
  for (let i = 0; i < ids.length; i += SEND_POOL) await Promise.all(ids.slice(i, i + SEND_POOL).map((id) => notify(id, 'broadcast', ref, message)));
}

/**
 * The scheduled part. Run once a minute: the daily reminder at each member's chosen time, and a streak warning at 20:00
 * Pakistan time for anyone whose streak of two or more days would break tonight.
 */
export async function runReminders(now = Date.now()) {
  const hm = new Date(now + 5 * 3600e3).toISOString().slice(11, 16);
  const day = new Date(now + 5 * 3600e3).toISOString().slice(0, 10);
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const rows = all(`SELECT DISTINCT u.id, u.reminder_time, u.streak, u.last_day FROM users u JOIN push_subs p ON p.user_id = u.id
                    WHERE u.suspended = 0 AND u.deleted_at IS NULL`);
  const jobs = [];
  for (const u of rows) {
    if (u.last_day === day) continue; // already recited today
    // the daily reminder is for the three hours after the chosen time: a member who sets 07:30 at 21:00 is not pinged at once
    if (u.reminder_time && mins(hm) >= mins(u.reminder_time) && mins(hm) < mins(u.reminder_time) + REMIND_WINDOW_MIN) jobs.push(() => notify(u.id, 'remind', day, MSG.remind));
    if (hm >= '20:00' && u.streak >= 2 && u.last_day && dayNum(day) - dayNum(u.last_day) === 1) jobs.push(() => notify(u.id, 'streak', day, MSG.streak));
  }
  let sent = 0;
  for (let i = 0; i < jobs.length; i += SEND_POOL) sent += (await Promise.all(jobs.slice(i, i + SEND_POOL).map((j) => j()))).reduce((a, b) => a + b, 0);
  return sent;
}
const REMIND_WINDOW_MIN = 180, SEND_POOL = 10;

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
    try { ensureWeekClosed(); } catch (e) { console.error('week close', e); }
    nightlyAudit().catch((e) => console.error('audit', e));
  };
  const h = setInterval(housekeeping, 3600e3);
  h.unref();
  setTimeout(housekeeping, 30_000).unref();
  return t;
}

// ---- event-driven messages --------------------------------------------------------------------------------------
export const notifyJoined = (referrerId, who) => notify(referrerId, 'joined', who, MSG.joined(who)).catch(() => {});
/** Caravan events: an invitation reaches the invitee, a request or a new member reaches the owner. Sent after the answer, never awaited. */
/** A razakar asks their masul to move a deadline. */
export function notifyDueRequest(masulId, who, task) { setImmediate(() => notify(masulId, 'due_ask', `${who}:${task}:${Date.now()}`, MSG.dueAsk(who, task)).catch(() => {})); }
export function notifyCaravan(kind, toId, who, caravanName) {
  if (!toId) return;
  const make = { invite: MSG.cvInvite, request: MSG.cvRequest, joined: MSG.cvJoined, accepted: MSG.cvAccepted }[kind];
  setImmediate(() => notify(toId, `cv_${kind}`, `${who}:${caravanName}:${Date.now()}`, make(who, caravanName)).catch(() => {}));
}
hooks.milestone = (k) => setImmediate(() => notifyAll(`crore:${k}`, (lang) => pack(MSG.crore(k), lang, 'crore')).catch(() => {}));
hooks.badge = (userId, code) => setImmediate(() => notify(userId, 'caravan', code, MSG.caravan).catch(() => {}));

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
  if (kind === 'qabilas') {
    return toCsv(['qabila_root', 'city', 'members_below', 'qabila_total'], all(`SELECT u.username, u.city, (SELECT COUNT(*) FROM ancestors a WHERE a.ancestor_id = u.id AND a.depth > 0) m, u.team_total t
      FROM users u WHERE u.referrer_id IS NULL AND u.deleted_at IS NULL AND EXISTS (SELECT 1 FROM users c WHERE c.referrer_id = u.id) ORDER BY t DESC`).map((r) => [r.username, r.city, r.m, r.t]));
  }
  if (kind === 'weeks') {
    return toCsv(['week_start', 'active_members', 'durood_total'], all(`SELECT date(julianday(day) - ((CAST(strftime('%w', day) AS INTEGER) + 6) % 7)) w, COUNT(DISTINCT user_id) m, SUM(count) t
      FROM daily GROUP BY w ORDER BY w DESC`).map((r) => [r.w, r.m, r.t]));
  }
  throw new HttpError(400, 'bad_export');
}
