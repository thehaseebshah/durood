# Durood Quest (MVP): scope decided with the owner, 27 October 2026

Status (branch `durood-quest-wip`): server and client are both cut down and renamed; unit tests and the browser test (`npm run e2e`) pass. Not done yet: the Android app (`android-app/`, untouched), the Fly deploy, and a rewrite of the old member guide (`guide/`).

A separate, simpler app cut from Seerah Quest (branch `durood-quest`). New name, new Fly app (`durood-quest`), new database, new Android app (`app.duroodquest`). Seerah Quest (prod and QA) is scaled to zero only after Durood Quest is live and checked; data volumes are kept.

## Keep
- Durood counter, daily goal, streak, streak shields and streak points; tasbih sound, vibration, counter roll.
- Points, levels, badges, celebrations and shareable badge cards; durood quests (daily goal, weekly goal, 5 days a week, streak) and Sunnah quests (the Sunnah of the day and its streaks).
- Weekly leagues (bronze to diamond).
- One fixed 40-day community challenge (10 crore) and its ranking. No scheduling of later challenges.
- Competition: individual, city, caravan, Majlis, leagues.
- Majlis as is (9 defaults, optional membership, member proposals approved by admin, ranking).
- Sunnah of the day (tick or photo), feed of community Sunnah photos, likes and short replies, reporting and moderation, announcements (News) with the bell.
- Profiles: picture, display name, bio, profile sheet with stats and badges, WhatsApp message button with hide-my-number.
- Caravans: owner's "Falling behind" list with Remove.
- Sign-up: username, email, phone (country code), city, password. English and Urdu, light and dark.
- Admin: Challenge, Invite codes, Members, Caravans, Flagged totals, Reported, Log, Audit, News, Sunnahs, Majalis, Exports, Waitlist, admin accounts and roles.

## Remove
- Qabila (invite tree, Qabila ranking, referral rewards, invite quests, "who invited you").
- Al-Burhan entirely (murabbi/salik/masul/razakar, tasks, routines, team tags, My people, Mamulaat link).
- Weekly lectures, quizzes, comments and the Drive/YouTube player; daily reflection and its themes; Seerat Circles.
- All web push and reminders (in-app only), including the streak nudge being a push (the on-screen banner stays only if trivial).
- Repeatable/scheduled challenges (one fixed challenge only).
- Per-member invite allowances (levels, streak, 'Give invites').

## Joining
Every member belongs to a caravan from sign-up. The invite code is the **caravan's name**; anyone may use it (no limit beyond a daily cap per caravan). Admin creates caravans (name, owner). Members are locked in; only the owner or an admin removes them. Admin can also generate plain codes tied to a caravan.

## Defaults I chose (change if wrong)
Navy/gold look unchanged; fields validated as now; phone/email not verified; admin reset links over WhatsApp, no mail provider; QA app not needed for the MVP.

## Server notes (branch `durood-quest-wip`)
- **Bootstrap:** a caravan needs an owner who is already a member, and sign-up needs a caravan, so the first one is made by an admin: `POST /api/admin/members/create` `{username,email,phone,password,cityId}` registers a member with no caravan, then `POST /api/admin/caravans` `{name, owner, displayName?}` makes that member the owner. Everyone after that signs up with the caravan's name (case-insensitive; the display name does not count) or with an admin code from `POST /api/admin/invites` `{caravan, label?, maxUses?}`.
- **Limits:** `caravan_daily_cap` (default 200 new members per caravan name per Pakistan-time day, env `CARAVAN_DAILY_CAP`) and the sign-up kill switch are set with `POST /api/admin/signups` `{enabled?, dailyCap?}`. Admin codes ignore the daily cap.
- **Locked in:** there is no leave, switch, join, invite or request route. The owner (`POST /api/caravan/remove`) or an admin (`POST /api/admin/caravans/:id/remove`, `.../:id/members`) moves members; a removed member has `caravan: null` until an admin adds them to one.
- **One challenge:** `challenge_start`, `challenge_days` and `challenge_target` in settings, edited with `POST /api/admin/challenge`.
- Old tables (ancestors, referrer/tree columns) stay in a fresh schema but nothing reads them.

## Client notes
- **Sign-up** asks for a "Caravan name" (the old invite field). It checks the name while the person types (`/api/invite-check`) and shows the caravan's display name when it is valid; `caravan_full` and `signups_closed` have English and Urdu messages, and the form shows a notice when `/api/config` says sign-ups are closed. `?invite=<caravan name>` still fills the field.
- **Navigation:** bottom bar Today, Feed, Compete, Browse; sidebar adds Sunnah, Caravan, Me and Settings. The Sunnah page keeps today's Sunnah, the member's own posts and the community's photos. There is no Seerah, Qabila, Tasks or My people page.
- **Caravan page:** members, streak, "Falling behind" and Remove for the owner, rename and display name for the owner; a member in no caravan is told to ask an admin. No create, join, invite, leave or search screens.
- **Admin page tabs:** Challenge, Invite codes (sign-up switch, daily limit, codes for a caravan), Members (with Create a member), Caravans (create with an owner, add or remove a member, rename, delete), Flagged totals, Reported, Pictures and names, News, Sunnahs (with special days), Majalis, Exports, Waitlist (approving names a caravan), Admins, Audit, Log.
- **Badges:** the Qabila, recruit, lecture and circle badges are gone; the caravan badges (`group10k`, `group100k`, `group1m`) now say "your caravan recited".
- **Service worker:** cache `durood-v1`; no push handlers.
- `scripts/e2e.mjs` drives all of this. `scripts/guide-shots.mjs` and `guide/` still target the old app.
