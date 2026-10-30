// The whole server: one page, three small API calls, one SQLite file. No dependencies (Node 22.5 or newer).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startBackups } from './backup.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const CITIES = JSON.parse(await readFile(path.join(PUBLIC, 'cities.json'), 'utf8'));
export const OTHER_CITY = 'Other';
const MAX_ONE_ENTRY = 1_000_000;                                     // only a guard against an extra zero; there is no limit per day
export const TARGET = Number(process.env.TARGET) || 100_000_000;     // the overall target of everyone together

export function createApp({ dbPath = process.env.DB_PATH || path.join(HERE, 'data', 'tasbeeh.db'), backups = {} } = {}) {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL, city TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES people(id), day TEXT NOT NULL, count INTEGER NOT NULL CHECK (count > 0),
      rid TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS entries_day ON entries(day);
    CREATE INDEX IF NOT EXISTS entries_person ON entries(person_id, day);
  `);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  // days are Pakistan time (UTC+5); the week starts on Monday
  const dayOf = (t = Date.now()) => new Date(t + 5 * 3600e3).toISOString().slice(0, 10);
  const weekStart = (day = dayOf()) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

  /** '0300 1234567', '+92 300 1234567', '923001234567' -> '+923001234567'; null when it is not a plausible number. */
  const normalisePhone = (raw) => {
    let d = String(raw ?? '').replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x06f0).replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = `92${d.slice(1)}`;               // a local Pakistani number
    return d.length >= 10 && d.length <= 15 ? `+${d}` : null;
  };

  const stats = (personId) => {
    const today = dayOf(), wk = weekStart(today);
    const sum = (where, ...a) => one(`SELECT COALESCE(SUM(count), 0) n FROM entries WHERE ${where}`, ...a).n;
    return {
      you: { today: sum('person_id = ? AND day = ?', personId, today), week: sum('person_id = ? AND day >= ?', personId, wk), total: sum('person_id = ?', personId) },
      everyone: { today: sum('day = ?', today), week: sum('day >= ?', wk), total: sum('1 = 1'), people: one('SELECT COUNT(*) n FROM people').n },
      target: TARGET,
    };
  };

  class Bad extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

  // a person (or a script) can only try so many times a minute
  const hits = new Map();
  const limited = (ip, max = 60) => { const now = Date.now(); const h = (hits.get(ip) || []).filter((t) => now - t < 60e3); h.push(now); hits.set(ip, h); if (hits.size > 5000) hits.clear(); return h.length > max; };

  const api = {
    // does this number already have a name? (the page uses it to decide whether to ask for a name and a city)
    'POST /api/check': ({ phone }) => {
      const p = normalisePhone(phone);
      if (!p) throw new Bad(400, 'bad_phone');
      return { known: !!one('SELECT 1 FROM people WHERE phone = ?', p) };
    },
    // add today's count; a new number must come with a name and a city
    'POST /api/entry': ({ phone, count, rid, name, city }) => {
      const p = normalisePhone(phone);
      if (!p) throw new Bad(400, 'bad_phone');
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1 || n > MAX_ONE_ENTRY) throw new Bad(400, 'bad_count');
      if (typeof rid !== 'string' || !/^[\w-]{8,64}$/.test(rid)) throw new Bad(400, 'bad_request');
      db.exec('BEGIN IMMEDIATE');
      try {
        let person = one('SELECT id FROM people WHERE phone = ?', p);
        let created = false;
        if (!person) {
          const nm = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
          if ([...nm].length < 2 || [...nm].length > 60) throw new Bad(422, 'need_name');
          if (!CITIES.includes(city) && city !== OTHER_CITY) throw new Bad(422, 'need_city');
          person = { id: Number(run('INSERT INTO people (phone, name, city, created_at) VALUES (?,?,?,?)', p, nm, city, Date.now()).lastInsertRowid) };
          created = true;
        }
        // a double tap or a retry carries the same rid and counts once
        const dup = one('SELECT 1 FROM entries WHERE rid = ?', rid);
        if (!dup) run('INSERT INTO entries (person_id, day, count, rid, created_at) VALUES (?,?,?,?,?)', person.id, dayOf(), n, rid, Date.now());
        db.exec('COMMIT');
        return { ok: true, created, duplicate: !!dup, ...stats(person.id) };
      } catch (e) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
    },
    'GET /api/cities': () => ({ cities: [...CITIES, OTHER_CITY] }),
  };

  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };

  const backup = startBackups({ db, ...backups });
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json', extra = {}) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...HEADERS, ...extra }); res.end(body); };
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/healthz') return send(200, JSON.stringify({ ok: true, backup: backup.status() }));
      const handler = api[`${req.method} ${url.pathname}`];
      if (handler) {
        const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress || '';
        if (limited(ip)) return send(429, '{"error":"slow_down"}');
        let body = {};
        if (req.method === 'POST') {
          const chunks = []; let size = 0;
          for await (const c of req) { size += c.length; if (size > 4096) return send(413, '{"error":"too_big"}'); chunks.push(c); }
          try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return send(400, '{"error":"bad_json"}'); }
        }
        return send(200, JSON.stringify(handler(body && typeof body === 'object' ? body : {})));
      }
      if (req.method !== 'GET') return send(405, '{"error":"not_allowed"}');
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const full = path.join(PUBLIC, path.normalize(file));
      if (!full.startsWith(PUBLIC + path.sep)) return send(404, '{"error":"not_found"}');
      const data = await readFile(full);
      return send(200, data, TYPES[path.extname(full)] || 'application/octet-stream');
    } catch (e) {
      if (e instanceof Bad) return send(e.status, JSON.stringify({ error: e.code }));
      if (e?.code === 'ENOENT' || e?.code === 'EISDIR') return send(404, '{"error":"not_found"}');
      console.error(e);
      return send(500, '{"error":"server_error"}');
    }
  });
  server.on('close', () => backup.stop());
  return { server, db, normalisePhone, dayOf, weekStart, backup };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  createApp().server.listen(port, () => console.log(`Tasbeeh page on http://localhost:${port}`));
}
