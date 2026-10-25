// Profile: display name, bio, picture, password change, phone change.
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

let server, base, n = 0;
before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function api(method, path, { token, body, headers, raw } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  if (raw) return res;
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const admin = { 'x-admin-key': 'test-admin' };
const signup = (username, invite = 'TESTFOUND') => { n += 1; return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0304${String(6000000 + n)}`, password: 'secret1', cityId: 1172451, invite } }); };

// a small square JPEG with camera metadata and trailing junk, like a phone would produce
function jpeg({ w = 192, h = 192, size = 3000, junk = true, exif = true } = {}) {
  const seg = (m, body) => Buffer.concat([Buffer.from([0xff, m]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const scan = Buffer.alloc(size); for (let i = 0; i < size; i++) scan[i] = crypto.randomInt(0, 255);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), exif ? seg(0xe1, Buffer.from('Exif\0\0GPSLatitude=31.5204')) : Buffer.alloc(0),
    seg(0xdb, Buffer.alloc(65, 3)), seg(0xc0, Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), scan, Buffer.from([0xff, 0xd9]),
    junk ? Buffer.from('SECRET PAYLOAD AFTER THE IMAGE') : Buffer.alloc(0)]);
}
const upload = (u, buf) => api('POST', '/api/me/avatar', { token: u.token, body: { image: buf.toString('base64') } });

test('display name and bio: short plain text, no links, can be cleared', async () => {
  const u = await signup('pf_a');
  const put = (body) => api('PUT', '/api/me/profile', { token: u.token, body });
  const ok = await put({ displayName: '  Amina   Khan ', bio: 'Reciting for my family' });
  assert.equal(ok.displayName, 'Amina Khan');
  assert.equal(ok.bio, 'Reciting for my family');
  assert.equal((await put({ displayName: 'A' })).error, 'text_too_short');
  assert.equal((await put({ displayName: 'x'.repeat(41) })).error, 'text_too_long');
  assert.equal((await put({ bio: 'x'.repeat(101) })).error, 'text_too_long');
  assert.equal((await put({ bio: 'see www.example.com' })).error, 'no_links');
  assert.equal((await put({ displayName: 'visit me.com' })).error, 'no_links');
  assert.equal((await put({ bio: 'a\u0000b‮c' })).bio, 'a b c', 'control and direction characters become spaces');
  assert.equal((await put({ displayName: '', bio: '' })).displayName, '');
  // the name is shown to others where the person appears
  await put({ displayName: 'Amina Khan' });
  const v = await signup('pf_viewer');
  await api('POST', '/api/reflections', { token: u.token, body: { text: 'a thought' } });
  const item = (await api('GET', '/api/feed', { token: v.token })).items.find((i) => i.type === 'reflection' && i.username === 'pf_a');
  assert.equal(item.displayName, 'Amina Khan');
  const pub = await api('GET', '/api/members/pf_a', { token: v.token });
  assert.equal(pub.displayName, 'Amina Khan');
  assert.ok(!('email' in pub) && !('phone' in pub), 'the public profile has no contact details');
  assert.equal((await api('GET', '/api/members/nobody_here', { token: v.token })).status, 404);
});

test('profile picture: rebuilt without metadata or trailing data, served by a signed address, replaced by version, removable', async () => {
  const u = await signup('pf_pic'), other = await signup('pf_other');
  assert.equal((await api('GET', '/api/me', { token: u.token })).avatar, null);
  const r = await upload(u, jpeg());
  assert.match(r.avatar, /^\/avatars\/\d+\/1\/[\w-]+$/);
  const res = await api('GET', r.avatar, { raw: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('cache-control'), /immutable/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(!bytes.includes(Buffer.from('GPSLatitude')) && !bytes.includes(Buffer.from('JFIF')), 'camera data and application segments are gone');
  assert.ok(!bytes.includes(Buffer.from('SECRET PAYLOAD')), 'nothing rides behind the image');
  assert.equal(bytes.at(-2), 0xff); assert.equal(bytes.at(-1), 0xd9);
  assert.equal((await api('GET', r.avatar.replace(/[\w-]+$/, 'forgedsignature00000000'), { raw: true })).status, 404, 'a wrong signature is refused');
  // everyone can see it: it is on what other members get
  const feedRows = (await api('GET', '/api/leaderboard?type=users&period=all', { token: other.token }));
  await api('POST', '/api/log', { token: u.token, body: { count: 5, rid: crypto.randomUUID() } });
  const lb = await api('GET', '/api/leaderboard?type=users&period=all', { token: other.token });
  assert.equal(lb.rows.find((x) => x.username === 'pf_pic').avatar, r.avatar);
  assert.ok(feedRows.rows);
  // a new picture is a new version and the old address stops working
  const r2 = await upload(u, jpeg({ size: 3500 }));
  assert.match(r2.avatar, /\/2\//);
  assert.equal((await api('GET', r.avatar, { raw: true })).status, 404);
  assert.equal((await api('GET', r2.avatar, { raw: true })).status, 200);
  // bad files
  assert.equal((await upload(u, Buffer.from('not an image at all'.repeat(100)))).error, 'bad_image');
  assert.equal((await upload(u, jpeg({ w: 800, h: 800 }))).error, 'bad_image', 'too large in pixels');
  assert.equal((await upload(u, jpeg({ w: 40, h: 40 }))).error, 'bad_image', 'too small');
  assert.equal((await upload(u, jpeg({ size: 70_000 }))).status, 400, 'too heavy');
  assert.equal((await api('POST', '/api/me/avatar', { token: u.token, body: { image: '<script>' } })).error, 'bad_image');
  // remove
  assert.equal((await api('DELETE', '/api/me/avatar', { token: u.token })).avatar, null);
  assert.equal((await api('GET', r2.avatar, { raw: true })).status, 404);
  assert.match((await upload(u, jpeg())).avatar, /\/3\//, 'the next picture keeps counting up');
});

test('an admin can remove a picture and clear an offensive name; deleting an account removes the picture and the text', async () => {
  const u = await signup('pf_mod'), d = await signup('pf_del');
  const r = await upload(u, jpeg());
  await api('PUT', '/api/me/profile', { token: u.token, body: { displayName: 'Bad Name', bio: 'bad line' } });
  assert.equal((await api('POST', '/api/admin/members/pf_mod', { headers: admin, body: { action: 'clear-profile' } })).ok, true);
  const me = await api('GET', '/api/me', { token: u.token });
  assert.equal(me.avatar, null); assert.equal(me.displayName, ''); assert.equal(me.bio, '');
  assert.equal((await api('GET', r.avatar, { raw: true })).status, 404);
  const dr = await upload(d, jpeg());
  await api('PUT', '/api/me/profile', { token: d.token, body: { displayName: 'Delete Me', bio: 'private' } });
  assert.equal((await api('DELETE', '/api/me', { token: d.token, body: { password: 'secret1' } })).status, 200);
  assert.equal((await api('GET', dr.avatar, { raw: true })).status, 404);
  const row = db.prepare('SELECT display_name, bio, avatar_v FROM users WHERE username LIKE ?').get('member_%');
  assert.equal(row.display_name, ''); assert.equal(row.bio, ''); assert.ok(row.avatar_v <= 0);
});

test('password change: needs the current password, signs out every other device, keeps this one, and counts failures', async () => {
  const u = await signup('pw_a');
  const otherDevice = await api('POST', '/api/login', { body: { id: 'pw_a', password: 'secret1' } });
  assert.equal((await api('POST', '/api/me/password', { token: u.token, body: { current: 'wrong-one', next: 'newsecret1' } })).error, 'wrong_password');
  assert.equal((await api('POST', '/api/me/password', { token: u.token, body: { current: 'secret1', next: '123' } })).error, 'bad_password');
  assert.equal((await api('POST', '/api/me/password', { token: u.token, body: { current: 'secret1', next: 'secret1' } })).error, 'same_password');
  const ok = await api('POST', '/api/me/password', { token: u.token, body: { current: 'secret1', next: 'newsecret1' } });
  assert.ok(ok.token && ok.me.username === 'pw_a');
  assert.equal((await api('GET', '/api/me', { token: ok.token })).username, 'pw_a', 'this device continues with the fresh session');
  assert.equal((await api('GET', '/api/me', { token: u.token })).status, 401, 'the old session of this device is replaced');
  assert.equal((await api('GET', '/api/me', { token: otherDevice.token })).status, 401, 'other devices are signed out');
  assert.equal((await api('POST', '/api/login', { body: { id: 'pw_a', password: 'secret1' } })).status, 401);
  assert.ok((await api('POST', '/api/login', { body: { id: 'pw_a', password: 'newsecret1' } })).token);
  // open reset links die with the change
  const reset = await api('POST', '/api/admin/members/pw_a', { headers: admin, body: { action: 'reset-link' } });
  const tok = new URL(reset.url).searchParams.get('reset');
  await api('POST', '/api/me/password', { token: ok.token, body: { current: 'newsecret1', next: 'another-secret' } });
  assert.equal((await api('POST', '/api/password/reset', { body: { token: tok, password: 'sneaky123' } })).error, 'bad_token');
  // five wrong guesses lock the endpoint, even for the right password
  const w = await signup('pw_lock');
  for (let i = 0; i < 5; i++) await api('POST', '/api/me/password', { token: w.token, body: { current: 'nope-nope', next: 'whatever1' } });
  assert.equal((await api('POST', '/api/me/password', { token: w.token, body: { current: 'secret1', next: 'whatever1' } })).status, 429);
});

test('changing the WhatsApp number needs the password, is unique, normalised per country, rate limited, and resets the murabbi link', async () => {
  const u = await signup('ph_a'), other = await signup('ph_b');
  const change = (body, tok = u.token) => api('POST', '/api/me/phone', { token: tok, body });
  assert.equal((await change({ phone: '0301 1112233', password: 'wrong' })).error, 'wrong_password');
  assert.equal((await change({ phone: '123', password: 'secret1' })).error, 'bad_phone');
  const taken = db.prepare('SELECT phone FROM users WHERE username = ?').get('ph_b').phone;
  assert.equal((await change({ phone: taken, password: 'secret1' })).error, 'phone_taken');
  const me = db.prepare('SELECT id, phone FROM users WHERE username = ?').get('ph_a');
  assert.equal((await change({ phone: me.phone, password: 'secret1' })).error, 'no_change');
  db.prepare("INSERT INTO murabbi_links (user_id, murabbi_phone, murabbi_name, checked_at, created_at) VALUES (?, '+923000000001', 'Hafiz', 1, 1)").run(me.id);
  db.prepare("INSERT INTO mamulaat_days (user_id, day, percent) VALUES (?, '2026-10-20', 70)").run(me.id);
  const ok = await change({ phone: '0301 1112233', password: 'secret1' });
  assert.equal(ok.phone, '+923011112233');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM murabbi_links WHERE user_id = ?').get(me.id).n, 0, 'the old match no longer applies');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mamulaat_days WHERE user_id = ?').get(me.id).n, 0);
  assert.equal((await change({ phone: '07911 123456', cc: 'GB', password: 'secret1' })).phone, '+447911123456', 'another country with its code');
  assert.ok((await api('POST', '/api/login', { body: { id: '+447911123456', password: 'secret1' } })).token, 'the new number is the login');
  assert.equal((await change({ phone: '0302 2223344', password: 'secret1' })).phone, '+923022223344');
  assert.equal((await change({ phone: '0303 3334455', password: 'secret1' })).status, 429, 'three changes a day');
  assert.ok(other.token);
  assert.deepEqual(audit().problems, []);
});
