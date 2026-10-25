import { mkdirSync, chmodSync, readdirSync, unlinkSync, renameSync, statSync, statfsSync, existsSync } from 'node:fs';
import path from 'node:path';
import { db, getSetting, setSetting } from './db.js';

/**
 * A consistent snapshot of the whole database (VACUUM INTO works while the app is running), named by time and pruned to the
 * newest BACKUP_KEEP files. Copy the folder off the machine too: a backup on the same disk dies with the disk.
 * Photos live in UPLOAD_DIR and are not in the snapshot; back that folder up separately.
 */
export function backupNow(dir = process.env.BACKUP_DIR, keep = Number(process.env.BACKUP_KEEP) || 3) {
  if (!dir) throw new Error('BACKUP_DIR is not set');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('.', '').replace('T', '-').replace('Z', ''); // to the millisecond, so two backups never collide
  const file = path.join(dir, `seerah-quest-${stamp}.db`), tmp = `${file}.partial`;
  // never start a copy that cannot fit: a full volume stops the app, not only the backup
  const dbFile = process.env.DB_PATH;
  if (dbFile && dbFile !== ':memory:' && existsSync(dbFile)) {
    const need = statSync(dbFile).size * 1.2, fs = statfsSync(dir);
    if (fs.bavail * fs.bsize < need) throw new Error('not enough free disk space for a backup');
  }
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    chmodSync(tmp, 0o600); // a copy of everything, readable by the app alone
    renameSync(tmp, file); // a half-written copy never carries the real name, so it can never be mistaken for a good backup
  } catch (e) {
    for (const f of [tmp, `${tmp}-journal`]) { try { unlinkSync(f); } catch { /* none */ } }
    throw e;
  }
  const old = readdirSync(dir).filter((f) => /^seerah-quest-\d{8}-\d{6,9}\.db$/.test(f)).sort().slice(0, -keep);
  for (const f of old) unlinkSync(path.join(dir, f));
  setSetting('last_backup_at', String(Date.now()));
  return { file, pruned: old.length };
}

/** Called every hour by the scheduler: takes a backup when BACKUP_DIR is set and the last one is older than BACKUP_EVERY_HOURS (24). */
export function backupIfDue() {
  if (!process.env.BACKUP_DIR) return null;
  const every = (Number(process.env.BACKUP_EVERY_HOURS) || 24) * 3600e3;
  if (Date.now() - Number(getSetting('last_backup_at', '0')) < every) return null;
  return backupNow();
}
