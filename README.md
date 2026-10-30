# Tasbeeh (simple)

One web page. No accounts, no passwords.

1. Enter a **phone number** and **today's tasbeeh count**.
2. If the phone number is already known, that is all: press Add.
3. If it is new, **name** and **city** (a dropdown of Pakistani cities, plus "Other") appear. They are asked once.
4. After adding, the page shows **today**, **this week** and the **overall target** (yours, and everyone's together).

The phone number is the only identity. Anyone who knows a number can add counts under it, so keep this for a community that trusts each other.

## Run
```
node --no-warnings server.js        # http://localhost:8080  (Node 22.5 or newer, no npm install)
npm test                            # unit tests
```
Settings (environment): `PORT`, `DB_PATH` (default `data/tasbeeh.db`), `TARGET` (default 100,000,000), and for the sheet backup `SHEETS_URL`, `SHEETS_TOKEN`, `BACKUP_HOURS`.

## Backup to Google Sheets, twice a day
So the counts survive losing the server. Set-up and restore steps: [docs/google-sheets-backup.md](docs/google-sheets-backup.md).

## Deploy on Fly.io
```
fly apps create <name>            # and put the name in fly.toml
fly volumes create tasbeeh_data --region sin --size 1
fly secrets set SHEETS_URL=... SHEETS_TOKEN=...
fly deploy
```
`/healthz` shows whether the sheet backup is configured and when the last good one was.

## Checking the page in a real browser
`node scripts/browser-check.mjs http://localhost:8080` walks the whole page (needs Playwright installed separately; the app itself has no dependencies).

## Rules in short
- Days are Pakistan time (UTC+5); weeks start on Monday.
- No daily limit. One entry can be at most 1,000,000 (a guard against an extra zero).
- Pressing the button twice counts once.
- Phone numbers are stored as `+92...`; `0300 1234567`, `+92 300 1234567` and `923001234567` are the same person.
