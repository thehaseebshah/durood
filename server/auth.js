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
export function signToken(userId) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400;
  const body = `${userId}.${exp}`;
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [id, exp, sig] = token.split('.');
  if (!id || !exp || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(`${id}.${exp}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return Number(id);
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
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();
