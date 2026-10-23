import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { db, tx } from './db.js';
import { HttpError, hashPassword, checkPassword, signToken, verifyToken, rateLimit } from './auth.js';
import { audit } from './audit.js';
import * as sunnah from './sunnah.js';
import { CFG, dayOf, logDurood, startLecture, completeLecture, claimCircle, getMe, leaderboard, teamView, publicStats } from './game.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const one = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

// ---- validation -----------------------------------------------------------
const RESERVED = new Set(['admin', 'root', 'support', 'durood', 'qafila', 'seerat', 'api', 'null', 'undefined']);
const USERNAME = /^[a-z0-9_]{3,20}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-()]/g, '');
  if (/^03\d{9}$/.test(p)) p = '+92' + p.slice(1);
  else if (/^92\d{10}$/.test(p)) p = '+' + p;
  else if (/^0092/.test(p)) p = '+' + p.slice(2);
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

// ---- routing --------------------------------------------------------------
const routes = [];
const route = (method, pattern, opts, handler) => {
  if (typeof opts === 'function') [handler, opts] = [opts, {}];
  opts = { maxBody: 32_768, ...opts };
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, auth: opts.auth !== false, admin: !!opts.admin, maxBody: opts.maxBody, handler });
};

const lang = (v) => (v === 'en' ? 'en' : 'ur');

route('GET', '/api/username-check', { auth: false }, ({ query }) => {
  const u = String(query.get('u') || '');
  if (!USERNAME.test(u) || RESERVED.has(u.toLowerCase())) return { ok: false, reason: 'bad_username' };
  return { ok: !one('SELECT 1 FROM users WHERE username = ?', u) };
});

route('GET', '/api/referrer', { auth: false }, ({ query }) => {
  const u = one('SELECT username FROM users WHERE username = ?', String(query.get('code') || ''));
  return { valid: !!u, username: u?.username ?? null };
});

route('POST', '/api/register', { auth: false }, async ({ body, ip }) => {
  rateLimit(`reg:${ip}`, Number(process.env.REG_LIMIT_PER_HOUR) || 10, 3600e3);
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = normalizePhone(body.phone);
  const password = String(body.password || '');
  if (!USERNAME.test(username) || RESERVED.has(username.toLowerCase())) throw new HttpError(400, 'bad_username');
  if (!EMAIL.test(email)) throw new HttpError(400, 'bad_email');
  if (!phone) throw new HttpError(400, 'bad_phone');
  if (password.length < 6 || password.length > 128) throw new HttpError(400, 'bad_password');

  let referrer = null;
  if (body.referral) {
    referrer = one('SELECT id FROM users WHERE username = ?', String(body.referral).trim());
    if (!referrer) throw new HttpError(400, 'bad_referral');
  }
  const pass = await hashPassword(password);
  const id = tx(() => {
    if (one('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'username_taken');
    if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'email_taken');
    if (one('SELECT 1 FROM users WHERE phone = ?', phone)) throw new HttpError(409, 'phone_taken');
    const r = run(`INSERT INTO users (username, email, phone, pass, lang, city, referrer_id, created_day, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)`,
      username, email, phone, pass, lang(body.lang), String(body.city || '').trim().slice(0, 40), referrer?.id ?? null, dayOf(), Date.now());
    const uid = Number(r.lastInsertRowid);
    run('INSERT INTO ancestors (user_id, ancestor_id, depth) VALUES (?,?,0)', uid, uid);
    if (referrer) {
      run(`INSERT INTO ancestors (user_id, ancestor_id, depth)
           SELECT ?, ancestor_id, depth + 1 FROM ancestors WHERE user_id = ?`, uid, referrer.id);
    }
    return uid;
  });
  return { token: signToken(id), me: getMe(id) };
});

route('POST', '/api/login', { auth: false }, async ({ body, ip }) => {
  rateLimit(`login:${ip}`, 30, 600e3);
  const ident = String(body.id || '').trim();
  const phone = normalizePhone(ident);
  const u = one('SELECT id, pass FROM users WHERE username = ? OR email = ? OR phone = ?', ident, ident.toLowerCase(), phone ?? '\0');
  if (!u || !(await checkPassword(String(body.password || ''), u.pass))) throw new HttpError(401, 'bad_login');
  return { token: signToken(u.id), me: getMe(u.id) };
});

route('GET', '/api/public', { auth: false }, () => publicStats());
route('GET', '/api/me', ({ user }) => getMe(user));

route('PATCH', '/api/me', ({ user, body }) => {
  if (body.lang !== undefined) run('UPDATE users SET lang = ? WHERE id = ?', lang(body.lang), user);
  if (body.isPublic !== undefined) run('UPDATE users SET is_public = ? WHERE id = ?', body.isPublic ? 1 : 0, user);
  if (body.city !== undefined) run('UPDATE users SET city = ? WHERE id = ?', String(body.city).trim().slice(0, 40), user);
  if (body.dailyGoal !== undefined) {
    const g = Number(body.dailyGoal);
    if (!Number.isInteger(g) || g < 1 || g > 100_000) throw new HttpError(400, 'bad_count');
    run('UPDATE users SET daily_goal = ? WHERE id = ?', g, user);
  }
  return getMe(user);
});

route('POST', '/api/log', ({ user, body }) => {
  rateLimit(`log:${user}`, 60, 60e3);
  const result = logDurood(user, Number(body.count), body.rid);
  return { ...result, me: getMe(user) };
});

route('GET', '/api/leaderboard', ({ user, query }) => {
  const type = query.get('type') === 'teams' ? 'teams' : 'users';
  const period = query.get('period') === 'all' ? 'all' : 'week';
  return leaderboard(user, type, period);
});

route('GET', '/api/team', ({ user }) => teamView(user));

route('GET', '/api/lectures', ({ user }) => {
  const rows = db.prepare(`SELECT l.*, EXISTS(SELECT 1 FROM events e WHERE e.user_id = ? AND e.kind = 'lecture' AND e.ref = CAST(l.id AS TEXT)) done
                           FROM lectures l ORDER BY l.id DESC LIMIT 100`).all(user);
  return { lectures: rows.map((l) => ({ id: l.id, youtubeId: l.youtube_id, titleEn: l.title_en, titleUr: l.title_ur, speaker: l.speaker, minSeconds: l.min_seconds, xp: l.xp, done: !!l.done })), circleUrl: CFG.circleUrl, circleXp: CFG.circleXp };
});
route('POST', '/api/lectures/:id/start', ({ user, params }) => startLecture(user, Number(params.id)));
route('POST', '/api/lectures/:id/complete', ({ user, params }) => {
  const r = completeLecture(user, Number(params.id));
  return { ...r, me: getMe(user) };
});
route('POST', '/api/circle/claim', ({ user }) => ({ ...claimCircle(user), me: getMe(user) }));

route('GET', '/api/sunnah/today', ({ user }) => sunnah.today(user));
route('GET', '/api/sunnah/mine', ({ user }) => ({ posts: sunnah.mine(user) }));
route('POST', '/api/sunnah/post', { maxBody: 2_400_000 }, ({ user, body }) => {
  rateLimit(`post:${user}`, 10, 60e3);
  const r = sunnah.createPost(user, body.image);
  return { ...r, ...sunnah.today(user), me: getMe(user) };
});
route('GET', '/api/feed', ({ user }) => ({ posts: sunnah.feed(user) }));
route('POST', '/api/posts/:id/vote', ({ user, params, body }) => {
  const r = sunnah.vote(user, Number(params.id), body.vote);
  return { ...r, me: getMe(user) };
});
route('POST', '/api/posts/:id/report', ({ user, params }) => sunnah.report(user, Number(params.id)));

route('POST', '/api/admin/sunnahs', { auth: false, admin: true }, ({ body }) => ({ days: sunnah.addSunnahs(body.sunnahs ?? body) }));
route('GET', '/api/admin/reported', { auth: false, admin: true }, () => ({ posts: sunnah.reportedPosts() }));
route('POST', '/api/admin/posts/:id', { auth: false, admin: true }, ({ params, body }) => sunnah.moderate(Number(params.id), body.action));
route('GET', '/api/admin/audit', { auth: false, admin: true }, () => audit());
route('POST', '/api/admin/lectures', { auth: false, admin: true }, ({ body }) => {
  const yt = String(body.youtube_id || '').trim();
  if (!/^[\w-]{11}$/.test(yt) || !body.title_en) throw new HttpError(400, 'bad_lecture');
  const r = run('INSERT INTO lectures (youtube_id, title_en, title_ur, speaker, min_seconds, xp, created_at) VALUES (?,?,?,?,?,?,?)',
    yt, String(body.title_en), String(body.title_ur || ''), String(body.speaker || ''),
    Math.max(30, Number(body.min_seconds) || 600), Math.max(1, Number(body.xp) || 300), Date.now());
  return { id: Number(r.lastInsertRowid) };
});
route('DELETE', '/api/admin/lectures/:id', { auth: false, admin: true }, ({ params }) => {
  run('DELETE FROM lecture_starts WHERE lecture_id = ?', Number(params.id));
  run('DELETE FROM lectures WHERE id = ?', Number(params.id));
  return { ok: true };
});

// ---- server ---------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'too_large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'bad_json'); }
}

async function handleApi(req, res, url) {
  const route_ = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!route_) throw new HttpError(404, 'not_found');
  const m = route_.re.exec(url.pathname);
  const params = Object.fromEntries(route_.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const ip = (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress;
  const ctx = { query: url.searchParams, params, ip, body: {}, user: null };

  if (route_.admin) {
    if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) throw new HttpError(403, 'forbidden');
  }
  if (route_.auth) {
    const id = verifyToken((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!id || !one('SELECT 1 FROM users WHERE id = ?', id)) throw new HttpError(401, 'unauthorized');
    ctx.user = id;
  }
  if (req.method !== 'GET' && req.method !== 'DELETE') ctx.body = await readBody(req, route_.maxBody);
  const out = await route_.handler(ctx);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(out));
}

async function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(403, 'forbidden');
  let data;
  try { data = await readFile(file); } catch {
    // SPA fallback for extension-less paths (e.g. /?ref=...), 404 for missing assets
    if (path.extname(rel)) throw new HttpError(404, 'not_found');
    file = path.join(PUBLIC_DIR, 'index.html');
    data = await readFile(file);
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

async function handlePhoto(res, url) {
  const m = /^\/photos\/(\d+)\/([\w-]+)$/.exec(url.pathname);
  const file = m && sunnah.photoFile(Number(m[1]), m[2]);
  if (!file) throw new HttpError(404, 'not_found');
  const data = await readFile(file);
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (url.pathname.startsWith('/photos/') && req.method === 'GET') await handlePhoto(res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await handleStatic(req, res, url);
      else throw new HttpError(405, 'method_not_allowed');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e instanceof HttpError ? e.code : 'server_error' }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`Durood Qafila running on http://localhost:${port}`));
}
