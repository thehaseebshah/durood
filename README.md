# Durood Quest · درود کوئسٹ

A bilingual (English / Urdu, right-to-left) web app for reciting durood Shareef every day with your caravan, installable on Android as a PWA. Zero npm dependencies: a Node 22 server (built-in `node:sqlite`) and a vanilla browser client.

Scope and decisions: `docs/DUROOD-QUEST.md`. Deploying: `docs/DEPLOY.md`.

## Run it

Requires Node 22.13+.

```bash
npm start            # http://localhost:3000
npm test             # unit and API tests (in-memory database)
npm run fuzz         # malformed input on every API route; no route may answer 5xx
npm run stress       # 60 members at once; then the ledger audit must be clean
npm run test:dates   # the unit tests with the clock moved to tricky moments
npm run e2e          # browser test of the whole app (needs Playwright with Chromium)
```

## What it does

- **Durood counter** (type a number, quick amounts, or tap), daily goal, streaks and streak shields, points, levels, badges, shareable cards. Days follow Pakistan time.
- **Quests:** durood (daily goal, weekly goal, 5 days a week, streak, special days) and the Sunnah quest (the Sunnah of the day, tick or photo).
- **Competition:** individuals, caravans, cities, majalis, weekly leagues, and the one fixed 40-day community challenge (10 crore).
- **Feed:** Sunnah photos, likes, short replies, reports and moderation, announcements (the bell) and milestones.
- **Caravans:** every member belongs to one from sign-up. The owner sees who is falling behind and can remove members, and can rename the caravan or give it a display name.
- **Profiles:** picture, display name, bio, a WhatsApp message button (members can hide their number).
- **Admin page** (`/admin.html`): Challenge, Invite codes (sign-up switch and daily limit, codes for a caravan), Members (including creating one), Caravans, Flagged totals, Reported, Pictures and names, News, Sunnahs, Majalis, Exports, Waitlist, Admins, Audit, Log.

## Joining

The sign-up "code" is a **caravan's name** (not case-sensitive; the display name does not count). Anyone may use it, up to a daily limit per caravan, and the admin can switch all sign-ups off. An admin can also make plain codes tied to one caravan, and approving a waitlist request makes a one-use code for a caravan the admin names. `?invite=<caravan name>` in a link fills the field in.

The first caravan is made by an admin: create a member (Members tab, or `POST /api/admin/members/create`), then make a caravan with that member as owner (Caravans tab, or `POST /api/admin/caravans`). See `docs/DUROOD-QUEST.md`.

## Accuracy and accounts

- **Append-only ledger.** Every reported durood is a row in `entries` (database triggers forbid updating or deleting it); `daily`, `users.total` and `users.xp` are caches derived from it. Each submission carries a request id, so a retry counts once.
- **Provable totals.** `npm run audit` (or the Audit tab) recomputes every total from the ledger; `npm run audit -- --fix` rebuilds the caches. The app labels counts as self-reported.
- **Flags.** A day over 20,000, or far above the member's own average, hides the member from public boards until an admin releases it. The durood still counts in their own total.
- **Edits** to today's and yesterday's entries only; every change stays on record.
- Password reset by emailed single-use link; email confirmation never blocks sign-in. Account deletion erases name, phone and email; the durood stays in the totals.
- Privacy notice at `/privacy.html` (a bilingual **draft** for the organisers to approve).

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `DB_PATH` | SQLite file (default `data/durood.db`) |
| `AUTH_SECRET` | Token signing secret (auto-generated into `data/secret.key` if unset) |
| `ADMIN_KEY` | Shared break-glass owner key for the admin API. Admins normally sign in with their own member account and a role (`node scripts/make-admin.mjs <username> owner` makes the first) |
| `NATIONAL_TARGET` | Goal for the community meter (default 100,000,000) |
| `PUBLIC_URL` | Base URL used in emailed links, e.g. `https://durood-quest.fly.dev` |
| `MAIL_PROVIDER`, `RESEND_API_KEY` / `SENDGRID_API_KEY`, `MAIL_FROM` | Email sender; unset = links are logged (`ALLOW_CONSOLE_MAIL=1` in production) |
| `NODE_ENV` | `production` makes the server refuse to start without a real mail provider, a 24+ character `ADMIN_KEY` and `AUTH_SECRET` |
| `TRUST_PROXY`, `CLIENT_IP_HEADER`, `FORCE_HSTS` | Behind a proxy (`1`, `fly-client-ip`, `1` on Fly) |
| `ADMIN_IP_ALLOWLIST` | Optional comma-separated addresses allowed to use the admin API |
| `MAX_DAILY`, `MAX_DAILY_NEW` | Most durood one member can report in a day (default 50,000; 10,000 in the first 7 days) |
| `CARAVAN_DAILY_CAP` | New members one caravan name may take per day (default 200; the admin changes it on the Invite codes tab) |
| `REG_LIMIT_PER_HOUR` | Sign-ups per hour per address (default 30) |
| `MAJLIS_MIN_ACTIVE` | Active members a majlis needs to appear on its board |
| `PUBLIC_CACHE_MS` | How long boards and the public meter are cached (`0` turns caching off, used by the tests) |
| `PHOTO_KEEP_DAYS` | Days a decided Sunnah photo is kept before the file is deleted (default 14) |
| `BACKUP_DIR`, `BACKUP_KEEP`, `BACKUP_EVERY_HOURS` | Nightly database snapshot. Back up `UPLOAD_DIR` and `AUTH_SECRET` separately |
| `UPLOAD_DIR` | Where photos are stored; must be on a persistent volume |

## Installing on Android

Deploy behind HTTPS, open the site in Chrome, menu, **Install app**. It runs full-screen with its own icon and opens offline (the shell is cached; logging needs a connection, and durood added offline waits on the phone and is sent once). A Capacitor wrapper lives in `android-app/`.

## The look

Navy and gold welcome screens, white or dark inside, one type family (Inter for Latin letters and every digit, Nastaliq for Urdu). The sun/moon button switches modes; the choice is saved, and until then the app follows the phone. Icons are inline SVG in `public/icons.js`.

## Known limits

- Phone numbers and emails are not verified (no OTP provider). Counts are self-reported; present totals as "reported by members".
- SQLite (WAL) on one always-on machine comfortably serves a few thousand active members. See `docs/DESIGN.md` for the scale notes.
- `docs/SPEC.md`, `docs/STATUS.md`, `docs/REVIEW.md`, `docs/NEXT-FEATURES.md`, `docs/BURHAN-API.md` and the `guide/` pages describe the older Seerah Quest app and have not been rewritten.
