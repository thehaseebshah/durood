import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';

const { createServer } = await import('../server/index.js');
const { cleanJpeg } = await import('../server/sunnah.js');
const { audit } = await import('../server/audit.js');
const { dayOf, CFG } = await import('../server/game.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  if (path === '/api/log' && body && body.rid === undefined) body = { ...body, rid: crypto.randomUUID() };
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const admin = { 'x-admin-key': 'test-admin' };
const signup = async (username) => {
  n += 1;
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0301${String(2000000 + n)}`, password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
};
const xp = async (u) => (await api('GET', '/api/me', { token: u.token })).xp;

// a structurally valid JPEG (no real picture) with fake EXIF/GPS and unique image data
function fakeJpeg({ exif = true, w = 400, h = 400, size = 2000 } = {}) {
  const seg = (m, body) => Buffer.concat([Buffer.from([0xff, m]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const sof = Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
  const scan = Buffer.alloc(size);
  for (let i = 0; i < size; i++) scan[i] = crypto.randomInt(0, 255); // never 0xFF
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    exif ? seg(0xe1, Buffer.from('Exif\0\0GPSLatitude=31.5204;GPSLongitude=74.3587')) : Buffer.alloc(0),
    seg(0xfe, Buffer.from('secret comment')),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    scan,
    Buffer.from([0xff, 0xd9]),
  ]);
}
const b64 = (b) => b.toString('base64');
const post = (u, buf = fakeJpeg()) => api('POST', '/api/sunnah/post', { token: u.token, body: { image: b64(buf) } });

test('image cleaning strips metadata and rejects non-JPEGs', () => {
  const raw = fakeJpeg();
  assert.ok(raw.includes('GPSLatitude') && raw.includes('secret comment'));
  const { data, width, height } = cleanJpeg(raw);
  assert.ok(!data.includes('GPSLatitude') && !data.includes('secret comment'));
  assert.deepEqual([width, height], [400, 400]);
  assert.equal(data[0], 0xff); assert.equal(data.at(-1), 0xd9);
  assert.throws(() => cleanJpeg(Buffer.from('not an image'.repeat(200))), /bad_image/);
  assert.throws(() => cleanJpeg(fakeJpeg({ w: 50, h: 50 })), /bad_image/);
  assert.throws(() => cleanJpeg(raw.subarray(0, raw.length - 2)), /bad_image/);
});

test('posting needs a scheduled sunnah; admin schedules one', async () => {
  const a = await signup('poster_a');
  assert.equal((await post(a)).error, 'no_sunnah');
  assert.equal((await api('POST', '/api/admin/sunnahs', { body: { day: dayOf(), title_en: 'x' } })).status, 403);
  const r = await api('POST', '/api/admin/sunnahs', { headers: admin, body: { sunnahs: [{ day: dayOf(), title_en: 'Smile at someone', title_ur: 'مسکراہٹ', desc_en: 'd', source: 'test fixture' }] } });
  assert.deepEqual(r.days, [dayOf()]);
  const t = await api('GET', '/api/sunnah/today', { token: a.token });
  assert.equal(t.sunnah.titleEn, 'Smile at someone');
  assert.equal(t.mine, null);
  assert.equal((await api('POST', '/api/sunnah/post', { token: a.token, body: { image: b64(Buffer.from('x'.repeat(5000))) } })).error, 'bad_image');
});

test('posting a photo pays the reward at once and the post shows in the feed', async () => {
  const a = await signup('poster_v');
  const before = await xp(a);
  const img = fakeJpeg();
  const p = await post(a, img);
  assert.ok(p.id, 'posted');
  assert.equal(p.mine.status, 'verified', 'no waiting for reviewers');
  assert.equal((await post(a)).error, 'already_posted');
  assert.equal((await post(await signup('poster_dup'), img)).error, 'duplicate_image'); // the same file cannot be reused by someone else
  assert.equal(await xp(a), before + CFG.sunnahXp, 'the photo reward is paid in the same step');
  const meA = await api('GET', '/api/me', { token: a.token });
  assert.ok(meA.badges.includes('sunnah1'));
  assert.equal(meA.sunnah.posted, 1);
  const viewer = await signup('viewer_a');
  const item = (await api('GET', '/api/feed', { token: viewer.token })).items.find((i) => i.type === 'photo' && i.id === p.id);
  assert.ok(item && item.username === 'poster_v' && item.likes === 0 && item.liked === false);
  assert.deepEqual(audit().problems, []);
});

test('likes: one per member, never your own, the poster earns 2 points each for the first 10 only, liking earns nothing', async () => {
  const a = await signup('liked_a');
  const p = await post(a);
  const fans = [];
  for (let i = 0; i < 12; i++) fans.push(await signup(`fan_${i}`));
  const base = await xp(a);
  assert.equal((await api('POST', '/api/like', { token: a.token, body: { kind: 'post', id: p.id } })).error, 'own_post');
  const fanXp = await xp(fans[0]);
  assert.equal((await api('POST', '/api/like', { token: fans[0].token, body: { kind: 'post', id: p.id } })).likes, 1);
  assert.equal((await api('POST', '/api/like', { token: fans[0].token, body: { kind: 'post', id: p.id } })).error, 'already_liked');
  assert.equal(await xp(fans[0]), fanXp, 'the person who likes earns nothing');
  assert.equal(await xp(a), base + CFG.likeXp);
  for (const f of fans.slice(1)) await api('POST', '/api/like', { token: f.token, body: { kind: 'post', id: p.id } });
  assert.equal(await xp(a), base + CFG.likeCap * CFG.likeXp, 'only the first 10 likes pay');
  const item = (await api('GET', '/api/feed', { token: fans[0].token })).items.find((i) => i.type === 'photo' && i.id === p.id);
  assert.equal(item.likes, 12);
  assert.equal(item.liked, true);
  assert.equal((await api('POST', '/api/like', { token: fans[0].token, body: { kind: 'nope', id: 1 } })).error, 'bad_kind');
  assert.equal((await api('POST', '/api/like', { token: fans[0].token, body: { kind: 'post', id: 99999 } })).error, 'not_found');
  assert.deepEqual(audit().problems, []);
});

test('reports hide a post; admin can restore; photos are served only with a valid signature and without metadata', async () => {
  const k = await signup('poster_k');
  const reporters = [await signup('rep_1'), await signup('rep_2'), await signup('rep_3')];
  const { id } = await post(k);
  const url = (await api('GET', '/api/sunnah/today', { token: k.token })).mine.photoUrl;
  const ok = await fetch(base + url);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.ok(!Buffer.from(await ok.arrayBuffer()).includes('GPSLatitude'));
  assert.equal((await fetch(base + url.slice(0, -3) + 'abc')).status, 404);

  assert.equal((await api('POST', '/api/report', { token: k.token, body: { kind: 'post', id } })).error, 'own_post');
  for (const r of reporters) await api('POST', '/api/report', { token: r.token, body: { kind: 'post', id } });
  const viewer = await signup('late_viewer');
  assert.ok(!(await api('GET', '/api/feed', { token: viewer.token })).items.some((i) => i.type === 'photo' && i.id === id));
  assert.equal((await fetch(base + url)).status, 404);
  assert.equal((await api('GET', '/api/sunnah/mine', { token: k.token })).posts[0].status, 'removed');
  const rep = await api('GET', '/api/admin/reported', { headers: admin });
  assert.ok(rep.items.some((i) => i.kind === 'post' && i.id === id && i.status === 'removed'));

  assert.equal((await api('POST', `/api/admin/content/post/${id}`, { headers: admin, body: { action: 'restore' } })).ok, true);
  assert.equal((await fetch(base + url)).status, 200);
  assert.equal((await api('GET', '/api/sunnah/mine', { token: k.token })).posts[0].status, 'verified');
  assert.equal((await api('POST', `/api/admin/content/post/${id}`, { headers: admin, body: { action: 'bogus' } })).error, 'bad_action');
  assert.deepEqual(audit().problems, []);
});

test('audit detects tampered post payouts and like counts', async () => {
  const { db } = await import('../server/db.js');
  db.prepare("UPDATE posts SET likes = likes + 1 WHERE status = 'verified'").run();
  assert.ok(audit().problems.some((p) => p.kind === 'post_likes'));
  db.prepare("UPDATE posts SET likes = likes - 1 WHERE status = 'verified'").run();
  assert.deepEqual(audit().problems.filter((p) => p.kind === 'post_likes'), []);
  const saved = db.prepare("SELECT * FROM events WHERE kind = 'sunnah'").all();
  db.prepare("DELETE FROM events WHERE kind = 'sunnah'").run();
  assert.ok(audit().problems.some((p) => p.kind === 'post_payout'));
  for (const e of saved) db.prepare('INSERT INTO events (user_id, kind, ref, day, xp, created_at) VALUES (?,?,?,?,?,?)').run(e.user_id, e.kind, e.ref, e.day, e.xp, e.created_at);
  db.prepare("DELETE FROM events WHERE kind = 'like' AND ref = (SELECT MIN(ref) FROM events WHERE kind = 'like')").run();
  assert.ok(audit().problems.some((p) => p.kind === 'like_payout'));
});

test('photos are deleted after review plus the retention period, and on account deletion; the record stays', async () => {
  const { purgeOldPhotos } = await import('../server/sunnah.js');
  const { existsSync } = await import('node:fs');
  const path = await import('node:path');
  const { UPLOAD_DIR } = await import('../server/sunnah.js');
  const { db } = await import('../server/db.js');
  const a = await signup('keep_a');
  await api('POST', '/api/admin/sunnahs', { headers: admin, body: { sunnahs: [{ day: dayOf(), title_en: 'Smile again' }] } }).catch(() => {});
  const p = await post(a);
  assert.ok(p.id, 'posted');
  const row = () => db.prepare('SELECT * FROM posts WHERE id = ?').get(p.id);
  const file = path.join(UPLOAD_DIR, row().file);
  assert.equal(purgeOldPhotos(), 0, 'a fresh post is kept');
  db.prepare('UPDATE posts SET resolved_at = ? WHERE id = ?').run(Date.now() - 3 * 86400e3, p.id);
  assert.equal(purgeOldPhotos(), 0, 'posted 3 days ago: still inside the 14-day window');
  assert.ok(existsSync(file));
  db.prepare('UPDATE posts SET resolved_at = ? WHERE id = ?').run(Date.now() - 15 * 86400e3, p.id);
  assert.equal(purgeOldPhotos(), 1);
  assert.ok(!existsSync(file), 'file is gone');
  assert.ok(row().purged_at, 'the row, votes and payouts stay');
  const url = (await api('GET', '/api/sunnah/mine', { token: a.token })).posts[0];
  assert.equal(url.photoUrl, null);
  assert.equal(purgeOldPhotos(), 0, 'idempotent');

  const b = await signup('keep_b');
  const pb = await post(b);
  const fb = path.join(UPLOAD_DIR, db.prepare('SELECT file FROM posts WHERE id = ?').get(pb.id).file);
  assert.ok(existsSync(fb));
  assert.equal((await api('DELETE', '/api/me', { token: b.token, body: { password: 'secret1' } })).ok, true);
  assert.ok(!existsSync(fb), 'deleting an account deletes its pictures at once');
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(pb.id).status, 'removed');
  assert.ok(!(await api('GET', '/api/feed', { token: a.token })).items.some((i) => i.type === 'photo' && i.id === pb.id));
});
