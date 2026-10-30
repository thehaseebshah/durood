# Backing up to Google Sheets (twice a day)

The server sends a copy of the data to a Google Sheet at **06:00 and 18:00 Pakistan time** (change with `BACKUP_HOURS`, for example `5,17`), and once at start-up if the last good backup is over 13 hours old. If the server (or the Fly.io account) is ever lost, the sheet still has every person and every day's count.

## One-time set-up (about five minutes)
1. Make a new Google Sheet (any name). Keep it private.
2. In it: **Extensions > Apps Script**. Delete what is there and paste the whole of `docs/google-sheets-backup.gs`. Change `SECRET` to a long random text (for example 30 random letters and numbers).
3. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Press Deploy and allow access when Google asks. Copy the **Web app URL**.
4. On the server set two secrets:
   `fly secrets set SHEETS_URL="<the web app URL>" SHEETS_TOKEN="<the same SECRET>"`
5. Check it: `curl https://<your-app>.fly.dev/healthz` shows `"backup":{"configured":true,...}`. To send one now: `fly ssh console -C "node backup-now.mjs"`. Three sheets appear in your Google Sheet: **People**, **Daily** and **Totals**.

The web app URL is not secret by itself, but nothing is accepted without the token. The sheet holds names and phone numbers: keep it private to the organisers.

## What is in the sheet
- **People**: phone, name, city, joined (rewritten each time).
- **Daily**: one row per person per day (day, phone, count). Each backup replaces the last three days and leaves older days alone, so a missed backup is repaired by the next one.
- **Totals**: one line per backup: when, people, overall total, today.

## If the server is gone: restore
1. In the sheet: **File > Download > Comma-separated values** for **People**, then for **Daily** (it downloads the sheet you are on).
2. On a new server (fresh database): `node restore.mjs People.csv Daily.csv`. People and counts come back; running it twice does not double anything.
