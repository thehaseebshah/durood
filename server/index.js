import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { db, tx, getSetting } from './db.js';
import * as burhan from './burhan.js';
import * as caravanApi from './caravan.js';
import * as profile from './profile.js';
import { USERNAME, isReserved, handleTaken as handleTakenBy } from './handles.js';
import { HttpError, hashPassword, checkPassword, signToken, verifyToken, rateLimit, lockedOut, recordFailure, clientIp, sameSecret } from './auth.js';
import { auditAsync } from './audit.js';
import * as access from './access.js';
import { sendMail, resetEmail, confirmEmail, inviteEmail, baseUrl } from './mail.js';
import * as sunnah from './sunnah.js';
import * as news from './news.js';
import * as feedApi from './feed.js';
import * as geo from './geo.js';
import * as compete from './compete.js';
import { CFG, dayOf, challengeSummary, challengeSeries, setChallenge, startChallengeIfNeeded, editEntry, history, anonymiseUser, listFlags, resolveFlag, setHidden, logDurood, startLecture, completeLecture, answerQuiz, quizPassed, publicQuiz, parseQuestions, claimCircle, getMe, weekStart, setSpecialDay, deleteSpecialDay, listSpecialDays, leaderboard, qabilaBoard, teamView, publicStats } from './game.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const one = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);

// ---- validation -----------------------------------------------------------
// usernames and caravan names share one namespace (handles.js)
const CITY_LOCK_MS = 14 * 86400e3;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const EMAIL = { test: (e) => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e) }; // length first: no regex work on huge input

/**
 * Any international number. `cc` (a country code like "GB") lets a member type their national number: the country's calling
 * code is put in front and a leading 0 dropped. Pakistani 03xx numbers keep working without a country.
 */
export function normalizePhone(raw, cc) {
  let p = String(raw || '').replace(/[\s\-.]/g, '').replace(/^(\+\d{1,3})\(0\)/, '$1').replace(/[()]/g, ''); // "+44 (0)7911…": the trunk 0 in brackets is not part of the number
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (!p.startsWith('+')) {
    const dial = cc && geo.dialOf(cc);
    if (!cc || cc === 'PK') {
      if (/^03\d{9}$/.test(p)) p = '+92' + p.slice(1);
      else if (/^92\d{10}$/.test(p)) p = '+' + p;
      else if (dial && /^\d{4,14}$/.test(p)) p = `+${dial}${p.replace(/^0+/, '')}`;
    } else if (dial && /^\d{4,14}$/.test(p)) {
      // a national number that already starts with the country's dial code is that number, not a second copy of the code
      p = p.startsWith(dial) && p.length >= dial.length + 7 && !p.startsWith('0') ? `+${p}` : `+${dial}${p.replace(/^0+/, '')}`;
    }
  }
  return /^\+[1-9]\d{7,14}$/.test(p) && geo.knownDialCode(p) ? p : null;
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

// single-use links: only a hash is stored, so a database leak can't be turned into working links
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
function makeToken(userId, kind, ttlMs) {
  const raw = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO tokens (hash, user_id, kind, expires_at, created_at) VALUES (?,?,?,?,?)').run(hashToken(raw), userId, kind, Date.now() + ttlMs, Date.now());
  return raw;
}
function useToken(raw, kind) {
  const t = one('SELECT * FROM tokens WHERE hash = ? AND kind = ?', hashToken(String(raw || '')), kind);
  if (!t || t.used_at || t.expires_at < Date.now()) throw new HttpError(400, 'bad_token');
  run('UPDATE tokens SET used_at = ? WHERE hash = ?', Date.now(), t.hash);
  return t.user_id;
}

const tokenFor = (id) => signToken(id, one('SELECT token_ver v FROM users WHERE id = ?', id).v);
const lang = (v) => (v === 'en' ? 'en' : 'ur');

// where the sign-up form starts: the country from the visitor's IP, else the browser's time zone, else Pakistan
route('GET', '/api/geo', { auth: false }, ({ query, ip }) => {
  rateLimit(`geo:${ip}`, 60, 60e3);
  const cc = geo.detectCountry({ ip, tz: String(query.get('tz') || '').slice(0, 60) });
  return { country: cc, dial: geo.dialOf(cc), countries: geo.COUNTRIES };
});
route('GET', '/api/cities', { auth: false }, ({ query, ip }) => {
  rateLimit(`cities:${ip}`, 240, 60e3);
  return { cities: geo.searchCities(query.get('q'), query.get('cc')) };
});

route('GET', '/api/username-check', { auth: false }, ({ query, ip }) => {
  rateLimit(`uc:${ip}`, 120, 60e3);
  const u = String(query.get('u') || '');
  if (!USERNAME.test(u) || isReserved(u)) return { ok: false, reason: 'bad_username' };
  return { ok: !handleTakenBy(u) };
});

// ---- caravans: a named group, joined by invitation or request (caravan.js) ----------------------------------------------------
route('GET', '/api/caravan', ({ user }) => caravanApi.view(user));
route('POST', '/api/caravan', ({ user, body }) => { rateLimit(`cvc:${user}`, 20, 3600e3); return { ...caravanApi.create(user, body.name), view: caravanApi.view(user), me: getMe(user) }; });
route('PUT', '/api/caravan/name', ({ user, body }) => { rateLimit(`cvn:${user}`, 10, 3600e3); caravanApi.rename(user, body.name); return { view: caravanApi.view(user) }; });
route('GET', '/api/caravan/name-check', ({ user, query }) => {
  const n = String(query.get('u') || '').trim();
  if (!USERNAME.test(n) || isReserved(n)) return { ok: false, reason: 'bad_caravan_name' };
  const mine = one('SELECT c.id FROM caravan_members cm JOIN caravans c ON c.id = cm.caravan_id WHERE cm.user_id = ?', user);
  return { ok: !handleTakenBy(n, { exceptUserId: 0, exceptCaravanId: mine?.id ?? 0 }) };
});
route('POST', '/api/caravan/invite', ({ user, body }) => { rateLimit(`cvi:${user}`, 60, 3600e3); return { ...caravanApi.invite(user, body.username), view: caravanApi.view(user) }; });
route('POST', '/api/caravan/join', ({ user, body }) => { rateLimit(`cvj:${user}`, 20, 3600e3); return { ...caravanApi.requestJoin(user, body.name), view: caravanApi.view(user), me: getMe(user) }; });
route('POST', '/api/caravan/invitations/:id', ({ user, params, body }) => { const r = caravanApi.answerInvitation(user, Number(params.id), body.accept === true); return { ...r, view: caravanApi.view(user), me: getMe(user) }; });
route('POST', '/api/caravan/requests/:username', ({ user, params, body }) => ({ ...caravanApi.answerRequest(user, params.username, body.accept === true), view: caravanApi.view(user) }));
route('POST', '/api/caravan/cancel', ({ user, body }) => ({ ...caravanApi.cancelPending(user, { username: body.username, caravanId: body.caravanId }), view: caravanApi.view(user) }));
route('POST', '/api/caravan/leave', ({ user }) => ({ ...caravanApi.leave(user), view: caravanApi.view(user), me: getMe(user) }));
route('POST', '/api/caravan/remove', ({ user, body }) => ({ ...caravanApi.removeByOwner(user, body.username), view: caravanApi.view(user) }));
route('GET', '/api/caravan/search', ({ user, query }) => { rateLimit(`cvs:${user}`, 60, 60e3); return { usernames: caravanApi.searchInvitees(user, query.get('q')), caravans: caravanApi.searchCaravans(query.get('q')) }; });
route('GET', '/api/admin/caravans', { auth: false, admin: true }, () => ({ caravans: caravanApi.adminList() }));
route('DELETE', '/api/admin/caravans/:id', { auth: false, admin: true }, ({ params }) => caravanApi.adminDelete(Number(params.id)));

// ---- Al-Burhan edition: murabbi, masul, mamulaat, tasks and routines (404 in the public edition) ----------------------------------
const B = (fn) => (ctx) => { burhan.guard(); return fn(ctx); };
route('GET', '/api/burhan', B(({ user }) => burhan.burhanState(user)));
route('POST', '/api/burhan/murabbi', B(async ({ user }) => { rateLimit(`bm:${user}`, 6, 3600e3); return { murabbi: await burhan.activateMurabbi(user) }; }));
route('POST', '/api/burhan/murabbi/confirm', B(({ user }) => ({ murabbi: burhan.confirmMurabbi(user) })));
route('DELETE', '/api/burhan/murabbi', B(({ user }) => burhan.unlinkMurabbi(user)));
route('GET', '/api/burhan/requests', B(({ user }) => ({ requests: burhan.murabbiRequests(user) })));
route('POST', '/api/burhan/requests/:username', B(({ user, params, body }) => burhan.answerRequest(user, params.username, body.accept === true)));
route('PUT', '/api/burhan/masul', B(({ user, body }) => { rateLimit(`bms:${user}`, 20, 3600e3); return { masul: burhan.setMasul(user, body.username) }; }));
route('DELETE', '/api/burhan/masul', B(({ user }) => burhan.clearMasul(user)));
route('GET', '/api/burhan/usernames', B(({ user, query }) => { rateLimit(`bu:${user}`, 60, 60e3); return { usernames: burhan.searchUsernames(query.get('q'), user) }; }));
route('POST', '/api/assignments', B(({ user, body }) => { rateLimit(`as:${user}`, 60, 3600e3); return burhan.addAssignment(user, body.razakar, body); }));
route('DELETE', '/api/assignments/:id', B(({ user, params }) => burhan.endAssignment(user, Number(params.id))));
route('POST', '/api/assignments/:id/tick', B(({ user, params, body }) => burhan.tickAssignment(user, Number(params.id), body.done !== false)));
route('GET', '/api/burhan/saaliks', B(({ user }) => ({ saaliks: burhan.saalikList(user) })));
route('GET', '/api/burhan/saaliks/:username', B(({ user, params }) => { rateLimit(`bsr:${user}`, 120, 3600e3); return burhan.saalikReport(user, params.username); }));
route('GET', '/api/burhan/razakars', B(({ user }) => ({ razakars: burhan.razakarList(user) })));
route('GET', '/api/burhan/razakars/:username', B(({ user, params }) => burhan.razakarReport(user, params.username)));

route('GET', '/api/invite-check', { auth: false }, ({ query, ip }) => {
  rateLimit(`inv:${ip}`, 60, 60e3);
  try {
    const r = access.resolveInvite(query.get('code'));
    return { valid: true, kind: r.kind, from: r.kind === 'member' ? r.label : null };
  } catch (e) {
    if (e instanceof HttpError) return { valid: false, reason: e.code };
    throw e;
  }
});

route('GET', '/api/config', { auth: false }, () => ({ inviteOnly: access.INVITE_ONLY(), edition: burhan.edition() }));

route('POST', '/api/waitlist', { auth: false }, ({ body, ip }) => {
  rateLimit(`wl:${ip}`, 5, 3600e3);
  const name = String(body.name || '').trim();
  const phone = normalizePhone(body.phone);
  const email = String(body.email || '').trim().toLowerCase();
  if (name.length < 2) throw new HttpError(400, 'bad_name');
  if (!phone) throw new HttpError(400, 'bad_phone');
  if (email && !EMAIL.test(email)) throw new HttpError(400, 'bad_email');
  return access.addToWaitlist({ name, phone, email, city: body.city });
});

route('POST', '/api/register', { auth: false }, async ({ body, ip }) => {
  rateLimit(`reg:${ip}`, Number(process.env.REG_LIMIT_PER_HOUR) || 30, 3600e3);
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = normalizePhone(body.phone, body.phoneCountry);
  const password = String(body.password || '');
  if (!USERNAME.test(username) || isReserved(username)) throw new HttpError(400, 'bad_username');
  if (!EMAIL.test(email)) throw new HttpError(400, 'bad_email');
  if (!phone) throw new HttpError(400, 'bad_phone');
  if (password.length < 6 || password.length > 128) throw new HttpError(400, 'bad_password');
  const place = geo.cityById(body.cityId);          // the city is required: it decides which city board the member's durood counts for
  if (!place) throw new HttpError(400, 'city_required');

  const inviteRaw = body.invite ?? body.referral;
  if (access.INVITE_ONLY() && !String(inviteRaw || '').trim()) throw new HttpError(400, 'invite_required');
  const pass = await hashPassword(password);
  const { id, confirmToken } = tx(() => {
    // resolve again inside the transaction so a code can't be used past its limit by two people at once
    let r = null;
    if (String(inviteRaw || '').trim()) r = access.resolveInvite(inviteRaw);
    if (handleTakenBy(username)) throw new HttpError(409, 'username_taken');
    if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'email_taken');
    if (one('SELECT 1 FROM users WHERE phone = ?', phone)) throw new HttpError(409, 'phone_taken');
    if (r) access.consumeInvite(r);
    const referrerId = r?.kind === 'member' ? r.referrerId : null;
    const res = run(`INSERT INTO users (username, email, phone, pass, lang, city, city_id, country, referrer_id, created_day, created_at, invited_via, invite_code)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      username, email, phone, pass, lang(body.lang), place.name, place.id, place.cc, referrerId, dayOf(), Date.now(),
      r ? r.kind : 'open', r?.invite ? r.code : (r?.kind === 'public' ? r.code : null));
    const uid = Number(res.lastInsertRowid);
    startChallengeIfNeeded(); // day 1 of the challenge is the day the first member joins
    run('INSERT INTO ancestors (user_id, ancestor_id, depth) VALUES (?,?,0)', uid, uid);
    burhan.linkWaitingMurabbis(uid, phone); // a murabbi who signs up completes the links of the saliks waiting for them
    if (referrerId) {
      run(`INSERT INTO ancestors (user_id, ancestor_id, depth)
           SELECT ?, ancestor_id, depth + 1 FROM ancestors WHERE user_id = ?`, uid, referrerId);
    }
    if (referrerId) setImmediate(() => news.notifyJoined(referrerId, username));
    return { id: uid, confirmToken: makeToken(uid, 'confirm', 7 * 86400e3) };
  });
  // a confirmation link goes out but never blocks sign-in: it tells us which addresses actually work
  sendMail(confirmEmail(email, `${baseUrl()}/?confirm=${confirmToken}`));
  return { token: tokenFor(id), me: getMe(id) };
});

let dummyHash = null;
route('POST', '/api/login', { auth: false }, async ({ body, ip }) => {
  rateLimit(`login:${ip}`, 120, 600e3);
  const ident = String(body.id || '').trim().slice(0, 254);
  const password = String(body.password || '');
  // the identifier is read by its shape, never with OR: an email, a phone number or a username
  const phone = /^\+?[\d\s\-().]{7,}$/.test(ident) ? normalizePhone(ident) : null;
  const u = ident.includes('@') ? one('SELECT id, pass, suspended, deleted_at FROM users WHERE email = ?', ident.toLowerCase())
    : phone ? one('SELECT id, pass, suspended, deleted_at FROM users WHERE phone = ?', phone)
    : one('SELECT id, pass, suspended, deleted_at FROM users WHERE username = ?', ident);
  // wrong passwords are counted per account however the person is named, and only failures count, so a stranger cannot lock the owner out of a correct login
  const key = `loginfail:${u ? u.id : ident.toLowerCase().slice(0, 80)}`;
  if (lockedOut(key, 10)) throw new HttpError(429, 'rate_limited');
  dummyHash ??= await hashPassword('timing-equaliser');
  const ok = await checkPassword(password, u && !u.deleted_at ? u.pass : dummyHash); // the same work whether or not the account exists
  if (!u || u.deleted_at || !ok) { recordFailure(key, 600e3); throw new HttpError(401, 'bad_login'); }
  if (u.suspended) throw new HttpError(403, 'suspended');
  return { token: tokenFor(u.id), me: getMe(u.id) };
});

route('GET', '/api/public', { auth: false }, () => publicStats());
route('GET', '/api/me', ({ user }) => getMe(user));

route('PATCH', '/api/me', async ({ user, body }) => {
  // validate every field first so a bad one cannot leave the others half-applied
  let email = null, place = null, goal = null;
  if (body.email !== undefined) {
    email = String(body.email).trim().toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(400, 'bad_email');
    const cur = one('SELECT email, pass FROM users WHERE id = ?', user);
    if (email === cur.email) email = null;
    else {
      rateLimit(`emailchg:${user}`, 3, 86400e3);
      if (!(await checkPassword(String(body.password || ''), cur.pass))) throw new HttpError(403, 'password_needed'); // a stolen session cannot redirect the account's mail
      if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'email_taken');
    }
  }
  if (body.cityId !== undefined) {
    place = geo.cityById(body.cityId);
    if (!place) throw new HttpError(400, 'city_required');
  }
  if (body.dailyGoal !== undefined) {
    goal = Number(body.dailyGoal);
    if (!Number.isInteger(goal) || goal < 1 || goal > 100_000) throw new HttpError(400, 'bad_count');
  }
  if (body.lang !== undefined) run('UPDATE users SET lang = ? WHERE id = ?', lang(body.lang), user);
  if (email) {
    run('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?', email, user);
    sendMail(confirmEmail(email, `${baseUrl()}/?confirm=${makeToken(user, 'confirm', 7 * 86400e3)}`));
  }
  if (body.reminderTime !== undefined) news.setReminder(user, body.reminderTime);
  if (place) {
    const cur = one('SELECT city_id, city_changed_at FROM users WHERE id = ?', user);
    if (cur.city_id && cur.city_id !== place.id) {
      if (cur.city_changed_at && Date.now() - cur.city_changed_at < CITY_LOCK_MS) throw new HttpError(429, 'city_locked'); // one change a fortnight: no hopping to the leading city before a weekly close
      run('UPDATE users SET city_changed_at = ? WHERE id = ?', Date.now(), user);
    }
    run('UPDATE users SET city = ?, city_id = ?, country = ? WHERE id = ?', place.name, place.id, place.cc, user);
  }
  if (goal !== null) run('UPDATE users SET daily_goal = ? WHERE id = ?', goal, user);
  return getMe(user);
});

// ---- profile: picture, name, bio, password, phone ----------------------------------------------------------------------------------
route('PUT', '/api/me/profile', ({ user, body }) => { rateLimit(`prof:${user}`, 30, 3600e3); profile.updateProfile(user, body); return getMe(user); });
route('POST', '/api/me/avatar', { maxBody: 120_000 }, ({ user, body }) => { rateLimit(`avatar:${user}`, 10, 3600e3); profile.setAvatar(user, body.image); return getMe(user); });
route('DELETE', '/api/me/avatar', ({ user }) => { profile.removeAvatar(user); return getMe(user); });
route('POST', '/api/me/password', async ({ user, body }) => {
  const key = `pwfail:${user}`;
  if (lockedOut(key, 5)) throw new HttpError(429, 'rate_limited');                                  // five wrong current passwords lock this for a while
  try { await profile.changePassword(user, body.current, body.next); } catch (e) { if (e.code === 'wrong_password') recordFailure(key, 900e3); throw e; }
  return { token: tokenFor(user), me: getMe(user) };                                                // this device stays signed in; all others are signed out
});
route('POST', '/api/me/phone', async ({ user, body }) => {
  if (lockedOut(`phonechg:${user}`, 3)) throw new HttpError(429, 'rate_limited');                 // three changes a day; only real changes count
  const cur = one('SELECT pass FROM users WHERE id = ?', user);
  const key = `pwfail:${user}`;
  if (lockedOut(key, 5)) throw new HttpError(429, 'rate_limited');
  if (!(await checkPassword(String(body.password || ''), cur.pass))) { recordFailure(key, 900e3); throw new HttpError(403, 'wrong_password'); }
  const phone = normalizePhone(body.phone, String(body.cc || '').toUpperCase().slice(0, 2));
  if (!phone) throw new HttpError(400, 'bad_phone');
  profile.setPhone(user, phone);
  recordFailure(`phonechg:${user}`, 86400e3);
  return getMe(user);
});
route('GET', '/api/members/:username', ({ user, params }) => { rateLimit(`prof-view:${user}`, 120, 60e3); return profile.publicProfile(params.username); });

route('POST', '/api/log', ({ user, body }) => {
  rateLimit(`log:${user}`, 60, 60e3);
  compete.ensureWeekClosed(); // the first durood of a new week must find last week's promotions already made
  const result = logDurood(user, Number(body.count), body.rid);
  return { ...result, me: getMe(user) };
});

route('POST', '/api/password/forgot', { auth: false }, async ({ body, ip }) => {
  rateLimit(`pw:${ip}`, 8, 3600e3);
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, 'bad_email');
  rateLimit(`pwe:${email}`, 3, 3600e3);
  const u = one('SELECT id, suspended, deleted_at FROM users WHERE email = ?', email);
  if (u && !u.deleted_at) sendMail(resetEmail(email, `${baseUrl()}/?reset=${makeToken(u.id, 'reset', 3600e3)}`)).catch(() => {}); // not awaited: the answer must not reveal, by its speed, whether the address is registered
  return { ok: true }; // identical answer whether or not the address is registered
});

route('POST', '/api/password/reset', { auth: false }, async ({ body, ip }) => {
  rateLimit(`pwr:${ip}`, 20, 3600e3);
  const password = String(body.password || '');
  if (password.length < 6 || password.length > 128) throw new HttpError(400, 'bad_password');
  const userId = useToken(body.token, 'reset');
  const pass = await hashPassword(password);
  tx(() => {
    run('UPDATE users SET pass = ?, token_ver = token_ver + 1 WHERE id = ?', pass, userId); // old sessions stop working
    run("UPDATE tokens SET used_at = ? WHERE user_id = ? AND kind = 'reset' AND used_at IS NULL", Date.now(), userId);
  });
  return { token: tokenFor(userId), me: getMe(userId) };
});

route('POST', '/api/sessions/revoke', ({ user }) => {
  run('UPDATE users SET token_ver = token_ver + 1 WHERE id = ?', user);
  return { token: tokenFor(user) }; // every other device is signed out; this one gets a fresh token
});

route('POST', '/api/email/confirm', { auth: false }, ({ body }) => {
  const userId = useToken(body.token, 'confirm');
  run('UPDATE users SET email_verified_at = ? WHERE id = ?', Date.now(), userId);
  return { ok: true };
});

route('POST', '/api/email/resend', ({ user }) => {
  rateLimit(`ers:${user}`, 3, 3600e3);
  const u = one('SELECT email, email_verified_at FROM users WHERE id = ?', user);
  if (!u.email_verified_at) sendMail(confirmEmail(u.email, `${baseUrl()}/?confirm=${makeToken(user, 'confirm', 7 * 86400e3)}`));
  return { ok: true };
});

route('GET', '/api/history', ({ user }) => history(user));
route('PATCH', '/api/entries/:id', ({ user, params, body }) => {
  rateLimit(`edit:${user}`, 30, 60e3);
  const r = editEntry(user, Number(params.id), Number(body.count), body.rid);
  return { ...r, me: getMe(user), history: history(user) };
});

route('DELETE', '/api/me', { admin: false }, async ({ user, body }) => {
  const u = one('SELECT pass FROM users WHERE id = ?', user);
  if (!(await checkPassword(String(body.password || ''), u.pass))) throw new HttpError(401, 'bad_login');
  anonymiseUser(user, await hashPassword(crypto.randomBytes(24).toString('hex')));
  sunnah.purgeUser(user); // their photos go with their name
  return { ok: true };
});

route('GET', '/api/leaderboard', ({ user, query }) => {
  const t = query.get('type');
  const type = t === 'caravans' ? 'caravans' : t === 'trees' || t === 'teams' ? 'trees' : 'users';
  const p = query.get('period');
  const period = p === 'all' ? 'all' : p === 'challenge' ? 'challenge' : 'week';
  const metric = query.get('metric');
  if (t === 'cities') return compete.cityBoard(user, metric === 'average' || metric === 'growth' ? metric : 'total');
  if (type === 'caravans') return caravanApi.board(user, period, metric === 'average' || metric === 'growth' ? metric : 'total');
  if (type === 'trees' && (metric === 'average' || metric === 'growth')) return qabilaBoard(user, metric);
  return leaderboard(user, type, period);
});

route('GET', '/api/challenge', ({ user }) => ({ summary: challengeSummary(), series: challengeSeries() }));
route('GET', '/api/league', ({ user }) => { compete.ensureWeekClosed(); return compete.leagueView(user); });
route('GET', '/api/team', ({ user }) => teamView(user));

route('GET', '/api/lectures', ({ user }) => ({ lectures: feedApi.lectureList(user), circleUrl: CFG.circleUrl, circleXp: CFG.circleXp }));
route('POST', '/api/lectures/:id/quiz', ({ user, params, body }) => {
  rateLimit(`quiz:${user}`, 60, 60e3);
  return answerQuiz(user, Number(params.id), body.answers);
});
route('POST', '/api/lectures/:id/start', ({ user, params }) => startLecture(user, Number(params.id)));
route('POST', '/api/lectures/:id/complete', ({ user, params }) => {
  const r = completeLecture(user, Number(params.id));
  return { ...r, me: getMe(user) };
});
route('POST', '/api/circle/claim', ({ user }) => ({ ...claimCircle(user), me: getMe(user) }));

route('GET', '/api/sunnah/today', ({ user }) => sunnah.today(user));
route('GET', '/api/sunnah/mine', ({ user }) => ({ posts: sunnah.mine(user) }));
route('POST', '/api/sunnah/post', { maxBody: 400_000 }, ({ user, body }) => {
  rateLimit(`post:${user}`, 10, 60e3);
  const r = sunnah.createPost(user, body.image);
  return { ...r, ...sunnah.today(user), me: getMe(user) };
});
route('POST', '/api/sunnah/tick', ({ user }) => ({ ...sunnah.tick(user), ...sunnah.today(user), me: getMe(user) }));
route('GET', '/api/feed', ({ user, query }) => {
  const before = query.get('before');
  const page = feedApi.feed(user, before || undefined);
  if (before) return page; // later pages are only the stream
  const seenAt = one('SELECT news_seen_at s FROM users WHERE id = ?', user).s;
  return { ...page, seenAt, lectures: feedApi.lectureList(user), today: sunnah.today(user), reflection: feedApi.reflectionToday(user) };
});
route('POST', '/api/reflections', ({ user, body }) => {
  rateLimit(`refl:${user}`, 10, 60e3);
  const r = feedApi.postReflection(user, body.text);
  return { ...r, reflection: feedApi.reflectionToday(user), me: getMe(user) };
});
route('POST', '/api/lectures/:id/comment', ({ user, params, body }) => {
  rateLimit(`lcom:${user}`, 10, 60e3);
  const r = feedApi.postComment(user, Number(params.id), body.text);
  return { ...r, lectures: feedApi.lectureList(user), me: getMe(user) };
});
route('GET', '/api/replies', ({ user, query }) => ({ replies: feedApi.listReplies(user, query.get('kind'), Number(query.get('id'))) }));
route('POST', '/api/replies', ({ user, body }) => {
  rateLimit(`reply:${user}`, 30, 60e3);
  const r = feedApi.postReply(user, body.kind, Number(body.id), body.text);
  return { ...r, replies: feedApi.listReplies(user, body.kind, Number(body.id)), me: getMe(user) };
});
route('POST', '/api/like', ({ user, body }) => {
  rateLimit(`like:${user}`, 120, 60e3);
  const r = feedApi.like(user, body.kind, Number(body.id));
  return { ...r, me: getMe(user) };
});
route('POST', '/api/report', ({ user, body }) => {
  rateLimit(`report:${user}`, 30, 60e3);
  return feedApi.report(user, body.kind, Number(body.id));
});

route('POST', '/api/admin/sunnahs', { auth: false, admin: true }, ({ body }) => ({ days: sunnah.addSunnahs(body.sunnahs ?? body) }));
route('GET', '/api/admin/reported', { auth: false, admin: true }, () => ({ items: feedApi.reportedContent() }));
route('POST', '/api/admin/content/:kind/:id', { auth: false, admin: true }, ({ params, body }) => feedApi.moderateContent(params.kind, Number(params.id), body.action));
route('GET', '/api/admin/prompts', { auth: false, admin: true }, () => ({ prompts: feedApi.listPrompts() }));
route('POST', '/api/admin/prompts', { auth: false, admin: true }, ({ body }) => feedApi.setPrompt(body));
route('GET', '/api/news', ({ user }) => news.listNews(user));
route('POST', '/api/news/seen', ({ user }) => news.markNewsSeen(user));
route('GET', '/api/push/key', () => news.pushKey());
route('POST', '/api/push/subscribe', ({ user, body }) => news.subscribe(user, body));
route('DELETE', '/api/push', ({ user }) => news.unsubscribe(user));

// ---- admin ----
const adm = { auth: false, admin: true };
route('GET', '/api/admin/invites', adm, () => ({ invites: access.listInvites(), publicCode: access.publicCode() }));
route('POST', '/api/admin/invites', adm, ({ body }) => access.createFounderCode({ label: body.label, maxUses: body.maxUses }));
route('POST', '/api/admin/invites/:code/revoke', adm, ({ params }) => access.revokeInvite(params.code));
route('POST', '/api/admin/public-code', adm, ({ body }) => access.setPublicCode({ code: body.code, enabled: body.enabled, dailyCap: body.dailyCap }));
route('GET', '/api/admin/waitlist', adm, ({ query }) => ({ requests: access.listWaitlist(query.get('status') || 'pending') }));
route('POST', '/api/admin/waitlist/:id', adm, async ({ params, body }) => {
  const r = access.resolveWaitlist(Number(params.id), body.action);
  if (r.code && r.email) r.emailed = await sendMail(inviteEmail(r.email, r.code));
  return r;
});
route('GET', '/api/admin/members', adm, ({ query }) => ({ members: access.searchMembers(query.get('q') || '') }));
route('POST', '/api/admin/members/:username', adm, ({ params, body }) => {
  const a = body.action;
  if (a === 'suspend' || a === 'unsuspend') return access.setSuspended(params.username, a === 'suspend', !!body.branch);
  if (a === 'hide' || a === 'unhide') return setHidden(params.username, a === 'hide');
  if (a === 'reset-link') {
    const u = one('SELECT id FROM users WHERE username = ? AND deleted_at IS NULL', params.username);
    if (!u) throw new HttpError(404, 'not_found');
    return { url: `${baseUrl()}/?reset=${makeToken(u.id, 'reset', 3600e3)}` }; // for sending over WhatsApp when email fails
  }
  if (a === 'remove-avatar' || a === 'clear-profile') {
    const u = one('SELECT id FROM users WHERE username = ? AND deleted_at IS NULL', params.username);
    if (!u) throw new HttpError(404, 'not_found');
    profile.removeAvatar(u.id);
    if (a === 'clear-profile') run("UPDATE users SET display_name = '', bio = '' WHERE id = ?", u.id); // for an offensive name or line
    return { ok: true };
  }
  throw new HttpError(400, 'bad_action');
});
route('GET', '/api/admin/flags', adm, ({ query }) => ({ flags: listFlags(query.get('status') || 'open') }));
route('POST', '/api/admin/flags/:id', adm, ({ params, body }) => resolveFlag(Number(params.id), body.action));
route('GET', '/api/admin/challenge', adm, () => ({ summary: challengeSummary(), series: challengeSeries() }));
route('POST', '/api/admin/challenge', adm, ({ body }) => ({ summary: setChallenge({ start: body.start, days: body.days, target: body.target, clearMilestones: !!body.clearMilestones }) }));
route('GET', '/api/admin/news', adm, () => ({ items: db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 50').all() }));
route('POST', '/api/admin/news', adm, ({ body }) => news.postNews(body));
route('DELETE', '/api/admin/news/:id', adm, ({ params }) => news.deleteNews(Number(params.id)));
route('GET', '/api/admin/export', adm, ({ query }) => ({ csv: news.exportCsv(query.get('kind')) }));
route('GET', '/api/admin/special-days', adm, () => ({ days: listSpecialDays() }));
route('POST', '/api/admin/special-days', adm, ({ body }) => setSpecialDay(body));
route('DELETE', '/api/admin/special-days/:day', adm, ({ params }) => deleteSpecialDay(params.day));
route('GET', '/api/admin/audit', { auth: false, admin: true }, () => auditAsync());
route('GET', '/api/admin/status', adm, () => ({ lastAudit: getSetting('last_audit') ? JSON.parse(getSetting('last_audit')) : null, lastBackup: Number(getSetting('last_backup_at', '0')) || null }));
route('POST', '/api/admin/lectures', { auth: false, admin: true }, ({ body }) => {
  const yt = String(body.youtube_id || '').trim();
  if (!/^[\w-]{11}$/.test(yt) || !body.title_en) throw new HttpError(400, 'bad_lecture');
  const questions = parseQuestions(body.questions);
  if (body.week && (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.week)) || Number.isNaN(Date.parse(`${body.week}T00:00:00Z`)))) throw new HttpError(400, 'bad_lecture');
  const week = body.week ? weekStart(String(body.week)) : weekStart();
  const r = run('INSERT INTO lectures (youtube_id, title_en, title_ur, speaker, min_seconds, xp, questions, week_start, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    yt, String(body.title_en), String(body.title_ur || ''), String(body.speaker || ''),
    Math.max(30, Number(body.min_seconds) || 600), Math.min(CFG.lectureXpMax, Math.max(1, Number(body.xp) || CFG.lectureXp)), questions.length ? JSON.stringify(questions) : '', week, Date.now());
  return { id: Number(r.lastInsertRowid) };
});
route('GET', '/api/admin/lectures', { auth: false, admin: true }, () => ({ lectures: db.prepare('SELECT id, youtube_id, title_en, speaker, week_start, min_seconds, xp FROM lectures ORDER BY week_start DESC, id DESC LIMIT 60').all() }));
route('DELETE', '/api/admin/lectures/:id', { auth: false, admin: true }, ({ params }) => {
  const id = Number(params.id);
  tx(() => { // all or nothing: comments, their replies, likes and reports go with the lecture
    // the points the comments and their likes paid go with them, so every member's XP still equals their events
    const gone = all(`SELECT user_id, kind, ref, xp FROM events WHERE (kind = 'comment' AND ref = ?) OR (kind = 'like' AND ref IN
                      (SELECT 'comment:' || c.id || ':' || l.user_id FROM lecture_comments c JOIN likes l ON l.kind = 'comment' AND l.item_id = c.id WHERE c.lecture_id = ?))`, String(id), id);
    for (const e of gone) {
      run('DELETE FROM events WHERE user_id = ? AND kind = ? AND ref = ?', e.user_id, e.kind, e.ref);
      run('UPDATE users SET xp = xp - ? WHERE id = ?', e.xp, e.user_id);
    }
    run("DELETE FROM replies WHERE kind = 'comment' AND item_id IN (SELECT id FROM lecture_comments WHERE lecture_id = ?)", id);
    run("DELETE FROM likes WHERE kind = 'comment' AND item_id IN (SELECT id FROM lecture_comments WHERE lecture_id = ?)", id);
    run("DELETE FROM content_reports WHERE kind = 'comment' AND item_id IN (SELECT id FROM lecture_comments WHERE lecture_id = ?)", id);
    run('DELETE FROM lecture_comments WHERE lecture_id = ?', id);
    run('DELETE FROM lecture_starts WHERE lecture_id = ?', id);
    run('DELETE FROM lecture_quiz WHERE lecture_id = ?', id);
    run('DELETE FROM lectures WHERE id = ?', id);
  });
  return { ok: true };
});

// ---- server ---------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'too_large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  let v;
  try { v = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'bad_json'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'bad_json');
  return v;
}

async function handleApi(req, res, url) {
  const route_ = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!route_) throw new HttpError(404, 'not_found');
  const m = route_.re.exec(url.pathname);
  let params;
  try { params = Object.fromEntries(route_.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); } catch { throw new HttpError(400, 'bad_path'); }
  const ip = clientIp(req);
  const ctx = { query: url.searchParams, params, ip, body: {}, user: null };

  if (route_.admin) {
    const allow = (process.env.ADMIN_IP_ALLOWLIST || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (allow.length && !allow.includes(ip)) throw new HttpError(403, 'forbidden');
    if (lockedOut(`adminfail:${ip}`, 10)) throw new HttpError(429, 'rate_limited');
    const given = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || typeof given !== 'string' || !sameSecret(given, process.env.ADMIN_KEY)) {
      recordFailure(`adminfail:${ip}`, 900e3); // 10 wrong keys lock this address out for 15 minutes
      throw new HttpError(403, 'forbidden');
    }
  }
  if (route_.auth) {
    const t = verifyToken((req.headers.authorization || '').replace(/^Bearer /, ''));
    const who = t && one('SELECT suspended, deleted_at, token_ver FROM users WHERE id = ?', t.id);
    if (!who || who.deleted_at || who.token_ver !== t.ver) throw new HttpError(401, 'unauthorized');
    if (who.suspended) throw new HttpError(403, 'suspended');
    ctx.user = t.id;
  }
  if (req.method !== 'GET') ctx.body = await readBody(req, route_.maxBody);
  const out = await route_.handler(ctx);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(out));
}

// Scripts may only come from this site, plus the few small inline theme scripts in the HTML pages, allowed by their hash.
function csp(html) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  return [
    "default-src 'self'", `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'", "font-src 'self'",
    "img-src 'self' data: blob:", 'frame-src https://www.youtube-nocookie.com', "connect-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
}

async function handleStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'bad_path'); }
  if (rel.includes('\0')) throw new HttpError(400, 'bad_path');
  if (rel === '/admin') rel = '/admin.html';
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'forbidden');
  let data;
  try { data = await readFile(file); } catch {
    // SPA fallback for extension-less paths (e.g. /?ref=...), 404 for missing assets
    if (path.extname(rel)) throw new HttpError(404, 'not_found');
    file = path.join(PUBLIC_DIR, 'index.html');
    data = await readFile(file);
  }
  const ext = path.extname(file);
  if (ext === '.html') res.setHeader('Content-Security-Policy', csp(data.toString()));
  // a short entity tag plus gzip for the text assets: the app shell is 195 KB raw and about 54 KB compressed, on mobile data
  const compressible = ['.html', '.js', '.css', '.webmanifest', '.svg', '.json'].includes(ext);
  const etag = `"${crypto.createHash('sha1').update(data).digest('base64url').slice(0, 16)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff', ETag: etag, Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  if (compressible && data.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    let gz = gzCache.get(etag);
    if (!gz) { gz = gzipSync(data, { level: 9 }); if (gzCache.size > 64) gzCache.clear(); gzCache.set(etag, gz); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
    return res.end(req.method === 'HEAD' ? undefined : gz);
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : data);
}
const gzCache = new Map();

async function handleAvatar(res, url) {
  const m = /^\/avatars\/(\d+)\/(\d+)\/([\w-]+)$/.exec(url.pathname);
  const file = m && profile.avatarFile(Number(m[1]), Number(m[2]), m[3]);
  if (!file) throw new HttpError(404, 'not_found');
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }); // the address changes with every new picture
  res.end(await readFile(file));
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
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
      if (process.env.FORCE_HSTS === '1' || (process.env.TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https')) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/healthz') { one('SELECT 1'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
      else if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (url.pathname.startsWith('/photos/') && req.method === 'GET') await handlePhoto(res, url);
      else if (url.pathname.startsWith('/avatars/') && req.method === 'GET') await handleAvatar(res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await handleStatic(req, res, url);
      else throw new HttpError(405, 'method_not_allowed');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (status === 413) { res.setHeader('Connection', 'close'); res.once('finish', () => req.destroy()); }
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e instanceof HttpError ? e.code : 'server_error' }));
    }
  });
  // a busy event loop must not look like a dead connection to the proxy in front: keep idle sockets longer than its timeout
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;
  return server;
}

geo.ensureCities();
if (process.env.PUBLIC_FOUNDERS_CODE && !getSetting('public_code')) access.setPublicCode({ code: process.env.PUBLIC_FOUNDERS_CODE, enabled: true });

// Refuse to start a production server that would silently fail members: no way to send reset emails, or a guessable admin key.
function checkProduction() {
  if (process.env.NODE_ENV !== 'production') return;
  const problems = [];
  if (!['resend', 'sendgrid'].includes((process.env.MAIL_PROVIDER || '').toLowerCase()) && process.env.ALLOW_CONSOLE_MAIL !== '1') problems.push('MAIL_PROVIDER must be resend or sendgrid (password-reset emails would never be sent; set ALLOW_CONSOLE_MAIL=1 to override)');
  if (String(process.env.ADMIN_KEY || '').length < 24) problems.push('ADMIN_KEY must be at least 24 random characters');
  if (!process.env.AUTH_SECRET) problems.push('AUTH_SECRET should be set so sessions survive a lost disk');
  if (!process.env.PUBLIC_URL) problems.push('PUBLIC_URL must be set (password-reset and confirmation links are built from it)');
  if (problems.length) { console.error('Refusing to start:\n- ' + problems.join('\n- ')); process.exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e)); // log it: a stray failed promise must not take the service down
  checkProduction();
  const port = Number(process.env.PORT) || 3000;
  news.startScheduler();
  const server = createServer();
  server.listen(port, () => console.log(`Seerah Quest running on http://localhost:${port}`));
  // a deploy sends SIGTERM: stop taking new connections, let requests in flight finish, then leave (a write is never cut in half)
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
    console.log(`${sig}: draining`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
