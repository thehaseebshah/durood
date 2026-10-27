// Admin accounts: a member can hold a role. The shared ADMIN_KEY still works as a break-glass owner.
import { db, tx } from './db.js';
import { HttpError, hashPassword, checkPassword, signAdminToken, verifyAdminToken } from './auth.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

export const ROLES = ['owner', 'moderator', 'organiser'];
/** What each role may do. Owner can do everything, including managing admins and running the audit. */
export const CAN = {
  owner: new Set(['moderate', 'organise', 'members', 'reset_link', 'log', 'status', 'audit', 'manage_admins', 'delete_member']),
  moderator: new Set(['moderate', 'members', 'log', 'status']),
  organiser: new Set(['organise', 'members', 'reset_link', 'status']),
};
export const can = (role, perm) => !!CAN[role]?.has(perm);

/** Which permission each admin route needs. A route missing here is owner-only. */
export const ADMIN_PERMS = {
  'GET /api/admin/caravans': 'moderate', 'PUT /api/admin/caravans/:id': 'moderate', 'DELETE /api/admin/caravans/:id': 'moderate', 'DELETE /api/admin/caravans/:id/display-name': 'moderate',
  'POST /api/admin/caravans': 'organise', 'POST /api/admin/caravans/:id/members': 'organise', 'POST /api/admin/caravans/:id/remove': 'moderate',
  'GET /api/admin/profiles': 'moderate', 'GET /api/admin/log': 'log',
  'GET /api/admin/reported': 'moderate', 'POST /api/admin/content/:kind/:id': 'moderate',
  'GET /api/admin/members': 'members', 'POST /api/admin/members/:username': 'members',   // the action inside decides (see index.js)
  'POST /api/admin/members/create': 'organise',
  'POST /api/admin/sunnahs': 'organise', 'GET /api/admin/sunnahs': 'organise', 'DELETE /api/admin/sunnahs/:day': 'organise',
  'GET /api/admin/invites': 'organise', 'POST /api/admin/leader-codes': 'organise', 'POST /api/admin/invites': 'organise', 'POST /api/admin/invites/:code/revoke': 'organise', 'POST /api/admin/signups': 'organise',
  'GET /api/admin/waitlist': 'organise', 'POST /api/admin/waitlist/:id': 'organise',
  'GET /api/admin/challenge': 'status', 'POST /api/admin/challenge': 'organise',
  'GET /api/admin/news': 'organise', 'POST /api/admin/news': 'organise', 'DELETE /api/admin/news/:id': 'organise',
  'GET /api/admin/export': 'organise',
  'GET /api/admin/special-days': 'organise', 'POST /api/admin/special-days': 'organise', 'DELETE /api/admin/special-days/:day': 'organise',
  'GET /api/admin/majalis': 'organise', 'POST /api/admin/majalis/:id': 'organise',
  'GET /api/admin/audit': 'audit', 'GET /api/admin/status': 'status',
  'GET /api/admin/me': 'status',
  'GET /api/admin/admins': 'manage_admins', 'POST /api/admin/admins': 'manage_admins', 'DELETE /api/admin/admins/:username': 'manage_admins',
};

const DUMMY = { hash: null };
/** Username and password of a member who holds a role. Returns a session that lasts 8 hours and ends if the password changes or the role is taken away. */
export async function adminLogin(ident, password, { priority = false } = {}) {
  const id = String(ident ?? '').trim();
  const u = one('SELECT id, username, pass, suspended, deleted_at, admin_role, token_ver FROM users WHERE username = ?', id);
  DUMMY.hash ??= await hashPassword('timing-equaliser');
  const ok = await checkPassword(String(password ?? ''), u && !u.deleted_at ? u.pass : DUMMY.hash, { priority }); // the same work whether or not the account exists
  if (!u || u.deleted_at || !ok || !u.admin_role || u.suspended) throw new HttpError(401, 'bad_login'); // one answer for "no such admin" and "wrong password"
  return { token: signAdminToken(u.id, u.token_ver), username: u.username, role: u.admin_role };
}

/** The admin behind a request header, or null. Read from the database each time, so revoking a role works at once. */
export function adminFromToken(token) {
  const t = verifyAdminToken(token);
  if (!t) return null;
  const u = one('SELECT id, username, suspended, deleted_at, admin_role, token_ver FROM users WHERE id = ?', t.id);
  if (!u || u.deleted_at || u.suspended || !u.admin_role || u.token_ver !== t.ver) return null;
  return { userId: u.id, username: u.username, role: u.admin_role, actor: u.username };
}

export const listAdmins = () => db.prepare(`SELECT username, admin_role role, admin_since since, city FROM users WHERE admin_role IS NOT NULL AND deleted_at IS NULL ORDER BY admin_since, id`).all();

/** Gives a member a role (or changes it). An admin cannot change their own role, and the last owner account cannot be demoted by another owner's mistake. */
export function grant(actor, username, role) {
  if (!ROLES.includes(role)) throw new HttpError(400, 'bad_role');
  return tx(() => {
    const u = one('SELECT id, admin_role FROM users WHERE username = ? AND deleted_at IS NULL AND suspended = 0', String(username ?? '').trim());
    if (!u) throw new HttpError(404, 'member_not_found');
    if (actor.userId === u.id) throw new HttpError(403, 'own_role');
    if (u.admin_role === 'owner' && role !== 'owner' && !actor.isKey && owners() <= 1) throw new HttpError(409, 'last_owner');
    run('UPDATE users SET admin_role = ?, admin_since = COALESCE(admin_since, ?) WHERE id = ?', role, Date.now(), u.id);
    return { ok: true, previous: u.admin_role };
  });
}
export function revoke(actor, username) {
  return tx(() => {
    const u = one('SELECT id, admin_role FROM users WHERE username = ? AND admin_role IS NOT NULL', String(username ?? '').trim());
    if (!u) throw new HttpError(404, 'not_found');
    if (actor.userId === u.id) throw new HttpError(403, 'own_role');
    if (u.admin_role === 'owner' && !actor.isKey && owners() <= 1) throw new HttpError(409, 'last_owner');
    run('UPDATE users SET admin_role = NULL, admin_since = NULL WHERE id = ?', u.id); // their admin session ends at once: the role is read from here on every request
    return { ok: true, role: u.admin_role };
  });
}
const owners = () => one("SELECT COUNT(*) n FROM users WHERE admin_role = 'owner' AND deleted_at IS NULL AND suspended = 0").n;
