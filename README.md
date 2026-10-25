# Seerah Quest · سیرت کوئسٹ


A bilingual (English / Urdu, RTL) social-RPG web app for reciting durood Shareef daily, installable on Android as a PWA.
Every durood is dedicated to facilitating the work of the Seerat Circles across Pakistan.

## Run it

Requires Node 22.13+ (uses built-in `node:sqlite`; **no npm dependencies**).

```bash
npm start            # http://localhost:3000
npm test             # API tests (in-memory DB)
npm run fuzz         # malformed input on every API route; no route may answer 5xx
npm run stress       # 60 members at once (logs, retries, undos, reads); then the ledger audit must be clean
npm run e2e          # browser test of the whole app (needs Playwright with Chromium)
```

### The 40-day challenge

10 crore (100,000,000) durood in 40 days, i.e. 2,500,000 a day. **Day 1 is the Pakistan-time day the first member joins**; an admin can correct the start date, length and target on the admin page (Challenge tab). The meter counts **everything reported since the start day and keeps counting after day 40**. Home shows a card under the number box: day X of 40, total in digits and in crore/lakh, a plan marker on the bar, *needed today* (the amount that finishes exactly on day 40 from where the community really is), *reported today*, *days left*, an honest ahead/behind figure and a projection from the last 7 complete days. Each crore reached is recorded the moment it is crossed and never un-happens, and members get a celebration (with a shareable image drawn on their phone); so does the finish. Ranks has a **Challenge** board for individuals and caravans covering the 40 days only, frozen when they end.

### Access, accuracy and accounts (step 1 of the spec)

- **Invite-only sign-up.** A code is required. Codes are: a member's own username; an admin-issued **founder code** (optional label and max uses, revocable); the **public founders code** (one code, switch it on or off); and a single-use code created when the admin approves a **waitlist** request. Members start with **10 invites, +10 for every 7-day streak** they reach; founder and waitlist sign-ups never use up anyone's invites.
- **No opt-out from ranks.** Everyone is ranked with exact counts and inviters see their invitees' name, city and counts. The only way off a public board is an admin **flag**.
- **Flags.** A day over **20,000**, or over **10x the member's average day** for the previous 7 days (established members only, and only once the day is at least 2,000), hides the member from public ranks until an admin clears or confirms it. The durood still counts in every total.
- **Edits.** A member can change their own entries from **today and yesterday**, to any number from 1 up. Nothing is overwritten: the ledger gets a reversing entry and a replacement, and the History section shows every change. Badges, quest XP and invite rewards already earned are not taken back.
- **Password reset** by emailed single-use link (1 hour); **email confirmation** link at sign-up and when the address changes (never blocks login). The sender is configurable (below); with no provider the links are logged and the admin page can hand over a reset link to send on WhatsApp.
- **Account deletion** (Me, then Delete account): name, phone and email are erased and the username becomes `member_<id>`; the durood stays in every total.
- **Admin page** at `/admin` (needs the admin key; the API refuses everything without it): invite codes, public code, waitlist, flagged totals, members (suspend a member or a whole branch, hide, reset link), and a one-click ledger audit.
- **Privacy notice** at `/privacy.html` (bilingual **draft** for the organisers to approve), linked from the footer.

Environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `DB_PATH` | SQLite file (default `data/durood.db`) |
| `AUTH_SECRET` | Token signing secret (auto-generated into `data/secret.key` if unset) |
| `ADMIN_KEY` | Shared break-glass owner key for the admin API (below). Admins normally sign in with their own member account and a role (`node scripts/make-admin.mjs <username> owner` makes the first). Unset = key disabled |
| `CIRCLE_URL` | Seerat Circle sign-up link shown in the Learn tab |
| `NATIONAL_TARGET` | Goal for the national meter (default 100,000,000) |
| `TEAM_MAX_DEPTH` | Cap how deep a caravan counts (default unlimited) |
| `INVITE_ONLY` | `0` allows open sign-up (development only; default is invite-only) |
| `PUBLIC_FOUNDERS_CODE` | Seeds the public founders code on first start (change or switch off later on the admin page) |
| `PUBLIC_URL` | Base URL used in emailed links, e.g. `https://quest.example.org` |
| `MAIL_PROVIDER` | `resend`, `sendgrid`, or unset for the log-only console sender |
| `RESEND_API_KEY` / `SENDGRID_API_KEY`, `MAIL_FROM` | Credentials and sender for the chosen provider |
| `NODE_ENV` | `production` makes the server refuse to start without a real mail provider, a 24+ character `ADMIN_KEY` and `AUTH_SECRET` |
| `TRUST_PROXY` | Number of reverse proxies in front of the app (`1` on Render/Fly). The client address is taken that many hops from the **right** of `X-Forwarded-For`; leave unset when not behind a proxy |
| `CLIENT_IP_HEADER` | A header the platform sets itself (e.g. `fly-client-ip`); used instead of `X-Forwarded-For` |
| `FORCE_HSTS` | `1` adds `Strict-Transport-Security` (also added automatically behind a trusted HTTPS proxy) |
| `ADMIN_IP_ALLOWLIST` | Comma-separated addresses allowed to use the admin API (optional; ten wrong admin keys lock an address out for 15 minutes either way) |
| `MAX_DAILY`, `MAX_DAILY_NEW` | Most durood one member can report in a day (default 50,000; 10,000 during their first 7 days) |
| `PUBLIC_DAILY_CAP` | Sign-ups per day through the public founders code (default 200; change it on the admin page) |
| `PUBLIC_CACHE_MS` | How long boards and the public meter are cached (default 30 s boards / 15 s meter; `0` turns caching off, used by the tests) |
| `EDITION` | `internal` (Al-Burhan: murabbi, masul, mamulaat, tasks, routines) or `public` (none of those). Default `public`; the Fly configs set `internal` |
| `MAMULAAT_API_URL`, `MAMULAAT_API_KEY` | The Mamulaat app's API (docs/BURHAN-API.md). Set the key with `fly secrets set`. `MAMULAAT_TTL_MS` changes the 30 minute cache |
| `PHOTO_KEEP_DAYS` | Days a decided Sunnah photo is kept before the file is deleted (default 14). Deleting an account deletes its photos at once |
| `BACKUP_DIR`, `BACKUP_KEEP`, `BACKUP_EVERY_HOURS` | Nightly database snapshot (default every 24 h, newest 14 kept). Also `node scripts/backup.mjs`. Copy the folder off the machine, and back up `UPLOAD_DIR` and `AUTH_SECRET` separately |
| `UPLOAD_DIR` | Where photos are stored (default `data/uploads`); must be on a persistent volume |
| `VAPID_SUBJECT`, `PUSH_HOSTS` | A real `mailto:` address for push; extra allowed push hosts (browsers' own services are built in) |

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

- **Accounts:** username (unique, case-insensitive; doubles as the invite code), email, WhatsApp number (any country, normalised to `+<code>…`), password. Login by username, email or phone. Usernames and caravan names share one namespace (case-insensitive) and can never look like a phone number.
- **Profile:** a photo (cropped and squeezed in the browser, rebuilt without metadata on the server, visible to everyone in the app), a display name, a one-line bio, a password change that signs out other devices, and a WhatsApp number change (docs/SPEC.md section 22).
- **Daily durood:** tap-counter or type a number. Pakistan-time days (UTC+5). Anti-cheat caps: 50,000 per day (10,000 in a member's first week). A day above 20,000, or above 5,000 for an account under two weeks old, is flagged and that member's durood is held out of the public, challenge and caravan totals until an admin clears it.
- **Priorities:** durood stays the main earner; Sunnah, the weekly lecture, reflections and replies pay small, balanced amounts (docs/SPEC.md section 18).
- **RPG layer:** XP (1 per durood + milestone and quest bonuses), levels with a "Musafir → Muqarrab" title ladder, daily streaks with *streak shields* (one earned per 7-day streak, auto-saves a missed day), daily/weekly quests, 18 badges.
- **Two kinds of group:** a *Qabila* is everyone under a member in the invite tree, at every depth (stored as a closure table; it has its own totals, boards and badges). A *caravan* is a group a member creates and names, joined by the owner's invitation (by username) or by asking; one caravan per member, no size limit. Caravan totals, average and growth boards, the caravan streak and the caravan badges (Caravan Week/Month, group milestones) belong to the named group.
- **Referral reward is delayed:** the inviter gets 500 points only once the invitee has recited 100 durood in all (blocks fake sign-ups), and the weekly invite quest counts only such invitees.
- **Leaderboards:** weekly / all-time, individuals / caravans / Qabila / cities, plus the weekly league. Public; there is no opt-out. Flagged members are hidden until reviewed.
- **Feed, likes, reflections:** see docs/SPEC.md section 15. Seerat Circle link on Today (under Sunnah & Seerah); one featured lecture a week with a quiz; sunnah photos; comments on the lecture (after its quiz) and short replies; a daily written reflection; likes earn the poster points; reports hide content.
- **National meter:** total durood across everyone vs a target.

## UI style

Swiss/International typographic style with one accent colour (green): heavy tabular numerals, ruled cells, flat blocks, square corners, and an eight-point star (two overlapping squares) as the single recurring motif (progress marker, quest checks, headings, active tab). One type family: Inter for all Latin text and every digit in both languages, with Nastaliq for Urdu letters (RTL layout).

**White / dark choice:** a sun/moon button in the header switches modes. The choice is saved in the browser; until someone chooses, the app follows the phone's light/dark setting. Both modes share every rule in `public/style.css` and differ only in the colour tokens at the top. **Icons** (`public/icons.js`): Monoline (thin currentColor line pictograms) for UI items such as the tab bar, header, buttons and headings; Offset Duotone (outlined tile, hard offset shadow, green wash, tier squares) for the 23 reward badges. Both are inline SVG using the colour tokens, so white and dark modes just work. Durood leads each screen; sunnah and seerah sit in the *Bonus* tab. Screenshots of every screen in white and dark, English and Urdu, are in `docs/ui/`.

## Daily sunnah and photos

- An admin schedules one sunnah per day (`POST /api/admin/sunnahs`, single object or `{"sunnahs":[…]}` for bulk; fields `day` (YYYY-MM-DD, Pakistan time), `title_en`, `title_ur`, `desc_en`, `desc_ur`, `source`).
- A member ticks "I did today's sunnah" (20 points) and can post one photo of it (40 more). The browser shrinks and re-encodes the photo hard (about 100 KB); the server rejects anything over 200 KB or 1,280 px, checks it is a JPEG and removes camera metadata segments.
- There is no review queue. Members are trusted, and likes and reports are the check: three reports from different members hide a photo until an admin restores it. See docs/SPEC.md sections 15, 17 and 18.
- Photos live in `UPLOAD_DIR` and are shown only through per-photo signed links. They are deleted after `PHOTO_KEEP_DAYS` (14) once hidden or old; the record and the points stay. Deleting an account removes its photos at once.
- **Honest limit:** nothing proves a photo shows the sunnah done sincerely or by that person. Treat the counts as "reported by members".

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
- Seasonal events and Seerat Circle-level boards are not built yet. The admin page, push reminders, special days and the Al-Burhan edition exist (docs/SPEC.md sections 12, 16, 19).
- **Scale limits found by review (not yet changed):** the nine ranking boards are recomputed from the daily table (about 2 to 3 seconds each when cold at 50,000 members, 30 second cache), the caravan streak check grows with how many people one member invited, and logging runs about 200 SQL statements. All are fine for thousands of members; a weekly-totals table and a background refresh are the next step before tens of thousands.
- **Phone numbers are not verified.** For the Al-Burhan edition this is why a murabbi link needs the salik to confirm the person shown and that person to accept (docs/SPEC.md section 19). Add a one-time code before opening sign-up widely.
