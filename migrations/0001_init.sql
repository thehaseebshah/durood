-- Small on purpose: every request reads and writes only a handful of rows (the free D1 plan counts rows).
CREATE TABLE people (
  id         INTEGER PRIMARY KEY,
  phone      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  total      INTEGER NOT NULL DEFAULT 0
);
-- one row per person per day (the counts added that day, summed)
CREATE TABLE person_days (
  person_id INTEGER NOT NULL REFERENCES people(id),
  day       TEXT NOT NULL,
  count     INTEGER NOT NULL,
  PRIMARY KEY (person_id, day)
) WITHOUT ROWID;
-- everyone together, per day
CREATE TABLE day_totals (
  day   TEXT PRIMARY KEY,
  total INTEGER NOT NULL
) WITHOUT ROWID;
-- request ids, so a double tap or a retry counts once (pruned after two days)
CREATE TABLE rids (
  rid        TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
-- 'total' is the overall count of everyone; the backup also keeps its last result here
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
INSERT INTO meta (key, value) VALUES ('total', '0');
