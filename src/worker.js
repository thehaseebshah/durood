// The Cloudflare Worker: three small API calls, a health check and the twice-a-day backup. The page itself (public/) is served by
// Cloudflare as static files, so it does not count against the Worker's request allowance.
import { addEntry, check, cityList, stats, backupStatus, sendBackup, pruneRids, Bad } from './logic.js';

const HEADERS = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });

// a person (or a script) can only try so many times a minute; this is per Worker instance, a coarse brake rather than an exact count
const hits = new Map();
const limited = (ip, max = 60) => {
  const now = Date.now(), h = (hits.get(ip) || []).filter((t) => now - t < 60e3);
  h.push(now); hits.set(ip, h);
  if (hits.size > 2000) hits.clear();
  return h.length > max;
};

// comparing secrets without stopping at the first different character
const same = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = Number(env.TARGET) || 100_000_000;
    try {
      if (request.method === 'GET' && url.pathname === '/healthz') return reply(200, { ok: true, backup: await backupStatus(env.DB, !!env.SHEETS_URL) });
      // run a backup now (to check the Google Sheet link): only with the same secret the sheet checks
      if (request.method === 'POST' && url.pathname === '/api/backup') {
        const given = request.headers.get('x-backup-token') || '';
        if (!env.SHEETS_TOKEN || !same(given, env.SHEETS_TOKEN)) return reply(403, { error: 'forbidden' });
        return reply(200, await sendBackup(env.DB, { url: env.SHEETS_URL, token: env.SHEETS_TOKEN }));
      }
      if (request.method === 'GET' && url.pathname === '/api/cities') return reply(200, { cities: cityList() });
      if (request.method === 'POST' && (url.pathname === '/api/check' || url.pathname === '/api/entry')) {
        if (limited(request.headers.get('CF-Connecting-IP') || 'unknown')) return reply(429, { error: 'slow_down' });
        const text = await request.text();
        if (text.length > 4096) return reply(413, { error: 'too_big' });
        let body; try { body = JSON.parse(text || '{}'); } catch { return reply(400, { error: 'bad_json' }); }
        if (!body || typeof body !== 'object') body = {};
        return reply(200, url.pathname === '/api/check' ? await check(env.DB, body) : await addEntry(env.DB, body, target));
      }
      // anything else is a page file: Cloudflare serves it from public/ before the Worker is asked; this is only the fallback
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return reply(404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof Bad) return reply(e.status, { error: e.code });
      console.error(e);
      return reply(500, { error: 'server_error' });
    }
  },

  // 01:00 and 13:00 UTC are 06:00 and 18:00 in Pakistan (see wrangler.toml)
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      await sendBackup(env.DB, { url: env.SHEETS_URL, token: env.SHEETS_TOKEN });
      await pruneRids(env.DB);
    })());
  },
};
