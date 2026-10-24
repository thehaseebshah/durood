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
const { encryptPayload } = await import('../server/push.js');
const news = await import('../server/news.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ...json };
}
const admin = { 'x-admin-key': 'test-admin' };
const signup = async (username, invite = 'TESTFOUND') => {
  n += 1;
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0304${String(5000000 + n)}`, password: 'secret1', invite } });
};
// a real browser-style subscription so the encryption has valid keys
const fakeSub = (endpoint) => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
};

test('push encryption reproduces the worked example in RFC 8291', () => {
  const out = encryptPayload('When I grow up, I want to be a watermelon', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    { ephemeral: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.equal(out.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('news: admin posts, members see it newest first, unread count clears', async () => {
  const a = await signup('news_a');
  assert.equal((await api('POST', '/api/admin/news', { body: { title_en: 'x' } })).status, 403);
  assert.equal((await api('POST', '/api/admin/news', { headers: admin, body: { title_en: '' } })).error, 'bad_news');
  await api('POST', '/api/admin/news', { headers: admin, body: { title_en: 'First', title_ur: 'پہلی', body_en: 'Hello' } });
  await api('POST', '/api/admin/news', { headers: admin, body: { title_en: 'Second' } });
  const list = await api('GET', '/api/news', { token: a.token });
  assert.deepEqual(list.items.map((i) => i.titleEn), ['Second', 'First']);
  assert.equal(list.unread, 2);
  assert.equal((await api('GET', '/api/me', { token: a.token })).unreadNews, 2);
  await api('POST', '/api/news/seen', { token: a.token });
  assert.equal((await api('GET', '/api/news', { token: a.token })).unread, 0);
});

test('reminders: daily at the chosen time, streak warning at 20:00, once per day, never after reciting', async () => {
  const sent = [];
  news.setSender(async (sub, msg) => { sent.push({ ep: sub.endpoint, msg }); return 'ok'; });
  const u = await signup('rem_a');
  assert.equal((await api('PATCH', '/api/me', { token: u.token, body: { reminderTime: '25:00' } })).error, 'bad_time');
  assert.equal((await api('PATCH', '/api/me', { token: u.token, body: { reminderTime: '07:30' } })).reminderTime, '07:30');
  assert.equal((await api('POST', '/api/push/subscribe', { token: u.token, body: { endpoint: 'http://insecure', keys: {} } })).error, 'bad_subscription');
  assert.equal((await api('POST', '/api/push/subscribe', { token: u.token, body: fakeSub('https://fcm.googleapis.com/fcm/send/a') })).ok, true);

  const at = (hhmm) => Date.parse(`2030-03-10T${hhmm}:00+05:00`);
  assert.equal(await news.runReminders(at('07:00')), 0);                   // before the chosen time
  assert.equal(await news.runReminders(at('07:31')), 1);                   // reminder
  assert.equal(await news.runReminders(at('09:00')), 0);                   // not again today
  db.prepare("UPDATE users SET streak = 3, last_day = '2030-03-09' WHERE username = 'rem_a'").run();
  assert.equal(await news.runReminders(at('20:05')), 1);                   // streak warning
  assert.equal(sent.at(-1).msg.tag, 'streak');
  db.prepare("UPDATE users SET last_day = '2030-03-11' WHERE username = 'rem_a'").run(); // recited on the next day
  assert.equal(await news.runReminders(Date.parse('2030-03-11T21:00:00+05:00')), 0);
  news.setSender(null);
});

test('dead subscriptions are removed; joining a caravan and announcements push', async () => {
  const sent = [];
  news.setSender(async (sub, msg) => { sent.push({ ep: sub.endpoint, msg }); return sub.endpoint.endsWith('/dead') ? 'gone' : 'ok'; });
  const root = await signup('push_root');
  await api('POST', '/api/push/subscribe', { token: root.token, body: fakeSub('https://fcm.googleapis.com/fcm/send/dead') });
  await signup('push_kid', 'push_root');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(sent.some((x) => x.msg.tag === 'joined' && x.msg.body.includes('push_kid')));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM push_subs WHERE endpoint LIKE '%/dead'").get().n, 0);
  await api('POST', '/api/push/subscribe', { token: root.token, body: fakeSub('https://fcm.googleapis.com/fcm/send/live') });
  await api('POST', '/api/admin/news', { headers: admin, body: { title_en: 'Jumu‘ah mubarak', push: true } });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(sent.some((x) => x.ep.endsWith('/live') && x.msg.title === 'Jumu‘ah mubarak'));
  assert.equal((await api('DELETE', '/api/push', { token: root.token })).ok, true);
  news.setSender(null);
});

test('exports are CSV, formula-safe, and admin only', async () => {
  const a = await signup('exp_a');
  await api('PATCH', '/api/me', { token: a.token, body: { city: '=cmd|calc' } });
  await api('POST', '/api/log', { token: a.token, body: { count: 77, rid: crypto.randomUUID() } });
  assert.equal((await api('GET', '/api/admin/export?kind=cities')).status, 403);
  const res = await fetch(`${base}/api/admin/export?kind=cities`, { headers: admin });
  const { csv } = await res.json();
  assert.ok(csv.startsWith('city,members,durood_total'));
  assert.ok(csv.includes("\"'=cmd|calc\"") || csv.includes("'=cmd|calc"));
  assert.ok(!/^=cmd/m.test(csv));
  for (const k of ['caravans', 'weeks']) assert.ok((await (await fetch(`${base}/api/admin/export?kind=${k}`, { headers: admin })).json()).csv.includes('\n'));
  assert.equal((await api('GET', '/api/admin/export?kind=nope', { headers: admin })).error, 'bad_export');
});

test('reminders: only inside the three hours after the chosen time; a total push failure is retried, a few times at most', async () => {
  const u = await signup('rem_window');
  await api('PATCH', '/api/me', { token: u.token, body: { reminderTime: '07:30' } });
  await api('POST', '/api/push/subscribe', { token: u.token, body: fakeSub('https://fcm.googleapis.com/fcm/send/window') });
  const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+05:00`);
  const sent = [];
  news.setSender(async (sub, msg) => { if (sub.endpoint.endsWith('/window')) sent.push(msg.tag); return 'ok'; });
  await news.runReminders(at('2031-01-10', '10:31'));
  assert.equal(sent.length, 0, 'more than 3 hours after 07:30: no reminder');
  await news.runReminders(at('2031-01-10', '21:00'));
  assert.equal(sent.length, 0, 'setting a time and being pinged hours later is not wanted');
  await news.runReminders(at('2031-01-11', '10:29'));
  assert.deepEqual(sent, ['remind'], 'inside the window');

  let calls = 0;
  news.setSender(async (sub) => { if (sub.endpoint.endsWith('/window')) calls += 1; return 'failed'; });
  const day = '2031-01-12';
  for (let i = 0; i < 8; i++) await news.runReminders(at(day, '08:00'));
  assert.equal(calls, 4, 'tried four times, then gave up for the day');
  const mine = [];
  news.setSender(async (sub) => { if (sub.endpoint.endsWith('/window')) mine.push(1); return 'ok'; });
  await news.runReminders(at('2031-01-13', '08:00'));
  assert.equal(mine.length, 1, 'the next day starts fresh');
  news.setSender(null);
});

test('the nightly audit runs once a day after 03:00 Pakistan time and records its result', async () => {
  const { getSetting } = await import('../server/db.js');
  assert.equal(await news.nightlyAudit(Date.parse('2031-02-01T02:00:00+05:00')), null, 'too early');
  const r = await news.nightlyAudit(Date.parse('2031-02-01T04:00:00+05:00'));
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(JSON.parse(getSetting('last_audit')).problems, r.problems.length);
  assert.equal(await news.nightlyAudit(Date.parse('2031-02-01T23:00:00+05:00')), null, 'once a day');
  assert.ok(await news.nightlyAudit(Date.parse('2031-02-02T03:30:00+05:00')), 'next day runs again');
});
