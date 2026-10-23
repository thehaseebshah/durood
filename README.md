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
- **Priorities:** durood first (counter, quests, milestones, ranks, caravan); sunnah is a secondary quest and seerah a small bonus, both in the *Bonus* tab with deliberately small rewards. Full table in `docs/DESIGN.md`.
- **RPG layer:** XP (1 per durood + milestone and quest bonuses), levels with a "Musafir → Muqarrab" title ladder, daily streaks with *streak shields* (one earned per 7-day streak, auto-saves a missed day), daily/weekly quests, 18 badges.
- **Network layer:** unlimited-depth referral tree stored as a closure table. A person's *caravan* = themselves + everyone below them. Caravan totals, weekly caravan leaderboard, caravan milestone badges and XP (10K → 10M, counting only what invitees recited), invite via WhatsApp share.
- **Referral reward is delayed:** the referrer gets XP only once the invitee recites their first durood (blocks fake sign-ups).
- **Leaderboards:** weekly / all-time, individuals / caravans. Public by default; users can opt out (still counted in their caravan, hidden from boards and from their referrer's list).
- **Seerat Circles & lectures:** circle link (claim bonus once), YouTube lectures embedded with server-verified minimum watch time, one reward per lecture.
- **National meter:** total durood across everyone vs a target.

## UI style

Swiss/International typographic style: heavy tabular numerals, hairline rules, flat black and green blocks, square corners, one type family (Inter; Nastaliq for Urdu with RTL layout). Durood leads each screen; sunnah and seerah sit in the *Bonus* tab. Screenshots of every screen in English and Urdu are in `docs/ui/`; earlier exploratory prototypes are in `prototypes/`.

## Daily sunnah with photo verification

- An admin schedules one sunnah per day (`POST /api/admin/sunnahs`, single object or `{"sunnahs":[…]}` for bulk; fields `day` (YYYY-MM-DD, Pakistan time), `title_en`, `title_ur`, `desc_en`, `desc_ur`, `source`). **Content is deliberately not bundled** — supply texts and references that your scholars have checked.
- Members photograph the sunnah (camera or gallery), preview it, and post — one post per sunnah. The browser re-encodes to JPEG; the server also strips all metadata (EXIF/GPS, comments), validates the file, and rejects a photo whose bytes were already used.
- Other members review it in the **Verify others** feed: *confirm* or *doesn't look right*, or *report* for inappropriate content. Reviewers do not see current votes or the poster's name; least-reviewed posts are shown first so everything gets looked at.
- **Rules (see `CFG` in `server/game.js`):** 3 distinct confirmations verify a post; 3 rejections reject it. On verification the poster gets +60 XP, and each reviewer *who voted with the final outcome* gets +5 XP (careless clicking earns nothing). You can't review your own post, vote twice, or exceed 30 reviews a day. Posts that don't reach a decision within 72 h expire with no payout. 3 reports hide a post pending admin review (`POST /api/admin/posts/:id` with `{"action":"restore"|"remove"}`; `GET /api/admin/reported`).
- Extras: daily quests (post the sunnah, review 3), badges (Sunnah Keeper/Seven/Thirty, Trusted Reviewer, Pillar of Trust).
- The audit (`npm run audit`) also checks that vote counts, post statuses and every sunnah/reviewer payout follow from the votes table.
- Photos are stored in `UPLOAD_DIR` (default `data/uploads`) and served only through unguessable per-photo URLs that logged-in members receive; back this folder up with the database.
- **Honest limit:** peer review confirms a photo *looks* like the sunnah, not that it was done sincerely or by that person. Treat verified counts as "peer-verified".

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
