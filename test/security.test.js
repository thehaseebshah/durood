// Security review fixes: admins can't act on higher accounts, sign-in locks can't be turned against the member, no account probing, XP clawback.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';
process.env.TRUST_PROXY = '1';

const { createServer } = await import('../server/index.js');

let server, base, n = 0;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function api(method, path, { token, body, headers, ip = '9.9.9.9' } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const phone = () => `0306${String(1000000 + n)}`;
const signup = (username, invite = 'TESTFOUND') => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: phone(), password: 'secret1', cityId: 1172451, invite } }); };
const adminLogin = async (username, ip) => { const r = await api('POST', '/api/admin/login', { ip, body: { id: username, password: 'secret1' } }); return { 'x-admin-token': r.token }; };
const as = (h) => (method, path, body) => api(method, `/api/admin${path}`, { headers: h, body });
const K = as({ 'x-admin-key': 'test-admin' });

test('a moderator or organiser cannot reset, suspend, hide or clear an admin; only an owner can', async () => {
  for (const u of ['sx_owner', 'sx_mod', 'sx_org', 'sx_plain']) await signup(u);
  await K('POST', '/admins', { username: 'sx_owner', role: 'owner' });
  await K('POST', '/admins', { username: 'sx_mod', role: 'moderator' });
  await K('POST', '/admins', { username: 'sx_org', role: 'organiser' });
  const M = as(await adminLogin('sx_mod')), G = as(await adminLogin('sx_org')), O = as(await adminLogin('sx_owner'));
  assert.equal((await G('POST', '/members/sx_owner', { action: 'reset-link' })).error, 'not_allowed');
  for (const action of ['suspend', 'hide', 'clear-profile', 'remove-avatar']) assert.equal((await M('POST', '/members/sx_owner', { action })).error, 'not_allowed', action);
  assert.equal((await M('POST', '/members/sx_org', { action: 'suspend' })).error, 'not_allowed');
  assert.equal((await O('GET', '/me')).role, 'owner'); // still signed in
  // ordinary members are still theirs to handle
  assert.ok((await G('POST', '/members/sx_plain', { action: 'reset-link' })).url);
  assert.equal((await M('POST', '/members/sx_plain', { action: 'suspend' })).ok, true);
  assert.equal((await M('POST', '/members/sx_plain', { action: 'unsuspend' })).ok, true);
  // an owner can
  assert.ok((await O('POST', '/members/sx_mod', { action: 'reset-link' })).url);
});

test("a moderator's branch suspension skips admins inside the branch", async () => {
  await signup('br_top'); await signup('br_admin', 'br_top'); await signup('br_kid', 'br_top');
  await K('POST', '/admins', { username: 'br_admin', role: 'organiser' });
  const M = as(await adminLogin('sx_mod'));
  assert.equal((await M('POST', '/members/br_top', { action: 'suspend', branch: true })).ok, true);
  const G = as(await adminLogin('br_admin'));
  assert.equal((await G('GET', '/me')).role, 'organiser');
  assert.equal((await api('POST', '/api/login', { body: { id: 'br_kid', password: 'secret1' } })).error, 'suspended');
  await M('POST', '/members/br_top', { action: 'unsuspend', branch: true });
});

test('moderators see members with masked contact details; owners and organisers see them whole', async () => {
  const M = as(await adminLogin('sx_mod')), G = as(await adminLogin('sx_org'));
  const m = (await M('GET', '/members?q=plain')).members.find((x) => x.username === 'sx_plain');
  assert.ok(m.email.includes('•') && m.phone.includes('•'));
  assert.equal((await G('GET', '/members?q=plain')).members.find((x) => x.username === 'sx_plain').email, 'sx_plain@x.pk');
});

test('wrong guesses from strangers do not lock the member out of their own correct sign-in', async () => {
  await signup('lock_me');
  assert.ok((await api('POST', '/api/login', { ip: '1.1.1.1', body: { id: 'lock_me', password: 'secret1' } })).token); // the member's own address
  for (let i = 0; i < 12; i++) await api('POST', '/api/login', { ip: `6.6.6.${i}`, body: { id: 'lock_me', password: 'nope' + i } });
  assert.equal((await api('POST', '/api/login', { ip: '7.7.7.7', body: { id: 'lock_me', password: 'secret1' } })).error, 'rate_limited'); // a new address is still stopped
  assert.ok((await api('POST', '/api/login', { ip: '1.1.1.1', body: { id: 'lock_me', password: 'secret1' } })).token);   // the member's address is not
});

test('parallel wrong guesses cannot get past the lock', async () => {
  await signup('race_me');
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => api('POST', '/api/login', { ip: '5.5.5.5', body: { id: 'race_me', password: 'x' + i } })));
  assert.ok(rs.filter((r) => r.error === 'bad_login').length <= 10);
});

test('admin sign-in: spaces around the name are the same account for the lock', async () => {
  for (let i = 0; i < 8; i++) await api('POST', '/api/admin/login', { ip: '4.3.2.1', body: { id: i % 2 ? ' sx_owner' : 'sx_owner ', password: 'bad' } });
  assert.equal((await api('POST', '/api/admin/login', { ip: '4.3.2.1', body: { id: '\tsx_owner', password: 'secret1' } })).error, 'rate_limited');
});

test('deleting an account is not an unlimited password oracle', async () => {
  const u = await signup('del_guess');
  for (let i = 0; i < 5; i++) await api('DELETE', '/api/me', { token: u.token, body: { password: 'bad' + i } });
  assert.equal((await api('DELETE', '/api/me', { token: u.token, body: { password: 'secret1' } })).error, 'rate_limited');
});

test('sign-up does not say whether an email or a phone number is registered', async () => {
  await signup('probe_me');
  const taken = await api('POST', '/api/register', { body: { username: 'probe_x', email: 'probe_me@x.pk', phone: '03069999999', password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
  const takenPhone = await api('POST', '/api/register', { body: { username: 'probe_y', email: 'fresh@x.pk', phone: phone(), password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
  assert.equal(taken.error, 'account_exists');
  assert.equal(takenPhone.error, 'account_exists');
});

test('an invitee who logs 100 and edits it down takes the referral reward back from the inviter', async () => {
  await signup('farm_top');
  const sock = await signup('farm_sock', 'farm_top');
  const before = (await api('POST', '/api/login', { body: { id: 'farm_top', password: 'secret1' } })).me.xp;
  await api('POST', '/api/log', { token: sock.token, body: { count: 100, rid: 'farm-sock-1' } });
  const mid = (await api('POST', '/api/login', { body: { id: 'farm_top', password: 'secret1' } })).me.xp;
  assert.ok(mid >= before + 500);
  const id = (await api('GET', '/api/history', { token: sock.token })).days[0].entries[0].id;
  assert.equal((await api('PATCH', `/api/entries/${id}`, { token: sock.token, body: { count: 1 } })).status, 200);
  const after = (await api('POST', '/api/login', { body: { id: 'farm_top', password: 'secret1' } })).me.xp;
  assert.equal(after, before);
  const { audit } = await import('../server/audit.js');
  assert.deepEqual(audit().problems, []);
});
