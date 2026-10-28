import crypto from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
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
  if (existsSync('data/secret.key')) return readFileSync('data/secret.key', 'utf8'); // where older installs kept it
  const dir = path.dirname(process.env.DB_PATH || 'data/durood.db'), f = path.join(dir, 'secret.key'); // beside the database, never in the app's code
  if (existsSync(f)) return readFileSync(f, 'utf8');
  mkdirSync(dir, { recursive: true });
  const s = crypto.randomBytes(32).toString('hex');
  writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

// scrypt runs on libuv's small thread pool, which static files use too: at most two run at once and a short queue waits,
// so a burst of password checks answers "busy" instead of stalling every other request
const SCRYPT_MAX = 2, SCRYPT_QUEUE = 40;
let scryptBusy = 0;
const scryptWaiting = [];
// a member signing in from a device or address that signed them in before goes to the front, and is never turned away as busy,
// so a flood of strangers' guesses can't keep returning members out
async function limitedScrypt(pw, salt, priority = false) {
  if (scryptBusy >= SCRYPT_MAX) {
    if (!priority && scryptWaiting.length >= SCRYPT_QUEUE) throw new HttpError(503, 'busy');
    await new Promise((resolve) => (priority ? scryptWaiting.unshift(resolve) : scryptWaiting.push(resolve)));
  }
  scryptBusy++;
  try { return await scrypt(pw, salt, 32); } finally { scryptBusy--; scryptWaiting.shift()?.(); }
}

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await limitedScrypt(pw, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function checkPassword(pw, stored, { priority = false } = {}) {
  // a stored value that isn't a salt:key pair (an erased account, a hand-made row) is a wrong password, after the same work, never a crash
  const m = /^([0-9a-f]{16,}):([0-9a-f]{32,})$/.exec(String(stored ?? ''));
  const got = await limitedScrypt(String(pw ?? ''), Buffer.from(m ? m[1] : '00'.repeat(16), 'hex'), priority);
  if (!m) return false;
  const want = Buffer.from(m[2], 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const TOKEN_DAYS = 90;
/** `ver` is the member's token_ver: bumping it in the database signs them out of every device. */
// ---- names on the rankings ----------------------------------------------------------------------------------------
// To protect people's ikhlas the people rankings show other members under a made-up name, never their username, display name
// or picture. The made-up name is always the same for the same member (it comes from the server's secret, so it cannot be
// worked out from outside). Tapping a row opens the real profile through a signed `ref`, which only this server can make.
const ADJ = ['Quiet', 'Humble', 'Patient', 'Gentle', 'Steady', 'Bright', 'Calm', 'Kind', 'Sincere', 'Grateful', 'Hopeful', 'Peaceful', 'Faithful', 'Radiant', 'Modest', 'Noble', 'Swift', 'Serene', 'Tender', 'Devoted', 'Mindful', 'Generous', 'Cheerful', 'Loyal', 'Honest', 'Graceful', 'Hidden', 'Early', 'Blessed', 'Luminous', 'Content', 'Thankful', 'Warm', 'Trusting', 'Wise', 'Fragrant', 'Joyful', 'Steadfast', 'Silent', 'Golden'];
const NOUN = ['Lantern', 'Traveller', 'Falcon', 'Garden', 'Pearl', 'Dawn', 'River', 'Olive', 'Crescent', 'Date', 'Star', 'Compass', 'Mountain', 'Rose', 'Dove', 'Palm', 'Oasis', 'Candle', 'Well', 'Horizon', 'Meadow', 'Sparrow', 'Cedar', 'Breeze', 'Moon', 'Spring', 'Path', 'Harbour', 'Jasmine', 'Light', 'Seeker', 'Wanderer', 'Fig', 'Anchor', 'Lamp', 'Orchard', 'Reed', 'Shore', 'Summit', 'Wing'];
const mac = (s, n) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, n);
export function aliasFor(userId) {
  const b = crypto.createHmac('sha256', SECRET).update(`alias:${userId}`).digest();
  return `${ADJ[b[0] % ADJ.length]} ${NOUN[b[1] % NOUN.length]} ${10 + ((b[2] << 8) | b[3]) % 90}`;
}
export const makeRef = (userId) => `${Number(userId).toString(36)}.${mac(`ref:${userId}`, 10)}`;
/** The member id inside a genuine ref, or null. */
export function readRef(ref) {
  const [id36, sig] = String(ref ?? '').split('.');
  const id = parseInt(id36, 36);
  if (!Number.isInteger(id) || id < 1 || !sig) return null;
  const want = mac(`ref:${id}`, 10);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null;
}

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
/** Takes back one counted attempt. Attempts are counted before the slow password check, so parallel guesses can't all slip past the lock. */
export function forgiveFailure(key) { const b = buckets.get(key); if (b && b.n > 0) b.n -= 1; }
export const clearFailures = (key) => buckets.delete(key);

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

/**
 * The address used for rate limits and lockouts: IPv6 by its /64 (one home or phone line gets a whole /64, so counting single
 * addresses would give one caller billions of fresh budgets); IPv4, also when written as ::ffff:a.b.c.d, as it is.
 */
export function rateIp(ip) {
  const s = String(ip || '');
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (v4) return v4[1];
  if (!s.includes(':')) return s;
  const [head, tail = ''] = s.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = s.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

/**
 * A device token, given at sign-in and kept by the app: a later sign-in from that device skips the account's lock (the password is
 * still checked), so strangers' wrong guesses can't lock a member out of their own phone. It grants nothing on its own.
 */
export function signDevice(userId) {
  const body = `${userId}.${crypto.randomBytes(9).toString('base64url')}`;
  return `${body}.${crypto.createHmac('sha256', SECRET).update(`device:${body}`).digest('base64url')}`;
}
export function deviceUser(token) {
  const [id, nonce, sig] = String(token ?? '').split('.');
  if (!id || !nonce || !sig) return null;
  return sameSecret(sig, crypto.createHmac('sha256', SECRET).update(`device:${id}.${nonce}`).digest('base64url')) ? Number(id) : null;
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
