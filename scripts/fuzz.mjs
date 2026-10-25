// Sends malformed input to every API route, as a member and as an admin, on a throwaway database. No route may answer 5xx.
//   npm run fuzz
// (Linking a murabbi calls the Mamulaat app, which is not reachable here, so its 503 is expected and not counted.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-fuzz-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'fuzz.db'), ADMIN_KEY: 'fuzz-admin-key-long-enough-1234', EDITION: 'internal',
  PUBLIC_FOUNDERS_CODE: 'FUZZCODE', NODE_ENV: 'test', FLAG_NEW_HIGH: '1000000000', REG_LIMIT_PER_HOUR: '1000' });
const { createServer } = await import('../server/index.js');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`;
const json = { 'content-type': 'application/json' };
const reg = (u) => fetch(B + '/api/register', { method: 'POST', headers: json, body: JSON.stringify({ username: u, email: `${u}@f.pk`, phone: `0305${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'secret12', cityId: 1172451, invite: 'FUZZCODE' }) }).then((r) => r.json());
const me = await reg('fuzz_me'); await reg('fuzz_other');

const src = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const routes = [...src.matchAll(/^route\('([A-Z]+)', '([^']+)'/gm)].map((m) => [m[1], m[2]]);
const weird = [null, [], {}, '', 'x'.repeat(5000), -1, 1e308, '../../etc/passwd', '<script>', true, '1; DROP TABLE users', 0.5, '٣٣', '\u0000', { a: { b: [1] } }];
const FIELDS = ['count', 'id', 'username', 'name', 'nameUr', 'title', 'dueDay', 'day', 'kind', 'body', 'url', 'tags', 'weekdays', 'action', 'accept', 'team',
  'image', 'lang', 'city', 'cityId', 'password', 'current', 'next', 'phone', 'email', 'rid', 'code', 'label', 'maxUses', 'enabled', 'displayName', 'bio', 'dailyGoal'];
const fill = (p, w) => p.replace(/:(\w+)/g, () => encodeURIComponent(typeof w === 'string' ? w.slice(0, 40) || 'x' : String(w)));
const bad = [];
let n = 0;
for (const [m, p] of routes) {
  const admin = p.startsWith('/api/admin');
  const headers = { ...json, ...(admin ? { 'x-admin-key': process.env.ADMIN_KEY } : { authorization: `Bearer ${me.token}` }) };
  for (const w of weird) {
    const body = m === 'GET' ? undefined : JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, w])));
    const q = m === 'GET' ? `?q=${encodeURIComponent(String(w))}&type=${encodeURIComponent(String(w))}&period=${encodeURIComponent(String(w))}&metric=${encodeURIComponent(String(w))}` : '';
    const r = await fetch(B + fill(p, w) + q, { method: m, headers, body }).catch(() => ({ status: 'network error' }));
    n++;
    if ((r.status === 'network error' || r.status >= 500) && !(p === '/api/burhan/murabbi' && r.status === 503)) bad.push(`${m} ${p} with ${JSON.stringify(w)?.slice(0, 30)} -> ${r.status}`);
  }
}
server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${n} requests to ${routes.length} routes; ${bad.length} server errors`);
if (bad.length) { console.log([...new Set(bad)].slice(0, 40).join('\n')); process.exit(1); }
process.exit(0);
