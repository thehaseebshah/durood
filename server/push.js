import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

// ---- VAPID: the server's own signing key, created once and kept in settings ---------------------------------------
function vapid() {
  let priv = getSetting('vapid_private');
  if (!priv) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    priv = JSON.stringify(privateKey.export({ format: 'jwk' }));
    setSetting('vapid_private', priv);
  }
  const jwk = JSON.parse(priv);
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const pub = b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]));
  return { key, pub };
}
export const vapidPublicKey = () => vapid().pub;

function vapidHeader(endpoint) {
  const { key, pub } = vapid();
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || 'mailto:admin@example.org' }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${pub}`;
}

/**
 * RFC 8291 (aes128gcm) encryption of one push message for a browser subscription.
 * `ephemeral` and `salt` are only injected by the test that checks the RFC's own worked example.
 */
export function encryptPayload(plaintext, p256dh, authSecret, { ephemeral, salt } = {}) {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1');
  if (ephemeral) ecdh.setPrivateKey(unb64u(ephemeral)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const s = salt ? unb64u(salt) : crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, s, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, s, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([s, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Sends one message. Returns 'ok', 'gone' (the subscription is dead and should be deleted) or 'failed'. */
export async function sendPush(sub, message) {
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Authorization: vapidHeader(sub.endpoint) },
      body: encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'failed';
  } catch { return 'failed'; }
}
