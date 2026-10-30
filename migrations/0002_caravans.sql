-- Caravans: separate groups, each with its own link, members, counts, target and stats page.
-- The group that exists today becomes the first caravan, with a link of its own (/c/tasbeeh-<random>); there is no link that is not a caravan's.
PRAGMA defer_foreign_keys = true;
CREATE TABLE caravans (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  target     INTEGER NOT NULL,
  total      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
INSERT INTO caravans (id, slug, name, target, total, created_at)
  VALUES (1, 'tasbeeh-' || lower(hex(randomblob(4))), 'Tasbeeh', 100000000, COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'total'), 0), CAST(strftime('%s', 'now') AS INTEGER) * 1000);
DELETE FROM meta WHERE key = 'total';

-- the same phone number can be in more than one caravan, and counts separately in each
CREATE TABLE people_new (
  id         INTEGER PRIMARY KEY,
  caravan_id INTEGER NOT NULL DEFAULT 1 REFERENCES caravans(id),
  phone      TEXT NOT NULL,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  total      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (caravan_id, phone)
);
INSERT INTO people_new (id, caravan_id, phone, name, city, created_at, total) SELECT id, 1, phone, name, city, created_at, total FROM people;
-- person_days points at people, so it is rebuilt together with it (the parent is never dropped while a child still refers to it)
CREATE TABLE person_days_new (
  person_id INTEGER NOT NULL REFERENCES people_new(id),
  day       TEXT NOT NULL,
  count     INTEGER NOT NULL,
  PRIMARY KEY (person_id, day)
) WITHOUT ROWID;
INSERT INTO person_days_new (person_id, day, count) SELECT person_id, day, count FROM person_days;
DROP TABLE person_days;
DROP TABLE people;
ALTER TABLE people_new RENAME TO people;
ALTER TABLE person_days_new RENAME TO person_days;

CREATE TABLE day_totals_new (
  caravan_id INTEGER NOT NULL REFERENCES caravans(id),
  day        TEXT NOT NULL,
  total      INTEGER NOT NULL,
  PRIMARY KEY (caravan_id, day)
) WITHOUT ROWID;
INSERT INTO day_totals_new (caravan_id, day, total) SELECT 1, day, total FROM day_totals;
DROP TABLE day_totals;
ALTER TABLE day_totals_new RENAME TO day_totals;
