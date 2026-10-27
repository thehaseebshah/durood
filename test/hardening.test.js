import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin-key-that-is-long-enough';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';

const { createServer } = await import('../server/index.js');
(await import('./helpers.js')).seedCaravan();
const { db } = await import('../server/db.js');
const { audit } = await import('../server/audit.js');
const { CFG, dayOf } = await import('../server/game.js');
const { clientIp } = await import('../server/auth.js');
const { backupNow } = await import('../server/backup.js');
const { outbox } = await import('../server/mail.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, p, { token, body, headers } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const adm = { 'x-admin-key': process.env.ADMIN_KEY };
const signup = (username, invite = 'testcv', headers) => {
  n += 1;
  return api('POST', '/api/register', { headers, body: { username, email: `${username}@x.pk`, phone: `0305${String(6000000 + n)}`, password: 'secret1', cityId: 1172451, invite } });
};
const log = (u, count) => api('POST', '/api/log', { token: u.token, body: { count, rid: crypto.randomUUID() } });
const age = (username, days = 30) => db.prepare('UPDATE users SET created_day = ? WHERE username = ?').run(new Date(Date.now() + 5 * 3600e3 - days * 86400e3).toISOString().slice(0, 10), username);
const withEnv = async (vars, fn) => {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('new members have a lower daily limit; established members have 50,000', async () => {
  assert.equal(CFG.maxDaily, 50_000);
  assert.equal(CFG.maxDailyNew, 10_000);
  const fresh = await signup('hd_fresh');
  assert.equal((await log(fresh, 10_001)).error, 'daily_cap');
  assert.equal((await log(fresh, 10_000)).added, 10_000);
  assert.equal((await log(fresh, 1)).error, 'daily_cap');
  const old = await signup('hd_old'); age('hd_old');
  assert.equal((await log(old, 19_000)).added, 19_000);
  assert.equal((await log(old, 31_000)).added, 31_000);          // 50,000 exactly
  assert.equal((await log(old, 1)).error, 'daily_cap');
});

test('sessions: revoke signs out other devices; a password reset does too', async () => {
  const u = await signup('sess_u');
  assert.equal((await api('GET', '/api/me', { token: u.token })).status, 200);
  const r = await api('POST', '/api/sessions/revoke', { token: u.token });
  assert.ok(r.token && r.token !== u.token);
  assert.equal((await api('GET', '/api/me', { token: u.token })).status, 401, 'the old token is dead');
  assert.equal((await api('GET', '/api/me', { token: r.token })).status, 200, 'this device keeps a fresh one');
  outbox.length = 0;
  await api('POST', '/api/password/forgot', { body: { email: 'sess_u@x.pk' } });
  const link = outbox.find((m) => m.to === 'sess_u@x.pk' && /reset=/.test(m.text)).text.match(/reset=([\w-]+)/)[1];
  const done = await api('POST', '/api/password/reset', { body: { token: link, password: 'newsecret1' } });
  assert.equal((await api('GET', '/api/me', { token: r.token })).status, 401, 'reset signs everything out');
  assert.equal((await api('GET', '/api/me', { token: done.token })).status, 200);
  assert.equal((await api('GET', '/api/me', { headers: { Authorization: 'Bearer 1.9999999999.sig' } })).status, 401);
});

test('admin key: 10 wrong guesses lock the address out, even for the right key; other addresses are unaffected', async () => {
  await withEnv({ TRUST_PROXY: '1' }, async () => {
    const from = (ip) => ({ 'x-forwarded-for': ip });
    for (let i = 0; i < 10; i++) assert.equal((await api('GET', '/api/admin/audit', { headers: { ...from('7.7.7.7'), 'x-admin-key': 'guess' + i } })).status, 403);
    assert.equal((await api('GET', '/api/admin/audit', { headers: { ...from('7.7.7.7'), ...adm } })).status, 429);
    assert.equal((await api('GET', '/api/admin/audit', { headers: { ...from('8.8.8.8'), ...adm } })).status, 200);
  });
  await withEnv({ TRUST_PROXY: '1', ADMIN_IP_ALLOWLIST: '9.9.9.9' }, async () => {
    assert.equal((await api('GET', '/api/admin/audit', { headers: { 'x-forwarded-for': '1.1.1.1', ...adm } })).status, 403);
    assert.equal((await api('GET', '/api/admin/audit', { headers: { 'x-forwarded-for': '9.9.9.9', ...adm } })).status, 200);
  });
});

test('client address: only the hop the proxy added is trusted, so a spoofed header changes nothing', () => {
  const req = (xff, extra = {}) => ({ headers: { 'x-forwarded-for': xff, ...extra }, socket: { remoteAddress: '10.0.0.1' } });
  assert.equal(clientIp(req('6.6.6.6')), '10.0.0.1', 'not behind a proxy: ignore the header');
  process.env.TRUST_PROXY = '1';
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4')), '1.2.3.4');
  assert.equal(clientIp(req('1.2.3.4')), '1.2.3.4');
  process.env.TRUST_PROXY = '2';
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4, 10.9.9.9')), '1.2.3.4');
  delete process.env.TRUST_PROXY;
  process.env.CLIENT_IP_HEADER = 'Fly-Client-IP';
  assert.equal(clientIp(req('6.6.6.6', { 'fly-client-ip': '5.5.5.5' })), '5.5.5.5');
  delete process.env.CLIENT_IP_HEADER;
});

test('one account cannot be password-guessed from many addresses', async () => {
  await signup('guess_me');
  let last;
  await withEnv({ TRUST_PROXY: '1' }, async () => {
    for (let i = 0; i < 11; i++) last = await api('POST', '/api/login', { headers: { 'x-forwarded-for': `4.4.4.${i}` }, body: { id: 'guess_me', password: 'wrong' + i } });
  });
  assert.equal(last.error, 'rate_limited');
});

test('security headers, a CSP that matches the inline scripts, and safe static paths', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('referrer-policy'));
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'") && !csp.includes("script-src 'self' 'unsafe-inline'"));
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.ok(csp.includes(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`), 'inline script is allowed by hash');
  assert.equal((await fetch(base + '/%')).status, 400);
  assert.equal((await fetch(base + '/%00')).status, 400);
  assert.ok([403, 404].includes((await fetch(base + '/..%2fserver%2fdb.js')).status));
  assert.equal((await fetch(base + '/healthz')).status, 200);
  assert.equal((await fetch(base + '/admin')).headers.get('x-frame-options'), 'DENY');
  assert.equal((await api('GET', '/api/public')).status, 200);
});

test('backup: a consistent snapshot that opens, passes the integrity check, and old ones are pruned', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quest-bk-'));
  const first = backupNow(dir, 2);
  const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const copy = new DatabaseSync(first.file);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM users').get().n, users);
  assert.equal(copy.prepare('SELECT SUM(count) n FROM entries').get().n, db.prepare('SELECT SUM(count) n FROM entries').get().n);
  copy.close();
  for (let i = 0; i < 3; i++) { const f = path.join(dir, `seerah-quest-2020010${i + 1}-000000.db`); db.exec(`VACUUM INTO '${f}'`); }
  backupNow(dir, 2);
  assert.equal(readdirSync(dir).length, 2, 'only the newest two are kept');
  assert.throws(() => backupNow(undefined, 2), /BACKUP_DIR/);
});

test('a production server refuses to start without a mail provider or a long admin key', () => {
  const run = (env) => spawnSync(process.execPath, ['server/index.js'], { env: { PATH: process.env.PATH, DB_PATH: ':memory:', PORT: '0', NODE_ENV: 'production', ...env }, encoding: 'utf8', timeout: 8000 });
  const bad = run({});
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /MAIL_PROVIDER/);
  assert.match(bad.stderr, /ADMIN_KEY/);
  assert.match(bad.stderr, /AUTH_SECRET/);
});

test('boards are cached for a short time and the per-day public totals stay equal to the ledger', async () => {
  const a = await signup('cache_a');
  await log(a, 100);
  const board = () => api('GET', '/api/leaderboard?type=users&period=week', { token: a.token });
  await withEnv({ PUBLIC_CACHE_MS: '60000' }, async () => {
    const first = (await board()).rows.find((r) => r.username === 'cache_a').score;
    await log(a, 50);
    assert.equal((await board()).rows.find((r) => r.username === 'cache_a').score, first, 'served from the cache');
    assert.equal((await board()).rows.find((r) => r.username === 'cache_a').me, true, 'the "you" marker is still per viewer');
  });
  assert.equal((await board()).rows.find((r) => r.username === 'cache_a').score, 150, 'fresh again when caching is off');
  const dt = db.prepare('SELECT COALESCE(SUM(total),0) n FROM day_totals').get().n;
  const pub = await api('GET', '/api/public');
  assert.equal(dt, pub.total, 'day_totals and the national total agree (both leave out durood on hold)');
  assert.deepEqual(audit().problems, []);
});
