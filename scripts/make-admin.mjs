// Usage: node scripts/make-admin.mjs <username> [owner|moderator|organiser]   (add DB_PATH if the database is not data/durood.db)
// Gives an existing member a role. Use it for the very first owner; after that, owners add admins on the Admins tab.
import { db } from '../server/db.js';
import { ROLES } from '../server/admins.js';

const [username, role = 'owner'] = process.argv.slice(2);
if (!username || !ROLES.includes(role)) { console.error(`Usage: node scripts/make-admin.mjs <username> [${ROLES.join('|')}]`); process.exit(1); }
const r = db.prepare('UPDATE users SET admin_role = ?, admin_since = COALESCE(admin_since, ?) WHERE username = ? AND deleted_at IS NULL').run(role, Date.now(), username);
if (!r.changes) { console.error(`No member called ${username}.`); process.exit(1); }
db.prepare('INSERT INTO admin_log (at, action, target, detail, actor) VALUES (?,?,?,?,?)').run(Date.now(), 'grant-admin', username, role, 'command line');
console.log(`${username} is now ${role}.`);
