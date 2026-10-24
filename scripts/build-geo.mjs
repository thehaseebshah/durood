// Builds the geography files the app ships with. Run it again only to refresh the data.
//   mkdir -p /tmp/geo && cd /tmp/geo
//   curl -LO https://download.geonames.org/export/dump/cities5000.zip && unzip cities5000.zip
//   curl -LO https://download.geonames.org/export/dump/admin1CodesASCII.txt
//   curl -LO https://download.geonames.org/export/dump/countryInfo.txt
//   curl -LO https://download.geonames.org/export/dump/timeZones.txt
//   curl -L https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.csv.gz | gunzip > dbip.csv
//   node scripts/build-geo.mjs /tmp/geo
// Sources: GeoNames (CC BY 4.0, geonames.org) and DB-IP.com IP to Country Lite (CC BY 4.0, db-ip.com).
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const dir = process.argv[2] || '/tmp/geo';
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'server', 'data');
const read = (f) => readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));

// countries: code, name, dial prefix
const countries = read('countryInfo.txt').map((l) => l.split('\t')).map((c) => ({ cc: c[0], name: c[4], dial: String(c[12] || '').split(/[ ,]/)[0].replace(/\D/g, '') })).filter((c) => c.cc && c.dial)
  .sort((a, b) => a.name.localeCompare(b.name));
const ccs = new Set(countries.map((c) => c.cc));
const tz = {};
for (const l of read('timeZones.txt').slice(1)) { const [cc, id] = l.split('\t'); if (ccs.has(cc)) tz[id] = cc; }
writeFileSync(path.join(out, 'countries.json'), JSON.stringify({ countries, tz }));

// cities of 5,000+ people: id, name, ascii name, country, region, population
const admin1 = Object.fromEntries(read('admin1CodesASCII.txt').map((l) => l.split('\t')).map((a) => [a[0], a[2] || a[1]]));
const rows = [];
for (const l of readFileSync(path.join(dir, 'cities5000.txt'), 'utf8').split('\n')) {
  const c = l.split('\t');
  if (c.length < 15 || !ccs.has(c[8])) continue;
  rows.push([c[0], c[1], c[2], c[8], admin1[`${c[8]}.${c[10]}`] || '', c[14]].join('\t'));
}
writeFileSync(path.join(out, 'cities.tsv.gz'), gzipSync(rows.join('\n'), { level: 9 }));

// IP to country: sorted range starts with the country that applies until the next start; gaps become "??"
const v4 = [], v6 = [];
const ip4 = (s) => s.split('.').reduce((a, b) => a * 256 + Number(b), 0);
function ip6(s) {
  let [head, tail] = s.split('::');
  const h = head ? head.split(':') : [], t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const parts = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return parts.reduce((a, p) => (a << 16n) | BigInt(parseInt(p || '0', 16)), 0n);
}
let prev4 = -1, prev6 = -1n;
for (const l of readFileSync(path.join(dir, 'dbip.csv'), 'utf8').split('\n')) {
  const [a, b, cc] = l.split(',');
  if (!cc) continue;
  if (a.includes(':')) {
    const s = ip6(a), e = ip6(b);
    if (prev6 >= 0n && s !== prev6 + 1n) v6.push([(prev6 + 1n) >> 64n, '??']);
    v6.push([s >> 64n, cc]); prev6 = e;
  } else {
    const s = ip4(a), e = ip4(b);
    if (prev4 >= 0 && s !== prev4 + 1) v4.push([prev4 + 1, '??']);
    v4.push([s, cc]); prev4 = e;
  }
}
const buf = Buffer.alloc(12 + v4.length * 6 + v6.length * 10);
buf.write('IPC1', 0); buf.writeUInt32LE(v4.length, 4); buf.writeUInt32LE(v6.length, 8);
let o = 12;
for (const [s, cc] of v4) { buf.writeUInt32LE(s, o); buf.write(cc, o + 4, 2, 'latin1'); o += 6; }
for (const [s, cc] of v6) { buf.writeBigUInt64LE(s, o); buf.write(cc, o + 8, 2, 'latin1'); o += 10; }
writeFileSync(path.join(out, 'ipcountry.bin.gz'), gzipSync(buf, { level: 9 }));
console.log({ countries: countries.length, tz: Object.keys(tz).length, cities: rows.length, v4: v4.length, v6: v6.length });
