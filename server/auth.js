import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const scrypt = promisify(crypto.scrypt);

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.DB_PATH === ':memory:') return crypto.randomBytes(32).toString('hex');
  const f = 'data/secret.key';
  if (existsSync(f)) return readFileSync(f, 'utf8');
  mkdirSync('data', { recursive: true });
  const s = crypto.randomBytes(32).toString('hex');
  writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function checkPassword(pw, stored) {
  const [salt, key] = stored.split(':');
  const got = await scrypt(pw, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(got, Buffer.from(key, 'hex'));
}

const TOKEN_DAYS = 90;
/** `ver` is the member's token_ver: bumping it in the database signs them out of every device. */
export function signToken(userId, ver = 0) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400;
  const body = `${userId}.${exp}.${ver}`;
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Returns { id, ver } for a genuine, unexpired token, otherwise null. The caller must still compare `ver` with the database. */
export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [id, exp, ver, sig] = token.split('.');
  if (!id || !exp || ver === undefined || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(`${id}.${exp}.${ver}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return { id: Number(id), ver: Number(ver) };
}

// tiny fixed-window limiter; swap for Redis when running more than one instance
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  if (++b.n > max) throw new HttpError(429, 'rate_limited');
}
/** Failure-only limiter for secrets (the admin key): only wrong guesses count, and a locked caller is refused before the check. */
export const lockedOut = (key, max) => { const b = buckets.get(key); return !!b && b.reset > Date.now() && b.n >= max; };
export function recordFailure(key, windowMs) {
  const now = Date.now(), b = buckets.get(key);
  if (!b || b.reset < now) buckets.set(key, { n: 1, reset: now + windowMs }); else b.n += 1;
}

/**
 * The caller's address for rate limits. Behind a reverse proxy set TRUST_PROXY to the number of proxies in front of the app
 * (1 for Render/Fly/most hosts) and the address that many hops from the right is used; the left side of X-Forwarded-For is
 * written by the client and can be anything. CLIENT_IP_HEADER names a header the platform sets itself (e.g. fly-client-ip).
 */
export function clientIp(req) {
  const named = process.env.CLIENT_IP_HEADER && req.headers[process.env.CLIENT_IP_HEADER.toLowerCase()];
  if (named) return String(named).split(',')[0].trim();
  const hops = process.env.TRUST_PROXY ? (Number(process.env.TRUST_PROXY) || 1) : 0;
  if (hops) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length >= hops) return parts[parts.length - hops];
  }
  return req.socket.remoteAddress;
}

/** Constant-time comparison for secrets of any length. */
export const sameSecret = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

// unguessable per-photo capability: only logged-in users ever receive these URLs (from the feed / their own history)
// ---- admin sessions: a separate, short token (8 hours), tied to the member's session version so a password change or a sign-out-everywhere ends it
const ADMIN_HOURS = 8;
export function signAdminToken(userId, ver = 0) {
  const body = `a.${userId}.${Math.floor(Date.now() / 1000) + ADMIN_HOURS * 3600}.${ver}`;
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
export function verifyAdminToken(token) {
  if (typeof token !== 'string') return null;
  const [kind, id, exp, ver, sig] = token.split('.');
  if (kind !== 'a' || !id || !exp || ver === undefined || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(`a.${id}.${exp}.${ver}`).digest('base64url');
  const x = Buffer.from(sig), y = Buffer.from(want);
  if (x.length !== y.length || !crypto.timingSafeEqual(x, y) || Number(exp) < Date.now() / 1000) return null;
  return { id: Number(id), ver: Number(ver) };
}

/** A profile picture is addressed by member and version, so a new picture is a new, permanently cacheable URL. */
export const avatarSig = (id, v) => crypto.createHmac('sha256', SECRET).update(`avatar:${id}:${v}`).digest('base64url').slice(0, 24);
export const avatarUrl = (id, v) => (v > 0 ? `/avatars/${id}/${v}/${avatarSig(id, v)}` : null);
export const photoSig = (postId) => crypto.createHmac('sha256', SECRET).update(`photo:${postId}`).digest('base64url').slice(0, 24);
