# Deploying Durood Quest (Fly.io)

The repo is ready to deploy: `Dockerfile`, `fly.toml`, `scripts/smoke.mjs`. I could not run these from the build sandbox (no Docker daemon, no Fly account), so the first deploy is yours. The app itself was started from a clean copy of exactly the files the image contains, with production settings, and the smoke test passed.

Why Fly: a persistent volume (the database and photos live on one disk), a Singapore region (Fly no longer offers Mumbai; Singapore is its nearest Asian region), HTTPS for free (web push and installing the app need it), and a single always-on machine, which is what this app needs.

## One-time setup (about 15 minutes)
```bash
curl -L https://fly.io/install.sh | sh          # or: brew install flyctl
fly auth signup                                  # or: fly auth login   (needs a card)
cd durood
# 1. fly.toml already names the app `durood-quest` (region sin); use another name only if it is taken
fly apps create durood-quest
fly volumes create quest_data --region sin --size 1   # 1 GB is plenty to start; grow later with `fly volumes extend`
# 2. secrets (never commit these)
fly secrets set \
  ADMIN_KEY="$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)" \
  AUTH_SECRET="$(openssl rand -hex 32)" \
  PUBLIC_URL="https://<your-app-name>.fly.dev" \
  ALLOW_CONSOLE_MAIL=1
# 3. ship it
fly deploy
fly status && fly logs
```
After the first member exists, make yourself the owner so you can sign in by name: `fly ssh console -C "node scripts/make-admin.mjs <username> owner"` (or sign in on /admin.html with the key and use the Admins tab). Keep the key for emergencies only.

Write the generated `ADMIN_KEY` down: `fly secrets list` shows names only. To read it back, set a new one.

Then open `https://<your-app-name>.fly.dev`, and check the deploy:
```bash
SMOKE_URL=https://<your-app-name>.fly.dev SMOKE_CODE=<a caravan's name> ADMIN_KEY=<the admin key> node scripts/smoke.mjs
```
It should print `All checks passed`. It creates one `smoke_…` member; delete it from the admin page (Members, Actions, Delete account).

## Email
`ALLOW_CONSOLE_MAIL=1` lets the server start without a mail provider: password-reset and confirmation links then appear in `fly logs` instead of being sent. Fine for QA with a few testers (use the admin page's "Reset link" button to send a reset link over WhatsApp). **Before launch** create a Resend or SendGrid account, verify a sending domain, then:
```bash
fly secrets unset ALLOW_CONSOLE_MAIL
fly secrets set MAIL_PROVIDER=resend RESEND_API_KEY=... MAIL_FROM="Durood Quest <no-reply@yourdomain>"
```

## What the server does for you
- **Backups:** a nightly snapshot to `/data/backups` on the same volume (newest 14). That protects against mistakes, not against losing the volume: also run `fly volumes snapshots list` (Fly keeps daily volume snapshots) and occasionally `fly ssh sftp get /data/backups/<file>` to copy one to your computer. Photos are on the volume too.
- **Housekeeping** (weekly leagues, photo clean-up, the nightly audit) runs inside the one machine, which `fly.toml` keeps on (`auto_stop_machines = "off"`). Do not scale to two machines: the database is one file.
- **Logs:** `fly logs`. Health: `/healthz`.
- The machine has a swap file and Node is started with `--max-old-space-size=160`, so the nightly audit cannot take the whole 256 MB.
- `PUBLIC_URL` is required in production: password-reset and confirmation links are built from it (`fly.toml` sets it).

## Starting a fresh Durood Quest
1. Open `/admin.html` and sign in with the admin key (or your own account once it has a role).
2. **Members:** create the first caravan owner (username, password, email, phone, city).
3. **Caravans:** create the first caravan with that member as owner. Everyone else now signs up with the caravan's name.
4. **Challenge:** the 40-day clock starts when the first member joins; set the real start date before launch and tick "forget the crores already recorded".
5. **Sunnahs:** add the Sunnah of the day for the coming two weeks. **News:** post a welcome.
6. Optionally, **Invite codes:** set the daily limit per caravan name; keep the sign-up switch handy.

## Checklist on real phones
1. Open in Chrome on Android, **Install app**; check the icon, full-screen launch and an airplane-mode open.
2. Sign up with a caravan name in Urdu and in English; check right-to-left layout, numerals, dark and white mode.
3. Three intro screens; log durood by typing, quick amounts and tapping; edit an entry in Me, History.
4. Tick the Sunnah and post a photo (40 points); reply to a photo.
5. The caravan owner sees the caravan page, "Falling behind" and Remove.
6. Flag path: new members are capped at 10,000 a day, so to reach the 20,000 flag line run `fly secrets set MAX_DAILY_NEW=50000` (remove it before launch). Log 25,000 on a test account, watch the challenge number drop to "pending", clear it under Flagged totals and watch it return.
7. Admin: Audit (must be clean), Exports, suspend and unsuspend a member, account deletion (photos disappear).
8. Forgot password with the link from `fly logs`.

## Backup and restore
Backups are written to `BACKUP_DIR` (newest kept). They sit on the same volume, so **copy them off the machine regularly** (for example `fly ssh sftp get`). Photos and profile pictures are not in them: back up `UPLOAD_DIR` too.

To restore: stop the app, then replace the database **and remove its write-ahead files**, or a stale log is replayed over the restored copy:

    rm -f /data/durood.db-wal /data/durood.db-shm
    cp /data/backups/seerah-quest-<stamp>.db /data/durood.db

Start the app and run `npm run audit`: it must report no problems. (Backup file names still start with `seerah-quest-`.)

## Android app
`android-app/` holds a small Android wrapper that opens the live site. See `android-app/README.md` to build the APK. The wrapper loads the address in `android-app/capacitor.config.json`, which is updated separately when the app is built.
