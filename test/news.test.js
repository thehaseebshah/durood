import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';

const { createServer } = await import('../server/index.js');
(await import('./helpers.js')).seedCaravan();
const { db } = await import('../server/db.js');
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
const signup = async (username, invite = 'testcv') => {
  n += 1;
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0304${String(5000000 + n)}`, password: 'secret1', cityId: 1172451, invite } });
};
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

test('exports are CSV, formula-safe, and admin only', async () => {
  const a = await signup('exp_a');
  db.prepare("UPDATE users SET city = '=cmd|calc' WHERE username = 'exp_a'").run(); // a name that starts like a spreadsheet formula
  await api('POST', '/api/log', { token: a.token, body: { count: 77, rid: crypto.randomUUID() } });
  assert.equal((await api('GET', '/api/admin/export?kind=cities')).status, 403);
  const res = await fetch(`${base}/api/admin/export?kind=cities`, { headers: admin });
  const { csv } = await res.json();
  assert.ok(csv.startsWith('city,country,members,durood_total'));
  assert.ok(csv.includes("\"'=cmd|calc\"") || csv.includes("'=cmd|calc"));
  assert.ok(!/^=cmd/m.test(csv));
  for (const k of ['caravans', 'weeks']) assert.ok((await (await fetch(`${base}/api/admin/export?kind=${k}`, { headers: admin })).json()).csv.includes('\n'));
  assert.equal((await api('GET', '/api/admin/export?kind=nope', { headers: admin })).error, 'bad_export');
});

test('there is no web push: no subscribe routes, no reminders, nothing sent when news is posted', async () => {
  const u = await signup('nopush_a');
  for (const [method, path] of [['POST', '/api/push/subscribe'], ['DELETE', '/api/push'], ['GET', '/api/push/key']]) assert.equal((await api(method, path, { token: u.token, ...(method === 'GET' ? {} : { body: {} }) })).status, 404, path);
  assert.equal((await api('PATCH', '/api/me', { token: u.token, body: { reminderTime: '07:30' } })).reminderTime, undefined);
  assert.equal(typeof news.runReminders, 'undefined');
  assert.equal((await api('POST', '/api/admin/news', { headers: admin, body: { title_en: 'No push', push: true } })).id > 0, true, 'an announcement is in-app only');
});

test('the nightly audit runs once a day after 03:00 Pakistan time, records its result, and finds nothing wrong on a database with activity', async () => {
  const { getSetting } = await import('../server/db.js');
  const u = await signup('aud_a'), k = await signup('aud_b');
  await api('POST', '/api/log', { token: u.token, body: { count: 1200, rid: crypto.randomUUID() } });
  await api('POST', '/api/log', { token: k.token, body: { count: 300, rid: crypto.randomUUID() } });
  const e = await api('POST', '/api/log', { token: k.token, body: { count: 40, rid: crypto.randomUUID() } });
  await api('PATCH', `/api/entries/${e.entryId}`, { token: k.token, body: { count: 25, rid: crypto.randomUUID() } });
  assert.equal(await news.nightlyAudit(Date.parse('2031-02-01T02:00:00+05:00')), null, 'too early');
  const r = await news.nightlyAudit(Date.parse('2031-02-01T04:00:00+05:00'));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.problems, []);
  assert.equal(JSON.parse(getSetting('last_audit')).problems, 0);
  assert.equal(await news.nightlyAudit(Date.parse('2031-02-01T23:00:00+05:00')), null, 'once a day');
  assert.ok(await news.nightlyAudit(Date.parse('2031-02-02T03:30:00+05:00')), 'next day runs again');
});
