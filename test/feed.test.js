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
const signup = (username, invite = 'TESTFOUND') => {
  n += 1;
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0306${String(7000000 + n)}`, password: 'secret1', invite } });
};
const log = (u, count) => api('POST', '/api/log', { token: u.token, body: { count, rid: crypto.randomUUID() } });
const xp = async (u) => (await api('GET', '/api/me', { token: u.token })).xp;
const feed = async (u, q = '') => (await api('GET', `/api/feed${q}`, { token: u.token }));
const reflect = (u, text) => api('POST', '/api/reflections', { token: u.token, body: { text } });

test('daily reflection: one short plain-text post a day, no links, pays its quest once', async () => {
  await api('POST', '/api/admin/prompts', { headers: admin, body: { day: dayOf(), text_en: 'What did you learn from the Seerah this week?', text_ur: 'آپ نے اس ہفتے سیرت سے کیا سیکھا؟' } });
  const a = await signup('refl_a');
  assert.equal((await feed(a)).reflection.prompt.textEn, 'What did you learn from the Seerah this week?');
  assert.equal((await reflect(a, '   ')).error, 'empty_text');
  assert.equal((await reflect(a, 'x'.repeat(281))).error, 'text_too_long');
  assert.equal((await reflect(a, 'Read more at https://example.com')).error, 'no_links');
  assert.equal((await reflect(a, 'see www.example.org')).error, 'no_links');
  assert.equal((await reflect(a, 'visit shop.com now')).error, 'no_links');
  const before = await xp(a);
  const ok = await reflect(a, 'Patience  in hardship\u0007 is a mercy.');
  assert.ok(ok.id);
  assert.equal(await xp(a), before + CFG.reflectXp, 'the daily reflection quest pays');
  assert.equal(ok.reflection.mine.body, 'Patience in hardship is a mercy.', 'control characters and doubled spaces are cleaned');
  assert.equal((await reflect(a, 'again')).error, 'already_posted');
  assert.equal((await reflect({ token: null }, 'x')).status, 401);
  assert.equal((await reflect(await signup('refl_280'), 'ا'.repeat(280))).status, 200, 'exactly 280 characters is fine, counted as characters not bytes');
  const viewer = await signup('refl_viewer');
  const item = (await feed(viewer)).items.find((i) => i.type === 'reflection' && i.id === ok.id);
  assert.equal(item.username, 'refl_a');
  assert.equal(item.promptEn, 'What did you learn from the Seerah this week?');
  assert.equal((await api('POST', '/api/like', { token: viewer.token, body: { kind: 'reflection', id: ok.id } })).likes, 1);
  assert.equal(await xp(a), before + CFG.reflectXp + CFG.likeXp, 'a like on a reflection pays the poster');
  assert.deepEqual(audit().problems, []);
});

test('reflections can be reported and hidden, and restored by an admin', async () => {
  const a = await signup('refl_rep');
  const { id } = await reflect(a, 'A thought');
  const rs = [await signup('rr_1'), await signup('rr_2'), await signup('rr_3')];
  assert.equal((await api('POST', '/api/report', { token: a.token, body: { kind: 'reflection', id } })).error, 'own_post');
  for (const r of rs) await api('POST', '/api/report', { token: r.token, body: { kind: 'reflection', id } });
  assert.ok(!(await feed(rs[0])).items.some((i) => i.type === 'reflection' && i.id === id), 'hidden after three reports');
  assert.ok((await api('GET', '/api/admin/reported', { headers: admin })).items.some((i) => i.kind === 'reflection' && i.id === id));
  await api('POST', `/api/admin/content/reflection/${id}`, { headers: admin, body: { action: 'restore' } });
  assert.ok((await feed(rs[0])).items.some((i) => i.type === 'reflection' && i.id === id), 'back after restore');
});

test('the feed shows announcements, caravan milestones to the right people only, and each crore to everyone', async () => {
  const root = await signup('fd_root');
  const kid = await signup('fd_kid', 'fd_root');
  const stranger = await signup('fd_stranger');
  await log(kid, 1000);                                             // d1k badge
  const msIn = async (u) => (await feed(u)).items.filter((i) => i.type === 'milestone' && i.username === 'fd_kid' && i.code === 'd1k');
  assert.equal((await msIn(kid)).length, 1, 'the member sees their own milestone');
  assert.equal((await msIn(root)).length, 1, 'the person who invited them sees it');
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
  assert.ok('today' in first && 'lectures' in first && 'reflection' in first, 'the first page carries the composer state');
});

test('lectures belong to a week: this week shows, other weeks do not, any date in a week means that week', async () => {
  const v = await signup('wk_viewer');
  const mk = (week) => api('POST', '/api/admin/lectures', { headers: admin, body: { youtube_id: 'dQw4w9WgXcQ', title_en: `Lecture ${week || 'now'}`, min_seconds: 30, ...(week && { week }) } });
  const mon = weekStart();
  const next = new Date(Date.parse(mon + 'T00:00:00Z') + 9 * 86400e3).toISOString().slice(0, 10);
  const thisWeek = await mk();
  const wed = new Date(Date.parse(mon + 'T00:00:00Z') + 2 * 86400e3).toISOString().slice(0, 10);
  await mk(wed);
  await mk(next);
  assert.equal((await mk('not-a-date')).error, 'bad_lecture');
  const titles = (await api('GET', '/api/lectures', { token: v.token })).lectures.map((l) => l.titleEn);
  assert.ok(titles.includes('Lecture now') && titles.includes(`Lecture ${wed}`));
  assert.ok(!titles.includes(`Lecture ${next}`), 'next week is not shown yet');
  assert.deepEqual((await feed(v)).lectures.map((l) => l.titleEn).sort(), titles.slice().sort());
  assert.ok(thisWeek.id);
  assert.ok((await api('GET', '/api/admin/lectures', { headers: admin })).lectures.some((l) => l.week_start === weekStart(next)));
});

test('three rankings: people, caravans (people I invited myself) and referral trees (everyone under me)', async () => {
  const root = await signup('rk_root');
  const kid = await signup('rk_kid', 'rk_root');
  const grand = await signup('rk_grand', 'rk_kid');
  await log(root, 100); await log(kid, 200); await log(grand, 400);
  const score = async (type, user = 'rk_root', q = '&period=week') => (await api('GET', `/api/leaderboard?type=${type}${q}`, { token: root.token })).rows.find((r) => r.username === user)?.score;
  assert.equal(await score('users'), 100);
  assert.equal(await score('caravans'), 300, 'caravan = me and the people I invited: 100 + 200');
  assert.equal(await score('trees'), 700, 'referral tree = everyone under me: 100 + 200 + 400');
  assert.equal(await score('teams'), 700, 'the old name still means the tree');
  assert.equal(await score('caravans', 'rk_root', '&period=all'), 300);
  assert.equal(await score('trees', 'rk_root', '&period=all'), 700);
  assert.equal(await score('caravans', 'rk_kid'), 600, "the kid's caravan: 200 + 400");
  assert.equal(await score('caravans', 'rk_root', '&metric=average'), 150, 'average per active member of the caravan (2 active)');
  assert.equal(await score('trees', 'rk_root', '&metric=average'), 233, '700 / 3');
  const t = await api('GET', '/api/team', { token: root.token });
  assert.equal(t.caravan.members, 1);
  assert.equal(t.caravan.down, 200);
  assert.equal(t.caravan.week, 300);
  assert.equal(t.total, 700);
});

test('caravan milestones count only the people I invited; tree milestones count everyone under me', async () => {
  const root = await signup('ms_root');
  const kid = await signup('ms_kid', 'ms_root');
  const grand = await signup('ms_grand', 'ms_kid');
  await log(kid, 4000); await log(grand, 8000);                     // tree under root: 12,000; caravan (kid only): 4,000
  let me = await api('GET', '/api/me', { token: root.token });
  assert.ok(me.badges.includes('caravan10k'), 'the referral tree passed 10,000');
  assert.ok(!me.badges.includes('group10k'), 'the caravan has not');
  assert.equal(me.caravan.down, 4000);
  await log(kid, 6000);                                              // kid now 10,000
  me = await api('GET', '/api/me', { token: root.token });
  assert.ok(me.badges.includes('group10k'), 'the caravan passed 10,000');
  const msgs = (await feed(root)).items.filter((i) => i.type === 'milestone' && i.username === 'ms_root').map((i) => i.code);
  assert.ok(msgs.includes('group10k') && msgs.includes('caravan10k'));
  assert.ok(!me.badges.includes('verifier10') && me.badges.every((b) => /^[a-z0-9_]+$/.test(b)));
  assert.deepEqual(audit().problems, []);
});
