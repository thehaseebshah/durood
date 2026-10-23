// Usage: BACKUP_DIR=/path node scripts/backup.mjs   (add DB_PATH if the database is not data/durood.db)
import { backupNow } from '../server/backup.js';
console.log(JSON.stringify(backupNow(), null, 2));
