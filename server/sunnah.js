import crypto from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, tx, getSetting, setSetting } from './db.js';
import { HttpError, photoSig } from './auth.js';
import { CFG, dayOf, grant, evalBadges, settleQuests, tickSunnah } from './game.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

export const UPLOAD_DIR = process.env.UPLOAD_DIR
  || (process.env.DB_PATH === ':memory:' ? mkdtempSync(path.join(os.tmpdir(), 'quest-')) : 'data/uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_IMAGE = 200_000;      // the app squeezes photos to about 100 KB before upload; this is the most the server will take

/**
 * Validates a JPEG and rebuilds it from only what an image needs: quantisation and Huffman tables, the frame header, restart interval
 * and the scan data. Camera metadata (EXIF/GPS), comments, ICC profiles, thumbnails, application and unknown segments are dropped, and
 * anything after the final end-of-image marker is cut. Returns { data, width, height }. Throws bad_image for anything that is not a plain
 * baseline or progressive JPEG within the size limits.
 */
export function cleanJpeg(buf, { maxBytes = MAX_IMAGE, minDim = 200, maxDim = 1280 } = {}) {
  const bad = () => new HttpError(400, 'bad_image');
  if (buf.length < 600 || buf.length > maxBytes || buf[0] !== 0xff || buf[1] !== 0xd8) throw bad();
  const KEEP = new Set([0xc0, 0xc1, 0xc2, 0xc4, 0xdb, 0xdd]); // SOF0-2, DHT, DQT, DRI
  const out = [Buffer.from([0xff, 0xd8])];
  let i = 2, width = 0, height = 0, scanAt = -1;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw bad();
    const m = buf[i + 1];
    if (m === 0xff) { i += 1; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw bad();
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) { height = buf.readUInt16BE(i + 5); width = buf.readUInt16BE(i + 7); }
    if (m === 0xda) { scanAt = i; break; }          // start of scan: everything after is image data up to the final EOI
    if (KEEP.has(m)) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  if (scanAt < 0) throw bad();
  const end = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (end <= scanAt) throw bad();
  out.push(buf.subarray(scanAt, end + 2));          // the scan(s), cut at the last EOI so nothing can ride behind the image
  const data = Buffer.concat(out);
  if (!width || !height || width < minDim || height < minDim || width > maxDim || height > maxDim) throw bad();
  return { data, width, height };
}

const photoUrl = (id) => `/photos/${id}/${photoSig(id)}`;

export function photoFile(id, sig) {
  if (sig !== photoSig(id)) return null;
  const p = one("SELECT file FROM posts WHERE id = ? AND status != 'removed' AND purged_at IS NULL", id);
  return p ? path.join(UPLOAD_DIR, p.file) : null;
}

const sunnahOut = (s) => s && ({ id: s.id, day: s.day, titleEn: s.title_en, titleUr: s.title_ur, descEn: s.desc_en, descUr: s.desc_ur, source: s.source });
const postOut = (p) => ({
  id: p.id, day: p.day, status: p.status, likes: p.likes, photoUrl: p.purged_at ? null : photoUrl(p.id),
  titleEn: p.title_en, titleUr: p.title_ur, createdAt: p.created_at,
});

/** What the composer needs: today's sunnah, whether it was ticked, the member's own photo and this week's class photo. */
export function today(userId) {
  const s = one('SELECT * FROM sunnahs WHERE day = ?', dayOf());
  const mine = s && one(`SELECT p.*, s.day, s.title_en, s.title_ur FROM posts p JOIN sunnahs s ON s.id = p.sunnah_id
                         WHERE p.user_id = ? AND p.sunnah_id = ?`, userId, s.id);
  const ticked = !!(s && one("SELECT 1 FROM events WHERE user_id = ? AND kind = 'sunnah_tick' AND ref = ?", userId, String(s.id)));
  return { sunnah: sunnahOut(s), mine: mine ? postOut(mine) : null, ticked, rules: { tickXp: CFG.sunnahTickXp, sunnahXp: CFG.sunnahXp } };
}

export function mine(userId) {
  return all(`SELECT p.*, s.day, s.title_en, s.title_ur FROM posts p JOIN sunnahs s ON s.id = p.sunnah_id
              WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 30`, userId).map(postOut);
}

export function tick(userId) {
  const s = one('SELECT * FROM sunnahs WHERE day = ?', dayOf());
  if (!s) throw new HttpError(404, 'no_sunnah');
  return tickSunnah(userId, s.id);
}

/**
 * Posting a photo completes the sunnah (or the weekly class) at once: members are trusted, and the feed's likes and reports
 * are the check. The reward is paid in the same step, exactly once.
 */
export function createPost(userId, imageB64) {
  const s = one('SELECT * FROM sunnahs WHERE day = ?', dayOf());
  if (!s) throw new HttpError(404, 'no_sunnah');
  if (one('SELECT 1 FROM posts WHERE user_id = ? AND sunnah_id = ?', userId, s.id)) throw new HttpError(409, 'already_posted');
  const raw = Buffer.from(String(imageB64 || '').replace(/^data:image\/jpeg;base64,/, ''), 'base64');
  const { data } = cleanJpeg(raw);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  if (one('SELECT 1 FROM posts WHERE sha256 = ?', sha)) throw new HttpError(409, 'duplicate_image');

  const file = `${crypto.randomBytes(16).toString('hex')}.jpg`;
  writeFileSync(path.join(UPLOAD_DIR, file), data, { mode: 0o600 });
  try {
    const fresh = [];
    const id = tx(() => {
      const r = run(`INSERT INTO posts (user_id, sunnah_id, file, sha256, status, created_day, created_at, resolved_at) VALUES (?,?,?,?, 'verified', ?,?,?)`,
        userId, s.id, file, sha, dayOf(), Date.now(), Date.now());
      const postId = Number(r.lastInsertRowid);
      grant(userId, 'sunnah', postId, CFG.sunnahXp);
      settleQuests(userId);
      evalBadges(userId, fresh);
      return postId;
    });
    return { id };
  } catch (e) {
    try { unlinkSync(path.join(UPLOAD_DIR, file)); } catch { /* already gone */ }
    throw e;
  }
}

/** Posts that exist from before verification was dropped: make them visible and pay the reward they were waiting for. */
function migrateOldPosts() {
  run("UPDATE posts SET status = 'verified', resolved_at = COALESCE(resolved_at, created_at) WHERE status IN ('pending','expired')");
  run("UPDATE posts SET status = 'removed', resolved_at = COALESCE(resolved_at, created_at) WHERE status = 'rejected'"); // a photo that was turned down stays hidden
  for (const p of all(`SELECT p.id, p.user_id, s.kind FROM posts p JOIN sunnahs s ON s.id = p.sunnah_id
        WHERE p.status = 'verified' AND NOT EXISTS (SELECT 1 FROM events e WHERE e.kind IN ('sunnah','class') AND e.ref = CAST(p.id AS TEXT))`)) {
    grant(p.user_id, p.kind === 'class' ? 'class' : 'sunnah', p.id, p.kind === 'class' ? 150 : CFG.sunnahXp);
  }
  // the weekly class photo no longer exists: take those posts out of the feed (what they paid stays paid)
  run("UPDATE posts SET status = 'removed' WHERE status != 'removed' AND sunnah_id IN (SELECT id FROM sunnahs WHERE kind = 'class')");
}
if (getSetting('posts_migrated_v') !== '1') { migrateOldPosts(); setSetting('posts_migrated_v', '1'); } // once, not on every start

// ---- retention: photos are kept only as long as they are needed -----------------------------------------------------------
const PHOTO_KEEP_MS = (Number(process.env.PHOTO_KEEP_DAYS) || 14) * 86400e3;
function purge(rows) {
  let n = 0;
  for (const p of rows) {
    try { unlinkSync(path.join(UPLOAD_DIR, p.file)); } catch (e) { if (e.code !== 'ENOENT') continue; } // keep the row to retry if the delete failed
    run('UPDATE posts SET purged_at = ? WHERE id = ?', Date.now(), p.id);
    n += 1;
  }
  return n;
}
/** Deletes the picture file of every post that was decided (or expired) more than PHOTO_KEEP_DAYS ago. The row, votes and payouts stay. */
export function purgeOldPhotos(now = Date.now()) {
  return purge(all("SELECT id, file FROM posts WHERE purged_at IS NULL AND COALESCE(resolved_at, created_at) < ? LIMIT 500", now - PHOTO_KEEP_MS));
}
/** Account deletion: every picture goes now and the posts leave the feed. */
export function purgeUser(userId) {
  run("UPDATE posts SET status = 'removed' WHERE user_id = ?", userId);
  return purge(all('SELECT id, file FROM posts WHERE user_id = ? AND purged_at IS NULL', userId));
}

// ---- admin ----------------------------------------------------------------
export function addSunnahs(items) {
  const list = Array.isArray(items) ? items : [items];
  if (!list.length || list.length > 400) throw new HttpError(400, 'bad_sunnah');
  return tx(() => list.map((x) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.day)) || !x.title_en) throw new HttpError(400, 'bad_sunnah');
    run(`INSERT INTO sunnahs (day, title_en, title_ur, desc_en, desc_ur, source, created_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(day) DO UPDATE SET title_en = excluded.title_en, title_ur = excluded.title_ur,
           desc_en = excluded.desc_en, desc_ur = excluded.desc_ur, source = excluded.source`,
      x.day, String(x.title_en), String(x.title_ur || ''), String(x.desc_en || ''), String(x.desc_ur || ''), String(x.source || ''), Date.now());
    return x.day;
  }));
}
