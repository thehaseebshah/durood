-- Each count a person adds, with an optional private note, so they can look back at their own history.
-- (person_days keeps the per-day sums the stats use; entries are only read for the person's own history.)
CREATE TABLE entries (
  id         INTEGER PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES people(id),
  day        TEXT NOT NULL,
  count      INTEGER NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX entries_person ON entries (person_id, id DESC);
