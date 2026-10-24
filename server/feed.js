import { db, tx } from './db.js';
import { HttpError, photoSig } from './auth.js';
import { CFG, dayOf, weekStart, grant, settleQuests, publicQuiz, quizPassed } from './game.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

// ---- the question of the day and written reflections ---------------------------------------------------------------
export const REFLECTION_MAX = 280;
// plain text only: no links, so a reflection can never be an advert or a way to lure members elsewhere
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|pk|io|me|co|info|app|tv|xyz)\b)/i;

export function setPrompt({ day, text_en, text_ur }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !String(text_en || '').trim()) throw new HttpError(400, 'bad_prompt');
  run(`INSERT INTO prompts (day, text_en, text_ur) VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET text_en = excluded.text_en, text_ur = excluded.text_ur`,
    day, String(text_en).trim().slice(0, 200), String(text_ur || '').trim().slice(0, 200));
  return { ok: true };
}
export const listPrompts = () => all('SELECT * FROM prompts ORDER BY day DESC LIMIT 60');
const promptOut = (p) => p && { day: p.day, textEn: p.text_en, textUr: p.text_ur };

export function reflectionToday(userId) {
  const day = dayOf();
  const mine = one('SELECT * FROM reflections WHERE user_id = ? AND day = ?', userId, day);
  return { prompt: promptOut(one('SELECT * FROM prompts WHERE day = ?', day)), mine: mine && { id: mine.id, body: mine.body, likes: mine.likes, status: mine.status }, max: REFLECTION_MAX };
}

export function postReflection(userId, text) {
  const body = String(text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim();
  const len = [...body].length;
  if (!len) throw new HttpError(400, 'empty_text');
  if (len > REFLECTION_MAX) throw new HttpError(400, 'text_too_long');
  if (LINK.test(body)) throw new HttpError(400, 'no_links');
  const day = dayOf();
  return tx(() => {
    if (one('SELECT 1 FROM reflections WHERE user_id = ? AND day = ?', userId, day)) throw new HttpError(409, 'already_posted');
    const r = run('INSERT INTO reflections (user_id, day, body, created_at) VALUES (?,?,?,?)', userId, day, body, Date.now());
    settleQuests(userId); // the daily reflection quest pays here
    return { id: Number(r.lastInsertRowid) };
  });
}

// ---- likes, reports, moderation -----------------------------------------------------------------------------------
const ITEMS = {
  post: { table: 'posts', owner: 'user_id', live: "status = 'verified' AND purged_at IS NULL", gone: "status = 'removed'", restore: "status = 'verified'" },
  reflection: { table: 'reflections', owner: 'user_id', live: "status = 'visible'", gone: "status = 'removed'", restore: "status = 'visible'" },
};
const itemOf = (kind) => ITEMS[kind] || (() => { throw new HttpError(400, 'bad_kind'); })();

/**
 * One like per member per item, never taken back, so the points it earns stay exact. The poster earns likeXp for each of the
 * first likeCap likes; liking earns nothing, and nobody can like their own post.
 */
export function like(userId, kind, itemId) {
  const it = itemOf(kind);
  return tx(() => {
    const row = one(`SELECT ${it.owner} owner, likes FROM ${it.table} WHERE id = ? AND ${it.live}`, itemId);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.owner === userId) throw new HttpError(403, 'own_post');
    if (!run('INSERT OR IGNORE INTO likes (kind, item_id, user_id, created_at) VALUES (?,?,?,?)', kind, itemId, userId, Date.now()).changes) throw new HttpError(409, 'already_liked');
    run(`UPDATE ${it.table} SET likes = likes + 1 WHERE id = ?`, itemId);
    const likes = row.likes + 1;
    if (likes <= CFG.likeCap) grant(row.owner, 'like', `${kind}:${itemId}:${userId}`, CFG.likeXp);
    return { likes };
  });
}

/** Three reports from different members hide an item until an admin looks at it. Own items cannot be reported. */
export function report(userId, kind, itemId) {
  const it = itemOf(kind);
  return tx(() => {
    const row = one(`SELECT ${it.owner} owner, reports FROM ${it.table} WHERE id = ? AND ${it.live}`, itemId);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.owner === userId) throw new HttpError(403, 'own_post');
    if (run('INSERT OR IGNORE INTO content_reports (kind, item_id, user_id, created_at) VALUES (?,?,?,?)', kind, itemId, userId, Date.now()).changes) {
      run(`UPDATE ${it.table} SET reports = reports + 1 WHERE id = ?`, itemId);
      if (row.reports + 1 >= 3) run(`UPDATE ${it.table} SET ${it.gone} WHERE id = ?`, itemId);
    }
    return { ok: true };
  });
}

export function reportedContent() {
  const posts = all(`SELECT p.id, p.status, p.reports, p.likes, p.created_at, p.purged_at, u.username, s.title_en text FROM posts p JOIN users u ON u.id = p.user_id JOIN sunnahs s ON s.id = p.sunnah_id
                     WHERE p.reports > 0 OR p.status = 'removed' ORDER BY p.id DESC LIMIT 50`)
    .map((p) => ({ kind: 'post', id: p.id, status: p.status, reports: p.reports, likes: p.likes, username: p.username, text: p.text, photoUrl: p.purged_at ? null : `/photos/${p.id}/${photoSig(p.id)}`, at: p.created_at }));
  const refl = all(`SELECT r.id, r.status, r.reports, r.likes, r.created_at, r.body text, u.username FROM reflections r JOIN users u ON u.id = r.user_id
                    WHERE r.reports > 0 OR r.status = 'removed' ORDER BY r.id DESC LIMIT 50`)
    .map((r) => ({ kind: 'reflection', id: r.id, status: r.status, reports: r.reports, likes: r.likes, username: r.username, text: r.text, at: r.created_at }));
  return [...posts, ...refl].sort((a, b) => b.at - a.at);
}

export function moderateContent(kind, itemId, action) {
  const it = itemOf(kind);
  if (!one(`SELECT 1 FROM ${it.table} WHERE id = ?`, itemId)) throw new HttpError(404, 'not_found');
  if (action === 'remove') run(`UPDATE ${it.table} SET ${it.gone} WHERE id = ?`, itemId);
  else if (action === 'restore') {
    run(`UPDATE ${it.table} SET ${it.restore}, reports = 0 WHERE id = ?`, itemId);
    run('DELETE FROM content_reports WHERE kind = ? AND item_id = ?', kind, itemId);
  } else throw new HttpError(400, 'bad_action');
  return { ok: true };
}

// ---- this week's lectures ------------------------------------------------------------------------------------------
// every lecture belongs to the week it is featured in; rows from before weeks existed take the week they were added in
for (const l of all('SELECT id, created_at FROM lectures WHERE week_start IS NULL')) run('UPDATE lectures SET week_start = ? WHERE id = ?', weekStart(dayOf(l.created_at)), l.id);

export function lectureList(userId, { week = weekStart() } = {}) {
  return all(`SELECT l.*, EXISTS(SELECT 1 FROM events e WHERE e.user_id = ? AND e.kind = 'lecture' AND e.ref = CAST(l.id AS TEXT)) done
              FROM lectures l WHERE l.week_start = ? ORDER BY l.id DESC LIMIT 20`, userId, week).map((l) => {
    const quiz = publicQuiz(l);
    return { id: l.id, youtubeId: l.youtube_id, titleEn: l.title_en, titleUr: l.title_ur, speaker: l.speaker, minSeconds: l.min_seconds, xp: l.xp, done: !!l.done,
      week: l.week_start, quiz, quizPassed: quiz.length ? quizPassed(userId, l.id) : null };
  });
}

// ---- the feed -------------------------------------------------------------------------------------------------------
const photo = (id) => `/photos/${id}/${photoSig(id)}`;
export const FEED_PAGE = 20;

/**
 * Newest first, five kinds of item: announcements, sunnah and class photos, reflections, milestones of the member's own caravan
 * (themselves, the people they invited, and the person who invited them) and each crore of the challenge. Paged by time.
 */
export function feed(userId, before = Date.now() + 1) {
  const cutoff = Number(before) || Date.now() + 1;
  const items = [];
  for (const a of all('SELECT * FROM announcements WHERE created_at < ? ORDER BY created_at DESC LIMIT ?', cutoff, FEED_PAGE + 1)) {
    items.push({ type: 'announcement', id: a.id, at: a.created_at, titleEn: a.title_en, titleUr: a.title_ur, bodyEn: a.body_en, bodyUr: a.body_ur });
  }
  for (const p of all(`SELECT p.id, p.user_id, p.created_at, p.likes, s.title_en, s.title_ur, s.kind, u.username, u.city,
        EXISTS(SELECT 1 FROM likes l WHERE l.kind = 'post' AND l.item_id = p.id AND l.user_id = ?) liked
      FROM posts p JOIN sunnahs s ON s.id = p.sunnah_id JOIN users u ON u.id = p.user_id
      WHERE p.status = 'verified' AND p.purged_at IS NULL AND p.created_at < ? AND u.deleted_at IS NULL AND u.suspended = 0
      ORDER BY p.created_at DESC LIMIT ?`, userId, cutoff, FEED_PAGE + 1)) {
    items.push({ type: 'photo', kind: p.kind === 'class' ? 'class' : 'sunnah', id: p.id, at: p.created_at, username: p.username, city: p.city, titleEn: p.title_en, titleUr: p.title_ur,
      photoUrl: photo(p.id), likes: p.likes, liked: !!p.liked, mine: p.user_id === userId });
  }
  for (const r of all(`SELECT r.id, r.user_id, r.body, r.likes, r.created_at, r.day, u.username, u.city, pr.text_en, pr.text_ur,
        EXISTS(SELECT 1 FROM likes l WHERE l.kind = 'reflection' AND l.item_id = r.id AND l.user_id = ?) liked
      FROM reflections r JOIN users u ON u.id = r.user_id LEFT JOIN prompts pr ON pr.day = r.day
      WHERE r.status = 'visible' AND r.created_at < ? AND u.deleted_at IS NULL AND u.suspended = 0
      ORDER BY r.created_at DESC LIMIT ?`, userId, cutoff, FEED_PAGE + 1)) {
    items.push({ type: 'reflection', id: r.id, at: r.created_at, username: r.username, city: r.city, body: r.body, likes: r.likes, liked: !!r.liked, mine: r.user_id === userId,
      promptEn: r.text_en, promptUr: r.text_ur });
  }
  for (const e of all(`SELECT e.id, e.user_id, e.ref, e.created_at, u.username FROM feed_events e JOIN users u ON u.id = e.user_id
      WHERE e.kind = 'badge' AND e.created_at < ? AND u.deleted_at IS NULL
        AND (e.user_id = ? OR e.user_id IN (SELECT id FROM users WHERE referrer_id = ?) OR e.user_id = (SELECT referrer_id FROM users WHERE id = ?))
      ORDER BY e.created_at DESC LIMIT ?`, cutoff, userId, userId, userId, FEED_PAGE + 1)) {
    items.push({ type: 'milestone', id: e.id, at: e.created_at, username: e.username, code: e.ref, mine: e.user_id === userId });
  }
  for (const c of all("SELECT key, value FROM settings WHERE key GLOB 'ch_m_[0-9]*'")) {
    const at = Number(c.value), k = Number(c.key.slice(5));
    if (at < cutoff) items.push({ type: 'crore', id: k, at, k });
  }
  items.sort((a, b) => b.at - a.at || (a.type < b.type ? -1 : 1));
  const page = items.slice(0, FEED_PAGE);
  return { items: page, next: items.length > FEED_PAGE ? page.at(-1).at : null };
}
