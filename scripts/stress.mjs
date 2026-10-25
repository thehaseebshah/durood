// 60 members at once: logging, retrying with the same request id, undoing, reading boards and the feed. No 5xx, and the audit must come back clean.
//   npm run stress
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-stress-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 's.db'), ADMIN_KEY: 'stress-admin-key-long-enough-123', EDITION: 'internal', PUBLIC_FOUNDERS_CODE: 'STRESS1', NODE_ENV: 'test', FLAG_NEW_HIGH: '1000000000', REG_LIMIT_PER_HOUR: '100000' });
const { createServer } = await import('../server/index.js');
const server = createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`, J = { 'content-type': 'application/json' };
const call = (m, p, body, tok) => fetch(B + p, { method: m, headers: { ...J, ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body && JSON.stringify(body) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
const users = [];
let prev = 'STRESS1';
for (let i = 0; i < 60; i++) {
  const r = await call('POST', '/api/register', { username: `st_${i}`, email: `st${i}@x.pk`, phone: `0306${String(1000000 + i)}`, password: 'secret12', cityId: 1172451, invite: i % 5 ? prev : 'STRESS1' });
  if (!r.j?.token) { console.log('reg fail', i, r.s, r.j); continue; }
  users.push(r.j.token); prev = `st_${i}`;
}
let n = 0, err5 = 0, codes = {};
const t0 = Date.now();
await Promise.all(users.map(async (tok, i) => {
  for (let k = 0; k < 15; k++) {
    const ops = [
      () => call('POST', '/api/log', { count: 1 + ((i * 7 + k) % 300), rid: `stress-r${i}-${k}` }, tok),
      () => call('POST', '/api/log', { count: 33, rid: `stress-r${i}-${k}` }, tok), // retry with same rid
      () => call('GET', '/api/me', null, tok),
      () => call('GET', '/api/leaderboard?type=users&period=week', null, tok),
      () => call('GET', '/api/feed', null, tok),
    ];
    const rs = await Promise.all(ops.map((f) => f()));
    const logged = rs[0].j?.entryId;
    if (logged && k % 4 === 0) rs.push(await call('PATCH', `/api/entries/${logged}`, { count: 0, rid: `stress-u${i}-${k}` }, tok));
    for (const r of rs) { n++; codes[r.s] = (codes[r.s] || 0) + 1; if (r.s >= 500) err5++; }
  }
}));
const ms = Date.now() - t0;
const a = await fetch(B + '/api/admin/audit', { headers: { 'x-admin-key': process.env.ADMIN_KEY } }).then((r) => r.json());
console.log(`${users.length} members, ${n} requests in ${ms} ms (${Math.round(n / (ms / 1000))}/s); 5xx: ${err5}; codes ${JSON.stringify(codes)}`);
console.log('audit', JSON.stringify(a).slice(0, 400));
server.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(err5 || !a.ok ? 1 : 0);
