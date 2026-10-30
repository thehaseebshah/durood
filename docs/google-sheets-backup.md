# Backing up to Google Sheets (twice a day)

The Worker sends a copy of the data to a Google Sheet at **06:00 and 18:00 Pakistan time** (the cron lines in `wrangler.toml`: 01:00 and 13:00 UTC). If the Cloudflare account is ever lost, the sheet still has every person and every day's count.

## One-time set-up (about five minutes)
1. Make a new Google Sheet (any name). Keep it private.
2. In it: **Extensions > Apps Script**. Delete what is there and paste the whole of `docs/google-sheets-backup.gs`. Change `SECRET` to a long random text (for example 30 random letters and numbers).
3. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Press Deploy and allow access when Google asks. Copy the **Web app URL**.
4. Give the Worker the address and the secret (run these in the project folder; each asks you to paste the value):
   `npx wrangler secret put SHEETS_URL` and `npx wrangler secret put SHEETS_TOKEN`
5. Check it: `https://<your-worker-address>/healthz` shows `"backup":{"configured":true,...}`. The first backup runs at the next 06:00 or 18:00; to see it sooner, change the `crons` line in `wrangler.toml` to `["*/5 * * * *"]`, run `npm run deploy`, wait five minutes, then change it back and deploy again. Three sheets appear in your Google Sheet: **People**, **Daily** and **Totals**. `lastOkAt` in `/healthz` shows the last good backup.

The web app URL is not secret by itself, but nothing is accepted without the token. The sheet holds names and phone numbers: keep it private to the organisers.

## What is in the sheet
- **People**: phone, name, city, joined (rewritten each time).
- **Daily**: one row per person per day (day, phone, count). Each backup replaces the last three days and leaves older days alone, so a missed backup is repaired by the next one.
- **Totals**: one line per backup: when, people, overall total, today.

## If the server is gone: restore
1. In the sheet: **File > Download > Comma-separated values** for **People**, then for **Daily** (it downloads the sheet you are on).
2. On the new Cloudflare account, set the app up again (README), then: `node scripts/restore-sql.mjs People.csv Daily.csv > restore.sql` and `npx wrangler d1 execute tasbeeh --remote --file=restore.sql`. People and counts come back and the totals are rebuilt from the days; running it twice does not double anything.
