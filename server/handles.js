// Usernames and caravan names share one namespace: a name is free only when no member and no caravan uses it.
import { db } from './db.js';

const one = (sql, ...a) => db.prepare(sql).get(...a);

const RESERVED = new Set(['admin', 'root', 'support', 'durood', 'qafila', 'quest', 'seerah', 'seerat', 'api', 'null', 'undefined']);
export const USERNAME = /^[a-z0-9_]{3,20}$/i;
/** member_<id> is what deleted accounts become; all digits could be taken for a phone number at login. */
export const isReserved = (u) => RESERVED.has(u.toLowerCase()) || /^member_\d+$/i.test(u) || /^\d+$/.test(u);
export const validHandle = (n) => typeof n === 'string' && USERNAME.test(n) && !isReserved(n);

/** Taken by a member (other than exceptUserId) or a caravan (other than exceptCaravanId). */
export const handleTaken = (name, { exceptUserId = 0, exceptCaravanId = 0 } = {}) => !!(
  one('SELECT 1 FROM users WHERE username = ? AND id != ?', name, exceptUserId)
  || one('SELECT 1 FROM caravans WHERE name = ? AND id != ?', name, exceptCaravanId));
