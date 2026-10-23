import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';

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
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0301${String(2000000 + n)}`, password: 'secret1' } });
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
const feedIds = async (u) => (await api('GET', '/api/feed', { token: u.token })).posts.map((p) => p.id);

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

test('three independent confirmations verify a post and pay poster and agreeing reviewers once', async () => {
  const a = await signup('poster_v');
  const [b, c, d, e] = [await signup('rev_b'), await signup('rev_c'), await signup('rev_d'), await signup('rev_e')];
  const img = fakeJpeg();
  const p = await post(a, img);
  assert.equal(p.mine.status, 'pending');
  assert.equal((await post(a)).error, 'already_posted');
  assert.equal((await post(b, img)).error, 'duplicate_image'); // same file cannot be reused by someone else
  const id = p.id;

  assert.ok(!(await feedIds(a)).includes(id)); // own post is never offered
  assert.equal((await api('POST', `/api/posts/${id}/vote`, { token: a.token, body: { vote: 'confirm' } })).error, 'own_post');
  const item = (await api('GET', '/api/feed', { token: b.token })).posts.find((x) => x.id === id);
  assert.ok(item && !('confirms' in item) && !('username' in item)); // votes and identity hidden from reviewers

  const before = { a: await xp(a), b: await xp(b) };
  await api('POST', `/api/posts/${id}/vote`, { token: b.token, body: { vote: 'confirm' } });
  assert.equal((await api('POST', `/api/posts/${id}/vote`, { token: b.token, body: { vote: 'confirm' } })).error, 'already_voted');
  assert.ok(!(await feedIds(b)).includes(id));
  await api('POST', `/api/posts/${id}/vote`, { token: c.token, body: { vote: 'confirm' } });
  assert.equal((await api('GET', '/api/sunnah/today', { token: a.token })).mine.status, 'pending');
  assert.equal(await xp(a), before.a); // nothing paid before consensus
  const last = await api('POST', `/api/posts/${id}/vote`, { token: d.token, body: { vote: 'confirm' } });
  assert.equal(last.outcome, 'verified');

  assert.equal((await api('GET', '/api/sunnah/today', { token: a.token })).mine.status, 'verified');
  assert.equal(await xp(a), before.a + CFG.sunnahXp);
  assert.equal(await xp(b), before.b + CFG.verifyXp);
  const meA = await api('GET', '/api/me', { token: a.token });
  assert.ok(meA.badges.includes('sunnah1'));
  assert.equal(meA.sunnah.verified, 1);
  assert.equal((await api('POST', `/api/posts/${id}/vote`, { token: e.token, body: { vote: 'confirm' } })).error, 'already_resolved');
  assert.deepEqual(audit().problems, []);
});

test('rejection pays only reviewers who matched the outcome, and nothing to the poster', async () => {
  const f = await signup('poster_r');
  const [g, h, i, j] = [await signup('rev_g'), await signup('rev_h'), await signup('rev_i'), await signup('rev_j')];
  const { id } = await post(f);
  const xpBefore = { f: await xp(f), g: await xp(g), h: await xp(h) };
  await api('POST', `/api/posts/${id}/vote`, { token: g.token, body: { vote: 'confirm' } });
  await api('POST', `/api/posts/${id}/vote`, { token: h.token, body: { vote: 'reject' } });
  await api('POST', `/api/posts/${id}/vote`, { token: i.token, body: { vote: 'reject' } });
  const last = await api('POST', `/api/posts/${id}/vote`, { token: j.token, body: { vote: 'reject' } });
  assert.equal(last.outcome, 'rejected');
  assert.equal((await api('GET', '/api/sunnah/today', { token: f.token })).mine.status, 'rejected');
  assert.equal(await xp(f), xpBefore.f);
  assert.equal(await xp(g), xpBefore.g); // voted against the consensus
  assert.equal(await xp(h), xpBefore.h + CFG.verifyXp);
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

  for (const r of reporters) await api('POST', `/api/posts/${id}/report`, { token: r.token });
  assert.ok(!(await feedIds(await signup('late_viewer'))).includes(id));
  assert.equal((await fetch(base + url)).status, 404);
  assert.equal((await api('GET', '/api/sunnah/mine', { token: k.token })).posts[0].status, 'removed');

  assert.equal((await api('POST', `/api/admin/posts/${id}`, { headers: admin, body: { action: 'restore' } })).ok, true);
  assert.equal((await fetch(base + url)).status, 200);
  assert.equal((await api('GET', '/api/sunnah/mine', { token: k.token })).posts[0].status, 'pending');
  const rep = await api('GET', '/api/admin/reported', { headers: admin });
  assert.ok(Array.isArray(rep.posts));
  assert.deepEqual(audit().problems, []);
});

test('audit detects tampered sunnah payouts and votes', async () => {
  const { db } = await import('../server/db.js');
  db.prepare("UPDATE posts SET confirms = confirms + 1 WHERE status = 'verified'").run();
  assert.ok(audit().problems.some((p) => p.kind === 'post_votes'));
  db.prepare("UPDATE posts SET confirms = confirms - 1 WHERE status = 'verified'").run();
  db.prepare("DELETE FROM events WHERE kind = 'sunnah'").run();
  assert.ok(audit().problems.some((p) => p.kind === 'post_payout'));
});
