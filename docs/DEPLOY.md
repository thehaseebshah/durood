# Deploying Seerah Quest for QA (Fly.io)

The repo is ready to deploy: `Dockerfile`, `fly.toml`, `scripts/smoke.mjs`. I could not run these from the build sandbox (no Docker daemon, no Fly account), so the first deploy is yours. The app itself was started from a clean copy of exactly the files the image contains, with production settings, and the smoke test passed.

Why Fly: a persistent volume (the database and photos live on one disk), a Mumbai region close to Pakistan, HTTPS for free (web push and installing the app need it), and a single always-on machine, which is what this app needs.

## One-time setup (about 15 minutes)
```bash
curl -L https://fly.io/install.sh | sh          # or: brew install flyctl
fly auth signup                                  # or: fly auth login   (needs a card)
cd durood
# 1. edit fly.toml: change `app = "seerah-quest-qa"` to a name nobody has taken
fly apps create <your-app-name>
fly volumes create quest_data --region bom --size 3
# 2. secrets (never commit these)
fly secrets set \
  ADMIN_KEY="$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)" \
  AUTH_SECRET="$(openssl rand -hex 32)" \
  PUBLIC_FOUNDERS_CODE="QA2026" \
  PUBLIC_URL="https://<your-app-name>.fly.dev" \
  VAPID_SUBJECT="mailto:you@example.org" \
  ALLOW_CONSOLE_MAIL=1
# 3. ship it
fly deploy
fly status && fly logs
```
Write the generated `ADMIN_KEY` down: `fly secrets list` shows names only. To read it back, set a new one.

Then open `https://<your-app-name>.fly.dev`, and check the deploy:
```bash
SMOKE_URL=https://<your-app-name>.fly.dev SMOKE_CODE=QA2026 ADMIN_KEY=<the admin key> node scripts/smoke.mjs
```
It should print `All checks passed`. It creates one `smoke_…` member; remove it later by resetting the QA data (below).

## Email during QA
`ALLOW_CONSOLE_MAIL=1` lets the server start without a mail provider: password-reset and confirmation links then appear in `fly logs` instead of being sent. Fine for QA with a few testers (use the admin page's "Reset link" button to send a reset link over WhatsApp). **Before launch** create a Resend or SendGrid account, verify a sending domain, then:
```bash
fly secrets unset ALLOW_CONSOLE_MAIL
fly secrets set MAIL_PROVIDER=resend RESEND_API_KEY=... MAIL_FROM="Seerah Quest <no-reply@yourdomain>"
```

## What the QA environment does for you
- **Backups:** a nightly snapshot to `/data/backups` on the same volume (newest 14). That protects against mistakes, not against losing the volume: also run `fly volumes snapshots list` (Fly keeps daily volume snapshots) and occasionally `fly ssh sftp get /data/backups/<file>` to copy one to your computer. Photos are on the volume too.
- **Reminders and housekeeping** run inside the one machine, which `fly.toml` keeps on (`auto_stop_machines = "off"`). Do not scale to two machines: the database is one file.
- **Logs:** `fly logs`. Health: `/healthz`.

## Admin page
`https://<your-app-name>.fly.dev/admin`, paste the admin key. First things to do: Challenge tab (the 40-day clock starts when the first member joins, so QA sign-ups start it: set the real start date before launch, tick "forget the crores already recorded"), Invite codes (the public code is `QA2026`; cap is 200 a day), News (post one test announcement with the notification box ticked).

## QA checklist (on real phones)
1. Open in Chrome on Android, **Install app**; check icon, full-screen launch, airplane-mode open.
2. Sign up with the founders code in Urdu and in English; check right-to-left layout, numerals, dark and white mode on both.
3. Three intro screens, language choice; log durood by typing, presets, tapping; edit an entry in Me → History.
4. Invite a second tester with your username as the code; they log; check Caravan boards, "caravans above you", the invite counter.
5. Reminders: turn them on (Home card after a 2-day streak, or Me), set a reminder a few minutes ahead, lock the phone; post News with the notification ticked. **Push delivery has never run on a real device, so this is the most important test.**
6. Sunnah: tick, post a photo, have two others confirm on the feed; class photo; video + quiz (add a lecture, see README); Circle card.
7. Flag path: new members are capped at 10,000 a day, so to reach the 20,000 flag line during QA run `fly secrets set MAX_DAILY_NEW=50000` (remove it before launch with `fly secrets unset MAX_DAILY_NEW`). Log 25,000 on one test account, watch the Home challenge number drop to "pending" and the inviter's caravan total drop, then clear it in the admin page's Flagged totals and watch both return.
8. Admin: audit button (must be clean), exports, suspend and unsuspend a member, account deletion (photos disappear).
9. Forgot password with the link from `fly logs`.

## Resetting QA data before launch
Test accounts and test totals must not carry into launch:
```bash
fly ssh console -C "sh -c 'rm -f /data/durood.db /data/durood.db-wal /data/durood.db-shm && rm -rf /data/uploads'"
fly machine restart $(fly machine list -q | head -1)
```
This deletes everything on the volume's database (keep `/data/backups` if you want a copy). Then re-run the admin steps above.

## Other hosts
The image is plain Node with one volume mounted at `/data`, so any host with a persistent disk works (Render, Railway, a VPS with `docker run -v quest:/data -p 80:8080 …`). Set the same environment variables; behind a proxy set `TRUST_PROXY=1` (or `CLIENT_IP_HEADER` if the host sets a trusted client-IP header).

## Cost
Roughly a few US dollars a month for one small machine plus a 3 GB volume (check Fly's current pricing).
