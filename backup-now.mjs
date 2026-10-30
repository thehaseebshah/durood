// Sends one backup to the sheet right now: node backup-now.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sendBackup } from './backup.js';
const dbPath = process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'tasbeeh.db');
const r = await sendBackup({ db: new DatabaseSync(dbPath), url: process.env.SHEETS_URL, token: process.env.SHEETS_TOKEN });
console.log(r.ok ? `Sent (${r.rows ?? '?'} rows).` : `Not sent: ${r.error}`);
process.exit(r.ok ? 0 : 1);
