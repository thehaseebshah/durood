import crypto from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, tx } from './db.js';
import { HttpError, photoSig } from './auth.js';
import { CFG, dayOf, grant, evalBadges, settleQuests } from './game.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

export const UPLOAD_DIR = process.env.UPLOAD_DIR
  || (process.env.DB_PATH === ':memory:' ? mkdtempSync(path.join(os.tmpdir(), 'qafila-')) : 'data/uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_IMAGE = 1_500_000;

/**
 * Validates a JPEG and rebuilds it without metadata (EXIF/GPS, comments, ICC, thumbnails).
 * Returns { data, width, height }. Throws bad_image for anything that is not a plain baseline/progressive JPEG.
 */
export function cleanJpeg(buf) {
  const bad = () => new HttpError(400, 'bad_image');
  if (buf.length < 1000 || buf.length > MAX_IMAGE || buf[0] !== 0xff || buf[1] !== 0xd8) throw bad();
  const out = [buf.subarray(0, 2)];
  let i = 2, width = 0, height = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw bad();
    const m = buf[i + 1];
    if (m === 0xff) { i += 1; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw bad();
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) { height = buf.readUInt16BE(i + 5); width = buf.readUInt16BE(i + 7); }
    const strip = (m >= 0xe1 && m <= 0xed) || m === 0xef || m === 0xfe;
    if (m === 0xda) { // start of scan: everything after is image data up to EOI
      out.push(buf.subarray(i));
      break;
    }
    if (!strip) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const data = Buffer.concat(out);
  if (data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) throw bad();
  if (!width || !height || width < 200 || height < 200 || width > 6000 || height > 6000) throw bad();
  return { data, width, height };
}

const photoUrl = (id) => `/photos/${id}/${photoSig(id)}`;

export function photoFile(id, sig) {
  if (sig !== photoSig(id)) return null;
  const p = one("SELECT file FROM posts WHERE id = ? AND status != 'removed'", id);
  return p ? path.join(UPLOAD_DIR, p.file) : null;
}

function expireOld() {
  run("UPDATE posts SET status = 'expired', resolved_at = ? WHERE status = 'pending' AND created_at < ?", Date.now(), Date.now() - CFG.postWindowMs);
}

const sunnahOut = (s) => s && ({ id: s.id, day: s.day, titleEn: s.title_en, titleUr: s.title_ur, descEn: s.desc_en, descUr: s.desc_ur, source: s.source });
const postOut = (p) => ({
  id: p.id, day: p.day, status: p.status, confirms: p.confirms, rejects: p.rejects, photoUrl: photoUrl(p.id),
  titleEn: p.title_en, titleUr: p.title_ur, createdAt: p.created_at,
});

export function today(userId) {
  expireOld();
  const s = one('SELECT * FROM sunnahs WHERE day = ?', dayOf());
  const mine = s && one(`SELECT p.*, s.day, s.title_en, s.title_ur FROM posts p JOIN sunnahs s ON s.id = p.sunnah_id
                         WHERE p.user_id = ? AND p.sunnah_id = ?`, userId, s.id);
  return { sunnah: sunnahOut(s), mine: mine ? postOut(mine) : null, rules: { confirmsNeeded: CFG.confirmsNeeded, sunnahXp: CFG.sunnahXp, verifyXp: CFG.verifyXp } };
}

export function mine(userId) {
  expireOld();
  return all(`SELECT p.*, s.day, s.title_en, s.title_ur FROM posts p JOIN sunnahs s ON s.id = p.sunnah_id
              WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 30`, userId).map(postOut);
}

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
    const id = tx(() => {
      const r = run(`INSERT INTO posts (user_id, sunnah_id, file, sha256, created_day, created_at) VALUES (?,?,?,?,?,?)`,
        userId, s.id, file, sha, dayOf(), Date.now());
      settleQuests(userId);
      return Number(r.lastInsertRowid);
    });
    return { id };
  } catch (e) {
    try { unlinkSync(path.join(UPLOAD_DIR, file)); } catch { /* already gone */ }
    throw e;
  }
}

// Reviewers see the least-reviewed posts first so every post gets a fair chance. Vote counts and the
// poster's name are hidden to keep reviews independent and unbiased.
export function feed(userId) {
  expireOld();
  return all(`SELECT p.id, s.title_en, s.title_ur, s.desc_en, s.desc_ur, p.created_at FROM posts p JOIN sunnahs s ON s.id = p.sunnah_id
    WHERE p.status = 'pending' AND p.user_id != ?
      AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.post_id = p.id AND v.user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.post_id = p.id AND r.user_id = ?)
    ORDER BY (p.confirms + p.rejects) ASC, p.created_at ASC LIMIT 10`, userId, userId, userId)
    .map((p) => ({ id: p.id, titleEn: p.title_en, titleUr: p.title_ur, descEn: p.desc_en, descUr: p.desc_ur, photoUrl: photoUrl(p.id), createdAt: p.created_at }));
}

function resolve(post) {
  const outcome = post.confirms >= CFG.confirmsNeeded ? 'verified' : post.rejects >= CFG.confirmsNeeded ? 'rejected' : null;
  if (!outcome) return null;
  const fresh = [];
  run('UPDATE posts SET status = ?, resolved_at = ? WHERE id = ?', outcome, Date.now(), post.id);
  if (outcome === 'verified') {
    grant(post.user_id, 'sunnah', post.id, CFG.sunnahXp);
    evalBadges(post.user_id, fresh);
  }
  // reviewers are paid only when they agreed with the final outcome, so careless clicking earns nothing
  const agreeing = all('SELECT user_id FROM votes WHERE post_id = ? AND vote = ?', post.id, outcome === 'verified' ? 'confirm' : 'reject');
  for (const v of agreeing) {
    grant(v.user_id, 'verify', post.id, CFG.verifyXp);
    evalBadges(v.user_id, fresh);
  }
  return outcome;
}

export function vote(userId, postId, choice) {
  if (choice !== 'confirm' && choice !== 'reject') throw new HttpError(400, 'bad_vote');
  expireOld();
  return tx(() => {
    const post = one('SELECT * FROM posts WHERE id = ?', postId);
    if (!post) throw new HttpError(404, 'not_found');
    if (post.user_id === userId) throw new HttpError(403, 'own_post');
    if (post.status !== 'pending') throw new HttpError(409, 'already_resolved');
    if (one('SELECT 1 FROM votes WHERE post_id = ? AND user_id = ?', postId, userId)) throw new HttpError(409, 'already_voted');
    if (one('SELECT COUNT(*) n FROM votes WHERE user_id = ? AND day = ?', userId, dayOf()).n >= CFG.maxVotesPerDay) throw new HttpError(429, 'vote_cap');

    run('INSERT INTO votes (post_id, user_id, vote, day, created_at) VALUES (?,?,?,?,?)', postId, userId, choice, dayOf(), Date.now());
    run(`UPDATE posts SET ${choice === 'confirm' ? 'confirms' : 'rejects'} = ${choice === 'confirm' ? 'confirms' : 'rejects'} + 1 WHERE id = ?`, postId);
    const outcome = resolve(one('SELECT * FROM posts WHERE id = ?', postId));
    settleQuests(userId);
    return { outcome };
  });
}

export function report(userId, postId) {
  return tx(() => {
    const post = one('SELECT * FROM posts WHERE id = ?', postId);
    if (!post) throw new HttpError(404, 'not_found');
    if (post.user_id === userId) throw new HttpError(403, 'own_post');
    if (post.status !== 'pending') throw new HttpError(409, 'already_resolved');
    if (run('INSERT OR IGNORE INTO reports (post_id, user_id, created_at) VALUES (?,?,?)', postId, userId, Date.now()).changes) {
      run('UPDATE posts SET reports = reports + 1 WHERE id = ?', postId);
      if (post.reports + 1 >= 3) run("UPDATE posts SET status = 'removed' WHERE id = ?", postId); // hidden until an admin restores it
    }
    return { ok: true };
  });
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

export function reportedPosts() {
  return all(`SELECT p.id, p.status, p.reports, p.confirms, p.rejects, s.title_en FROM posts p JOIN sunnahs s ON s.id = p.sunnah_id
              WHERE p.reports > 0 OR p.status = 'removed' ORDER BY p.id DESC LIMIT 50`)
    .map((p) => ({ ...p, photoUrl: photoUrl(p.id) }));
}

export function moderate(postId, action) {
  const post = one('SELECT * FROM posts WHERE id = ?', postId);
  if (!post) throw new HttpError(404, 'not_found');
  // only unresolved posts can be pulled or restored: a resolved post has already paid out and stays on the record
  if (action === 'remove' && post.status === 'pending') run("UPDATE posts SET status = 'removed' WHERE id = ?", postId);
  else if (action === 'restore' && post.status === 'removed') {
    run("UPDATE posts SET status = 'pending', reports = 0 WHERE id = ?", postId);
    run('DELETE FROM reports WHERE post_id = ?', postId);
  } else throw new HttpError(400, 'bad_action');
  return { ok: true };
}
