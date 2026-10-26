// The daily reflection always has a specific question: the administrator's own for that day, else a built-in theme.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';

const { createServer } = await import('../server/index.js');
const { THEMES, themeFor } = await import('../server/reflection-themes.js');
const { dayOf } = await import('../server/game.js');

let server, base;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const admin = { 'x-admin-key': 'test-admin' };
const signup = (username) => api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0306${String(8000000 + username.length * 97 + username.charCodeAt(username.length - 1))}`, password: 'secret1', cityId: 1172451, invite: 'TESTFOUND' } });

test('there are 30 themes, 15 from the Seerah and 15 from the Sunnah, alternating, each named and asked in English and Urdu', () => {
  assert.equal(THEMES.length, 30);
  THEMES.forEach((t, i) => {
    assert.equal(t.kind, i % 2 === 0 ? 'seerah' : 'sunnah', `${t.en}: alternates Seerah, Sunnah`);
    assert.ok(t.en.startsWith(t.kind === 'seerah' ? 'Seerah \u00b7 ' : 'Sunnah \u00b7 '), `${t.en}: the English label says which it is`);
    assert.ok(t.ur.startsWith(t.kind === 'seerah' ? 'سیرت \u00b7 ' : 'سنت \u00b7 '), `${t.en}: the Urdu label says which it is`);
    for (const k of ['qEn', 'qUr']) assert.ok(String(t[k]).trim().length >= 60, `${t.en}: the ${k} question names the event or practice and asks something`);
    assert.ok(t.qEn.length <= 260 && [...t.qUr].length <= 260, `${t.en} stays short enough for the card`);
    assert.match(t.qUr, /[\u0600-\u06FF]/, `${t.en}: the Urdu question is in Urdu script`);
    assert.ok(/\?\s*$/.test(t.qEn) || /\.\s*$/.test(t.qEn), `${t.en}: the English question is a finished sentence`);
  });
  assert.equal(THEMES.filter((t) => t.kind === 'seerah').length, 15);
  assert.equal(new Set(THEMES.map((t) => t.qEn)).size, 30, 'no two themes ask the same thing');
  assert.equal(new Set(THEMES.map((t) => t.en)).size, 30, 'no two themes share a name');
});

test('the theme changes every day, repeats only after 30, and is the same for everyone', () => {
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
  assert.equal(new Set(days.map((d) => themeFor(d).en)).size, 30, 'thirty days in a row use thirty different themes');
  assert.equal(themeFor('2026-10-26'), themeFor('2026-10-26'));
  assert.equal(themeFor('2026-10-26'), themeFor('2026-11-25'), 'thirty days later it comes round again');
  assert.notEqual(themeFor('2026-10-26'), themeFor('2026-10-27'));
  assert.ok(themeFor('1999-12-31') && themeFor('2100-01-01'), 'any date gives a theme');
});

test('with no question set for the day, members get that day\'s theme; an administrator\'s own question replaces it', async () => {
  const a = await signup('thm_a');
  const day = dayOf(), t = themeFor(day);
  const before = (await api('GET', '/api/feed', { token: a.token })).reflection.prompt;
  assert.equal(before.textEn, t.qEn);
  assert.equal(before.textUr, t.qUr);
  assert.equal(before.themeEn, t.en);
  assert.equal(before.themeUr, t.ur);

  await api('POST', '/api/admin/prompts', { headers: admin, body: { day, text_en: 'What did the Seerah teach you this week?', text_ur: '' } });
  const own = (await api('GET', '/api/feed', { token: a.token })).reflection.prompt;
  assert.equal(own.textEn, 'What did the Seerah teach you this week?');
  assert.equal(own.themeEn, null, 'an administrator\'s question carries no built-in theme label');
});

test('a reflection in the feed shows the question it answered, built-in or the administrator\'s', async () => {
  const b = await signup('thm_b'), v = await signup('thm_v');
  const posted = await api('POST', '/api/reflections', { token: b.token, body: { text: 'Grateful for the rain today.' } });
  assert.ok(posted.id);
  const item = (await api('GET', '/api/feed', { token: v.token })).items.find((i) => i.type === 'reflection' && i.id === posted.id);
  assert.ok(item.promptEn && item.promptEn.length > 10, 'the feed names the question');
});
