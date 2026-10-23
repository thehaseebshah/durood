import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH || 'data/durood.db';
if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

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

CREATE TABLE IF NOT EXISTS lectures (
  id          INTEGER PRIMARY KEY,
  youtube_id  TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  title_ur    TEXT NOT NULL DEFAULT '',
  speaker     TEXT NOT NULL DEFAULT '',
  min_seconds INTEGER NOT NULL DEFAULT 600,
  xp          INTEGER NOT NULL DEFAULT 300,
  created_at  INTEGER NOT NULL
);

-- a member passes a lecture's quiz once; the reward is only paid after a pass
CREATE TABLE IF NOT EXISTS lecture_quiz (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  lecture_id INTEGER NOT NULL REFERENCES lectures(id),
  passed_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, lecture_id)
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

-- browser push subscriptions (one per device) and a log so a reminder is never sent twice for the same thing
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS push_log (
  user_id INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  ref     TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS lecture_starts (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  lecture_id INTEGER NOT NULL REFERENCES lectures(id),
  started_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lecture_id)
) WITHOUT ROWID;

-- invite-only access ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- founder codes (issued by admins) and single-use codes created when a waitlist request is approved.
-- A member's own invite code is simply their username and has no row here.
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

export const tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
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

addCol('lectures', 'questions', "TEXT NOT NULL DEFAULT ''");        // JSON: [{q_en,q_ur,options_en,options_ur,answer}]
addCol('sunnahs', 'kind', "TEXT NOT NULL DEFAULT 'daily'");        // 'daily' sunnah or the weekly 'class' photo slot

addCol('users', 'reminder_time', "TEXT NOT NULL DEFAULT ''");       // 'HH:MM' Pakistan time, '' = no daily reminder
addCol('users', 'news_seen_at', 'INTEGER NOT NULL DEFAULT 0');

export const getSetting = (key, fallback = null) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
export const setSetting = (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
