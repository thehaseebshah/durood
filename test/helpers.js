// Shared by the tests: every member joins a caravan at sign-up, and the invite code is the caravan's name.
// seedCaravan() makes caravan `name` with an owner straight in the database (the admin routes are tested in caravan.test.js).
import { db } from '../server/db.js';

export const CV = 'testcv';

export function seedCaravan(name = CV, ownerName = `${name}_owner`) {
  if (db.prepare('SELECT 1 FROM caravans WHERE name = ?').get(name)) return name;
  const n = db.prepare('SELECT COUNT(*) n FROM users').get().n + 1;
  const day = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  const uid = Number(db.prepare(`INSERT INTO users (username, email, phone, pass, city, city_id, country, created_day, created_at, invited_via)
    VALUES (?,?,?,?,?,?,?,?,?, 'admin')`).run(ownerName, `${ownerName}@x.pk`, `+9299${String(1000000 + n)}`, 'x', '', null, '', day, Date.now()).lastInsertRowid);
  const cid = Number(db.prepare('INSERT INTO caravans (name, owner_id, created_at) VALUES (?,?,?)').run(name, uid, Date.now()).lastInsertRowid);
  db.prepare('INSERT INTO caravan_members (user_id, caravan_id, joined_at) VALUES (?,?,?)').run(uid, cid, Date.now());
  return name;
}

let k = 0;
/**
 * A caravan the way an admin makes one: an owner registered without a caravan (admin route), then the caravan with that owner.
 * `api(method, path, { token, body, headers })` is the test file's own fetch helper. Returns the owner signed in: { token, me }.
 */
export async function makeCaravan(api, name, ownerName = `${name}_o`) {
  const headers = { 'x-admin-key': process.env.ADMIN_KEY || 'test-admin' };
  k += 1;
  const c = await api('POST', '/api/admin/members/create', { headers, body: { username: ownerName, email: `${ownerName}@x.pk`, phone: `0309${String(5000000 + k)}`, password: 'secret1', cityId: 1172451 } });
  if (!c.ok) throw new Error(`create member: ${JSON.stringify(c)}`);
  const cv = await api('POST', '/api/admin/caravans', { headers, body: { name, owner: ownerName } });
  if (!cv.id) throw new Error(`create caravan: ${JSON.stringify(cv)}`);
  const l = await api('POST', '/api/login', { body: { id: ownerName, password: 'secret1' } });
  return { token: l.token, me: l.me };
}

/** The real username behind a row of a people ranking (other members appear there under made-up names with a signed ref). */
export async function realName(row) {
  if (!row.ref) return row.username;
  const { readRef } = await import('../server/auth.js');
  const id = readRef(row.ref);
  return id ? db.prepare('SELECT username FROM users WHERE id = ?').get(id).username : null;
}
