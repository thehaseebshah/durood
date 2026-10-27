import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';

// the database holds password hashes, contact details: files this process creates are readable by it alone
if (isMainThread) process.umask(0o077); // not allowed inside a worker thread, which loads this file too (the audit)
const file = process.env.DB_PATH || 'data/durood.db';
if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
if (file !== ':memory:') for (const f of [file, `${file}-wal`, `${file}-shm`]) { try { if (existsSync(f)) chmodSync(f, 0o600); } catch { /* not ours to change */ } } // files made before the umask

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

// likes and reports apply to photos, reflections, lecture comments and replies. Older databases limited them to the first two (a CHECK
// constraint), so rebuild those two small tables once, keeping every row.
const LIKES_DDL = `CREATE TABLE IF NOT EXISTS likes (
  kind TEXT NOT NULL CHECK (kind IN ('post','reflection','comment','reply')), item_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY (kind, item_id, user_id)) WITHOUT ROWID`;
const REPORTS_DDL = `CREATE TABLE IF NOT EXISTS content_reports (
  kind TEXT NOT NULL CHECK (kind IN ('post','reflection','comment','reply')), item_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY (kind, item_id, user_id)) WITHOUT ROWID`;
for (const [table, ddl] of [['likes', LIKES_DDL], ['content_reports', REPORTS_DDL]]) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (row && !row.sql.includes("'comment'")) {
    db.exec('BEGIN');
    try {
      db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old`);
      db.exec(ddl);
      db.exec(`INSERT INTO ${table} SELECT kind, item_id, user_id, created_at FROM ${table}_old`);
      db.exec(`DROP TABLE ${table}_old`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

// An older database has a ledger with CHECK (count > 0) and no edit columns. Rebuild it once, keeping every row and id,
// BEFORE the schema below runs, because that schema creates indexes on the new columns.
if (hasTable('entries') && !cols('entries').includes('kind')) {
  // the old ledger had CHECK (count > 0) and no edit columns; rebuild it once, keeping every row and id
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE entries RENAME TO entries_old');
    db.exec(`CREATE TABLE entries (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), day TEXT NOT NULL,
      count INTEGER NOT NULL CHECK (count != 0), rid TEXT NOT NULL, created_at INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'add' CHECK (kind IN ('add','reverse','replace')),
      ref_id INTEGER REFERENCES entries(id), UNIQUE (user_id, rid))`);
    db.exec("INSERT INTO entries (id, user_id, day, count, rid, created_at) SELECT id, user_id, day, count, rid, created_at FROM entries_old");
    db.exec('DROP TABLE entries_old');
    db.exec('CREATE INDEX IF NOT EXISTS entries_user_day ON entries(user_id, day)');
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS entries_one_reversal ON entries(ref_id) WHERE kind = 'reverse'");
    db.exec("CREATE TRIGGER IF NOT EXISTS entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'entries is append-only'); END");
    db.exec("CREATE TRIGGER IF NOT EXISTS entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT, 'entries is append-only'); END");
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}


db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone       TEXT NOT NULL UNIQUE,
  pass        TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'ur',
  city        TEXT NOT NULL DEFAULT '',
  referrer_id INTEGER REFERENCES users(id),
  is_public   INTEGER NOT NULL DEFAULT 1,
  daily_goal  INTEGER NOT NULL DEFAULT 100,
  total       INTEGER NOT NULL DEFAULT 0,
  team_total  INTEGER NOT NULL DEFAULT 0,
  xp          INTEGER NOT NULL DEFAULT 0,
  streak      INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  shields     INTEGER NOT NULL DEFAULT 0,
  last_day    TEXT,
  created_day TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  hidden_from_ranks INTEGER NOT NULL DEFAULT 0,  -- set by an open/confirmed flag; their durood still counts everywhere
  suspended   INTEGER NOT NULL DEFAULT 0,        -- admin action: cannot log in or invite; durood still counted
  email_verified_at INTEGER,
  deleted_at  INTEGER,                           -- anonymised account; totals stay
  invited_via TEXT NOT NULL DEFAULT 'member',    -- member | founder | waitlist | public
  invite_code TEXT
);
CREATE INDEX IF NOT EXISTS users_referrer ON users(referrer_id);

-- append-only ledger: the single source of truth for every durood ever reported.
-- An edit never changes a row: it appends a reversing entry (negative count) plus a replacement entry.
-- daily / users.total / users.team_total / users.xp are derived caches that the audit re-checks against it.
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  day        TEXT NOT NULL,
  count      INTEGER NOT NULL CHECK (count != 0),
  rid        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'add' CHECK (kind IN ('add','reverse','replace')),
  ref_id     INTEGER REFERENCES entries(id),
  UNIQUE (user_id, rid)
);
CREATE INDEX IF NOT EXISTS entries_user_day ON entries(user_id, day);
CREATE UNIQUE INDEX IF NOT EXISTS entries_one_reversal ON entries(ref_id) WHERE kind = 'reverse';
CREATE TRIGGER IF NOT EXISTS entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'entries is append-only'); END;
CREATE TRIGGER IF NOT EXISTS entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT, 'entries is append-only'); END;

-- one row per user per (Pakistan) day
CREATE TABLE IF NOT EXISTS daily (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day     TEXT NOT NULL,
  count   INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS daily_day ON daily(day);

-- closure table of the referral tree; every user is their own ancestor at depth 0
CREATE TABLE IF NOT EXISTS ancestors (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  ancestor_id INTEGER NOT NULL REFERENCES users(id),
  depth       INTEGER NOT NULL,
  PRIMARY KEY (user_id, ancestor_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS anc_ancestor ON ancestors(ancestor_id, depth);

-- one-off XP grants (lectures, referrals, quests, circle); UNIQUE makes them idempotent
CREATE TABLE IF NOT EXISTS events (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL,
  ref        TEXT NOT NULL,
  day        TEXT NOT NULL,
  xp         INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS badges (
  user_id   INTEGER NOT NULL REFERENCES users(id),
  code      TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, code)
) WITHOUT ROWID;

-- places of 5,000+ people (GeoNames, CC BY 4.0), loaded on first start; members must pick one
CREATE TABLE IF NOT EXISTS cities (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  ascii  TEXT NOT NULL COLLATE NOCASE,
  cc     TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  pop    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cities_ascii ON cities(ascii COLLATE NOCASE, pop DESC);

-- weekly leagues: members who recite in a week are put in a group of up to 30 at their tier; at the week's end the top move up and
-- the bottom move down. Cities: the three best cities of each closed week.
CREATE TABLE IF NOT EXISTS league_members (
  week    TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tier    INTEGER NOT NULL,
  grp     INTEGER NOT NULL,
  rank    INTEGER,
  result  TEXT,
  PRIMARY KEY (week, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS league_group ON league_members(week, tier, grp);
CREATE TABLE IF NOT EXISTS city_weeks (
  week      TEXT NOT NULL,
  rank      INTEGER NOT NULL,
  city_id   INTEGER NOT NULL,
  score     INTEGER NOT NULL,
  closed_at INTEGER NOT NULL,
  PRIMARY KEY (week, rank)
) WITHOUT ROWID;
-- days with an extra reason to recite (Fridays are automatic); the admin adds Ramadan, Rabi ul Awwal and so on
CREATE TABLE IF NOT EXISTS special_days (
  day     TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ur TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;

-- the feed: likes (one per member per photo, never taken back, so the points they earn stay exact), short replies, reports,
-- and milestone events shown to a member's caravan
-- short replies to photos
CREATE TABLE IF NOT EXISTS replies (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('post','reflection','comment')),
  item_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  reports    INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','removed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS replies_item ON replies(kind, item_id, id);
CREATE TABLE IF NOT EXISTS feed_events (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL,
  ref        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS feed_events_time ON feed_events(created_at);

-- per-day totals of every member whose durood counts publicly (not on hold). A tiny table that answers the challenge questions
-- without scanning every member's daily rows; kept in step by logDurood, editEntry and setHeld, and checked by the audit.
CREATE TABLE IF NOT EXISTS day_totals (
  day   TEXT PRIMARY KEY,
  total INTEGER NOT NULL
) WITHOUT ROWID;

-- short announcements, newest first; members see them in the News screen
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY,
  title_en   TEXT NOT NULL,
  title_ur   TEXT NOT NULL DEFAULT '',
  body_en    TEXT NOT NULL DEFAULT '',
  body_ur    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- access ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- codes issued by admins (plain codes and single-use waitlist approvals), each tied to one caravan (caravan_id, added below).
-- A caravan's own invite code is its name and has no row here.
CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('founder','waitlist')),
  label      TEXT NOT NULL DEFAULT '',
  max_uses   INTEGER,
  uses       INTEGER NOT NULL DEFAULT 0,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  code       TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS waitlist_status ON waitlist(status, created_at);

-- implausible totals; a member with an open or confirmed flag is hidden from public ranks
CREATE TABLE IF NOT EXISTS flags (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL CHECK (reason IN ('daily_20k','spike_10x','manual')),
  day         TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared','confirmed')),
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS flags_status ON flags(status, created_at);
CREATE INDEX IF NOT EXISTS flags_user ON flags(user_id, status);

-- single-use links for password reset and email confirmation; only a hash is stored
CREATE TABLE IF NOT EXISTS tokens (
  hash       TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('reset','confirm')),
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

-- daily sunnah (content supplied by admins) and the photo posts that prove it was done
CREATE TABLE IF NOT EXISTS sunnahs (
  id         INTEGER PRIMARY KEY,
  day        TEXT NOT NULL UNIQUE,
  title_en   TEXT NOT NULL,
  title_ur   TEXT NOT NULL DEFAULT '',
  desc_en    TEXT NOT NULL DEFAULT '',
  desc_ur    TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  sunnah_id   INTEGER NOT NULL REFERENCES sunnahs(id),
  file        TEXT NOT NULL,
  sha256      TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','expired','removed')),
  confirms    INTEGER NOT NULL DEFAULT 0,
  rejects     INTEGER NOT NULL DEFAULT 0,
  reports     INTEGER NOT NULL DEFAULT 0,
  created_day TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE (user_id, sunnah_id)
);
CREATE INDEX IF NOT EXISTS posts_feed ON posts(status, created_at);

CREATE TABLE IF NOT EXISTS votes (
  post_id    INTEGER NOT NULL REFERENCES posts(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  vote       TEXT NOT NULL CHECK (vote IN ('confirm','reject')),
  day        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS votes_user_day ON votes(user_id, day);

CREATE TABLE IF NOT EXISTS reports (
  post_id    INTEGER NOT NULL REFERENCES posts(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
) WITHOUT ROWID;
`);
db.exec(LIKES_DDL);
db.exec(REPORTS_DDL);

export const tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* the engine already rolled back (disk full at COMMIT): keep the real error */ }
    throw e;
  }
};

// ---- columns added after the first release -------------------------------------------------------------
function addCol(table, col, ddl) {
  if (!cols(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
addCol('users', 'hidden_from_ranks', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'suspended', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'email_verified_at', 'INTEGER');
addCol('users', 'deleted_at', 'INTEGER');
addCol('users', 'invited_via', "TEXT NOT NULL DEFAULT 'member'");
addCol('users', 'invite_code', 'TEXT');

addCol('invites', 'caravan_id', 'INTEGER REFERENCES caravans(id)'); // the caravan a registration with this code joins
addCol('sunnahs', 'kind', "TEXT NOT NULL DEFAULT 'daily'");        // 'daily' sunnah or the weekly 'class' photo slot

addCol('users', 'held', 'INTEGER NOT NULL DEFAULT 0');             // an open/confirmed automatic flag: durood stays in the ledger but is left out of public totals
addCol('users', 'token_ver', 'INTEGER NOT NULL DEFAULT 0');       // bumped to sign a member out of every device
addCol('users', 'invite_bonus', 'INTEGER NOT NULL DEFAULT 0');  // extra invites an admin gave this member on top of what they earn
addCol('users', 'placed', 'INTEGER NOT NULL DEFAULT 0');       // 1 = put under a member by the public code's host setting, not invited by them (does not use up their invites)
addCol('users', 'hide_phone', 'INTEGER NOT NULL DEFAULT 0');   // 1 = this member's number is not offered to other members (WhatsApp button)
addCol('posts', 'purged_at', 'INTEGER');
addCol('posts', 'w', 'INTEGER');                                  // photo size, so the feed keeps its place while the photo loads
addCol('posts', 'h', 'INTEGER');                          // photo file deleted (retention or account deletion)
addCol('posts', 'likes', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'city_id', 'INTEGER');                              // the place the member chose (cities.id); required for new members
addCol('users', 'country', "TEXT NOT NULL DEFAULT ''");           // country code of that place
db.exec('CREATE INDEX IF NOT EXISTS users_city ON users(city_id)');
addCol('users', 'league', 'INTEGER NOT NULL DEFAULT 0');           // 0 Bronze, 1 Silver, 2 Gold, 3 Diamond
addCol('users', 'news_seen_at', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'caravan_name', 'TEXT');
addCol('users', 'city_changed_at', 'INTEGER');
addCol('users', 'display_name', "TEXT NOT NULL DEFAULT ''");           // a real name shown beside the username (not unique)
addCol('users', 'bio', "TEXT NOT NULL DEFAULT ''");                    // one short line
addCol('users', 'avatar_v', 'INTEGER NOT NULL DEFAULT 0');             // > 0: the current profile picture's version; <= 0: none (the next upload is abs(v) + 1)
addCol('users', 'phone_changed_at', 'INTEGER');
addCol('users', 'avatar_at', 'INTEGER');                               // when the current picture was uploaded
addCol('users', 'admin_role', 'TEXT');                                 // NULL, or 'owner' | 'moderator' | 'organiser'
addCol('users', 'admin_since', 'INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')`);
addCol('admin_log', 'actor', "TEXT NOT NULL DEFAULT ''");                 // who did it: a member's username, or 'admin key'
addCol('flags', 'day_total', 'INTEGER');                               // the day's total when the flag was raised
db.exec('CREATE INDEX IF NOT EXISTS events_kind_ref ON events(kind, ref)'); // payouts are looked up by what they paid for                        // a member may change city once a fortnight
db.exec(`
-- who opened whose WhatsApp chat from a profile, kept 90 days so a complaint can be looked into
CREATE TABLE IF NOT EXISTS wa_opens (
  id        INTEGER PRIMARY KEY,
  viewer_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wa_opens_at ON wa_opens(at);
`);
                              // the member's own name for their caravan; shares one namespace with usernames
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_caravan_name ON users(caravan_name COLLATE NOCASE) WHERE caravan_name IS NOT NULL');

// ---- caravans: a named group an admin creates for an owner; a member joins one at sign-up (its name is the invite code) -----------------
// Names share one namespace with usernames (handles.js: handleTaken).
db.exec(`
CREATE TABLE IF NOT EXISTS caravans (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  owner_id       INTEGER NOT NULL REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  streak_awarded INTEGER NOT NULL DEFAULT 0,   -- highest caravan-streak badge already given to the members (7, 30)
  total_awarded  INTEGER NOT NULL DEFAULT 0    -- highest caravan-total badge already given (10000, 100000, 1000000)
);
CREATE TABLE IF NOT EXISTS caravan_members (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id),   -- one caravan per member
  caravan_id INTEGER NOT NULL REFERENCES caravans(id),
  joined_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS caravan_members_caravan ON caravan_members(caravan_id, joined_at);
-- who was in a caravan and when they left, so removing members who missed days can't rewrite the caravan's past streak
CREATE TABLE IF NOT EXISTS caravan_past (
  caravan_id INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  joined_at  INTEGER NOT NULL,
  left_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS caravan_past_caravan ON caravan_past(caravan_id, left_at);
`);
addCol('caravans', 'display_name', "TEXT NOT NULL DEFAULT ''");   // optional name in any script (e.g. Urdu); `name` stays the unique English handle
// the old per-member caravan name is replaced by real caravans; free those names
if (db.prepare("SELECT value FROM settings WHERE key = 'caravan_v2'").get()?.value !== '1') {
  db.exec("UPDATE users SET caravan_name = NULL WHERE caravan_name IS NOT NULL");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('caravan_v2', '1')");
}

export const getSetting = (key, fallback = null) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
export const setSetting = (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
