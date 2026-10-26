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
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0306${String(7000000 + n)}`, password: 'secret1', cityId: 1172451, invite } });
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

// a caravan with these members: the owner creates it and invites, each member accepts
async function caravanOf(owner, name, members) {
  assert.ok((await api('POST', '/api/caravan', { token: owner.token, body: { name } })).id);
  for (const m of members) {
    await api('POST', '/api/caravan/invite', { token: owner.token, body: { username: m.me.username } });
    const v = await api('GET', '/api/caravan', { token: m.token });
    assert.equal((await api('POST', `/api/caravan/invitations/${v.invitations[0].id}`, { token: m.token, body: { accept: true } })).ok, true);
  }
}

test('the feed shows announcements, caravan milestones to the right people only, and each crore to everyone', async () => {
  const root = await signup('fd_root');
  const kid = await signup('fd_kid', 'fd_root');
  const stranger = await signup('fd_stranger');
  await caravanOf(root, 'fd_caravan', [kid]);
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

test('rankings: people, caravans (named groups) and Qabila (everyone under me in the invite tree)', async () => {
  const root = await signup('rk_root');
  const kid = await signup('rk_kid', 'rk_root');
  const grand = await signup('rk_grand', 'rk_kid');
  const friend = await signup('rk_friend');
  await caravanOf(root, 'rk_caravan', [friend]);                    // the caravan is a different group from the invite tree
  await log(root, 100); await log(kid, 200); await log(grand, 400); await log(friend, 50);
  const rows = async (type, q = '&period=week') => (await api('GET', `/api/leaderboard?type=${type}${q}`, { token: root.token })).rows;
  const score = async (type, user = 'rk_root', q) => (await rows(type, q)).find((r) => r.username === user)?.score;
  assert.equal(await score('users'), 100);
  assert.equal(await score('trees'), 700, 'Qabila = everyone under me in the invite tree: 100 + 200 + 400');
  assert.equal(await score('teams'), 700, 'the old name still means the tree');
  assert.equal(await score('trees', 'rk_root', '&period=all'), 700);
  assert.equal(await score('trees', 'rk_root', '&metric=average'), 233, '700 / 3');
  const cv = await rows('caravans');
  assert.equal(cv.find((r) => r.name === 'rk_caravan').score, 150, 'the caravan is root + friend, not the invite tree: 100 + 50');
  assert.equal(cv.find((r) => r.name === 'rk_caravan').me, true);
  assert.equal(cv.find((r) => r.name === 'rk_caravan').members, 2);
  assert.equal((await rows('caravans', '&period=all')).find((r) => r.name === 'rk_caravan').score, 150);
  assert.equal((await rows('caravans', '&metric=average')).find((r) => r.name === 'rk_caravan').score, 75, 'average per active member: 150 / 2');
  const t = await api('GET', '/api/team', { token: root.token });
  assert.equal(t.total, 700);
  assert.equal(t.direct.length, 1);
  assert.ok(!('caravan' in t) && !('karwan' in t), 'the invite tree no longer carries caravan numbers');
});

test('caravan badges follow the named group; Qabila badges follow the invite tree', async () => {
  const root = await signup('ms_root');
  const kid = await signup('ms_kid', 'ms_root');
  const grand = await signup('ms_grand', 'ms_kid');
  const pal = await signup('ms_pal');
  await caravanOf(root, 'ms_caravan', [pal]);
  await log(root, 200); await log(kid, 4000); await log(grand, 8000);   // tree under root: 12,000; caravan (root + pal): 200
  let me = await api('GET', '/api/me', { token: root.token });
  assert.ok(me.badges.includes('caravan10k'), 'the referral tree (Qabila) passed 10,000');
  assert.ok(!me.badges.includes('group10k'), 'the caravan has not');
  assert.equal((await api('GET', '/api/caravan', { token: root.token })).caravan.total, 200);
  await log(pal, 10_000);                                               // the caravan: 10,200
  me = await api('GET', '/api/me', { token: root.token });
  assert.ok(me.badges.includes('group10k'), 'the caravan passed 10,000, and every active member shares it');
  assert.ok((await api('GET', '/api/me', { token: pal.token })).badges.includes('group10k'));
  assert.ok(!(await api('GET', '/api/me', { token: kid.token })).badges.includes('group10k'), 'someone outside the caravan does not');
  const msgs = (await feed(root)).items.filter((i) => i.type === 'milestone' && i.username === 'ms_root').map((i) => i.code);
  assert.ok(msgs.includes('group10k') && msgs.includes('caravan10k'));
  assert.deepEqual(audit().problems, []);
});

test('caravan mates say MashaAllah on a milestone: once each, never on their own, and only on what their caravan can see', async () => {
  const { cheer } = await import('../server/feed.js');
  const uid = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  const a = await signup('ch_owner'), b = await signup('ch_mate'), c = await signup('ch_stranger');
  await api('POST', '/api/caravan', { token: a.token, body: { name: 'cheer_cv' } });
  await api('POST', '/api/caravan/invite', { token: a.token, body: { username: 'ch_mate' } });
  const inv = (await api('GET', '/api/caravan', { token: b.token })).invitations[0];
  await api('POST', `/api/caravan/invitations/${inv.id}`, { token: b.token, body: { accept: true } });
  await api('POST', '/api/log', { token: a.token, body: { count: 1000, rid: 'cheer-log-1000' } });
  const ev = db.prepare("SELECT id FROM feed_events WHERE user_id = ? AND kind = 'badge' ORDER BY id DESC LIMIT 1").get(uid('ch_owner'));
  assert.ok(ev);
  assert.equal(cheer(uid('ch_mate'), ev.id).cheers, 1);
  assert.equal(cheer(uid('ch_mate'), ev.id).cheers, 1); // once each
  assert.throws(() => cheer(uid('ch_owner'), ev.id), /own_post/);
  assert.throws(() => cheer(uid('ch_stranger'), ev.id), /not_found/);
  const item = (await api('GET', '/api/feed', { token: b.token })).items.find((x) => x.type === 'milestone' && x.id === ev.id);
  assert.equal(item.cheers, 1); assert.equal(item.cheered, true);
});

test('reading material: a Google Drive link is accepted, stored as an id, and any other address is refused', async () => {
  const post = (youtube_id) => api('POST', '/api/admin/lectures', { headers: admin, body: { youtube_id, title_en: 'Reading', min_seconds: 30 } });
  assert.equal((await post('https://drive.google.com/file/d/1AbC_defGhIjKlMnOpQrStUv/view?usp=sharing')).status, 200);
  assert.equal((await post('https://drive.google.com/open?id=1AbC_defGhIjKlMnOpQrStUv')).status, 200);
  for (const bad of ['http://drive.google.com/file/d/1AbC_defGhIjKlMnOpQrStUv/view', 'https://evil.example/file/d/1AbC_defGhIjKlMnOpQrStUv/view', 'https://drive.google.com.evil.example/file/d/1AbC_defGhIjKlMnOpQrStUv/view', 'https://drive.google.com/file/d/short/view', 'javascript:alert(1)']) {
    assert.equal((await post(bad)).error, 'bad_lecture', bad);
  }
  const u = await signup('rd_a');
  const l = (await api('GET', '/api/lectures', { token: u.token })).lectures.filter((x) => x.kind === 'drive');
  assert.ok(l.length >= 2);
  assert.equal(l[0].driveId, '1AbC_defGhIjKlMnOpQrStUv');
  const res = await fetch(base + '/');
  assert.match(res.headers.get('content-security-policy'), /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/drive\.google\.com;/);
});
