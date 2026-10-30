// A stand-in for Cloudflare D1 on top of node:sqlite, so the real queries run in the unit tests without any Cloudflare tooling.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  _runSync() { return this.db.prepare(this.sql).run(...this.args); }
}

export function createD1() {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS).sort()) raw.exec(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  return {
    raw,
    prepare: (sql) => new Statement(raw, sql),
    // like D1: the statements run in one transaction; if one fails, none of them happened
    async batch(statements) {
      raw.exec('BEGIN');
      try { for (const s of statements) s._runSync(); raw.exec('COMMIT'); return statements.map(() => ({ success: true })); }
      catch (e) { raw.exec('ROLLBACK'); throw new Error(`D1_ERROR: ${e.message}`); }
    },
  };
}
