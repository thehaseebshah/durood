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
const { db } = await import('../server/db.js');
const { dayOf, CFG } = await import('../server/game.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
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
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0302${String(3000000 + n)}`, password: 'secret1', cityId: 1172451, invite: 'testcv' } });
};
const xp = async (u) => (await api('GET', '/api/me', { token: u.token })).xp;
function fakeJpeg() {
  const seg = (m, body) => Buffer.concat([Buffer.from([0xff, m]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const scan = Buffer.alloc(2000);
  for (let i = 0; i < 2000; i++) scan[i] = crypto.randomInt(0, 255);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xc0, Buffer.from([8, 1, 144, 1, 144, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), scan, Buffer.from([0xff, 0xd9])]);
}
test('daily sunnah: the tick pays once, a verified photo brings a day to 3x the tick', async () => {
  await api('POST', '/api/admin/sunnahs', { headers: admin, body: { sunnahs: [{ day: dayOf(), title_en: 'Smile' }] } });
  const a = await signup('tick_a');
  const t0 = await xp(a);
  assert.equal((await api('POST', '/api/sunnah/tick', { token: a.token })).xpGained, CFG.sunnahTickXp);
  assert.equal((await api('POST', '/api/sunnah/tick', { token: a.token })).already, true);
  assert.equal(await xp(a), t0 + CFG.sunnahTickXp);
  assert.equal((await api('GET', '/api/sunnah/today', { token: a.token })).ticked, true);
  assert.equal(CFG.sunnahTickXp + CFG.sunnahXp, 3 * CFG.sunnahTickXp);

  const post = await api('POST', '/api/sunnah/post', { token: a.token, body: { image: fakeJpeg().toString('base64') } });
  const revs = [await signup('tick_r1'), await signup('tick_r2'), await signup('tick_r3')];
  for (const r of revs) await api('POST', `/api/posts/${post.id}/vote`, { token: r.token, body: { vote: 'confirm' } });
  assert.equal(await xp(a), t0 + 3 * CFG.sunnahTickXp);
  assert.deepEqual(audit().problems, []);
});

test('replies on a Sunnah photo are short, capped, and pay a little; three reports hide one', async () => {
  await api('POST', '/api/admin/sunnahs', { headers: admin, body: { sunnahs: [{ day: dayOf(), title_en: 'Smile' }] } });
  const a = await signup('cm_a'), b = await signup('cm_b'), c = await signup('cm_c');
  const mine = await api('POST', '/api/sunnah/post', { token: a.token, body: { image: fakeJpeg().toString('base64') } });
  assert.ok(mine.id);
  assert.equal((await api('POST', '/api/like', { token: b.token, body: { kind: 'post', id: mine.id } })).likes, 1);
  assert.equal((await api('POST', '/api/like', { token: a.token, body: { kind: 'post', id: mine.id } })).error, 'own_post');
  assert.equal((await api('POST', '/api/like', { token: b.token, body: { kind: 'comment', id: 1 } })).error, 'bad_kind', 'there are no comments any more');

  // replies: 140 characters, 3 per member per post, XP only on someone else's post
  const reply = (u, text, kind = 'post', id = mine.id) => api('POST', '/api/replies', { token: u.token, body: { kind, id, text } });
  const t0 = await xp(b);
  assert.equal((await reply(b, 'x'.repeat(141))).error, 'text_too_long');
  assert.equal((await reply(b, 'visit www.example.com')).error, 'no_links');
  assert.equal((await reply(b, 'JazakAllah')).xp, CFG.replyXp);
  assert.equal(await xp(b), t0 + CFG.replyXp);
  await reply(b, 'Two'); await reply(b, 'Three');
  assert.equal((await reply(b, 'Four')).error, 'reply_limit');
  assert.equal((await api('GET', `/api/replies?kind=post&id=${mine.id}`, { token: c.token })).replies.length, 3);
  assert.equal((await reply(a, 'Thanks')).xp, 0); // own post earns nothing
  assert.equal((await reply(b, 'hi', 'post', 999999)).error, 'not_found');
  assert.equal((await reply(b, 'hi', 'comment', mine.id)).error, 'bad_kind');
  assert.equal((await api('POST', '/api/like', { token: b.token, body: { kind: 'reply', id: 1 } })).error, 'bad_kind');

  // three reports hide a reply
  const rid = (await api('GET', `/api/replies?kind=post&id=${mine.id}`, { token: c.token })).replies[0].id;
  const d = await signup('cm_d'), e = await signup('cm_e');
  for (const u of [c, d, e]) await api('POST', '/api/report', { token: u.token, body: { kind: 'reply', id: rid } });
  assert.equal((await api('GET', `/api/replies?kind=post&id=${mine.id}`, { token: c.token })).replies.some((r) => r.id === rid), false);
  assert.ok((await api('GET', '/api/admin/reported', { headers: admin })).items.some((i) => i.kind === 'reply' && i.id === rid));
  assert.deepEqual(audit().problems, []);
});

test('the class photo is gone: the route is not there and daily posts still work', async () => {
  const a = await signup('noclass');
  assert.equal((await api('POST', '/api/class/post', { token: a.token, body: { image: fakeJpeg().toString('base64') } })).status, 404);
  assert.equal((await api('GET', '/api/sunnah/today', { token: a.token })).classPost, undefined);
});

test('XP balance: a tiny personal goal pays nothing extra, and no single recurring action outweighs a Sunnah day', async () => {
  const a = await signup('econ_a');
  await api('PATCH', '/api/me', { token: a.token, body: { dailyGoal: 1 } });
  const t0 = await xp(a);
  const r = await api('POST', '/api/log', { token: a.token, body: { count: 1, rid: crypto.randomUUID() } });
  assert.equal(r.me.quests.find((q) => q.id === 'goal').done, false);
  assert.equal(await xp(a), t0 + 1);
  // the daily ceilings of the small actions, from the configuration itself
  const sunnahDay = CFG.sunnahTickXp + CFG.sunnahXp;
  const daily = {
    replies: CFG.replyXp * CFG.replyDailyCap,
    photoLikes: CFG.likeXp * CFG.likeCap,
  };
  for (const [k, v] of Object.entries(daily)) assert.ok(v <= sunnahDay, `${k} pays ${v}, more than a whole Sunnah day (${sunnahDay})`);
});
