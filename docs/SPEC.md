# Seerah Quest: product spec after the feature interview

Status: decisions from the interview. **Step 1 (access and accuracy) is built**; steps 2 and 3 are not. See section 7 for what step 1 does exactly and the defaults I chose where the interview left a gap.

## 1. Principles
1. **Durood first.** Everything else is secondary. The number box is the hero of Home.
2. **Reported, not verified.** Totals are exact *as reported* (append-only ledger, audit). Public wording says "reported by members".
3. **Small launch, 200 to 2,000 people**, invite-only, run by you and organisers.
4. **Urdu and English equal.** Same numerals (Inter) in both. White and dark modes.

## 2. Feature decisions

| Feature | Decision |
|---|---|
| Durood entry | Typing a total is the main way. Tap counter stays but is secondary. Presets: **100, 500, 1,000**. |
| Durood text on Home | **Removed.** |
| Edits | Own entries, **today and yesterday only**, every edit kept as a reversing entry plus a new one. Shown in a **History** section in Me. |
| Implausible totals | Flag at **20,000 in a day or 10x the member's weekly average**. A **new member (first 7 days) is flagged only above 20,000**. Flagged members still count privately but are hidden from public ranks until an admin reviews. |
| Individual ranks | Exact counts, weekly and all-time. **No opt-out:** everyone is ranked. The only way off a public board is an admin flag (section 4). |
| Caravan boards | Three: **total, average per active member, growth this week**. **Active = recited on any day this week.** Revisit after the pilot. |
| Levels and titles | Keep titles and progress bar. **Hide raw XP numbers.** |
| Badges | Show **all 23**, locked ones greyed. The **7 that need Sunnah/Seerah activity** stay greyed until earned (earlier "coming soon" label dropped: those features stay). |
| Streaks and shields | Keep. |
| Quests | Keep the four durood quests. Sunnah, review and lecture quests go with their features. |
| Sunnah (secondary) | **Stays, with XP.** Tick "I did today's sunnah" = 20 XP; a photo verified on the feed adds 40 more (a verified day = 3x the tick). |
| Seerah (tertiary) | **Stays, with XP.** Circle sign-up 300 XP once; a lecture pays only after its quiz is passed (admin-written, all answers right, unlimited retries); the weekly class photo, verified on the feed, pays 150 XP. |
| Seerat Circles | **A card on Home, no tab.** One sign-up link and a short explanation. No dedication or per-Circle tracking. |
| National meter | Keep, with the "reported by members" label. |
| Sign-up | **Invite-only, code required.** Founders get in through (a) one **public founders code** and (b) an **admin-approved waitlist**. |
| Invite cap | **10 to start, +10 for each 7-day streak.** |
| Verification | **None at launch** for phone or email. |
| Password reset | **Email link** through a transactional service (Resend, SendGrid or similar). |
| Language | Asked on the first intro screen. |
| First run | **Three short intro screens**, language choice first. |
| Notifications | Daily reminder at a chosen time; streak about to break; someone joined your caravan; caravan or national milestone. Permission asked **after the first completed streak day**. |
| Announcements | A short **News feed**, newest first. |
| Inviter view | Names, city and counts. With no opt-out, nothing is hidden from inviters. |
| Consent | **Footer link** to a one-page privacy notice (no tick-box, as chosen). |
| Account deletion | Self-serve. **Durood stays in totals, the person is anonymised** (name, phone, email erased). |
| Admin tools | Issue and revoke invite codes (including cutting a branch); review flagged members; post announcements; export reports (totals by city, caravan, week). |
| Hosting | Recommended: a managed host with a persistent volume (Fly.io or Render), automatic daily database backup. A small VPS is the fallback. |

## 3. Screens and layout (v1)

Tabs (four): **Home, Ranks, Caravan, Me.** A bell in the header opens **News**.

**Home** (top to bottom)
1. Header: app name, streak, mode and language buttons, News bell.
2. **Number box (hero):** "Today", large running total, big numeric field with **Add**, presets *+100 +500 +1,000*; a small "Count by tapping" control below.
3. Goal bar, streak, shields.
4. Level title and progress bar (no XP numbers).
5. **Seerat Circle card** (sign-up link).
6. Durood quests.
7. Caravan one-liner; national meter with the reported-by-members label.

**Ranks:** Individuals, with Week and All-time. Exact counts. Flagged members hidden.

**Caravan**
1. **Three boards** (Total, Average, Growth), your caravan highlighted.
2. Your caravan: members, total, this week, next milestone.
3. Invite code, share on WhatsApp, **invites left** and what unlocks more.
4. Members: name, city, counts, recited this week.

**Me:** profile; **History** (last two days editable, older read-only); badges (grid, locked greyed); settings (daily goal, city, reminders, language, mode); delete account; log out. Footer: privacy notice.

**Intro (first run only):** language choice, then three screens: purpose, how counting works, how caravans work.

**Admin (separate page):** invite codes; flagged members; announcements; exports.

## 4. Data and rules to add
- `invites` (code, owner, created, revoked, uses), founders code, `waitlist` (name, phone, city, status).
- Entry history: edits recorded as reversing plus replacement entries; edits only for today and yesterday; the audit still reconciles to the ledger.
- `flags` (member, reason, date, status); a flagged member's `hidden_from_ranks` is set by an admin. The old self-service rank-visibility setting is removed.
- `announcements`; push subscriptions; reminder time per member.
- Anonymisation job for deletions; totals unaffected.
- Password reset tokens (single use, short expiry) and a mail sender.

## 5. Build order
1. **Access and accuracy:** invite codes, founders code, waitlist, admin page; edits and History; flags; password reset; footer privacy notice.
2. **Home and structure:** new Home, four tabs, intro screens, Ranks, three caravan boards, hide XP, Circle card, feature switches for sunnah and seerah.
3. **Reach:** News feed, push notifications and reminders, admin announcements, exports.

## 6. Resolved and remaining
**Resolved in the interview follow-up**
1. Badges: all 23 shown, the 7 unearnable ones marked "coming soon".
2. Rank privacy: **opt-out removed**; inviters see counts. The worship-and-showing-off concern is now handled only by the intention reminder text and the admin flag.
3. "Active" = recited any day this week; new-member flag rule as in section 2.
4. Consent: footer link only. *Risk noted:* a weaker record of consent for phone numbers; easy to add a tick-box later.

**Remaining, with my default unless you say otherwise**
5. **Notification prompt** comes after the first completed streak day (second consecutive day). Day-one members get no reminders until then. *Default: as chosen.*
6. **Unverified email and reset links:** a mistyped email strands the account. *Default: send a confirmation link at sign-up that does not block login, so we know which emails work.*
7. **Tap counter and the News bell** are my proposals. *Default: ship both.*
8. **Removing opt-out is a one-way door for trust.** Members who joined expecting privacy will see exact counts. The in-app text should say so plainly before launch.

## 7. Step 1 as built, with the defaults I chose
Built and tested: invite-only sign-up (member, founder, public and waitlist codes), invite cap, branch suspension, edits with History, flags, password reset, email confirmation, account deletion, admin page, privacy notice (draft), ledger migration for older databases.

Defaults I picked where the interview didn't say. Tell me if any is wrong:
1. **Edits can't delete an entry** or set it to 0 (minimum 1), and members **can't add a missing entry for yesterday**, only change existing ones. Both keep streaks simple and accurate. Say so if "I forgot to log last night" must be possible.
2. **Spike rule:** 10x the average day over the previous 7 days, only for members at least 7 days old, only when the day is at least 2,000, and not when the previous week was empty.
3. **Flagged members' durood still counts** in caravan and national totals; only the public individual ranks hide them.
4. **Invite cap** counts every 7-day streak ever reached (best streak), so it never shrinks.
5. **Branch suspension** locks the member and everyone they invited out; their durood stays in every total.
6. **Founder and waitlist codes** make a member the root of their own caravan.
7. **Reset links** work once for one hour. The admin page can produce one to send over WhatsApp.
8. **Deleted accounts** become `member_<id>`, can't be invited from, and drop off every board.
9. The admin page is a normal web page at `/admin`; what protects it is the admin key on every API call. Use a long random `ADMIN_KEY`.
10. The privacy notice wording is my draft and has bracketed gaps for the organiser's name and contact.

## 8. The 40-day challenge (added after step 1)
Decisions: clock starts when the first founders join; everything reported since the app opened counts; a card under the number box on Home; honest pace ("needed today", ahead or behind); celebrate each crore and the finish; challenge boards for individuals and caravans; keep counting after day 40.

Defaults I chose:
1. **Day 1 = the Pakistan-time day of the first sign-up.** If a test account starts the clock too early, the admin corrects the date (Challenge tab).
2. **"Needed today"** = (target - reported before today) / days left including today, rounded up. **Ahead/behind** compares the total at the start of today with a straight line to the target.
3. **Projection** uses the average of the last up to 7 complete days. It is hidden on day 1.
4. **The meter** counts all durood from the start day with no end date. **Challenge boards** count only the 40 days and freeze when they end (so the all-time and challenge boards differ once the challenge is over).
5. Crores are recorded when the next write crosses them, so the timestamp is accurate to seconds. A later edit can lower the total but never removes a crore already reached.
6. The old "whole Qafila" national meter on Home is replaced by the challenge card.
7. Honest note: 10 crore in 40 days needs roughly 1,250 durood a day from each of 2,000 active members, so the target depends on the community growing well past the first launch.

## 9. Correction: Sunnah and Seerah stay (after step 1)
The earlier "cut from v1" was a misreading. Both stay as secondary and tertiary features and the Bonus tab remains (so five tabs: Home, Ranks, Caravan, Bonus, Me). Defaults I chose (the "no preference" answers): tick 20 XP, verified photo +40; quizzes of up to 10 questions written by an admin through `POST /api/admin/lectures` (`questions: [{q_en,q_ur,options_en,options_ur,answer}]`), wrong answers are marked but the key is never sent; class attendance is proven by one photo a week reviewed like a sunnah photo. Caravan model (hide ancestors, depth, pyramid concerns) is **still open** and not built.

## 10. Name and caravan terms (decided)
- The app is **Seerah Quest · سیرت کوئسٹ** (was Durood Qafila). Seerah is where it is headed; durood stays the daily habit and first on Home.
- **"Caravan" (قافلہ) is the only member-facing word** for the tree of people you referred. "Qabila" is an internal name for the same tree and never appears in the UI.
- Everyone starts their own tree. **No money anywhere:** no payments requested, no monetary rewards. Rewards are XP, badges and milestones only, and the app should say so plainly.
- **Upline is visible:** a member sees the chain of people above them (who invited them, and who invited those) with each caravan's name and totals. This reverses the earlier idea to hide the inviter's caravan.
- **Depth is unlimited:** you earn rewards for everyone in your tree, at any depth (as built).

## 11. Step 2 as built
Home: number box first (type a total, presets +100/+500/+1,000 fill the field, Add), tap counter folded under "Count by tapping", challenge card, level title (no XP numbers), Circle card, quests. Raw XP numbers are hidden everywhere. Intro: three screens on first visit, language choice on the first. Ranks: individuals only (week, challenge, all-time). Caravan tab: three boards first (Total, Average per active member, Growth vs last week), then invite, the caravans above you, your caravan, people you invited. Five tabs stay (Home, Ranks, Caravan, Bonus, Me). Not yet built: News bell, push reminders, exports (Step 3).

## 12. Step 3 as built
- **News:** admin posts a short announcement (English, Urdu optional), newest first, under a bell in the header with an unread count. Optional notification to everyone with reminders on.
- **Reminders (web push):** the app asks on Home after the member has a streak of 2 days, and the member can also turn them on in Me. Daily reminder at a chosen Pakistan-time hour, a streak warning at 20:00 for anyone whose streak of 2+ days would break tonight, plus pushes for "someone joined your caravan", each crore of the challenge and caravan badges. Each message goes out once. Dead devices are removed automatically. The server signs with its own VAPID key (created on first start, stored in settings); set `VAPID_SUBJECT` to a real `mailto:` address. A scheduler runs once a minute inside the server process.
- **Exports:** CSV of totals by city, by caravan (owners with invitees), and by week, downloaded from the admin page. Cells that start with `=`, `+`, `-` or `@` are neutralised so spreadsheets don't run them.
- **Verified:** the push encryption reproduces the RFC 8291 worked example byte for byte. **Not verified:** delivery through a real push service on a real phone. Test that on a deployed HTTPS address before launch (push needs HTTPS).

## 13. Before-launch hardening (from docs/REVIEW.md)
- **Durood on hold:** a day above 20,000 (or a 10x spike) flags the member and holds their whole total out of the national, challenge and caravan totals and boards. It stays in the ledger and in their own total, and `/api/public` reports it as `pending`. Clearing the flag releases it. The audit checks the rule.
- **Limits:** 50,000 a day (10,000 for a member's first 7 days); the public founders code admits at most 200 sign-ups a day (admin can change it).
- **Sessions:** tokens carry a version; password reset and "Log out of all devices" (Me) sign everything else out.
- **Access control:** the client address is read from the proxy's own hop (not the spoofable left side); 10 wrong admin keys lock an address out for 15 minutes; optional admin IP allowlist; per-account login limit; admin key compared in constant time.
- **Headers and server:** CSP (inline theme scripts allowed by hash only), `X-Frame-Options: DENY`, referrer policy, HSTS behind HTTPS, longer keep-alive and request timeouts, `/healthz`, bad paths return 400.
- **Push:** subscriptions must point at a real browser push service.
- **Data safety:** nightly `VACUUM INTO` backups (`BACKUP_DIR`), photo files deleted 14 days after review and at once on account deletion (the post record, votes and payouts stay), the scheduler never overlaps itself.
- **Production guard:** with `NODE_ENV=production` the server refuses to start without a real mail provider, a 24+ character admin key and `AUTH_SECRET`.
- **Not done (and why):** phone verification needs an SMS provider; the performance fixes (running challenge total, cached boards, off-peak audit) are the next batch, needed before about 5,000 members.
