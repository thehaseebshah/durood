import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';

const { createServer, normalizePhone } = await import('../server/index.js');
const geo = await import('../server/geo.js');
const { db } = await import('../server/db.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const reg = (extra = {}) => { n += 1; return api('POST', '/api/register', { body: { username: `geo_${n}`, email: `geo${n}@x.pk`, phone: `0307${String(8000000 + n)}`, password: 'secret1', invite: 'TESTFOUND', ...extra } }); };

test('phone numbers: any country, the national form with a country, and Pakistani numbers as before', () => {
  assert.equal(normalizePhone('+44 7700 900123'), '+447700900123');
  assert.equal(normalizePhone('07700 900123', 'GB'), '+447700900123', 'leading 0 dropped, calling code added');
  assert.equal(normalizePhone('(415) 555-2671', 'US'), '+14155552671');
  assert.equal(normalizePhone('00 971 50 123 4567'), '+971501234567');
  assert.equal(normalizePhone('0300 1234567'), '+923001234567');
  assert.equal(normalizePhone('300 1234567', 'PK'), '+923001234567');
  assert.equal(normalizePhone('+999 123456789'), null, 'not a real calling code');
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('123'), null);
});

test('IP to country, with the time zone and Pakistan as fallbacks', () => {
  assert.equal(geo.ipCountry('8.8.8.8'), 'US');
  assert.equal(geo.ipCountry('::ffff:8.8.8.8'), 'US', 'IPv4 inside IPv6');
  assert.equal(geo.ipCountry('2001:4860:1c00::1'), 'US', 'IPv6 (a range the source lists as US)');
  assert.equal(geo.ipCountry('14.1.104.1'), 'PK', 'a Pakistani range');
  assert.equal(geo.ipCountry('10.0.0.1'), null, 'private addresses are unknown');
  assert.equal(geo.ipCountry('999.1.1.1'), null);
  assert.equal(geo.ipCountry('not an ip'), null);
  assert.equal(geo.ipCountry(''), null);
  assert.equal(geo.detectCountry({ ip: '8.8.8.8', tz: 'Asia/Karachi' }), 'US', 'IP first');
  assert.equal(geo.detectCountry({ ip: '10.0.0.1', tz: 'Europe/London' }), 'GB', 'then the time zone');
  assert.equal(geo.detectCountry({ ip: '10.0.0.1', tz: 'Mars/Base' }), 'PK', 'then Pakistan');
  assert.equal(geo.detectCountry({}), 'PK');
});

test('city search: as you type, own country first, safe against odd input', () => {
  assert.ok(geo.searchCities('Burew').some((c) => c.name === 'Burewala' && c.cc === 'PK'));
  const lah = geo.searchCities('lahore', 'PK');
  assert.equal(lah[0].name, 'Lahore');
  assert.equal(lah[0].label, 'Lahore, Punjab, Pakistan');
  assert.ok(geo.searchCities('Springfield', 'US').every((c) => /springfield/i.test(c.name)));
  assert.equal(geo.searchCities('S').length, 0, 'needs two letters');
  assert.deepEqual(geo.searchCities('%%'), []);
  assert.doesNotThrow(() => geo.searchCities("'; DROP TABLE users;--"));
  assert.ok(db.prepare('SELECT COUNT(*) n FROM cities').get().n > 60000);
  assert.equal(geo.cityById(1172451).name, 'Lahore');
  assert.equal(geo.cityById(1), null);
  assert.equal(geo.cityById('x'), null);
});

test('the city is required at sign-up and stored with its country; the profile can change it', async () => {
  assert.equal((await reg({ cityId: undefined })).error, 'city_required');
  assert.equal((await reg({ cityId: 1 })).error, 'city_required');
  assert.equal((await reg({ city: 'Lahore' })).error, 'city_required', 'free text is not enough');
  const ok = await reg({ cityId: 1172451 });
  assert.equal(ok.status, 200);
  assert.equal(ok.me.city, 'Lahore');
  assert.equal(ok.me.country, 'PK');
  assert.equal(ok.me.needsCity, false);
  const uk = await reg({ cityId: geo.searchCities('London', 'GB')[0].id, phone: '07700 900199', phoneCountry: 'GB' });
  assert.equal(uk.status, 200);
  assert.equal(uk.me.phone, '+447700900199');
  assert.equal(uk.me.country, 'GB');
  const me = await api('PATCH', '/api/me', { token: ok.token, body: { cityId: 1174872 } });
  assert.equal(me.city, 'Karachi');
  assert.equal((await api('PATCH', '/api/me', { token: ok.token, body: { cityId: 5 } })).error, 'city_required');
});

test('older members with a typed city are matched to a place; others are asked to choose', async () => {
  const a = await reg({ cityId: 1172451 }), b = await reg({ cityId: 1172451 });
  db.prepare("UPDATE users SET city_id = NULL, country = '', city = 'Multan' WHERE username = ?").run(a.me.username);
  db.prepare("UPDATE users SET city_id = NULL, country = '', city = 'Nowhereville' WHERE username = ?").run(b.me.username);
  geo.matchOldCities();
  const ma = await api('GET', '/api/me', { token: a.token }), mb = await api('GET', '/api/me', { token: b.token });
  assert.equal(ma.country, 'PK'); assert.equal(ma.needsCity, false); assert.equal(ma.city, 'Multan');
  assert.equal(mb.needsCity, true);
});

test('the public geo and city endpoints work without signing in', async () => {
  const g = await api('GET', '/api/geo?tz=Europe/London');
  assert.equal(g.country, 'GB', 'a local address has no IP country, so the time zone decides');
  assert.equal(g.dial, '44');
  assert.ok(g.countries.length > 200 && g.countries.some((c) => c.cc === 'PK' && c.dial === '92'));
  const c = await api('GET', '/api/cities?q=kara&cc=PK');
  assert.equal(c.cities[0].name, 'Karachi');
});
