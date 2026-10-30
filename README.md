# Tasbeeh

One web page, free to run on **Cloudflare Workers + D1**. No accounts, no passwords.

1. Enter a **phone number** and **today's tasbeeh count**.
2. If the phone number is already known, that is all: press Add.
3. If it is new, **name** and **city** (a dropdown of Pakistani cities, plus "Other") appear. They are asked once.
4. After adding, the page shows **today**, **this week** and the **overall target** (yours, and everyone's together).

The phone number is the only identity. Anyone who knows a number can add counts under it, so keep this for a community that trusts each other.

## Put it online (free, about 10 minutes, no card needed)
You need a free Cloudflare account and Node 22 on your computer.
```
npm install
npx wrangler login                          # opens a browser: sign in to Cloudflare
npx wrangler d1 create tasbeeh              # prints a database_id: paste it into wrangler.toml
npm run db:remote                           # creates the tables
npm run deploy                              # prints your address, https://tasbeeh.<you>.workers.dev
```
Optional, for the Google Sheet backup (see [docs/google-sheets-backup.md](docs/google-sheets-backup.md)):
```
npx wrangler secret put SHEETS_URL
npx wrangler secret put SHEETS_TOKEN
```
Change the overall target with `TARGET` in `wrangler.toml`. A custom address (your own domain) can be added in the Cloudflare dashboard.

## Try it on your own computer
```
npm run db:local && npm run dev             # http://localhost:8787, with a local copy of D1
npm test                                    # unit tests (no Cloudflare tools needed)
node scripts/browser-check.mjs http://localhost:8787   # walks the page in a real browser (needs Playwright installed separately)
```

## What it costs and what the free plan allows
Nothing: it stays on Cloudflare's free plan. The page files are static and do not count as Worker requests. The free plan allows about 100,000 Worker requests and, for D1, 100,000 row writes and 5 million row reads a day, plus 5 GB of storage. One entry writes about six rows and reads about ten, so a few thousand entries a day fit comfortably. Cloudflare's limits can change: check the dashboard now and then. If a limit is reached, new entries are refused until the next day (midnight UTC) and nothing is lost.

## Backup and restore
Twice a day (06:00 and 18:00 Pakistan time) everything is copied to a Google Sheet, so the counts survive losing the Cloudflare account. If that ever happens: `node scripts/restore-sql.mjs People.csv Daily.csv > restore.sql`, then `npx wrangler d1 execute tasbeeh --remote --file=restore.sql`. Details in [docs/google-sheets-backup.md](docs/google-sheets-backup.md).

## Rules in short
- Days are Pakistan time (UTC+5); weeks start on Monday.
- No daily limit. One entry can be at most 1,000,000 (a guard against an extra zero).
- Pressing the button twice counts once.
- Phone numbers are stored as `+92...`; `0300 1234567`, `+92 300 1234567` and `923001234567` are the same person.
- The server keeps one row per person per day, plus running totals, so every request touches only a few rows.

## Public stats page

`/stats` shows the overall target, today / this week, a 14-day chart, top members (today, this week, all time) and city rankings. Members appear only under made-up names (for example "Calm Falcon 482") derived from a hash of their id, never a phone number, real name or city. The rankings are recalculated at most every 15 minutes to stay inside the free D1 read allowance; totals and the chart are live.

## Automatic deploys

`.github/workflows/deploy.yml` runs the tests, applies the D1 migrations and deploys on every push to `tasbeeh-cloudflare`. One-time setup: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository secrets.

## Caravans (groups)

Every group counts with its own link, `/c/<name>` (for example `/c/madinah`; a number is added if the name is taken); the plain address is only a landing page. The first caravan is created by the migration (its link is `/c/tasbeeh-<random>`, shown on the admin page; delete it once you have your own).

- **Admin page:** `/admin`. Unlock with the admin key (the `ADMIN_KEY` secret: `npx wrangler secret put ADMIN_KEY`), type a name (and optionally a target) and get the link to share.
- Members, counts, targets, rankings and the stats page are per caravan. The same phone number can be in several caravans and counts separately in each.
- `/c/<link>/stats` shows the caravan's own stats, an "Everyone" view across all caravans, and the caravan leaderboard (caravans ranked against each other; link names are never shown).
- The Google Sheet backup has a `caravan` column on People and Daily and a `Caravans` sheet; `restore-sql.mjs People.csv Daily.csv Caravans.csv` puts everything back, including the first caravan's link.
