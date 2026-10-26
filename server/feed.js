import { db, tx } from './db.js';
import { HttpError, photoSig, avatarUrl } from './auth.js';
import { CFG, dayOf, weekStart, grant, settleQuests, publicQuiz, quizPassed } from './game.js';
import { cityPodium } from './compete.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

// ---- the question of the day and written reflections ---------------------------------------------------------------
export const REFLECTION_MAX = 280;
// plain text only: no links, so a reflection can never be an advert or a way to lure members elsewhere
export const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|pk|io|me|co|info|app|tv|xyz)\b)/i;

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

/** Plain text only: control characters out, no links, 1..max characters. */
function cleanText(text, max) {
  const body = String(text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[ \t]+/g, ' ').trim();
  const len = [...body].length;
  if (!len) throw new HttpError(400, 'empty_text');
  if (len > max) throw new HttpError(400, 'text_too_long');
  if (LINK.test(body)) throw new HttpError(400, 'no_links');
  return body;
}

export function postReflection(userId, text) {
  const body = cleanText(text, REFLECTION_MAX);
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
  comment: { table: 'lecture_comments', owner: 'user_id', live: "status = 'visible'", gone: "status = 'removed'", restore: "status = 'visible'" },
  reply: { table: 'replies', owner: 'user_id', live: "status = 'visible'", gone: "status = 'removed'", restore: "status = 'visible'", noLikes: true },
};
const itemOf = (kind) => (Object.hasOwn(ITEMS, kind) && ITEMS[kind]) || (() => { throw new HttpError(400, 'bad_kind'); })();

/**
 * One like per member per item, never taken back, so the points it earns stay exact. The poster earns likeXp for each of the
 * first likeCap likes; liking earns nothing, and nobody can like their own post.
 */
export function like(userId, kind, itemId) {
  const it = itemOf(kind);
  if (it.noLikes) throw new HttpError(400, 'bad_kind');
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

// ---- "MashaAllah" on a milestone: caravan mates congratulate each other. No points, so there is nothing to farm. ------------------
db.exec(`CREATE TABLE IF NOT EXISTS cheers (event_id INTEGER NOT NULL REFERENCES feed_events(id), user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, PRIMARY KEY (event_id, user_id)) WITHOUT ROWID`);
/** Only a milestone the member can see in their feed (their caravan's), never their own, once each. */
export function cheer(userId, eventId) {
  const e = one(`SELECT e.id, e.user_id FROM feed_events e JOIN users u ON u.id = e.user_id WHERE e.id = ? AND e.kind = 'badge' AND u.deleted_at IS NULL AND u.suspended = 0
      AND e.user_id IN (SELECT cm.user_id FROM caravan_members cm WHERE cm.caravan_id = (SELECT x.caravan_id FROM caravan_members x WHERE x.user_id = ?))`, Number(eventId), userId);
  if (!e) throw new HttpError(404, 'not_found');
  if (e.user_id === userId) throw new HttpError(403, 'own_post');
  run('INSERT OR IGNORE INTO cheers (event_id, user_id, created_at) VALUES (?,?,?)', e.id, userId, Date.now());
  return { cheers: one('SELECT COUNT(*) n FROM cheers WHERE event_id = ?', e.id).n, cheered: true };
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
  const comments = all(`SELECT c.id, c.status, c.reports, c.likes, c.created_at, c.body text, u.username FROM lecture_comments c JOIN users u ON u.id = c.user_id
                        WHERE c.reports > 0 OR c.status = 'removed' ORDER BY c.id DESC LIMIT 50`)
    .map((r) => ({ kind: 'comment', id: r.id, status: r.status, reports: r.reports, likes: r.likes, username: r.username, text: r.text, at: r.created_at }));
  const replies = all(`SELECT r.id, r.status, r.reports, r.created_at, r.body text, u.username FROM replies r JOIN users u ON u.id = r.user_id
                       WHERE r.reports > 0 OR r.status = 'removed' ORDER BY r.id DESC LIMIT 50`)
    .map((r) => ({ kind: 'reply', id: r.id, status: r.status, reports: r.reports, likes: 0, username: r.username, text: r.text, at: r.created_at }));
  return [...posts, ...refl, ...comments, ...replies].sort((a, b) => b.at - a.at);
}

export function moderateContent(kind, itemId, action) {
  const it = itemOf(kind);
  if (!one(`SELECT 1 FROM ${it.table} WHERE id = ?`, itemId)) throw new HttpError(404, 'not_found');
  if (action === 'remove') run(`UPDATE ${it.table} SET ${it.gone} WHERE id = ?`, itemId);
  else if (action === 'restore') {
    // a photo's file is deleted 14 days after it was posted: restoring the row would bring back nothing
    if (kind === 'post' && one('SELECT 1 FROM posts WHERE id = ? AND purged_at IS NOT NULL', itemId)) throw new HttpError(409, 'photo_gone');
    run(`UPDATE ${it.table} SET ${it.restore}, reports = 0 WHERE id = ?`, itemId);
    run('DELETE FROM content_reports WHERE kind = ? AND item_id = ?', kind, itemId);
  } else throw new HttpError(400, 'bad_action');
  return { ok: true };
}

// ---- comments on the weekly lecture, and short replies ---------------------------------------------------------------
export const COMMENT_MAX = 280;
export const REPLY_MAX = 140;
export const REPLIES_PER_POST = 3;

/** One comment per member per lecture, and only after passing its quiz (a lecture without a quiz needs it watched). */
export function postComment(userId, lectureId, text) {
  const body = cleanText(text, COMMENT_MAX);
  return tx(() => {
    const l = one('SELECT * FROM lectures WHERE id = ?', lectureId);
    if (!l) throw new HttpError(404, 'not_found');
    const done = publicQuiz(l).length ? quizPassed(userId, l.id) : !!one("SELECT 1 FROM events WHERE user_id = ? AND kind = 'lecture' AND ref = ?", userId, String(l.id));
    if (!done) throw new HttpError(403, 'quiz_first');
    if (one('SELECT 1 FROM lecture_comments WHERE lecture_id = ? AND user_id = ?', l.id, userId)) throw new HttpError(409, 'already_posted');
    const r = run('INSERT INTO lecture_comments (lecture_id, user_id, body, created_at) VALUES (?,?,?,?)', l.id, userId, body, Date.now());
    grant(userId, 'comment', l.id, CFG.commentXp);
    return { id: Number(r.lastInsertRowid), xp: CFG.commentXp };
  });
}

const REPLY_TARGETS = {
  post: "SELECT user_id FROM posts WHERE id = ? AND status = 'verified' AND purged_at IS NULL",
  reflection: "SELECT user_id FROM reflections WHERE id = ? AND status = 'visible'",
  comment: "SELECT user_id FROM lecture_comments WHERE id = ? AND status = 'visible'",
};

/** Up to REPLIES_PER_POST short replies per member per post, one level deep; two points for the first replyDailyCap a day, never on your own post. */
export function postReply(userId, kind, itemId, text) {
  const target = Object.hasOwn(REPLY_TARGETS, kind) && REPLY_TARGETS[kind];
  if (!target) throw new HttpError(400, 'bad_kind');
  const body = cleanText(text, REPLY_MAX);
  return tx(() => {
    const row = one(target, itemId);
    if (!row) throw new HttpError(404, 'not_found');
    if (one("SELECT COUNT(*) n FROM replies WHERE kind = ? AND item_id = ? AND user_id = ? AND status = 'visible'", kind, itemId, userId).n >= REPLIES_PER_POST) throw new HttpError(429, 'reply_limit');
    const r = run('INSERT INTO replies (kind, item_id, user_id, body, created_at) VALUES (?,?,?,?,?)', kind, itemId, userId, body, Date.now());
    const id = Number(r.lastInsertRowid);
    let xp = 0;
    if (row.user_id !== userId && one("SELECT COUNT(*) n FROM events WHERE user_id = ? AND kind = 'reply' AND day = ?", userId, dayOf()).n < CFG.replyDailyCap) {
      if (grant(userId, 'reply', `${kind}:${itemId}:${id}`, CFG.replyXp)) xp = CFG.replyXp;
    }
    return { id, xp };
  });
}

export function listReplies(userId, kind, itemId) {
  if (!Object.hasOwn(REPLY_TARGETS, kind)) throw new HttpError(400, 'bad_kind');
  if (!one(REPLY_TARGETS[kind], itemId)) throw new HttpError(404, 'not_found'); // replies go with a removed or hidden post
  return all(`SELECT r.id, r.body, r.created_at, r.user_id, u.username, u.city, u.avatar_v av, u.display_name dn,
      EXISTS(SELECT 1 FROM content_reports c WHERE c.kind = 'reply' AND c.item_id = r.id AND c.user_id = ?) reported
    FROM replies r JOIN users u ON u.id = r.user_id
    WHERE r.kind = ? AND r.item_id = ? AND r.status = 'visible' AND u.deleted_at IS NULL AND u.suspended = 0 ORDER BY r.id LIMIT 200`, userId, kind, itemId)
    .map((r) => ({ id: r.id, body: r.body, at: r.created_at, username: r.username, displayName: r.dn, avatar: avatarUrl(r.user_id, r.av), city: r.city, mine: r.user_id === userId, reported: !!r.reported }));
}

// ---- this week's lectures ------------------------------------------------------------------------------------------
// every lecture belongs to the week it is featured in; rows from before weeks existed take the week they were added in
for (const l of all('SELECT id, created_at FROM lectures WHERE week_start IS NULL')) run('UPDATE lectures SET week_start = ? WHERE id = ?', weekStart(dayOf(l.created_at)), l.id);

export function lectureList(userId, { week = weekStart() } = {}) {
  return all(`SELECT l.*, EXISTS(SELECT 1 FROM events e WHERE e.user_id = ? AND e.kind = 'lecture' AND e.ref = CAST(l.id AS TEXT)) done
              FROM lectures l WHERE l.week_start = ? ORDER BY l.id DESC LIMIT 20`, userId, week).map((l) => {
    const quiz = publicQuiz(l);
    return { id: l.id, youtubeId: l.youtube_id, titleEn: l.title_en, titleUr: l.title_ur, speaker: l.speaker, minSeconds: l.min_seconds, xp: l.xp, done: !!l.done,
      week: l.week_start, quiz, quizPassed: quiz.length ? quizPassed(userId, l.id) : null,
      canComment: quiz.length ? quizPassed(userId, l.id) : !!l.done,
      myComment: (() => { const c = one('SELECT id, body, likes, status FROM lecture_comments WHERE lecture_id = ? AND user_id = ?', l.id, userId); return c && { id: c.id, body: c.body, likes: c.likes, status: c.status }; })(),
      commentMax: COMMENT_MAX };
  });
}

// ---- the feed -------------------------------------------------------------------------------------------------------
const photo = (id) => `/photos/${id}/${photoSig(id)}`;
export const FEED_PAGE = 20;

/**
 * Newest first, five kinds of item: announcements, sunnah photos, lecture comments, reflections, milestones of the member's own caravan and each crore of the challenge. Paged by time.
 */
export function feed(userId, before = Date.now() + 1) {
  const cutoff = Number(before) || Date.now() + 1;
  const items = [];
  for (const a of all('SELECT * FROM announcements WHERE created_at < ? ORDER BY created_at DESC LIMIT ?', cutoff, FEED_PAGE + 1)) {
    items.push({ type: 'announcement', id: a.id, at: a.created_at, titleEn: a.title_en, titleUr: a.title_ur, bodyEn: a.body_en, bodyUr: a.body_ur });
  }
  const replyN = (kind, id) => one("SELECT COUNT(*) n FROM replies WHERE kind = ? AND item_id = ? AND status = 'visible'", kind, id).n;
  for (const p of all(`SELECT p.id, p.user_id, p.created_at, p.likes, p.w, p.h, s.title_en, s.title_ur, u.username, u.city, u.avatar_v av, u.display_name dn,
        EXISTS(SELECT 1 FROM likes l WHERE l.kind = 'post' AND l.item_id = p.id AND l.user_id = ?) liked
      FROM posts p JOIN sunnahs s ON s.id = p.sunnah_id JOIN users u ON u.id = p.user_id
      WHERE p.status = 'verified' AND p.purged_at IS NULL AND s.kind != 'class' AND p.created_at < ? AND u.deleted_at IS NULL AND u.suspended = 0
      ORDER BY p.created_at DESC LIMIT ?`, userId, cutoff, FEED_PAGE + 1)) {
    items.push({ type: 'photo', kind: 'sunnah', id: p.id, replies: replyN('post', p.id), at: p.created_at, username: p.username, displayName: p.dn, avatar: avatarUrl(p.user_id, p.av), city: p.city, titleEn: p.title_en, titleUr: p.title_ur,
      photoUrl: photo(p.id), w: p.w || null, h: p.h || null, likes: p.likes, liked: !!p.liked, mine: p.user_id === userId });
  }
  for (const r of all(`SELECT r.id, r.user_id, r.body, r.likes, r.created_at, r.day, u.username, u.city, u.avatar_v av, u.display_name dn, pr.text_en, pr.text_ur,
        EXISTS(SELECT 1 FROM likes l WHERE l.kind = 'reflection' AND l.item_id = r.id AND l.user_id = ?) liked
      FROM reflections r JOIN users u ON u.id = r.user_id LEFT JOIN prompts pr ON pr.day = r.day
      WHERE r.status = 'visible' AND r.created_at < ? AND u.deleted_at IS NULL AND u.suspended = 0
      ORDER BY r.created_at DESC LIMIT ?`, userId, cutoff, FEED_PAGE + 1)) {
    items.push({ type: 'reflection', id: r.id, replies: replyN('reflection', r.id), at: r.created_at, username: r.username, displayName: r.dn, avatar: avatarUrl(r.user_id, r.av), city: r.city, body: r.body, likes: r.likes, liked: !!r.liked, mine: r.user_id === userId,
      promptEn: r.text_en, promptUr: r.text_ur });
  }
  for (const c of all(`SELECT c.id, c.user_id, c.body, c.likes, c.created_at, u.username, u.city, u.avatar_v av, u.display_name dn, l.title_en, l.title_ur,
        EXISTS(SELECT 1 FROM likes k WHERE k.kind = 'comment' AND k.item_id = c.id AND k.user_id = ?) liked
      FROM lecture_comments c JOIN users u ON u.id = c.user_id JOIN lectures l ON l.id = c.lecture_id
      WHERE c.status = 'visible' AND c.created_at < ? AND u.deleted_at IS NULL AND u.suspended = 0
      ORDER BY c.created_at DESC LIMIT ?`, userId, cutoff, FEED_PAGE + 1)) {
    items.push({ type: 'comment', id: c.id, at: c.created_at, username: c.username, displayName: c.dn, avatar: avatarUrl(c.user_id, c.av), city: c.city, body: c.body, likes: c.likes, liked: !!c.liked, mine: c.user_id === userId,
      replies: replyN('comment', c.id), lectureEn: c.title_en, lectureUr: c.title_ur });
  }
  for (const e of all(`SELECT e.id, e.user_id, e.ref, e.created_at, u.username FROM feed_events e JOIN users u ON u.id = e.user_id
      WHERE e.kind = 'badge' AND e.created_at < ? AND u.deleted_at IS NULL AND u.suspended = 0
        AND (e.user_id = ? OR e.user_id IN (SELECT cm.user_id FROM caravan_members cm WHERE cm.caravan_id = (SELECT x.caravan_id FROM caravan_members x WHERE x.user_id = ?)))
      ORDER BY e.created_at DESC LIMIT ?`, cutoff, userId, userId, FEED_PAGE + 1)) {
    items.push({ type: 'milestone', id: e.id, at: e.created_at, username: e.username, code: e.ref, mine: e.user_id === userId,
      cheers: one('SELECT COUNT(*) n FROM cheers WHERE event_id = ?', e.id).n, cheered: !!one('SELECT 1 FROM cheers WHERE event_id = ? AND user_id = ?', e.id, userId) });
  }
  for (const c of all("SELECT key, value FROM settings WHERE key GLOB 'ch_m_[0-9]*'")) {
    const at = Number(c.value), k = Number(c.key.slice(5));
    if (at < cutoff) items.push({ type: 'crore', id: k, at, k });
  }
  for (const c of cityPodium()) if (c.at < cutoff) items.push({ type: 'city', id: `${c.week}:${c.rank}`, at: c.at, rank: c.rank, label: c.label, score: c.score });
  items.sort((a, b) => b.at - a.at || (a.type < b.type ? -1 : 1));
  const page = items.slice(0, FEED_PAGE);
  return { items: page, next: items.length > FEED_PAGE ? page.at(-1).at : null };
}
