// Access: every member joins a caravan at sign-up. The invite code is a caravan's name (anyone may use it, up to a daily cap per caravan)
// or an admin-made code tied to one caravan. Also the waitlist, the sign-up kill switch and the admin member list.
import crypto from 'node:crypto';
import { db, tx, getSetting, setSetting } from './db.js';
import { HttpError } from './auth.js';
import { USERNAME } from './handles.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

/** Admin kill switch: when off, nobody can sign up (existing members are unaffected). */
export const signupsOpen = () => getSetting('signups_open', '1') !== '0';
export function setSignups({ enabled, dailyCap: cap }) {
  if (cap !== undefined) {
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 0 || n > 100_000) throw new HttpError(400, 'bad_cap');
    setSetting('caravan_daily_cap', String(n));
  }
  if (enabled !== undefined) setSetting('signups_open', enabled ? '1' : '0');
  return signupSettings();
}
export const signupSettings = () => ({ enabled: signupsOpen(), dailyCap: dailyCap() });

// unambiguous alphabet (no 0/O, 1/I/L), shown as XXXX-XXXX
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function genCode() {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
export const normCode = (c) => String(c || '').toUpperCase().replace(/[\s-]/g, '');
export const showCode = (c) => (c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);

/**
 * Works out what an invite code is without using it up. The code is an admin-made code (tied to one caravan) or a caravan's name.
 * Returns { kind: 'caravan' | 'founder' | 'waitlist', caravan, invite?, code?, label } or throws bad_invite / invite_revoked / invite_used / caravan_full.
 */
export function resolveInvite(raw) {
  const text = String(raw || '').trim();
  const code = normCode(text);
  if (!code) throw new HttpError(400, 'bad_invite');

  const lead = one('SELECT * FROM leader_codes WHERE code = ?', code);
  if (lead) {
    if (lead.revoked) throw new HttpError(400, 'invite_revoked');
    if (lead.max_uses != null && lead.uses >= lead.max_uses) throw new HttpError(400, 'invite_used');
    return { kind: 'leader', leader: lead, code, label: lead.label, caravan: null };
  }
  const inv = one('SELECT * FROM invites WHERE code = ?', code);
  if (inv) {
    if (inv.revoked) throw new HttpError(400, 'invite_revoked');
    if (inv.max_uses != null && inv.uses >= inv.max_uses) throw new HttpError(400, 'invite_used');
    const caravan = inv.caravan_id && one('SELECT id, name, display_name FROM caravans WHERE id = ?', inv.caravan_id);
    if (!caravan) throw new HttpError(400, 'bad_invite'); // a code whose caravan is gone
    return { kind: inv.kind, invite: inv, code, label: inv.label, caravan };
  }

  const caravan = byName(text);
  if (!caravan) throw new HttpError(400, 'bad_invite');
  // a caravan's name is public, so only so many can join through it each day
  if (joinedByNameToday(caravan.id) >= dailyCap()) throw new HttpError(400, 'caravan_full');
  return { kind: 'caravan', label: caravan.display_name || caravan.name, caravan };
}

/** Marks a resolved code as used. Call inside the registration transaction, after re-resolving. */
export function consumeInvite(r) {
  if (r.leader) {
    const res = run('UPDATE leader_codes SET uses = uses + 1 WHERE code = ? AND revoked = 0 AND (max_uses IS NULL OR uses < max_uses)', r.code);
    if (!res.changes) throw new HttpError(400, 'invite_used');
  } else if (r.invite) {
    const res = run('UPDATE invites SET uses = uses + 1 WHERE code = ? AND revoked = 0 AND (max_uses IS NULL OR uses < max_uses)', r.code);
    if (!res.changes) throw new HttpError(400, 'invite_used');
  }
}

const pkDay = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); // same Pakistan-time day game.js uses (avoids a circular import)
/** The caravan whose name is `raw` (case-insensitive; the display name does not count), or null. */
export const byName = (raw) => {
  const n = String(raw ?? '').trim();
  return USERNAME.test(n) ? one('SELECT id, name, display_name, owner_id FROM caravans WHERE name = ?', n) ?? null : null;
};

/** New members one caravan may take through its name in a Pakistan-time day. Admin setting `caravan_daily_cap`, default 200. */
export const dailyCap = () => Math.max(0, Math.floor(Number(getSetting('caravan_daily_cap', process.env.CARAVAN_DAILY_CAP || '200'))) || 0);
export const joinedByNameToday = (caravanId, day = pkDay()) => one(`SELECT COUNT(*) n FROM users u JOIN caravan_members cm ON cm.user_id = u.id
  WHERE cm.caravan_id = ? AND u.invited_via = 'caravan' AND u.created_day = ?`, caravanId, day).n;

// ---- admin: codes -----------------------------------------------------------------------------------------
/** A plain code tied to one caravan (by its name); whoever registers with it joins that caravan. */
export function createFounderCode({ label = '', maxUses = null, caravan } = {}) {
  const c = byName(caravan);
  if (!c) throw new HttpError(404, 'caravan_not_found');
  const code = genCode();
  const max = maxUses == null || maxUses === '' ? null : Math.max(1, Number(maxUses) | 0);
  run('INSERT INTO invites (code, kind, label, max_uses, caravan_id, created_at) VALUES (?,?,?,?,?,?)', code, 'founder', String(label).slice(0, 60), max, c.id, Date.now());
  return { code: showCode(code), label, maxUses: max, caravan: c.name };
}
/** A code whose holder signs up and starts a caravan of their own (they name it at sign-up). Share one code with many people; max uses caps it. */
export function createLeaderCode({ label = '', maxUses = null } = {}) {
  const code = genCode();
  const max = maxUses == null || maxUses === '' ? null : Math.max(1, Number(maxUses) | 0);
  run('INSERT INTO leader_codes (code, label, max_uses, created_at) VALUES (?,?,?,?)', code, String(label).slice(0, 60), max, Date.now());
  return { code: showCode(code), label, maxUses: max };
}
export const revokeInvite = (rawCode) => {
  const res = run('UPDATE invites SET revoked = 1 WHERE code = ?', normCode(rawCode));
  const res2 = run('UPDATE leader_codes SET revoked = 1 WHERE code = ?', normCode(rawCode));
  if (!res.changes && !res2.changes) throw new HttpError(404, 'not_found');
  return { ok: true };
};
const listLeaderCodes = () => all('SELECT l.*, (SELECT COUNT(*) FROM users u WHERE u.invite_code = l.code) joined FROM leader_codes l ORDER BY l.created_at DESC LIMIT 100')
  .map((i) => ({ code: showCode(i.code), kind: 'leader', label: i.label, caravan: null, maxUses: i.max_uses, uses: i.uses, joined: i.joined, revoked: !!i.revoked, createdAt: i.created_at }));
export const listInvites = () => [...listLeaderCodes(), ...listInvitesTied()].sort((a, b) => b.createdAt - a.createdAt);
const listInvitesTied = () => all(`SELECT i.*, c.name caravan, (SELECT COUNT(*) FROM users u WHERE u.invite_code = i.code) joined FROM invites i LEFT JOIN caravans c ON c.id = i.caravan_id ORDER BY i.created_at DESC LIMIT 200`)
  .map((i) => ({ code: showCode(i.code), kind: i.kind, label: i.label, caravan: i.caravan, maxUses: i.max_uses, uses: i.uses, joined: i.joined, revoked: !!i.revoked, createdAt: i.created_at }));

// ---- waitlist ---------------------------------------------------------------------------------------------
export function addToWaitlist({ name, phone, email, city }) {
  const dup = one("SELECT id FROM waitlist WHERE phone = ? AND status IN ('pending','approved')", phone);
  if (!dup) run('INSERT INTO waitlist (name, phone, email, city, created_at) VALUES (?,?,?,?,?)', String(name).trim().slice(0, 80), phone, String(email || '').trim().slice(0, 120), String(city || '').trim().slice(0, 40), Date.now());
  return { ok: true }; // same answer whether or not it was a repeat, so the form can't be used to probe numbers
}
export const listWaitlist = (status = 'pending') => all('SELECT * FROM waitlist WHERE status = ? ORDER BY created_at ASC LIMIT 300', status)
  .map((w) => ({ id: w.id, name: w.name, phone: w.phone, email: w.email, city: w.city, status: w.status, code: w.code ? showCode(w.code) : null, createdAt: w.created_at }));
export function resolveWaitlist(id, action, caravanName) {
  const w = one('SELECT * FROM waitlist WHERE id = ?', id);
  if (!w) throw new HttpError(404, 'not_found');
  if (w.status !== 'pending') throw new HttpError(409, 'already_resolved');
  if (action === 'reject') {
    run("UPDATE waitlist SET status = 'rejected', resolved_at = ? WHERE id = ?", Date.now(), id);
    return { ok: true };
  }
  if (action !== 'approve') throw new HttpError(400, 'bad_action');
  const c = byName(caravanName); // an approval names the caravan the person will join
  if (!c) throw new HttpError(404, 'caravan_not_found');
  const code = genCode();
  run('INSERT INTO invites (code, kind, label, max_uses, caravan_id, created_at) VALUES (?,?,?,?,?,?)', code, 'waitlist', w.name, 1, c.id, Date.now());
  run("UPDATE waitlist SET status = 'approved', code = ?, resolved_at = ? WHERE id = ?", code, Date.now(), id);
  return { ok: true, code: showCode(code), caravan: c.name, name: w.name, email: w.email, phone: w.phone };
}

// ---- admin: members -----------------------------------------------------------------------------------------
export function searchMembers(q = '', { contacts = true } = {}) {
  const like = `%${String(q).trim().replace(/[\\%_]/g, '\\$&')}%`; // % and _ typed by the admin are plain characters (usernames and emails contain _)
  // without contact access, email and phone are not searched either: matching on them would reveal them a character at a time
  const contact = contacts ? "OR u.email LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\'" : '';
  return all(`SELECT u.id, u.username, u.city, u.total, u.created_day, u.hidden_from_ranks hidden, u.suspended, u.deleted_at,
      u.invited_via, c.name caravan, u.email, u.phone, u.email_verified_at, u.hide_phone
    FROM users u LEFT JOIN caravan_members cm ON cm.user_id = u.id LEFT JOIN caravans c ON c.id = cm.caravan_id
    WHERE ? = '%%' OR u.username LIKE ? ESCAPE '\\' ${contact} OR u.city LIKE ? ESCAPE '\\'
    ORDER BY u.id DESC LIMIT 60`, ...(contacts ? [like, like, like, like, like] : [like, like, like])).map((m) => ({
    username: m.username, city: m.city, total: m.total, joined: m.created_day, hidden: !!m.hidden, suspended: !!m.suspended,
    deleted: !!m.deleted_at, invitedVia: m.invited_via, caravan: m.caravan, email: m.email, phone: m.phone, phoneHidden: !!m.hide_phone, emailVerified: !!m.email_verified_at,
  }));
}

/** Run for each member who is suspended (inside the transaction), e.g. a caravan owner's role passes on. */
export const suspendHooks = [];
/** Suspends (or restores) a member. Durood already reported stays in every total. */
export function setSuspended(username, suspended) {
  const u = one('SELECT id FROM users WHERE username = ?', username);
  if (!u) throw new HttpError(404, 'not_found');
  let affected = 0;
  tx(() => {
    if (!db.prepare('UPDATE users SET suspended = ? WHERE id = ? AND deleted_at IS NULL').run(suspended ? 1 : 0, u.id).changes) return;
    affected = 1;
    if (suspended) for (const fn of suspendHooks) fn(u.id);
  });
  return { ok: true, affected };
}
