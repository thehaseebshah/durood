import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';

const { createServer } = await import('../server/index.js');
(await import('./helpers.js')).seedCaravan();
const { audit } = await import('../server/audit.js');
const { db, setSetting } = await import('../server/db.js');
const { CFG, dayOf, weekStart } = await import('../server/game.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const admin = { 'x-admin-key': 'test-admin' };
const signup = (username, invite = 'testcv') => {
  n += 1;
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0306${String(7000000 + n)}`, password: 'secret1', cityId: 1172451, invite } });
};
const log = (u, count) => api('POST', '/api/log', { token: u.token, body: { count, rid: crypto.randomUUID() } });
const xp = async (u) => (await api('GET', '/api/me', { token: u.token })).xp;
const feed = async (u, q = '') => (await api('GET', `/api/feed${q}`, { token: u.token }));
const { makeCaravan } = await import('./helpers.js');
const make = (name, owner) => makeCaravan(api, name, owner);

test('the feed shows announcements, caravan milestones to the right people only, and each crore to everyone', async () => {
  const root = await make('fd_caravan', 'fd_root');
  const kid = await signup('fd_kid', 'fd_caravan');
  const stranger = await signup('fd_stranger');
  await log(kid, 1000);                                             // d1k badge
  const msIn = async (u) => (await feed(u)).items.filter((i) => i.type === 'milestone' && i.username === 'fd_kid' && i.code === 'd1k');
  assert.equal((await msIn(kid)).length, 1, 'the member sees their own milestone');
  assert.equal((await msIn(root)).length, 1, 'the others in their caravan see it');
  assert.equal((await msIn(stranger)).length, 0, 'someone outside the caravan does not');
  await api('POST', '/api/admin/news', { headers: admin, body: { title_en: 'Welcome to the feed', body_en: 'Hello' } });
  assert.ok((await feed(stranger)).items.some((i) => i.type === 'announcement' && i.titleEn === 'Welcome to the feed'));
  setSetting('ch_m_1', Date.now());
  assert.ok((await feed(stranger)).items.some((i) => i.type === 'crore' && i.k === 1));
});

test('the feed is newest first and pages by time', async () => {
  const v = await signup('pager');
  for (let i = 0; i < 25; i++) await api('POST', '/api/admin/news', { headers: admin, body: { title_en: `Note ${i}` } });
  const first = await feed(v);
  assert.equal(first.items.length, 20);
  assert.ok(first.next);
  assert.ok(first.items.every((it, i, a) => i === 0 || a[i - 1].at >= it.at), 'newest first');
  const second = await feed(v, `?before=${first.next}`);
  assert.ok(second.items.length > 0 && second.items.every((it) => it.at < first.next));
  assert.ok(!('today' in second), 'later pages are only the stream');
  assert.ok('today' in first && !('lectures' in first) && !('reflection' in first), 'the first page carries the Sunnah composer state only');
});

test('rankings: people and caravans (named groups); the old tree board is gone', async () => {
  const root = await make('rk_caravan', 'rk_root');
  const friend = await signup('rk_friend', 'rk_caravan');
  const outsider = await signup('rk_outsider');
  await log(root, 100); await log(friend, 50); await log(outsider, 400);
  const rows = async (type, q = '&period=week') => (await api('GET', `/api/leaderboard?type=${type}${q}`, { token: root.token })).rows;
  const score = async (type, user = 'rk_root', q) => (await rows(type, q)).find((r) => r.username === user)?.score;
  assert.equal(await score('users'), 100);
  assert.equal(await score('users', 'rk_outsider'), 400);
  assert.equal(await score('trees'), 100, 'an unknown type is the people board; there are no trees any more');
  const cv = await rows('caravans');
  assert.equal(cv.find((r) => r.name === 'rk_caravan').score, 150, 'the caravan is root + friend: 100 + 50');
  assert.equal(cv.find((r) => r.name === 'rk_caravan').me, true);
  assert.equal(cv.find((r) => r.name === 'rk_caravan').members, 2);
  assert.equal((await rows('caravans', '&period=all')).find((r) => r.name === 'rk_caravan').score, 150);
  assert.equal((await rows('caravans', '&metric=average')).find((r) => r.name === 'rk_caravan').score, 75, 'average per active member: 150 / 2');
  assert.equal((await api('GET', '/api/team', { token: root.token })).status, 404);
});

test('caravan badges follow the named group', async () => {
  const root = await make('ms_caravan', 'ms_root');
  const pal = await signup('ms_pal', 'ms_caravan');
  const kid = await signup('ms_kid');
  await log(root, 200); await log(kid, 9_000);                         // the caravan (root + pal): 200
  let me = await api('GET', '/api/me', { token: root.token });
  assert.ok(!me.badges.includes('group10k'), 'the caravan has not passed 10,000');
  assert.equal((await api('GET', '/api/caravan', { token: root.token })).caravan.total, 200);
  await log(pal, 10_000);                                               // the caravan: 10,200
  me = await api('GET', '/api/me', { token: root.token });
  assert.ok(me.badges.includes('group10k'), 'the caravan passed 10,000, and every active member shares it');
  assert.ok((await api('GET', '/api/me', { token: pal.token })).badges.includes('group10k'));
  assert.ok(!(await api('GET', '/api/me', { token: kid.token })).badges.includes('group10k'), 'someone outside the caravan does not');
  const msgs = (await feed(root)).items.filter((i) => i.type === 'milestone' && i.username === 'ms_root').map((i) => i.code);
  assert.ok(msgs.includes('group10k'));
  assert.deepEqual(audit().problems, []);
});

test('caravan mates say MashaAllah on a milestone: once each, never on their own, and only on what their caravan can see', async () => {
  const { cheer } = await import('../server/feed.js');
  const uid = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  const a = await make('cheer_cv', 'ch_owner'), b = await signup('ch_mate', 'cheer_cv'), c = await signup('ch_stranger');
  await api('POST', '/api/log', { token: a.token, body: { count: 1000, rid: 'cheer-log-1000' } });
  const ev = db.prepare("SELECT id FROM feed_events WHERE user_id = ? AND kind = 'badge' ORDER BY id DESC LIMIT 1").get(uid('ch_owner'));
  assert.ok(ev);
  assert.equal(cheer(uid('ch_mate'), ev.id).cheers, 1);
  assert.equal(cheer(uid('ch_mate'), ev.id).cheers, 1); // once each
  assert.throws(() => cheer(uid('ch_owner'), ev.id), /own_post/);
  assert.throws(() => cheer(uid('ch_stranger'), ev.id), /not_found/);
  const item = (await api('GET', '/api/feed', { token: b.token })).items.find((x) => x.type === 'milestone' && x.id === ev.id);
  assert.equal(item.cheers, 1); assert.equal(item.cheered, true);
  assert.ok(c.token);
});
