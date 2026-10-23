import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// a database exactly as the first release created it: old ledger (count > 0, no edit columns) and users without the new columns
const dir = mkdtempSync(path.join(os.tmpdir(), 'qafila-mig-'));
const file = path.join(dir, 'old.db');
const old = new DatabaseSync(file);
old.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone TEXT NOT NULL UNIQUE,
  pass TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'ur', city TEXT NOT NULL DEFAULT '', referrer_id INTEGER REFERENCES users(id), is_public INTEGER NOT NULL DEFAULT 1,
  daily_goal INTEGER NOT NULL DEFAULT 100, total INTEGER NOT NULL DEFAULT 0, team_total INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0, shields INTEGER NOT NULL DEFAULT 0, last_day TEXT, created_day TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE ancestors (user_id INTEGER NOT NULL, ancestor_id INTEGER NOT NULL, depth INTEGER NOT NULL, PRIMARY KEY (user_id, ancestor_id)) WITHOUT ROWID;
CREATE TABLE daily (user_id INTEGER NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day)) WITHOUT ROWID;
CREATE TABLE entries (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), day TEXT NOT NULL, count INTEGER NOT NULL CHECK (count > 0),
  rid TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (user_id, rid));
CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'entries is append-only'); END;
CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT, 'entries is append-only'); END;
INSERT INTO users (id, username, email, phone, pass, created_day, created_at, total, xp, team_total) VALUES (1, 'old_user', 'o@x.pk', '+923000000001', 'x', '2026-01-01', 1, 700, 700, 700);
INSERT INTO ancestors VALUES (1, 1, 0);
INSERT INTO daily VALUES (1, '2026-01-01', 700);
INSERT INTO entries (id, user_id, day, count, rid, created_at) VALUES (7, 1, '2026-01-01', 400, 'rid-old-0001', 1), (9, 1, '2026-01-01', 300, 'rid-old-0002', 2);
`);
old.close();

process.env.DB_PATH = file;
process.env.PUBLIC_CACHE_MS = '0';
const { db } = await import('../server/db.js');
const { audit } = await import('../server/audit.js');

test('an older database upgrades in place: ledger rows and ids survive, new columns and tables appear, audit is clean', () => {
  const cols = db.prepare('PRAGMA table_info(entries)').all().map((c) => c.name);
  assert.ok(cols.includes('kind') && cols.includes('ref_id'));
  const rows = db.prepare('SELECT id, count, kind, rid FROM entries ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.id, r.count, r.kind]), [[7, 400, 'add'], [9, 300, 'add']]);
  const u = db.prepare('SELECT hidden_from_ranks, suspended, invited_via FROM users WHERE id = 1').get();
  assert.deepEqual({ ...u }, { hidden_from_ranks: 0, suspended: 0, invited_via: 'member' });
  for (const t of ['invites', 'waitlist', 'flags', 'tokens', 'settings']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t), t);
  assert.deepEqual(audit().problems, []);
  // negative counts (reversals) are now allowed, and the ledger is still append-only
  db.prepare("INSERT INTO entries (user_id, day, count, rid, created_at, kind, ref_id) VALUES (1, '2026-01-01', -400, 'rid-rev-0001', 3, 'reverse', 7)").run();
  assert.throws(() => db.prepare('UPDATE entries SET count = 1').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM entries').run(), /append-only/);
  assert.throws(() => db.prepare("INSERT INTO entries (user_id, day, count, rid, created_at, kind, ref_id) VALUES (1, '2026-01-01', -400, 'rid-rev-0002', 3, 'reverse', 7)").run(), /UNIQUE/, 'an entry can only be reversed once');
});

test('opening the upgraded database again is a no-op', async () => {
  const again = new DatabaseSync(file);
  assert.equal(again.prepare('SELECT COUNT(*) n FROM entries').get().n, 3);
  again.close();
});
