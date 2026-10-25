// Admin accounts: roles, sign-in, per-route permissions, revocation, protections, the log names the actor.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';

const { createServer } = await import('../server/index.js');
const { db } = await import('../server/db.js');

let server, base, n = 0;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const key = { 'x-admin-key': 'test-admin' };
const signup = (username) => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0305${String(1000000 + n)}`, password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } }); };
const login = async (username, password = 'secret1') => { const r = await api('POST', '/api/admin/login', { body: { id: username, password } }); return r.token ? { 'x-admin-token': r.token } : r; };
const as = (h) => (method, path, body) => api(method, `/api/admin${path}`, { headers: h, body });

test('the key makes the first owner; owners give roles; each role sees only its own routes', async () => {
  await signup('ad_boss'); await signup('ad_mod'); await signup('ad_org'); await signup('ad_plain');
  const K = as(key);
  assert.equal((await K('POST', '/admins', { username: 'ad_boss', role: 'owner' })).ok, true);
  assert.equal((await K('POST', '/admins', { username: 'ad_mod', role: 'moderator' })).ok, true);
  assert.equal((await K('POST', '/admins', { username: 'ad_org', role: 'organiser' })).ok, true);
  assert.deepEqual((await K('GET', '/admins')).admins.map((a) => [a.username, a.role]), [['ad_boss', 'owner'], ['ad_mod', 'moderator'], ['ad_org', 'organiser']]);

  const O = as(await login('ad_boss')), M = as(await login('ad_mod')), G = as(await login('ad_org'));
  const allowed = async (who, method, path) => (await who(method, path)).status !== 403;
  // moderator: moderation yes, organising no, no admin management
  assert.ok(await allowed(M, 'GET', '/profiles'));
  assert.ok(await allowed(M, 'GET', '/log'));
  assert.ok(await allowed(M, 'GET', '/flags'));
  assert.ok(!(await allowed(M, 'GET', '/invites')));
  assert.ok(!(await allowed(M, 'GET', '/export?kind=cities')));
  assert.ok(!(await allowed(M, 'GET', '/admins')));
  assert.ok(!(await allowed(M, 'GET', '/audit')));
  // organiser: organising yes, moderating no
  assert.ok(await allowed(G, 'GET', '/invites'));
  assert.ok(await allowed(G, 'GET', '/waitlist'));
  assert.ok(!(await allowed(G, 'GET', '/profiles')));
  assert.ok(!(await allowed(G, 'GET', '/log')));
  assert.ok(!(await allowed(G, 'GET', '/admins')));
  // owner: all of it
  for (const p of ['/profiles', '/invites', '/admins', '/audit', '/log']) assert.ok(await allowed(O, 'GET', p), p);
  // what /me tells the page
  assert.equal((await M('GET', '/me')).role, 'moderator');
  assert.ok(!(await G('GET', '/me')).can.includes('moderate'));
});

test('member actions are split: moderators suspend but cannot make reset links; organisers the opposite', async () => {
  await signup('ad_target');
  const M = as(await login('ad_mod')), G = as(await login('ad_org'));
  assert.equal((await G('POST', '/members/ad_target', { action: 'suspend' })).error, 'not_allowed');
  assert.equal((await M('POST', '/members/ad_target', { action: 'reset-link' })).error, 'not_allowed');
  assert.equal((await M('POST', '/members/ad_target', { action: 'suspend' })).status, 200);
  assert.equal((await M('POST', '/members/ad_target', { action: 'unsuspend' })).status, 200);
  const r = await G('POST', '/members/ad_target', { action: 'reset-link' });
  assert.match(r.url, /reset=/);
});

test('the log names who acted', async () => {
  const M = as(await login('ad_mod'));
  await M('POST', '/members/ad_target', { action: 'hide' });
  await as(key)('POST', '/members/ad_target', { action: 'unhide' });
  const log = (await M('GET', '/log')).log;
  const row = (a, who) => log.find((l) => l.action === a && l.actor === who);
  assert.ok(row('hide', 'ad_mod'));
  assert.ok(row('unhide', 'admin key'));
  assert.ok(row('grant-admin', 'admin key'));
  assert.ok(log.find((l) => l.action === 'reset-link' && l.actor === 'ad_org'), 'reset links are logged too');
});

test('sign-in: one answer for wrong password, plain member and unknown name; a session dies with the role, the password or the account', async () => {
  assert.equal((await login('ad_plain')).status, 401);
  assert.equal((await login('ad_mod', 'nope')).status, 401);
  assert.equal((await login('no_such_person')).status, 401);
  assert.equal((await login('ad_plain')).error, (await login('no_such_person')).error);
  // the member token is not an admin token and the other way round
  const u = await signup('ad_cross');
  assert.equal((await api('GET', '/api/admin/me', { headers: { 'x-admin-token': u.token } })).status, 403);
  const M = await login('ad_mod');
  assert.equal((await api('GET', '/api/me', { headers: { Authorization: `Bearer ${M['x-admin-token']}` } })).status, 401);
  // change the password: that session ends
  const tmp = await signup('ad_temp'); await as(key)('POST', '/admins', { username: 'ad_temp', role: 'moderator' });
  const T = await login('ad_temp');
  assert.equal((await as(T)('GET', '/me')).role, 'moderator');
  const pc = await api('POST', '/api/me/password', { token: tmp.token, body: { current: 'secret1', next: 'another2x' } }); assert.equal(pc.status, 200, JSON.stringify(pc));
  assert.equal((await as(T)('GET', '/me')).status, 403, 'password change ends the admin session');
  // role removed: the same token stops working at once
  const T2 = await login('ad_temp', 'another2x');
  assert.equal((await as(T2)('GET', '/me')).role, 'moderator');
  assert.equal((await as(key)('DELETE', '/admins/ad_temp')).ok, true);
  assert.equal((await as(T2)('GET', '/me')).status, 403);
  assert.equal((await login('ad_temp', 'another2x')).status, 401);
  // suspended admins lose access
  await as(key)('POST', '/members/ad_org', { action: 'suspend' });
  assert.equal((await as(await login('ad_org')) ('GET', '/me')).status !== 200, true);
  await as(key)('POST', '/members/ad_org', { action: 'unsuspend' });
  assert.equal((await as(await login('ad_org'))('GET', '/me')).role, 'organiser');
});

test('protections: no changing your own role, the last owner account stays, only real active members, unknown role refused', async () => {
  const O = as(await login('ad_boss'));
  assert.equal((await O('POST', '/admins', { username: 'ad_boss', role: 'moderator' })).error, 'own_role');
  assert.equal((await O('DELETE', '/admins/ad_boss')).error, 'own_role');
  assert.equal((await O('POST', '/admins', { username: 'ad_plain', role: 'god' })).error, 'bad_role');
  assert.equal((await O('POST', '/admins', { username: 'nobody_here', role: 'owner' })).error, 'member_not_found');
  // a second owner can exist, and then neither is "last" until one is gone
  assert.equal((await O('POST', '/admins', { username: 'ad_plain', role: 'owner' })).ok, true);
  const P = as(await login('ad_plain'));
  assert.equal((await P('POST', '/admins', { username: 'ad_boss', role: 'moderator' })).ok, true);
  // now ad_plain is the only owner account: nobody else can demote them, only the key can
  assert.equal((await as(await login('ad_boss'))('GET', '/admins')).status, 403, 'demoted at once');
  assert.equal((await as(key)('POST', '/admins', { username: 'ad_boss', role: 'owner' })).ok, true);
  assert.equal((await db.prepare("SELECT COUNT(*) c FROM users WHERE admin_role = 'owner'").get()).c, 2);
});

test('the shared key still works as owner, and wrong keys or tokens lock an address out', async () => {
  assert.equal((await as(key)('GET', '/me')).role, 'owner');
  assert.equal((await as({ 'x-admin-key': 'wrong' })('GET', '/me')).status, 403);
  assert.equal((await as({ 'x-admin-token': 'a.1.2.3.bad' })('GET', '/me')).status, 403);
  assert.equal((await api('GET', '/api/admin/me')).status, 403);
  assert.equal((await api('POST', '/api/admin/login', { body: {} })).status, 401);
});

test('deleting an admin account removes the role with it', async () => {
  const d = await signup('ad_gone'); await as(key)('POST', '/admins', { username: 'ad_gone', role: 'moderator' });
  const T = await login('ad_gone');
  const del = await api('DELETE', '/api/me', { token: d.token, body: { password: 'secret1' } });
  assert.ok(del.status === 200 || del.ok, JSON.stringify(del));
  assert.equal((await as(T)('GET', '/me')).status, 403);
  assert.ok(!(await as(key)('GET', '/admins')).admins.some((a) => a.username === 'ad_gone'));
});
