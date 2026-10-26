// Invite-only access: member codes (their username), founder codes, the public founders code, the waitlist.
import crypto from 'node:crypto';
import { db, tx, getSetting, setSetting } from './db.js';
import { HttpError } from './auth.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

// Invites grow four ways, so nobody waits a week for more: what you start with, your level (points), each person you invited
// who really recites (100 durood, the same bar the referral reward uses), and every 7-day streak you have ever reached.
export const CAP = { start: 10, perLevel: 3, perActive: 2, activeMin: 100, perStreak: 10, streakDays: 7 };
export const INVITE_ONLY = () => process.env.INVITE_ONLY !== '0';

// unambiguous alphabet (no 0/O, 1/I/L), shown as XXXX-XXXX
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function genCode() {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
export const normCode = (c) => String(c || '').toUpperCase().replace(/[\s-]/g, '');
export const showCode = (c) => (c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);

const levelOf = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1; // the same curve as game.js levelFor (no import: game.js imports this file)
/** Invites a member may issue, and where they come from. */
export function inviteSources(userId) {
  const u = one('SELECT xp, best_streak FROM users WHERE id = ?', userId) ?? { xp: 0, best_streak: 0 };
  const level = levelOf(u.xp), active = one('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND total >= ?', userId, CAP.activeMin).n;
  const weeks = Math.floor(u.best_streak / CAP.streakDays);
  return { start: CAP.start, level: CAP.perLevel * (level - 1), active: CAP.perActive * active, streak: CAP.perStreak * weeks,
    next: { level: level + 1, levelXp: 100 * level ** 2, streak: CAP.streakDays * (weeks + 1) } };
}
export const invitesUsed = (userId) => one('SELECT COUNT(*) n FROM users WHERE referrer_id = ?', userId).n;
export function inviteStatus(userId) {
  const { next, ...from } = inviteSources(userId);
  const cap = from.start + from.level + from.active + from.streak, used = invitesUsed(userId);
  return { cap, used, left: Math.max(0, cap - used), nextAt: next.streak, from, next, per: { level: CAP.perLevel, active: CAP.perActive, streak: CAP.perStreak } };
}

const pkDay = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); // same Pakistan-time day game.js uses (avoids a circular import)
const publicCap = () => Math.max(0, Math.floor(Number(getSetting('public_daily_cap', process.env.PUBLIC_DAILY_CAP || '200'))) || 0);
const publicToday = () => one("SELECT COUNT(*) n FROM users WHERE invited_via = 'public' AND created_day = ?", pkDay()).n;
export function publicCode() {
  const code = getSetting('public_code');
  return { code: code ? showCode(code) : null, enabled: getSetting('public_enabled', '0') === '1', dailyCap: publicCap(), usedToday: publicToday() };
}
export function setPublicCode({ code, enabled, dailyCap }) {
  if (dailyCap !== undefined) {
    const n = Number(dailyCap);
    if (!Number.isInteger(n) || n < 0 || n > 100_000) throw new HttpError(400, 'bad_cap');
    setSetting('public_daily_cap', String(n));
  }
  if (code !== undefined) {
    const c = code === '' ? genCode() : normCode(code);
    if (!/^[A-Z0-9]{4,20}$/.test(c)) throw new HttpError(400, 'bad_code');
    setSetting('public_code', c);
  } else if (!getSetting('public_code')) setSetting('public_code', genCode());
  if (enabled !== undefined) setSetting('public_enabled', enabled ? '1' : '0');
  return publicCode();
}

/**
 * Works out what an invite code is without using it up.
 * Returns { kind, referrerId?, invite?, label } or throws bad_invite / invite_revoked / invite_full / invite_used.
 */
export function resolveInvite(raw) {
  const text = String(raw || '').trim();
  const code = normCode(text);
  if (!code) throw new HttpError(400, 'bad_invite');

  const inv = one('SELECT * FROM invites WHERE code = ?', code);
  if (inv) {
    if (inv.revoked) throw new HttpError(400, 'invite_revoked');
    if (inv.max_uses != null && inv.uses >= inv.max_uses) throw new HttpError(400, 'invite_used');
    return { kind: inv.kind, invite: inv, code, label: inv.label };
  }

  const pub = getSetting('public_code');
  if (pub && code === pub) {
    if (getSetting('public_enabled', '0') !== '1') throw new HttpError(400, 'bad_invite');
    // the public code is the easiest way to mass-create fake accounts, so only so many can join through it each day
    if (publicToday() >= publicCap()) throw new HttpError(400, 'public_full');
    return { kind: 'public', code, label: '' };
  }

  const m = one('SELECT id, username, suspended, deleted_at FROM users WHERE username = ?', text);
  if (!m || m.suspended || m.deleted_at) throw new HttpError(400, 'bad_invite');
  if (inviteStatus(m.id).left <= 0) throw new HttpError(400, 'invite_full');
  return { kind: 'member', referrerId: m.id, label: m.username };
}

/** Marks a resolved code as used. Call inside the registration transaction, after re-resolving. */
export function consumeInvite(r) {
  if (r.invite) {
    const res = run('UPDATE invites SET uses = uses + 1 WHERE code = ? AND revoked = 0 AND (max_uses IS NULL OR uses < max_uses)', r.code);
    if (!res.changes) throw new HttpError(400, 'invite_used');
  }
}

// ---- admin: codes -----------------------------------------------------------------------------------------
export function createFounderCode({ label = '', maxUses = null } = {}) {
  const code = genCode();
  const max = maxUses == null || maxUses === '' ? null : Math.max(1, Number(maxUses) | 0);
  run('INSERT INTO invites (code, kind, label, max_uses, created_at) VALUES (?,?,?,?,?)', code, 'founder', String(label).slice(0, 60), max, Date.now());
  return { code: showCode(code), label, maxUses: max };
}
export const revokeInvite = (rawCode) => {
  const res = run('UPDATE invites SET revoked = 1 WHERE code = ?', normCode(rawCode));
  if (!res.changes) throw new HttpError(404, 'not_found');
  return { ok: true };
};
export const listInvites = () => all(`SELECT i.*, (SELECT COUNT(*) FROM users u WHERE u.invite_code = i.code) joined FROM invites i ORDER BY i.created_at DESC LIMIT 200`)
  .map((i) => ({ code: showCode(i.code), kind: i.kind, label: i.label, maxUses: i.max_uses, uses: i.uses, joined: i.joined, revoked: !!i.revoked, createdAt: i.created_at }));

// ---- waitlist ---------------------------------------------------------------------------------------------
export function addToWaitlist({ name, phone, email, city }) {
  const dup = one("SELECT id FROM waitlist WHERE phone = ? AND status IN ('pending','approved')", phone);
  if (!dup) run('INSERT INTO waitlist (name, phone, email, city, created_at) VALUES (?,?,?,?,?)', String(name).trim().slice(0, 80), phone, String(email || '').trim().slice(0, 120), String(city || '').trim().slice(0, 40), Date.now());
  return { ok: true }; // same answer whether or not it was a repeat, so the form can't be used to probe numbers
}
export const listWaitlist = (status = 'pending') => all('SELECT * FROM waitlist WHERE status = ? ORDER BY created_at ASC LIMIT 300', status)
  .map((w) => ({ id: w.id, name: w.name, phone: w.phone, email: w.email, city: w.city, status: w.status, code: w.code ? showCode(w.code) : null, createdAt: w.created_at }));
export function resolveWaitlist(id, action) {
  const w = one('SELECT * FROM waitlist WHERE id = ?', id);
  if (!w) throw new HttpError(404, 'not_found');
  if (w.status !== 'pending') throw new HttpError(409, 'already_resolved');
  if (action === 'reject') {
    run("UPDATE waitlist SET status = 'rejected', resolved_at = ? WHERE id = ?", Date.now(), id);
    return { ok: true };
  }
  if (action !== 'approve') throw new HttpError(400, 'bad_action');
  const code = genCode();
  run('INSERT INTO invites (code, kind, label, max_uses, created_at) VALUES (?,?,?,?,?)', code, 'waitlist', w.name, 1, Date.now());
  run("UPDATE waitlist SET status = 'approved', code = ?, resolved_at = ? WHERE id = ?", code, Date.now(), id);
  return { ok: true, code: showCode(code), name: w.name, email: w.email, phone: w.phone };
}

// ---- admin: members -----------------------------------------------------------------------------------------
export function searchMembers(q = '', { contacts = true } = {}) {
  const like = `%${String(q).trim().replace(/[\\%_]/g, '\\$&')}%`; // % and _ typed by the admin are plain characters (usernames and emails contain _)
  // without contact access, email and phone are not searched either: matching on them would reveal them a character at a time
  const contact = contacts ? "OR u.email LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\'" : '';
  return all(`SELECT u.id, u.username, u.city, u.total, u.team_total, u.created_day, u.hidden_from_ranks hidden, u.suspended, u.deleted_at,
      u.invited_via, r.username inviter, u.email, u.phone, u.email_verified_at, u.hide_phone
    FROM users u LEFT JOIN users r ON r.id = u.referrer_id
    WHERE ? = '%%' OR u.username LIKE ? ESCAPE '\\' ${contact} OR u.city LIKE ? ESCAPE '\\'
    ORDER BY u.id DESC LIMIT 60`, ...(contacts ? [like, like, like, like, like] : [like, like, like])).map((m) => ({
    username: m.username, city: m.city, total: m.total, team: m.team_total, joined: m.created_day, hidden: !!m.hidden, suspended: !!m.suspended,
    deleted: !!m.deleted_at, invitedVia: m.invited_via, inviter: m.inviter, email: m.email, phone: m.phone, phoneHidden: !!m.hide_phone, emailVerified: !!m.email_verified_at,
    invites: m.deleted_at ? null : inviteStatus(m.id),
  }));
}

/** Run for each member who is suspended (inside the transaction), e.g. a caravan owner's role passes on. */
export const suspendHooks = [];
/** Suspends (or restores) a member, or their whole branch. Durood already reported stays in every total. */
export function setSuspended(username, suspended, branch = false, includeAdmins = true) {
  const u = one('SELECT id FROM users WHERE username = ?', username);
  if (!u) throw new HttpError(404, 'not_found');
  const ids = branch ? all('SELECT user_id id FROM ancestors WHERE ancestor_id = ?', u.id).map((r) => r.id) : [u.id];
  // only an owner's branch suspension reaches members who hold an admin role
  const st = db.prepare(`UPDATE users SET suspended = ? WHERE id = ? AND deleted_at IS NULL${includeAdmins ? '' : ' AND admin_role IS NULL'}`);
  let affected = 0;
  tx(() => {
    for (const id of ids) {
      if (!st.run(suspended ? 1 : 0, id).changes) continue;
      affected += 1;
      if (suspended) for (const fn of suspendHooks) fn(id);
    }
  });
  return { ok: true, affected };
}
