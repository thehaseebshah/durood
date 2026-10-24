// A stand-in for the Mamulaat app, for development and tests of the Al-Burhan edition. Implements docs/BURHAN-API.md.
// Usage: MAMULAAT_KEY=secret PORT=3222 SALIKS='{"923001234567":{"murabbi":{"name":"Hafiz Sahib","whatsapp":"923091999001"}}}' node scripts/fake-mamulaat.mjs
import http from 'node:http';

const KEY = process.env.MAMULAAT_KEY || 'dev-key';
const saliks = JSON.parse(process.env.SALIKS || '{}');
const pct = (phone, day) => 40 + ((Number(phone.slice(-4)) + Number(day.slice(-2)) * 7) % 61); // deterministic fake numbers

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'unauthorized' });
  const phone = u.searchParams.get('phone') || '';
  if (!saliks[phone]) return send(404, { error: 'saalik_not_found' });
  if (u.pathname === '/v1/murabbi') return send(200, { murabbi: saliks[phone].murabbi ?? null });
  if (u.pathname === '/v1/mamulaat') {
    const from = u.searchParams.get('from'), to = u.searchParams.get('to'), days = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400e3) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (d.slice(-1) !== '3') days.push({ day: d, percent: pct(phone, d) }); // some days have no report
    }
    return send(200, { days });
  }
  send(404, { error: 'not_found' });
}).listen(Number(process.env.PORT) || 3222, () => console.log('fake Mamulaat app on', process.env.PORT || 3222));
