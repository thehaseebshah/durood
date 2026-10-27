# Durood Quest (MVP): scope decided with the owner, 27 October 2026

A separate, simpler app cut from Seerah Quest (branch `durood-quest`). New name, new Fly app (`durood-quest`), new database, new Android app (`app.duroodquest`). Seerah Quest (prod and QA) is scaled to zero only after Durood Quest is live and checked; data volumes are kept.

## Keep
- Durood counter, daily goal, streak, streak shields and streak points; tasbih sound, vibration, counter roll.
- Points, levels, badges, celebrations and shareable badge cards; durood quests only (daily goal, weekly goal, 5 days a week, streak).
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
