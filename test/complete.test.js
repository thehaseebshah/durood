// Features completed after the half-built audit: Sunnah scheduling, the Seerat Circle claim, moderation "keep", hidden-post notice,
// caravan notifications, honest email status, lecture editing, a held total's final word, and deleting an account from the admin page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';

const { createServer } = await import('../server/index.js');
const { db } = await import('../server/db.js');
const news = await import('../server/news.js');
const { dayOf, dayNum, dayStr } = await import('../server/game.js');
const { audit } = await import('../server/audit.js');

let server, base, n = 0;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const K = (method, path, body) => api(method, `/api/admin${path}`, { headers: { 'x-admin-key': 'test-admin' }, body });
const signup = (username, invite = 'TESTFOUND') => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0307${String(1000000 + n)}`, password: 'secret1', cityId: 1172451, invite, lang: 'en' } }); };
const today = dayOf(), plus = (k) => dayStr(dayNum(today) + k);

test('organisers schedule, list, edit and remove daily Sunnahs; one already used cannot be removed', async () => {
  assert.equal((await K('POST', '/sunnahs', { sunnahs: [{ day: today, title_en: 'Smile', source: 'Tirmidhi' }, { day: plus(1), title_en: 'Salam first' }] })).days.length, 2);
  let list = (await K('GET', '/sunnahs')).sunnahs;
  assert.deepEqual(list.map((x) => x.day), [today, plus(1)]);
  await K('POST', '/sunnahs', { sunnahs: [{ day: plus(1), title_en: 'Give salam first', title_ur: 'پہلے سلام' }] }); // same day: replaced
  list = (await K('GET', '/sunnahs')).sunnahs;
  assert.equal(list.find((x) => x.day === plus(1)).title_ur, 'پہلے سلام');
  const u = await signup('sn_member');
  assert.equal((await api('GET', '/api/feed', { token: u.token })).today.sunnah.titleEn, 'Smile');
  await api('POST', '/api/sunnah/tick', { token: u.token });
  assert.equal((await K('DELETE', `/sunnahs/${today}`)).error, 'sunnah_in_use');
  assert.equal((await K('DELETE', `/sunnahs/${plus(1)}`)).ok, true);
  assert.equal((await K('DELETE', `/sunnahs/${plus(1)}`)).error, 'not_found');
});

test('the Seerat Circle link is set on the admin page, shown on Home, and its reward is claimed once', async () => {
  const u = await signup('ci_member');
  assert.equal((await api('GET', '/api/me', { token: u.token })).circleUrl, '');
  assert.equal((await K('POST', '/circle', { url: 'javascript:alert(1)' })).error, 'bad_url');
  await K('POST', '/circle', { url: 'https://example.org/circles' });
  assert.equal((await api('GET', '/api/me', { token: u.token })).circleUrl, 'https://example.org/circles');
  const c = await api('POST', '/api/circle/claim', { token: u.token });
  assert.equal(c.xpGained, 300);
  assert.ok(c.me.badges.includes('circle'));
  assert.equal((await api('POST', '/api/circle/claim', { token: u.token })).xpGained, 0);
  await K('POST', '/circle', { url: '' });
  assert.equal((await api('GET', '/api/me', { token: u.token })).circleUrl, '');
});

test('moderators keep an unfairly reported reflection (reports cleared); the author sees when theirs was hidden', async () => {
  const a = await signup('kp_author'), b = await signup('kp_reporter');
  const r = await api('POST', '/api/reflections', { token: a.token, body: { text: 'A thought about patience' } });
  await api('POST', '/api/report', { token: b.token, body: { kind: 'reflection', id: r.id } });
  let q = (await K('GET', '/reported')).items.find((i) => i.kind === 'reflection' && i.id === r.id);
  assert.equal(q.reports, 1);
  await K('POST', `/content/reflection/${r.id}`, { action: 'restore' }); // "Keep"
  assert.equal((await K('GET', '/reported')).items.some((i) => i.kind === 'reflection' && i.id === r.id), false);
  await K('POST', `/content/reflection/${r.id}`, { action: 'remove' });
  assert.equal((await api('GET', '/api/feed', { token: a.token })).reflection.mine.status, 'removed');
});

test('a photo whose file is already deleted cannot be "restored" into nothing', async () => {
  const u = await signup('pg_member');
  const s = db.prepare('SELECT id FROM sunnahs WHERE day = ?').get(today);
  const id = Number(db.prepare(`INSERT INTO posts (user_id, sunnah_id, file, sha256, status, created_day, created_at, resolved_at, purged_at) VALUES (?,?,?,?, 'removed', ?,?,?,?)`)
    .run(db.prepare('SELECT id FROM users WHERE username = ?').get('pg_member').id, s.id, 'gone.jpg', crypto.randomBytes(8).toString('hex'), today, Date.now(), Date.now(), Date.now()).lastInsertRowid);
  assert.equal((await K('POST', `/content/post/${id}`, { action: 'restore' })).error, 'photo_gone');
  db.prepare('DELETE FROM posts WHERE id = ?').run(id); // a made-up row: it has no payout history for the audit
  assert.ok(u.token);
});

test('caravan invitations, requests, joins and acceptances send a notification to the right person', async () => {
  const sent = [];
  news.setSender(async (sub, msg) => { sent.push({ to: sub.user_id, title: msg.title, body: msg.body }); return 'ok'; });
  try {
    const o = await signup('pn_owner'), m = await signup('pn_mate'), j = await signup('pn_joiner');
    const idOf = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
    for (const u of ['pn_owner', 'pn_mate', 'pn_joiner']) db.prepare('INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?)').run(`https://fcm.googleapis.com/x/${u}`, idOf(u), 'k', 'a', Date.now());
    await api('POST', '/api/caravan', { token: o.token, body: { name: 'pn_caravan' } });
    await api('POST', '/api/caravan/invite', { token: o.token, body: { username: 'pn_mate' } });
    const inv = (await api('GET', '/api/caravan', { token: m.token })).invitations[0];
    await api('POST', `/api/caravan/invitations/${inv.id}`, { token: m.token, body: { accept: true } });
    await api('POST', '/api/caravan/join', { token: j.token, body: { name: 'pn_caravan' } });
    await api('POST', '/api/caravan/requests/pn_joiner', { token: o.token, body: { accept: true } });
    await new Promise((r) => setTimeout(r, 50));
    const to = (u) => sent.filter((x) => x.to === idOf(u)).map((x) => x.body);
    assert.deepEqual(to('pn_mate'), ['pn_owner invited you to the caravan pn_caravan.']);
    assert.deepEqual(to('pn_owner'), ['pn_mate joined pn_caravan.', 'pn_joiner asked to join pn_caravan.']);
    assert.deepEqual(to('pn_joiner'), ['pn_owner accepted you into pn_caravan.']);
  } finally { news.setSender(null); }
});

test('without an email provider, members and admins are told nothing was emailed', async () => {
  const u = await signup('em_member');
  assert.equal((await api('POST', '/api/email/resend', { token: u.token })).sent, false);
});

test('lectures can be edited (points, quiz) without losing what members earned; the admin list shows the quiz', async () => {
  const quiz = [{ q_en: 'Where was the Prophet ﷺ born?', options_en: ['Makkah', 'Madinah'], answer: 0 }];
  const l = await K('POST', '/lectures', { youtube_id: 'abcdefghijk', title_en: 'Birth', min_seconds: 30, xp: 120, questions: quiz });
  const u = await signup('le_member');
  await api('POST', `/api/lectures/${l.id}/start`, { token: u.token });
  await api('POST', `/api/lectures/${l.id}/quiz`, { token: u.token, body: { answers: [0] } });
  assert.equal((await K('PUT', `/lectures/${l.id}`, { youtube_id: 'abcdefghijk', title_en: 'The blessed birth', min_seconds: 30, xp: 180, questions: [{ ...quiz[0], options_en: ['Makkah', 'Madinah', 'Taif'] }] })).ok, true);
  const row = (await K('GET', '/lectures')).lectures.find((x) => x.id === l.id);
  assert.equal(row.title_en, 'The blessed birth');
  assert.equal(row.xp, 180);
  assert.equal(row.questions[0].options_en.length, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lecture_quiz WHERE lecture_id = ?').get(l.id).n, 1); // the quiz pass is kept
  assert.equal((await K('PUT', '/lectures/99999', { youtube_id: 'abcdefghijk', title_en: 'x' })).error, 'not_found');
});

test('after "keep held" the member gets a final word instead of "being checked" for ever', async () => {
  const u = await signup('fl_member');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get('fl_member').id;
  db.prepare("INSERT INTO flags (user_id, reason, day, detail, day_total, created_at) VALUES (?, 'daily_20k', ?, 'test', 25000, ?)").run(id, today, Date.now());
  db.prepare('UPDATE users SET hidden_from_ranks = 1 WHERE id = ?').run(id);
  assert.equal((await api('GET', '/api/me', { token: u.token })).flagState, 'open');
  const f = db.prepare('SELECT id FROM flags WHERE user_id = ?').get(id);
  await K('POST', `/flags/${f.id}`, { action: 'confirm' });
  assert.equal((await api('GET', '/api/me', { token: u.token })).flagState, 'decided');
});

test('only an owner deletes an account from the admin page, never an admin\'s, and it is anonymised like a self-deletion', async () => {
  const u = await signup('dl_target'); await signup('dl_org');
  await K('POST', '/admins', { username: 'dl_org', role: 'organiser' });
  const tok = (await api('POST', '/api/admin/login', { body: { id: 'dl_org', password: 'secret1' } })).token;
  assert.equal((await api('POST', '/api/admin/members/dl_target', { headers: { 'x-admin-token': tok }, body: { action: 'delete' } })).error, 'not_allowed');
  assert.equal((await K('POST', '/members/dl_org', { action: 'delete' })).error, 'remove_role_first');
  assert.equal((await K('POST', '/members/dl_target', { action: 'delete' })).ok, true);
  assert.equal((await api('GET', '/api/me', { token: u.token })).status, 401);
  assert.equal((await api('POST', '/api/login', { body: { id: 'dl_target', password: 'secret1' } })).error, 'bad_login');
  assert.ok((await K('GET', '/log')).log.some((x) => x.action === 'delete-account' && x.target === 'dl_target'));
  assert.deepEqual(audit().problems, []);
});

test('teaching a Seerat Circle earns more than joining one, once an organiser confirms it', async () => {
  const u = await signup('tc_teacher'), j = await signup('tc_joiner');
  await K('POST', '/circle', { url: 'https://albn.org/seerat' });
  assert.equal((await api('POST', '/api/circle/claim', { token: j.token })).xpGained, 300);
  const before = (await api('GET', '/api/me', { token: u.token })).xp;
  assert.equal((await api('POST', '/api/circle/teach', { token: u.token, body: {} })).me.circleTeach, 'pending');
  assert.equal((await api('GET', '/api/me', { token: u.token })).xp, before); // nothing until confirmed
  assert.equal((await K('GET', '/circle-teachers')).teachers.find((x) => x.username === 'tc_teacher').status, 'pending');
  await K('POST', '/circle-teachers/tc_teacher', { action: 'reject' });
  assert.equal((await api('GET', '/api/me', { token: u.token })).circleTeach, 'rejected');
  await api('POST', '/api/circle/teach', { token: u.token, body: {} }); // can ask again
  await K('POST', '/circle-teachers/tc_teacher', { action: 'approve' });
  const me = await api('GET', '/api/me', { token: u.token });
  assert.equal(me.xp, before + 1000);
  assert.ok(me.badges.includes('circle_teacher'));
  await K('POST', '/circle-teachers/tc_teacher', { action: 'approve' }); // paid once
  assert.equal((await api('GET', '/api/me', { token: u.token })).xp, before + 1000);
  assert.equal((await api('POST', '/api/circle/teach', { token: u.token, body: {} })).error, 'already_teacher');
  assert.deepEqual(audit().problems, []);
  await K('POST', '/circle', { url: '' });
});
