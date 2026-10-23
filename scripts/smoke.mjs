// Quick end-to-end check of a deployed server. Creates one test member, so run it against QA, not production.
//   SMOKE_URL=https://your-app.fly.dev SMOKE_CODE=<founders code> ADMIN_KEY=<admin key> node scripts/smoke.mjs
const URL_ = (process.env.SMOKE_URL || '').replace(/\/$/, '');
if (!URL_ || !process.env.SMOKE_CODE) { console.error('Set SMOKE_URL and SMOKE_CODE (and ADMIN_KEY to also check the admin API)'); process.exit(2); }
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed += 1; };
const call = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => ({})) };
};

const home = await fetch(URL_ + '/');
check('home page loads over HTTPS', home.ok && (URL_.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)/.test(URL_)));
check('security headers present', home.headers.get('x-frame-options') === 'DENY' && !!home.headers.get('content-security-policy'));
check('HSTS present', !!home.headers.get('strict-transport-security'));
check('/healthz', (await call('GET', '/healthz')).status === 200);
check('manifest and service worker served', (await fetch(URL_ + '/manifest.webmanifest')).ok && (await fetch(URL_ + '/sw.js')).ok);
check('public meter', typeof (await call('GET', '/api/public')).json.total === 'number');

const id = `smoke_${Date.now().toString(36)}`.slice(0, 20);
const reg = await call('POST', '/api/register', { body: { username: id, email: `${id}@example.com`, phone: `+9230${String(Date.now()).slice(-8)}`, password: 'smoke-test-1', invite: process.env.SMOKE_CODE } });
check('register with the founders code', reg.status === 200 && !!reg.json.token, reg.json.error || '');
const token = reg.json.token;
if (token) {
  const log = await call('POST', '/api/log', { token, body: { count: 33, rid: `smoke-${Date.now()}-abcdef` } });
  check('log 33 durood', log.status === 200 && log.json.me?.today === 33, log.json.error || '');
  check('me / team / boards / news', (await call('GET', '/api/me', { token })).status === 200 && (await call('GET', '/api/team', { token })).status === 200
    && (await call('GET', '/api/leaderboard?type=teams&metric=average', { token })).status === 200 && (await call('GET', '/api/news', { token })).status === 200);
  check('push key available', !!(await call('GET', '/api/push/key', { token })).json.key);
  check('old token rejected after revoke', await (async () => { const r = await call('POST', '/api/sessions/revoke', { token }); return r.status === 200 && (await call('GET', '/api/me', { token })).status === 401; })());
}
check('a request without a token is refused', (await call('GET', '/api/me')).status === 401);
check('admin API refuses a wrong key', (await call('GET', '/api/admin/audit', { headers: { 'x-admin-key': 'wrong' } })).status === 403);
if (process.env.ADMIN_KEY) {
  const a = await call('GET', '/api/admin/audit', { headers: { 'x-admin-key': process.env.ADMIN_KEY } });
  check('ledger audit is clean', a.status === 200 && a.json.ok === true, JSON.stringify(a.json.problems?.slice(0, 2) || ''));
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
