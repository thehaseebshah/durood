import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH || 'data/durood.db';
if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

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
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_referrer ON users(referrer_id);

-- append-only ledger: the single source of truth for every durood ever reported.
-- daily / users.total / users.team_total / users.xp are derived caches that the audit re-checks against it.
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  day        TEXT NOT NULL,
  count      INTEGER NOT NULL CHECK (count > 0),
  rid        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, rid)
);
CREATE INDEX IF NOT EXISTS entries_user_day ON entries(user_id, day);
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

CREATE TABLE IF NOT EXISTS lecture_starts (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  lecture_id INTEGER NOT NULL REFERENCES lectures(id),
  started_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lecture_id)
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
