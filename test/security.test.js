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

test('a device that signed the member in before still gets in when strangers have locked the account, from any network', async () => {
  await signup('dev_me');
  const first = await api('POST', '/api/login', { ip: '1.2.3.4', body: { id: 'dev_me', password: 'secret1' } });
  assert.ok(first.device);
  for (let i = 0; i < 12; i++) await api('POST', '/api/login', { ip: `8.8.${i}.1`, body: { id: 'dev_me', password: 'bad' + i } });
  assert.equal((await api('POST', '/api/login', { ip: '100.64.0.9', body: { id: 'dev_me', password: 'secret1' } })).error, 'rate_limited');
  assert.ok((await api('POST', '/api/login', { ip: '100.64.0.9', body: { id: 'dev_me', password: 'secret1', device: first.device } })).token);
  // another member's device token is no use, and the password is still needed
  const other = await signup('dev_other');
  assert.equal((await api('POST', '/api/login', { ip: '100.64.0.10', body: { id: 'dev_me', password: 'secret1', device: other.device } })).error, 'rate_limited');
  assert.equal((await api('POST', '/api/login', { ip: '100.64.0.11', body: { id: 'dev_me', password: 'nope', device: first.device } })).error, 'bad_login');
});

test('IPv6 callers are counted by their /64, so one line cannot rotate addresses for fresh budgets', async () => {
  await signup('v6_me');
  for (let i = 0; i < 10; i++) await api('POST', '/api/login', { ip: `2001:db8:1:2::${i.toString(16)}`, body: { id: 'v6_me', password: 'bad' + i } });
  const { rateIp } = await import('../server/auth.js');
  assert.equal(rateIp('2001:db8:1:2::ff'), '2001:db8:1:2::/64');
  assert.equal(rateIp('::ffff:10.0.0.1'), '10.0.0.1');
  assert.equal(rateIp('2001:db8:1:2:3:4:5:6'), rateIp('2001:0db8:0001:0002::9'));
  assert.equal((await api('POST', '/api/login', { ip: '2001:db8:1:2::abcd', body: { id: 'v6_me', password: 'secret1' } })).error, 'rate_limited');
});

test('moderators cannot uncover a masked phone or email by searching for it', async () => {
  const M = as(await adminLogin('sx_mod', '3.3.3.3'));
  const full = (await K('GET', '/members?q=plain')).members.find((x) => x.username === 'sx_plain');
  assert.equal((await M('GET', `/members?q=${encodeURIComponent(full.phone.slice(0, 8))}`)).members.some((x) => x.username === 'sx_plain'), false);
  assert.equal((await M('GET', '/members?q=sx_plain%40x')).members.some((x) => x.username === 'sx_plain'), false);
});

test('a week whose leagues and city podium are decided can no longer be edited', async () => {
  const { setSetting } = await import('../server/db.js');
  const { weekStart } = await import('../server/game.js');
  const u = await signup('wk_closed');
  await api('POST', '/api/log', { token: u.token, body: { count: 50, rid: 'wk-closed-1' } });
  const h = await api('GET', '/api/history', { token: u.token });
  setSetting(`week_closed:${weekStart()}`, Date.now());
  try {
    assert.equal((await api('PATCH', `/api/entries/${h.days[0].entries[0].id}`, { token: u.token, body: { count: 1 } })).error, 'edit_window');
    assert.equal((await api('GET', '/api/history', { token: u.token })).days[0].editable, false);
  } finally { (await import('../server/db.js')).db.prepare('DELETE FROM settings WHERE key = ?').run(`week_closed:${weekStart()}`); }
});

test('badges a big number earned for the member, their inviter and their caravan are taken back when it is edited down', async () => {
  await signup('bd_top'); const c = await signup('bd_cheat', 'bd_top'); const m = await signup('bd_mate');
  await api('POST', '/api/log', { token: m.token, body: { count: 100, rid: 'bd-mate-1' } });
  await api('POST', '/api/caravan', { token: c.token, body: { name: 'bd_caravan' } });
  await api('POST', '/api/caravan/invite', { token: c.token, body: { username: 'bd_mate' } });
  const inv = (await api('GET', '/api/caravan', { token: m.token })).invitations[0];
  await api('POST', `/api/caravan/invitations/${inv.id}`, { token: m.token, body: { accept: true } });
  const xp = async (t) => (await api('GET', '/api/me', { token: t })).xp;
  const before = await xp(m.token);
  const r = await api('POST', '/api/log', { token: c.token, body: { count: 10_000, rid: 'bd-cheat-1' } });
  assert.ok(r.newBadges.includes('d10k') && r.newBadges.includes('group10k'));
  assert.ok(await xp(m.token) > before);
  const id = (await api('GET', '/api/history', { token: c.token })).days[0].entries[0].id;
  await api('PATCH', `/api/entries/${id}`, { token: c.token, body: { count: 1 } });
  const me = await api('GET', '/api/me', { token: c.token });
  assert.deepEqual(me.badges, ['first_step']);
  assert.equal(me.xp, 1);
  assert.equal(await xp(m.token), before);
  const top = await api('POST', '/api/login', { body: { id: 'bd_top', password: 'secret1' } });
  assert.ok(!top.me.badges.includes('recruit1'));
  const { audit } = await import('../server/audit.js');
  assert.deepEqual(audit().problems, []);
});

test('quiz answers: only while watching a lecture of this week, and a few checks per half hour', async () => {
  const { weekStart, dayNum, dayStr } = await import('../server/game.js');
  const Q = [{ q_en: 'Q1', options_en: ['a', 'b', 'c'], answer: 2 }, { q_en: 'Q2', options_en: ['a', 'b', 'c'], answer: 1 }];
  const u = await signup('qz_member');
  const later = await K('POST', '/lectures', { youtube_id: 'abcdefghijk', title_en: 'Later', min_seconds: 30, questions: Q, week: dayStr(dayNum(weekStart()) + 14) });
  assert.equal((await api('POST', `/api/lectures/${later.id}/start`, { token: u.token })).error, 'not_found');
  const now = await K('POST', '/lectures', { youtube_id: 'abcdefghijl', title_en: 'Now', min_seconds: 30, questions: Q });
  assert.equal((await api('POST', `/api/lectures/${now.id}/quiz`, { token: u.token, body: { answers: [0, 0] } })).error, 'not_found'); // not opened
  await api('POST', `/api/lectures/${now.id}/start`, { token: u.token });
  for (let i = 0; i < 3; i++) assert.equal((await api('POST', `/api/lectures/${now.id}/quiz`, { token: u.token, body: { answers: [0, 0] } })).passed, false);
  assert.equal((await api('POST', `/api/lectures/${now.id}/quiz`, { token: u.token, body: { answers: [2, 1] } })).error, 'rate_limited');
});

test('the audit runs on its worker thread (it loads the database module there, which must not need the main thread)', async () => {
  const dir = (await import('node:fs')).mkdtempSync((await import('node:os')).tmpdir() + '/audit-');
  const { execFileSync } = await import('node:child_process');
  const root = new URL('..', import.meta.url).pathname;
  (await import('node:fs')).writeFileSync(`${dir}/run.mjs`, `const { auditAsync } = await import(${JSON.stringify(root + 'server/audit.js')}); const r = await auditAsync(); console.log(JSON.stringify({ ok: r.ok, problems: r.problems }));`);
  const out = execFileSync(process.execPath, ['--no-warnings', `${dir}/run.mjs`], { env: { ...process.env, DB_PATH: `${dir}/a.db`, FLAG_NEW_HIGH: '1000000000' }, cwd: root }).toString().trim().split('\n').pop();
  assert.deepEqual(JSON.parse(out), { ok: true, problems: [] });
});

test('admin member search treats _ and % as ordinary characters', async () => {
  await signup('us_er_x');
  const M = as({ 'x-admin-key': 'test-admin' });
  assert.ok((await M('GET', '/members?q=us_er')).members.some((m) => m.username === 'us_er_x'));
  assert.equal((await M('GET', '/members?q=us%25er')).members.some((m) => m.username === 'us_er_x'), false);
  assert.equal((await M('GET', '/members?q=usXer')).members.some((m) => m.username === 'us_er_x'), false); // _ is not "any character"
});

test('a badge and the referral reward come back when an edit brings the total back up', async () => {
  await signup('eu_top'); const k = await signup('eu_kid', 'eu_top');
  await api('POST', '/api/log', { token: k.token, body: { count: 1000, rid: 'eu-kid-1' } });
  const id = (await api('GET', '/api/history', { token: k.token })).days[0].entries[0].id;
  await api('PATCH', `/api/entries/${id}`, { token: k.token, body: { count: 50 } });
  assert.ok(!(await api('GET', '/api/me', { token: k.token })).badges.includes('d1k'));
  const id2 = (await api('GET', '/api/history', { token: k.token })).days[0].entries[0].id;
  await api('PATCH', `/api/entries/${id2}`, { token: k.token, body: { count: 1000 } });
  assert.ok((await api('GET', '/api/me', { token: k.token })).badges.includes('d1k'));
  const top = await api('POST', '/api/login', { body: { id: 'eu_top', password: 'secret1' } });
  assert.ok(top.me.badges.includes('recruit1'));
  const { audit } = await import('../server/audit.js');
  assert.deepEqual(audit().problems, []);
});
