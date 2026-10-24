import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';

const { createServer } = await import('../server/index.js');
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
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0302${String(3000000 + n)}`, password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });
};
const xp = async (u) => (await api('GET', '/api/me', { token: u.token })).xp;
function fakeJpeg() {
  const seg = (m, body) => Buffer.concat([Buffer.from([0xff, m]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const scan = Buffer.alloc(2000);
  for (let i = 0; i < 2000; i++) scan[i] = crypto.randomInt(0, 255);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xc0, Buffer.from([8, 1, 144, 1, 144, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), scan, Buffer.from([0xff, 0xd9])]);
}
const Q = [
  { q_en: 'Where was the Prophet born?', options_en: ['Makkah', 'Madinah', 'Taif'], answer: 0 },
  { q_en: 'Who was his mother?', options_en: ['Aminah', 'Halimah'], answer: 0 },
];

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

test('video quiz: wrong answers never reveal the key; reward needs a pass and is paid once', async () => {
  const a = await signup('quiz_a');
  assert.equal((await api('POST', '/api/admin/lectures', { headers: admin, body: { youtube_id: 'dQw4w9WgXcQ', title_en: 'Bad', questions: [{ q_en: 'x', options_en: ['a'], answer: 0 }] } })).status, 400);
  const lec = await api('POST', '/api/admin/lectures', { headers: admin, body: { youtube_id: 'dQw4w9WgXcQ', title_en: 'Seerah 1', min_seconds: 30, questions: Q } });
  const listed = (await api('GET', '/api/lectures', { token: a.token })).lectures.find((l) => l.id === lec.id);
  assert.equal(listed.quiz.length, 2);
  assert.ok(!JSON.stringify(listed).includes('"answer"'));
  assert.equal(listed.quizPassed, false);

  await api('POST', `/api/lectures/${lec.id}/start`, { token: a.token });
  db.prepare('UPDATE lecture_starts SET started_at = started_at - 60000').run();
  assert.equal((await api('POST', `/api/lectures/${lec.id}/complete`, { token: a.token })).error, 'quiz_needed');
  const bad = await api('POST', `/api/lectures/${lec.id}/quiz`, { token: a.token, body: { answers: [0, 1] } });
  assert.deepEqual([bad.passed, bad.wrong], [false, [1]]);
  assert.equal((await api('POST', `/api/lectures/${lec.id}/complete`, { token: a.token })).error, 'quiz_needed');
  assert.equal((await api('POST', `/api/lectures/${lec.id}/quiz`, { token: a.token, body: { answers: [0] } })).error, 'bad_answers');
  assert.equal((await api('POST', `/api/lectures/${lec.id}/quiz`, { token: a.token, body: { answers: [0, 0] } })).passed, true);
  const before = await xp(a);
  const done = await api('POST', `/api/lectures/${lec.id}/complete`, { token: a.token });
  assert.equal(done.xpGained, 100);
  assert.equal(await xp(a), before + 100 + 30); // lecture plus the daily lecture quest
  assert.equal((await api('POST', `/api/lectures/${lec.id}/complete`, { token: a.token })).already, true);
  assert.deepEqual(audit().problems, []);
});

test('the weekly class photo pays classXp at once, once per week, and shows in the feed', async () => {
  const a = await signup('class_a');
  const t0 = await xp(a);
  const post = await api('POST', '/api/class/post', { token: a.token, body: { image: fakeJpeg().toString('base64') } });
  assert.ok(post.id);
  assert.equal(post.classPost.status, 'verified');
  assert.equal(await xp(a), t0 + CFG.classXp);
  assert.equal((await api('POST', '/api/class/post', { token: a.token, body: { image: fakeJpeg().toString('base64') } })).error, 'already_posted');
  const viewer = await signup('class_viewer');
  const item = (await api('GET', '/api/feed', { token: viewer.token })).items.find((i) => i.type === 'photo' && i.id === post.id);
  assert.equal(item.kind, 'class');
  assert.deepEqual(audit().problems, []);
});
