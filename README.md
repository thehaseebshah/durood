# Durood Qafila · درود قافلہ

A bilingual (English / Urdu, RTL) social-RPG web app for reciting durood Shareef daily, installable on Android as a PWA.
Every durood is dedicated to facilitating the work of the Seerat Circles across Pakistan.

## Run it

Requires Node 22.13+ (uses built-in `node:sqlite`; **no npm dependencies**).

```bash
npm start            # http://localhost:3000
npm test             # API tests (in-memory DB)
```

Environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `DB_PATH` | SQLite file (default `data/durood.db`) |
| `AUTH_SECRET` | Token signing secret (auto-generated into `data/secret.key` if unset) |
| `ADMIN_KEY` | Enables the admin API (below). Unset = admin disabled |
| `CIRCLE_URL` | Seerat Circle sign-up link shown in the Learn tab |
| `NATIONAL_TARGET` | Goal for the national meter (default 100,000,000) |
| `TEAM_MAX_DEPTH` | Cap how deep a caravan counts (default unlimited) |
| `TRUST_PROXY` | Set when behind a reverse proxy so rate limits use `X-Forwarded-For` |

### Installing on Android
Deploy behind HTTPS, open the site in Chrome → menu → **Install app** / *Add to Home screen*.
It then runs full-screen with its own icon and opens offline (the shell is cached; logging needs a connection).

### Adding seerah lectures (admin)
```bash
curl -X POST $URL/api/admin/lectures -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"youtube_id":"<11-char id>","title_en":"…","title_ur":"…","speaker":"…","min_seconds":900,"xp":300}'
```
`min_seconds` is the minimum watch time; the server verifies it from the moment the viewer pressed *Watch*.

## What's in the MVP

- **Accounts:** username (unique, case-insensitive; doubles as the referral code), email, WhatsApp number (Pakistani `03xx…` normalised to `+92…`), password. Login by username, email or phone.
- **Daily durood:** tap-counter or type a number. Pakistan-time days (UTC+5). Anti-cheat caps: 100,000 per submission, 500,000 per day.
- **RPG layer:** XP (1 per durood + bonuses), levels with a "Musafir → Muqarrab" title ladder, daily streaks with *streak shields* (one earned per 7-day streak, auto-saves a missed day), daily/weekly quests, 18 badges.
- **Network layer:** unlimited-depth referral tree stored as a closure table. A person's *caravan* = themselves + everyone below them. Caravan totals, weekly caravan leaderboard, caravan milestone badges (10K → 10M), invite via WhatsApp share.
- **Referral reward is delayed:** the referrer gets XP only once the invitee recites their first durood (blocks fake sign-ups).
- **Leaderboards:** weekly / all-time, individuals / caravans. Public by default; users can opt out (still counted in their caravan, hidden from boards and from their referrer's list).
- **Seerat Circles & lectures:** circle link (claim bonus once), YouTube lectures embedded with server-verified minimum watch time, one reward per lecture.
- **National meter:** total durood across everyone vs a target.

## Accuracy guarantees

- **Append-only ledger.** Every reported durood is a row in `entries` (database triggers forbid updating or deleting it). `daily`, `users.total`, `users.team_total` and `users.xp` are caches derived from it.
- **Exactly-once counting.** Each submission carries a unique request id; the client retries dropped connections with the same id, and the server ignores a repeat. Double-taps and retries cannot inflate a count.
- **Provable totals.** `npm run audit` (or `GET /api/admin/audit`) recomputes personal, caravan, national, daily and XP figures from the ledger and reports any mismatch; `npm run audit -- --fix` rebuilds the caches from the ledger. Run it on a schedule (e.g. nightly cron) and before publishing any campaign statistic.
- **Honest labelling.** The national meter shows the time it was computed (cached up to 15 s; `PUBLIC_CACHE_MS`), and the app states that counts are self-reported and days follow Pakistan time.
- **What this cannot guarantee:** that members report truthfully. Totals are exact *as reported*; present them publicly as "reported by members".

## Known limits / next steps

- **WhatsApp/email numbers are not verified yet.** Phone and email are collected and unique-checked only. Real OTP needs the WhatsApp Business API or an SMS provider (cost). Add before large-scale launch.
- **Counts are self-reported.** Caps limit abuse; add admin review / flagging for outliers.
- **Scale:** SQLite (WAL) comfortably serves a few thousand active users on one small server. For 50k+ active, move to Postgres (the SQL is plain), put the token-bucket limiter in Redis and cache leaderboards. See `docs/DESIGN.md`.
- Admin UI, push reminders (fajr/isha), seasonal events (Ramadan, Rabi ul Awwal) and Seerat Circle-level boards are not built yet.
