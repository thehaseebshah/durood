// Profile: display name, a one-line bio, a profile picture, a password change and a change of WhatsApp number.
import { mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { db, tx } from './db.js';
import { HttpError, avatarUrl, avatarSig, hashPassword, checkPassword, sameSecret } from './auth.js';
import { deleteHooks } from './game.js';
import { cleanJpeg, UPLOAD_DIR } from './sunnah.js';
import { LINK } from './feed.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
mkdirSync(AVATAR_DIR, { recursive: true });
export const NAME_MAX = 40, BIO_MAX = 100, AVATAR_MAX_BYTES = 60_000;
const avatarPath = (id, v) => path.join(AVATAR_DIR, `${id}-${v}.jpg`);
const rm = (f) => { try { unlinkSync(f); } catch { /* already gone */ } };

/** Plain one-line text: control characters out, spaces squeezed, no links. Empty is allowed (it clears the field). */
function plain(raw, max, min = 0) {
  const t = String(raw ?? '').replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  const len = [...t].length;
  if (len && len < min) throw new HttpError(400, 'text_too_short');
  if (len > max) throw new HttpError(400, 'text_too_long');
  if (LINK.test(t)) throw new HttpError(400, 'no_links');
  return t;
}

export function updateProfile(userId, { displayName, bio }) {
  const name = displayName === undefined ? undefined : plain(displayName, NAME_MAX, 2);
  const b = bio === undefined ? undefined : plain(bio, BIO_MAX);
  if (name !== undefined) run('UPDATE users SET display_name = ? WHERE id = ?', name, userId);
  if (b !== undefined) run('UPDATE users SET bio = ? WHERE id = ?', b, userId);
  return { ok: true };
}

// ---- the picture ------------------------------------------------------------------------------------------------------------------
/** The browser sends a small square JPEG (about 20 KB). Metadata is stripped and the file is rebuilt; a new upload is a new version. */
export function setAvatar(userId, imageB64) {
  const raw = String(imageB64 ?? '').replace(/^data:image\/jpeg;base64,/, '');
  if (!raw || raw.length > Math.ceil(AVATAR_MAX_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+=*$/.test(raw)) throw new HttpError(400, 'bad_image');
  const { data } = cleanJpeg(Buffer.from(raw, 'base64'), { maxBytes: AVATAR_MAX_BYTES, minDim: 64, maxDim: 512 });
  return tx(() => {
    const cur = one('SELECT avatar_v v FROM users WHERE id = ?', userId).v;
    const v = Math.abs(cur) + 1;
    const f = avatarPath(userId, v), tmp = `${f}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, f);
    run('UPDATE users SET avatar_v = ?, avatar_at = ? WHERE id = ?', v, Date.now(), userId);
    if (cur > 0) rm(avatarPath(userId, cur));
    return { avatar: avatarUrl(userId, v) };
  });
}
export function removeAvatar(userId) {
  const cur = one('SELECT avatar_v v FROM users WHERE id = ?', userId).v;
  if (cur > 0) { run('UPDATE users SET avatar_v = ? WHERE id = ?', -cur, userId); rm(avatarPath(userId, cur)); }
  return { ok: true };
}
/** The file for a signed picture address, or null. Only the member's current picture is served. */
export function avatarFile(id, v, sig) {
  if (!Number.isInteger(id) || !Number.isInteger(v) || !sameSecret(String(sig), avatarSig(id, v))) return null;
  const u = one('SELECT avatar_v, deleted_at, suspended FROM users WHERE id = ?', id);
  if (!u || u.avatar_v !== v || u.deleted_at || u.suspended) return null;
  const f = avatarPath(id, v);
  return existsSync(f) ? f : null;
}
export const readAvatar = (f) => readFileSync(f);
deleteHooks.push((userId) => { const v = one('SELECT avatar_v v FROM users WHERE id = ?', userId)?.v; if (v > 0) rm(avatarPath(userId, v)); });

// ---- password and phone -------------------------------------------------------------------------------------------------------------
/**
 * Changes the password after checking the current one. Every other device is signed out (the token version moves on); the caller
 * gets a fresh session for this one. Password-reset links that were still open stop working.
 */
export async function changePassword(userId, current, next) {
  const u = one('SELECT pass FROM users WHERE id = ?', userId);
  if (!(await checkPassword(String(current ?? ''), u.pass))) throw new HttpError(403, 'wrong_password');
  const pw = String(next ?? '');
  if (pw.length < 6 || pw.length > 128) throw new HttpError(400, 'bad_password');
  if (pw === String(current)) throw new HttpError(400, 'same_password');
  const hash = await hashPassword(pw);
  tx(() => {
    run('UPDATE users SET pass = ?, token_ver = token_ver + 1 WHERE id = ?', hash, userId);
    run("UPDATE tokens SET used_at = ? WHERE user_id = ? AND kind = 'reset' AND used_at IS NULL", Date.now(), userId);
  });
  return { ok: true };
}

/** Writes a new, already-normalised number. The old Mamulaat match no longer applies, so this member's murabbi link and numbers start over. */
export function setPhone(userId, phone) {
  return tx(() => {
    const cur = one('SELECT phone FROM users WHERE id = ?', userId).phone;
    if (cur === phone) throw new HttpError(400, 'no_change');
    if (one('SELECT 1 FROM users WHERE phone = ? AND id != ?', phone, userId)) throw new HttpError(409, 'phone_taken');
    run('UPDATE users SET phone = ?, phone_changed_at = ? WHERE id = ?', phone, Date.now(), userId);
    run('DELETE FROM murabbi_links WHERE user_id = ?', userId);
    run('DELETE FROM mamulaat_days WHERE user_id = ?', userId);
    run('DELETE FROM mamulaat_sync WHERE user_id = ?', userId);
    run("DELETE FROM burhan_views WHERE subject_id = ? AND kind = 'murabbi'", userId);
    return { ok: true };
  });
}

// ---- what anyone in the app may see ---------------------------------------------------------------------------------------------------
export function publicProfile(username) {
  const u = one(`SELECT id, username, display_name, bio, avatar_v, city, created_day, xp, streak, last_day, shields, total, hidden_from_ranks, held FROM users WHERE username = ? AND deleted_at IS NULL AND suspended = 0`, String(username ?? ''));
  if (!u) throw new HttpError(404, 'not_found');
  const cv = one('SELECT c.name FROM caravan_members cm JOIN caravans c ON c.id = cm.caravan_id WHERE cm.user_id = ?', u.id);
  // what the public boards already show: level, a streak that is still running, badges, and durood (only while it counts on the boards)
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  const gap = u.last_day ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${u.last_day}T00:00:00Z`)) / 864e5) : null;
  const streak = gap === 0 || gap === 1 || (gap === 2 && u.shields > 0) ? u.streak : 0;
  const onBoards = !u.hidden_from_ranks && !u.held;
  const badges = db.prepare('SELECT code FROM badges WHERE user_id = ? ORDER BY earned_at DESC LIMIT 6').all(u.id).map((b) => b.code);
  return { username: u.username, displayName: u.display_name, bio: u.bio, avatar: avatarUrl(u.id, u.avatar_v), city: u.city, joined: u.created_day, caravan: cv?.name ?? null,
    level: Math.floor(Math.sqrt(Math.max(0, u.xp) / 100)) + 1, streak, badges, total: onBoards ? u.total : null };
}

// ---- moderation (admin) ---------------------------------------------------------------------------------------------------------------
/** Every moderation action is written down: who or what it touched, and what the admin did. */
export const logAdmin = (action, target, detail = '', actor = '') => { run('INSERT INTO admin_log (at, action, target, detail, actor) VALUES (?,?,?,?,?)', Date.now(), action, String(target).slice(0, 80), String(detail).slice(0, 300), String(actor).slice(0, 40)); };
export const adminLog = (limit = 40) => db.prepare('SELECT at, action, target, detail, actor FROM admin_log ORDER BY id DESC LIMIT ?').all(limit);

/** Pictures and names to look at: newest pictures first, or members with a name or line, or a search by username, name, bio or city. */
export function adminProfiles({ q = '', filter = 'photos' } = {}) {
  const s = String(q).trim().slice(0, 40);
  const like = `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const where = [s ? "(u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.bio LIKE ? ESCAPE '\\' OR u.city LIKE ? ESCAPE '\\')" : '1=1',
    filter === 'photos' ? 'u.avatar_v > 0' : filter === 'text' ? "(u.display_name != '' OR u.bio != '')" : '1=1', 'u.deleted_at IS NULL'].join(' AND ');
  const args = s ? [like, like, like, like] : [];
  const order = filter === 'photos' ? 'COALESCE(u.avatar_at, 0) DESC, u.id DESC' : 'u.id DESC';
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.bio, u.avatar_v, u.avatar_at, u.city, u.created_day, u.suspended FROM users u WHERE ${where} ORDER BY ${order} LIMIT 60`).all(...args)
    .map((u) => ({ username: u.username, displayName: u.display_name, bio: u.bio, avatar: avatarUrl(u.id, u.avatar_v), avatarAt: u.avatar_at, city: u.city, joined: u.created_day, suspended: !!u.suspended }));
}
