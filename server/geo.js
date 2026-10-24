import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { db, tx, getSetting, setSetting } from './db.js';

const DATA = new URL('./data/', import.meta.url);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);

// ---- countries and time zones -----------------------------------------------------------------------------------------
const { countries, tz: TZ } = JSON.parse(readFileSync(new URL('countries.json', DATA), 'utf8'));
export const COUNTRIES = countries;                                       // [{ cc, name, dial }] sorted by name
const BY_CC = new Map(countries.map((c) => [c.cc, c]));
const DIALS = new Set(countries.map((c) => c.dial));
export const countryName = (cc) => BY_CC.get(cc)?.name || cc;
export const dialOf = (cc) => BY_CC.get(cc)?.dial || '';

/** True when the international number starts with a real country calling code. */
export function knownDialCode(e164) {
  const d = String(e164).replace(/^\+/, '');
  for (let n = 1; n <= 4; n++) if (DIALS.has(d.slice(0, n))) return true;
  return false;
}

// ---- IP to country (DB-IP.com IP to Country Lite, CC BY 4.0), read once on first use ----------------------------------------------
let ipdb = null;
function loadIp() {
  const b = gunzipSync(readFileSync(new URL('ipcountry.bin.gz', DATA)));
  const n4 = b.readUInt32LE(4), n6 = b.readUInt32LE(8);
  const v4 = new Uint32Array(n4), c4 = new Uint16Array(n4), v6 = new BigUint64Array(n6), c6 = new Uint16Array(n6);
  let o = 12;
  for (let i = 0; i < n4; i++, o += 6) { v4[i] = b.readUInt32LE(o); c4[i] = (b[o + 4] << 8) | b[o + 5]; }
  for (let i = 0; i < n6; i++, o += 10) { v6[i] = b.readBigUInt64LE(o); c6[i] = (b[o + 8] << 8) | b[o + 9]; }
  ipdb = { v4, c4, v6, c6 };
}
const ccOf = (n) => String.fromCharCode(n >> 8, n & 255);
function find(starts, key) { // the last start <= key
  let lo = 0, hi = starts.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= key) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
function ip6hi(s) { // the first 64 bits of an IPv6 address as a BigInt
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [], t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const parts = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{0,4}$/i.test(p))) return null;
  return parts.slice(0, 4).reduce((a, p) => (a << 16n) | BigInt(parseInt(p || '0', 16)), 0n);
}
/** Country code for an IP address, or null when unknown (private addresses, malformed input, gaps in the data). */
export function ipCountry(ip) {
  if (!ip) return null;
  if (!ipdb) loadIp();
  let s = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) s = mapped[1];
  let cc;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) {
    const p = s.split('.').map(Number);
    if (p.some((x) => x > 255)) return null;
    const i = find(ipdb.v4, ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3]);
    cc = i < 0 ? null : ccOf(ipdb.c4[i]);
  } else if (s.includes(':')) {
    const hi = ip6hi(s);
    if (hi === null) return null;
    const i = find(ipdb.v6, hi);
    cc = i < 0 ? null : ccOf(ipdb.c6[i]);
  } else return null;
  return cc && BY_CC.has(cc) ? cc : null;
}

/** IP first, then the browser's time zone, then Pakistan. The member can always change it. */
export function detectCountry({ ip, tz } = {}) {
  return ipCountry(ip) || (tz && TZ[tz]) || 'PK';
}

// ---- cities ------------------------------------------------------------------------------------------------------------------
let ready = false;
/** Loads the places into the database once (and again only if the data version changes), then tries to match older free-text cities. */
export function ensureCities() {
  if (ready) return;
  const VERSION = '1';
  if (getSetting('cities_v') !== VERSION) {
    const rows = gunzipSync(readFileSync(new URL('cities.tsv.gz', DATA))).toString('utf8').split('\n');
    tx(() => {
      db.exec('DELETE FROM cities');
      const ins = db.prepare('INSERT INTO cities (id, name, ascii, cc, region, pop) VALUES (?,?,?,?,?,?)');
      for (const l of rows) { const c = l.split('\t'); if (c.length === 6) ins.run(Number(c[0]), c[1], c[2], c[3], c[4], Number(c[5])); }
      setSetting('cities_v', VERSION);
    });
  }
  matchOldCities();
  ready = true;
}

/** Members who typed a city before the list existed: take the biggest place with that name, Pakistan first. */
export function matchOldCities() {
  db.exec(`UPDATE users SET city_id = (SELECT c.id FROM cities c WHERE c.ascii = users.city ORDER BY (c.cc = 'PK') DESC, c.pop DESC LIMIT 1)
           WHERE city_id IS NULL AND city != ''`);
  db.exec(`UPDATE users SET country = (SELECT cc FROM cities WHERE id = users.city_id), city = (SELECT name FROM cities WHERE id = users.city_id)
           WHERE city_id IS NOT NULL AND country = ''`);
}

export const cityLabel = (c) => [c.name, c.region && c.region !== c.name ? c.region : '', countryName(c.cc)].filter(Boolean).join(', ');
export const cityById = (id) => { ensureCities(); const c = one('SELECT * FROM cities WHERE id = ?', Number(id)); return c ? { id: c.id, name: c.name, region: c.region, cc: c.cc, country: countryName(c.cc), label: cityLabel(c) } : null; };

/** Search as you type: places whose name starts with the text, members' own country first, then by population. */
export function searchCities(q, cc = '') {
  ensureCities();
  const text = String(q || '').trim().replace(/[%_\\]/g, '').slice(0, 40);
  if (text.length < 2) return [];
  return all(`SELECT * FROM cities WHERE ascii LIKE ? ORDER BY (cc = ?) DESC, pop DESC LIMIT 12`, `${text}%`, String(cc || '')).map((c) => ({ id: c.id, name: c.name, region: c.region, cc: c.cc, country: countryName(c.cc), label: cityLabel(c) }));
}
