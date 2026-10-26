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
| Seerah (tertiary) | **Stays, with XP.** Circle sign-up 300 XP once; a lecture pays only after its quiz is passed (admin-written, all answers right, unlimited retries); the weekly lecture's quiz and comment thread are the weekly Seerah activity (the class photo was removed). |
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
- **"Caravan" (کارواں) is the only member-facing word** for the tree of people you referred. "Qabila" is an internal name for the same tree and never appears in the UI.
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

## 14. Wording and placement (from QA feedback)
- The fifth tab is **Seerah** (it was labelled "Bonus", an internal word nobody uses). It holds today's Sunnah, the weekly class, the Seerat Circle and lectures. On Home the section is "Sunnah and Seerah".
- **Language and display (white/dark) live in Me**, under "Language and display". The header keeps only the streak and the news bell. The sign-in and intro screens keep their own language switch because there is no account yet.
- **No design notes in the app's wording.** Statements such as "durood always comes first" are decisions about how the app works, not copy for members. Review all new text for this before it ships.

## 15. The feed, likes, reflections and the three rankings (replaces photo verification)
**Terms (fixed):** a **caravan** is a member plus the people they invited themselves. A **referral tree** (internally *qabila*) is everyone under a member at every depth. The Caravan tab shows the caravan; the tree appears in Me (people, total, this week, tree milestones) and as one of three rankings. Internally the closure table's depth 1 is the caravan and every depth is the tree.

**No verification.** Members are trusted. A sunnah photo pays its reward in the step that posts it (tick 20, photo +40). The review queue, voting, reviewer badges (Trusted Reviewer, Pillar of Trust) and the "review 3 photos" quest are gone. Likes and reports are the check: three reports from different members hide a photo or reflection until an admin restores it.

**Likes.** One like per member per item, never taken back (so the points stay exact), nobody likes their own. The poster earns 2 points for each of the first 10 likes on that item; liking earns nothing. The audit checks the arithmetic.

**Daily reflection.** One plain-text post a day, at most 280 characters, no links, answering the admin's question of the day (or a general prompt). It pays through a daily quest (15) and can be liked and reported. No replies, hashtags or follows, on purpose.

**The feed** (fifth tab becomes Feed: Home, Feed, Ranks, Caravan, Me) is newest first, paged by time, with five kinds of item: announcements; sunnah photos; reflections; lecture comments; milestones of a member's own caravan (themselves, the people they invited, and the person who invited them); each crore of the challenge. The week's lecture(s) sit with the day's actions on the left of the desktop layout (above the stream on a phone). Lectures belong to a week (any date in the week works when adding one); only the current week's show.

**Rankings:** People (week, challenge, all-time), Caravans and Referral trees (each by Total this week, Average per active member, Growth vs last week).

**Milestones:** new *Caravan* badges at 10K, 100K and 1M (what the people you invited recited, 300 / 1,500 / 6,000 points); the old whole-tree badges are now called *Tree* 10K to 10M (same rewards as before). 24 badges in all.

**Defaults I chose (change on request):** Urdu uses کارواں for caravan and "ریفرل ٹری" for referral tree; milestone posts reach the member, their invitees and their inviter only; feed photos are visible to every member; an admin can post one lecture or several per week; the photo reward stays 40 on top of the tick.

## 16. Cities, phone, the Compete tab, leagues and more (round 3)
**Terms, as the product owner set them:** *Karwan/Caravan* = a member plus the people they invited themselves. *Qabila* = everyone under a member at every depth, shown with a short hint ("everyone who joined through you, at every level"). Badges and rewards come in three families (Personal, Caravan, Qabila) plus the city podium; the Me screen shows them in those groups.

**City is required.** Members search as they type over about 70,000 places of 5,000+ people (GeoNames, 493 in Pakistan) and must pick one at sign-up; if a town is missing they pick the nearest bigger one. Members from before the list existed are matched by name (Pakistan first) or asked to choose on their next visit. City boards (Total, Average per active member, Growth) show a city only once **5 of its members recited this week**. The three best cities each week (by average) earn the **City Podium** badge for every member who recited; the winner also gets **City Champion**; the result appears in the feed.

**Phone and country.** The sign-up form has a country selector and the national number; any real international calling code is accepted. The country starts from the visitor's IP (DB-IP.com IP-to-Country Lite, bundled, IPv4 and IPv6, never stored), then the browser's time zone, then Pakistan. Numbers are format-checked only; they are not verified.

**Compete** (the old Ranks tab): the 40-day challenge on top, then People, League, Caravans, Qabila and Cities. The tab keeps its name after day 40.

**Weekly leagues** (like Duolingo): a member's first durood of a week puts them in a group of up to 30 at their tier (Bronze, Silver, Gold, Diamond). At the week's close the top third (at most 5, only with something recited) move up and the bottom third (at most 5) move down; promotion pays 100 points times the new tier and the league badge. The close runs once, on the hourly job or the first league view of the new week.

**Caravan streak:** a caravan of three or more people has a streak of days on which at least half recited; today never breaks it until it is over. Badges at 7 and 30 days.

**Live counter and special days:** Home shows durood and members today across everyone. Every Friday is a special day, and the admin adds others (Ramadan, 12 Rabi ul Awwal); members see a banner and a bonus quest (150 points) for reaching their goal.

**Share cards** now exist for badges and levels as well as the crore milestones.

**New badges (34 in all):** Caravan Week/Month; Qabila of 10/50/250 (people who have recited); Silver/Gold/Diamond League; City Podium and City Champion. The old whole-tree badges are renamed Qabila 10K to 10M.

**Credits:** GeoNames and DB-IP.com (both CC BY 4.0) are credited in the footer. To refresh the data, see `scripts/build-geo.mjs`.

## 17. Lecture comments, replies, no class photo

- **Class photo removed.** No weekly class photo, route, card or 150 XP. Old class posts are hidden from the feed; what they paid stays paid (the ledger is append-only).
- **Lecture comments.** Only members who passed the lecture's quiz (or, for a lecture without a quiz, completed it) may comment; one comment per lecture per member; 280 characters, plain text, no links. They appear in the feed labelled with the lecture title, can be liked (poster earns the usual like points) and reported (3 reports hide).
- **Replies** on sunnah photos, reflections and lecture comments: 140 characters, plain text, no links, one level deep, 3 per member per post. 3 reports from different members hide a reply; admin can restore. A reply earns 2 XP (`CFG.replyXp`), at most 5 a day (`replyDailyCap`), and nothing on your own post. No push notification to the poster. Replies cannot be liked.
- Admin: the Reported list covers comments and replies.

## 18. XP balance

Durood stays the main earner (1 XP per durood, plus its quests). Everything else is sized so no single action outweighs the others, and each is worth doing. All numbers live in `CFG` (server/game.js) and a test (`XP balance`) fails if a small action grows past a whole Sunnah day (60).

| Action | XP | Limit |
|---|---|---|
| Sunnah tick + photo | 20 + 40 | daily |
| Daily reflection | 15 | daily |
| Lecture (quiz passed) | 150 (admin can set up to 200) | per lecture |
| "Watch a lecture" quest | 50 | daily |
| Lecture comment | 20 | once per lecture |
| Reply to someone else's post | 2 | 5 a day |
| Like on your photo, reflection or comment | 2 | first 10 likes on each |
| Circle sign-up | 300 | once |
| Invited member's first durood | 500 | per invitee |

**Fixed:** the durood quests (daily 100, weekly 300, five days 200, Friday 150) now need at least 100 durood a day whatever personal goal a member sets. Before, a goal of 1 paid them for almost nothing. Lecture XP is capped, and lectures pay more than before because they were the lowest per minute. One-time badge rewards are unchanged.

## 19. Two editions, and the Al-Burhan features

**Two editions of one codebase.** `EDITION=internal` is for Al-Burhan members and is what is released now. `EDITION=public` is the future public app (durood, Sunnah, Seerah, caravans, rankings) and has none of the Al-Burhan features below: their routes answer 404 and the screens do not appear. Public is the default when the variable is missing, so a forgotten setting never exposes anything. `fly.toml` and `fly.prod.toml` both set `internal`. `/api/config` reports the edition.

**Words.** *Salik*: a person following a murabbi. *Murabbi*: their mentor, who sees their reports. *Razakar*: a volunteer who follows a masul. *Masul*: the manager who gives a razakar tasks and routines. One person can hold several roles.

**Murabbi and mamulaat.**
- A salik taps "Find my murabbi" (Me tab). Seerah Quest asks the Mamulaat app (`docs/BURHAN-API.md`) for the murabbi's WhatsApp number and matches it to an account by phone. Found: murabbi mode turns on for that person. Not found: the salik is told to ask the murabbi to sign up, and the link completes by itself when that number registers.
- The murabbi list refreshes from the Mamulaat app at most daily. A salik can remove the link at any time.
- Only a daily percentage is kept (14 days, cached 30 minutes). If the Mamulaat app is down the last numbers are shown and marked possibly old.
- The murabbi sees everything about the salik: profile (including phone and email), durood, XP, streak, Sunnahs, lectures, reflections, caravan, Qabila, badges, mamulaat, and any tasks and routines they carry.

**Masul, tasks and routines.**
- The razakar names their masul by username (Me tab). That is their consent: it is the only link.
- The masul gives **tasks** (once, optional due date) and **routines** (every week on a chosen day, such as the Thursday Majlis-e-Zikr). The razakar ticks them off themselves, with no confirmation. A routine can only be ticked on its day. Changing masul ends the old masul's assignments. The masul can remove an assignment.
- The masul sees tasks, routines (done of due over the last 4 weeks) and general progress. Never mamulaat, phone or email. The server enforces this: the masul report has no mamulaat in it.
- Tasks and routines give no XP: they are duties, and paying for them would unbalance section 18.

**Where it lives.** Me tab: murabbi, mamulaat bars, masul, "Assigned to you" and a plain "Who can see your data" card with when each person last looked. Home: today's routines and open tasks, and today's mamulaat percentage. Caravan tab: "Your saliks" and "Your razakars" lists, each opening a full report (for razakars, with the form to assign).

**Setup.** `MAMULAAT_API_URL`, `MAMULAAT_API_KEY` (keep the key a Fly secret), optional `MAMULAAT_TTL_MS`.

**Future public release.** Deploy with `EDITION=public`. Durood, Sunnah, Seerah, caravans, rankings, feed and the welcome screens stay. Nothing in the Al-Burhan tables is read or written. Keep new Al-Burhan features behind `burhan.guard()`.

## 20. Changes after the adversarial review

**Al-Burhan links are two-sided.** Phone numbers are unverified, so a number alone never shares anything. Murabbi: the Mamulaat app names a number; the salik is shown the account found for it (username, city, the name listed) and must confirm; that person must then accept. Only then do reports flow. If the Mamulaat app later names someone else, the link drops back to the confirm step and the old murabbi loses access at once. A murabbi who has no account yet waits; when that number registers, the salik is asked to confirm the account that appeared. Masul: a masul can have at most 200 razakars.

**Economy.** Durood quests need at least 100 a day whatever the personal goal. Editing a day down takes back the day's and week's quest points that no longer hold. The inviter's 500 points and the weekly invite quest need the invitee to have 100 durood in all. A new account (under 14 days) with 5,000 or more in a day is held for a look; a cleared flag is raised again only for a day half as big again. A city can be changed once every 14 days. Weeks missed by downtime are closed (up to four), and the week is closed before the first durood of a new one.

**Accounts.** Changing the email needs the current password (3 tries a day). Login failures are counted per account, whether the person types a username, email or phone, and only failures count. Deleting an account removes its push devices, written text, Al-Burhan links, assignments, mamulaat numbers and views.

**Operations.** The audit reads one snapshot and no longer holds every row in memory; startup no longer scans the ledger (index on `events(kind, ref)`, posts migration runs once); backups are written under a temporary name, refused when the disk is too full, and only 3 are kept (copy them off the machine); the server drains on SIGTERM; static files are gzip-compressed with ETags; fonts are bundled, so no third-party font request is made; the `fly` configs set `PUBLIC_URL` (reset links need it) and a swap file.

**Interface.** Dialogs trap focus and close with Escape; every form field has a label and errors are announced; typed text survives a language switch or a failed submit; touch targets are at least 44px; Urdu dates, arrows and the city search hint were fixed; every earn action says what it paid; a "Points and levels" card on Me explains the economy; the Caravan tab opens with the invite card; the app says so when offline instead of showing the login.

## 21. Caravans are named groups (supersedes the earlier meaning)

Earlier sections define a caravan as "a member plus the people they invited directly". **That is no longer true.** From now on:

- **Caravan:** a group a member creates and names. One caravan per member, no size limit. The creator is the owner. Names are 3 to 20 English letters, numbers or `_`, unique (case-insensitive) and in the same name space as usernames, so no member can take a name a caravan uses and the reverse; a name cannot be all digits.
- **Joining:** the owner invites a member by username and the member accepts (or declines); or a member searches for a caravan by name and asks, and the owner accepts or refuses. If both have asked each other, the person simply joins. Nobody is added without agreeing. A member may have 5 open requests; a caravan 100 open invitations and requests.
- **Owner:** can rename, remove members, withdraw invitations and decide on requests. Anyone can leave. If the owner leaves, the longest-standing member becomes owner; a caravan with no one left closes and its name is free. A deleted account leaves its caravan. An admin can list and delete a caravan (API: `GET/DELETE /api/admin/caravans`).
- **Qabila** is unchanged: everyone under a member in the invite tree. The invite code, the 500-point inviter reward (after the invitee has 100 durood), the weekly invite quest and the recruit badges stay tied to who invited whom.
- **What moved to the caravan:** the caravan boards (total, average per active member, growth; a caravan is ranked from 2 members), the caravan streak (3 or more members, half reciting each day, counted from the day each joined), the group badges (10K, 100K, 1M: shared once with every member who has recited at least 100 of their own, and with a newcomer who joins later), Caravan Week and Month, and the caravan milestones in the feed (a member sees their own and their caravan's).
- **What did not move:** the badges named "Caravan 10K" to "10M" in the code are Qabila badges (the whole invite tree), as before.
- Nothing was carried over from the old direct-invite caravans or the per-member caravan name (the app was not public). Members start without a caravan.

## 22. Profile: picture, name, bio, password, phone

- **Picture:** photo upload only (no preset avatars); members without one show a coloured circle with their initial. The browser crops a centred square, 192 px, under 24 KB; the server accepts a JPEG up to 60 KB and 64 to 512 px, rebuilds it from the image data only (EXIF/GPS, comments, application segments and anything after the final end-of-image marker are dropped) and stores it under `UPLOAD_DIR/avatars/<id>-<version>.jpg`. Each upload is a new version, so the address (`/avatars/<id>/<version>/<signature>`) is permanently cacheable and an old one stops working. **Everyone in the app can see it**: feed, replies, people and league rankings, caravan and invite lists, and a profile card opened by tapping a picture. Removing it or deleting the account deletes the file. An admin can remove a picture and clear an offensive name or line (`POST /api/admin/members/:username` with `remove-avatar` or `clear-profile`).
- **Name and bio:** an optional display name (2 to 40 characters, not unique, shown beside the username) and a one-line bio (up to 100). Plain text, no links, control and direction characters removed. The same people can see them as the picture. The public profile card shows picture, name, bio, city, join date and caravan, never email or phone.
- **Password change:** needs the current password; 6 to 128 characters and different from the old one; five wrong current passwords lock the endpoint for 15 minutes. Every other device is signed out (the session version moves on) and this one gets a fresh session; open reset links stop working.
- **WhatsApp number change:** needs the password, uses the same country-aware number rules as sign-up, must be unused, at most 3 changes a day (failed tries do not count). The number is still not verified. The member's murabbi link and Mamulaat numbers are cleared, since they were matched to the old number.
- **Backups:** pictures live in `UPLOAD_DIR`, which the database backup does not include (see docs/DEPLOY.md).
- The JPEG cleaner is now stricter for every upload, Sunnah photos included: only the tables, frame header and scan data are kept.

## 23. Admin moderation tab

The admin page has a **Moderation** tab: (1) *Pictures and names*: members with a photo (newest first), with a name or line, or everyone, with a search by username, name, bio or city; each row can have its picture removed or its name and line cleared. (2) *Caravans*: search by caravan or owner name, rename (same name rules and name space) or delete (members stay in the app and leave the caravan). (3) *Recent moderation actions*: a log of picture and profile removals, caravan renames and deletes, hiding or removing feed content, suspending, unsuspending and hiding members, with what was cleared. Failed actions are not logged. The log is `admin_log`; it is not shown to members. API: `GET /api/admin/profiles`, `GET/PUT/DELETE /api/admin/caravans`, `GET /api/admin/log`.

## 24. Admin accounts and roles

An admin is a normal member account with a role in `users.admin_role` (`owner`, `moderator`, `organiser`). They sign in on the admin page with their own username and password (`POST /api/admin/login`, 8-hour session in the `x-admin-token` header). The session ends when their role is removed, their password changes, they are suspended or they delete the account; the role is read from the database on every request. Wrong sign-ins give one answer for "no such admin", "not an admin" and "wrong password", and eight wrong tries per username (or ten wrong tokens or keys per address) lock that out for 15 minutes.

| Role | Can do |
|---|---|
| owner | everything: also the audit, the Admins tab (give or remove roles) |
| moderator | pictures, names, caravans, reported content, flagged totals, suspend/hide members, the moderation log, challenge status |
| organiser | invite codes, waitlist, news, lectures, questions, special days, challenge settings, exports, member list, reset links |

Each admin route has one permission in `server/admins.js` (`ADMIN_PERMS`); a route not listed there is owner-only. Inside `POST /api/admin/members/:username`, suspend, unsuspend, hide, unhide, remove-avatar and clear-profile need *moderate*; reset-link needs *reset_link*. Admins cannot change or remove their own role, and only the shared key can demote the last owner account. Every logged action records who did it (`admin_log.actor`: a username, `admin key` or `command line`), including role grants and removals and reset links.

The shared `ADMIN_KEY` still works and acts as an owner. Keep it for emergencies: it is not tied to a person, so its actions are logged as "admin key". Make the first owner either with the key (Admins tab, after signing in with it) or `node scripts/make-admin.mjs <username> owner`. Owners can give a role to any active member. API: `POST /api/admin/login`, `GET /api/admin/me`, `GET/POST /api/admin/admins`, `DELETE /api/admin/admins/:username`.

## 25. Security rules (review of October 2026)
- Only an owner can reset, suspend, hide or clear the profile of a member who holds an admin role. A moderator's branch suspension skips admins in the branch. Moderators see members' email and phone masked.
- Wrong passwords are counted per address and per account. When the per-account lock is on, an address that signed this account in during the last 30 days can still sign in, so strangers can't lock a member out. Attempts are counted before the password check, so parallel guesses can't get past the lock. A password reset clears the lock. Admin sign-in works the same way, and spaces around the name don't start a new count.
- Every password check (sign-in, password and phone change, account deletion) is locked after a few wrong tries. At most two password hashes run at once; a burst gets "busy" rather than slowing the whole server.
- Sign-up answers "an account already uses this email or phone" for both, so it can't be used to test whether one particular address or number is registered. Password-reset emails are limited per caller and address and never refused out loud.
- If an invitee's total is edited back under 100, the inviter's referral reward and that week's invite quest are taken back. They are paid again if the invitee really reaches 100. Badges already earned stay.
- A murabbi the Mamulaat app has replaced loses the report and the list at once, not when the salik next opens the app.
- Replies under a removed post are no longer shown. Suspended members' milestones and Sunnah photos are hidden, and they no longer appear in their inviter's list.
- History returns at most the newest 600 entries of the week and is rate-limited. Only one audit runs at a time.
- The offline cache stores pages under `/` only, so reset and confirm links never stay on the device. Signing out clears unsaved taps and drafts, and stops push notifications on that device.
- The app's code is read-only for the user it runs as. In production, reset and confirm links are masked in console mail logs.
- When a caravan owner is suspended, the owner role passes to the longest-standing active member, and the suspended person stays a plain member, also after they return. A caravan with no other active member is left as it is.
- Sign-in hands the app a device token. A later sign-in from that device skips the account's lock (the password is still checked), on any network. IPv6 callers are counted by their /64. Each address may run at most three password checks at once. Returning members' checks go to the front of the queue and are never refused as busy. A "busy" refusal no longer counts as a wrong password.
- A week whose leagues and city podium are decided can't be edited, so a promotion can't be won with a number that is edited away afterwards.
- Editing a number down also takes back the durood badges (and their points) it no longer supports: the member's own, and the group badges of their inviters and their caravan.
- Lecture quiz answers are checked only for a lecture the member has opened, of this week or earlier, and at most three wrong checks per lecture per half hour.
- The caravan streak counts members who left on the days they belonged, so removing those who missed days can't extend the streak backwards.
- Moderators' member search doesn't match email or phone, so masked details can't be found by searching.
- Photos: the image data is walked byte by byte and ends at the first end-of-image marker; anything else inside or behind it is refused. Database and backup files are readable by the app alone.
- **Still open:** phone numbers are not verified. Someone who signs up with a salik's number before the salik does can request that salik's murabbi; the murabbi's yes is the only safeguard. The fix is a WhatsApp or SMS one-time code, which needs a messaging provider.

## 26. Gaps closed (October 2026)
- **Sunnah of the day** is scheduled on the admin page (Feed tab): one day at a time or many as JSON, with a list that shows the next two weeks' gaps. A Sunnah members have ticked or posted can be edited but not removed.
- **Seerat Circle**: an organiser sets the sign-up link on the admin page (or `CIRCLE_URL`). Members see the card on Home and claim the one-time reward with "I have registered".
- **Moderation**: "Keep" clears unfair reports and takes the item off the queue. A member whose reflection or lecture comment was hidden sees a note saying so. A photo whose file is already deleted (14 days) cannot be restored.
- **Held totals**: after "Keep held" the member is told the decision instead of "being checked".
- **Notifications**: a caravan invitation reaches the invitee; a join request or a new member reaches the owner; an accepted request reaches the newcomer. The invite-code join message now says Qabila.
- **Email**: on a server without an email provider, members and admins are told nothing was emailed.
- **Lectures**: can be edited (points, quiz, titles, week) without losing comments, likes or quiz passes; the admin list shows each quiz with its answers. Admin errors are in plain words.
- **Al-Burhan**: a masul can remove a razakar (their open work ends); a murabbi can stop following a salik; the salik or razakar sees a one-line notice, also after a decline. Murabbi requests show a dot on the Caravan tab and a line on Home. The salik report names their caravan, shows the people they invited, their badges and recent reflections. Moderators see every murabbi and masul link on an Al-Burhan tab and can break a wrong one.
- **Accounts**: an owner can delete a member's account from the admin page (not an admin's), anonymised exactly like deleting it in the app, and logged.
- The privacy page describes what is collected and who sees it now (profile, posts, photos, Al-Burhan sharing). It still needs the organiser's name and contact.

## 27. Navigation (after Todoist)
- **Phones (and the Android app):** a bottom bar with Today, Feed, Compete and Browse. Browse (or the ☰ button top left) slides out the menu from the side. A round + button on every screen but Settings adds durood: on Today it jumps to the counter's box, elsewhere it opens a sheet with the counter, the number box and tap counting; the sheet closes once a number is saved. Back (Android) and Escape close the menu or the sheet first.
- **Wide screens (1024 px and up):** the menu is a sidebar that stays open on the left (right in Urdu); ☰ hides or shows it, remembered on the device. It holds the profile (to Progress), an "Add durood" button, Today (open quests counted), Feed (unread news), Compete, then Groups (Caravan, Qabila), Al-Burhan (internal edition; requests and today's tasks counted), and You (Progress & badges, Settings), with the language switch and sign-out at the foot.
- **Today** is the first screen: notices (held total, special day, caravan invitations and requests, murabbi requests, reminders), the durood counter and its box, then sections that fold away like Todoist's, remembered on the device: Sunnah & Seerah (today's Sunnah, the week's lecture, the reflection; done of total), Assigned to you (Al-Burhan tasks and routines due today, and today's mamulaat), Quests (done of total), the 40-day challenge (folded at first), and the Seerat Circle card until it is claimed.
- **Feed** is only what everyone shared; posting happens on Today.
- **Caravan** is the named group. **Qabila** holds the invite code and link, the people you invited, the tree's totals and milestone, and the people above you. **Progress & badges** holds level, points, history (edit today and yesterday) and badges. **Al-Burhan** holds murabbi, masul, assigned work and, for murabbis and masuls, the people they look after. **Settings** holds the profile, preferences, security and account deletion.
- A razakar sees the tasks and routines given to them on Today (those due today) and on the Al-Burhan page (all of them).

## 28. Seerat Circle teachers
Joining a Seerat Circle is self-declared and pays 300 once (badge "Circle Member"). Teaching one pays more: a member taps "I teach a Seerat Circle", an organiser confirms it on the admin page (Feed tab, Circle teachers), and the teacher gets 1,000 points once and the "Circle Teacher" badge. A refused request can be made again; confirming twice pays once. The QA server's circle link is https://albn.org/seerat.

## 29. Tasks, My people, and murabbi and masul under Me (Al-Burhan edition)
- **Tasks** (menu, under You): Todoist-style folding lists of your tasks and routines: Today (due today), Tasks, Routines, Done. Anyone can add their own task (optional due date) or weekly routine; the ones your masul gives you show "from <masul>". You can remove your own; only your masul can end theirs. Today's page shows "Tasks today" with a link here.
- Your own tasks and routines are reported like the rest: your masul sees them marked "their own" (and can't change them) and your murabbi sees all of them. A change of masul ends only what the old masul gave; your own stay.
- **My people** (menu, under Groups): your saliks (as murabbi) and razakars (as masul), each opening their report, plus murabbi requests waiting for you. When empty it explains how people come to appear there.
- **Me** (was Progress & badges) now also holds the murabbi and masul links, who sees what, and notices about ended links. The old Al-Burhan page is gone; old links lead to Tasks.

## 30. Deadlines and points for tasks and routines
- Every task has a deadline (today or later). Routines are due on their weekday.
- Points on completion: a task from your masul 30, your own 10; a routine ticked on its day 10 (from your masul) or 5 (your own). Done by the deadline: full points. Late: 60% one day late, 50%, 40%, 30%, 20%, then 10% from six days late. Each time the deadline was pushed later at the doer's wish: 20% less, never below 40%. Points are rounded, at least 1.
- Daily caps so a list of tiny tasks can't be farmed: 3 of your own and 5 from your masul earn points each day (routines count with tasks). Undoing a tick (same day) takes the points back.
- Your own task: you move its deadline yourself. A task from your masul: you ask for more time with a date; the masul gets a notification and agrees or keeps the date, and sees the request count on My people. A deadline the masul moves on their own does not lower the points; one moved because the doer asked, or the doer moved, does. Moving a deadline earlier costs nothing. A done task's deadline can't move.
- Each task shows its deadline, how many days late it is, how often it was moved, and the points it would earn today; a done one shows the points it earned.

## 31. Majalis, team tags, task handling and feel
- **Majalis** (Al-Burhan edition): Shabab, Ilm e Deen, Jamiaat, Tameeraat, Seerat, Islaah, Atfaal, Qabail, Aamilah from the start. A member picks one (or none) under Me. A member can propose a new one (2 to 40 characters, one open proposal at a time); an organiser approves or rejects it on the admin page's Al-Burhan tab, and the proposer joins it on approval if they have none. Compete has a weekly Majlis board (total, average per active member, growth) like the city board; a majlis appears once `MAJLIS_MIN_ACTIVE` (default 3) of its members recite that week.
- **Team tags**: a masul sorts their razakars into teams with #tags (2 to 24 letters, numbers or _, up to 5 per person, seen only by that masul), filters My people by team, and can give a whole team a task or routine at once. Tags go when the link ends.
- **Tasks, after Todoist**: a round checkbox that fills with a tick; the row settles and a toast offers Undo for five seconds. Swipe a task right to complete it, left to reschedule it (your own) or ask for more time (one from your masul). Rescheduling opens a sheet with Today, Tomorrow, In 3 days, Next week, or a date. A ⋯ menu holds reschedule, undo and remove. Late tasks have a red ring.
- **Feel**: pages cross-fade and slide (View Transitions where supported), sheets rise, folds open, menus drop, buttons give on press, the counter rolls to its new number, loading shows grey placeholders, and everything is still for "reduce motion". The tasbih counter clicks softly and vibrates on each tap, more strongly at every 33 and with a chime at every 100; adding durood or completing a task gives a short chime. Sounds and vibration can each be turned off in Settings.
- **Routines on several days**: a routine falls on any set of weekdays (for example Saturday and Sunday, or every day), picked with seven day buttons (Monday first) and an "Every day" shortcut. It is due, tickable and paid on each of those days; its 4-week record counts every one of them. Routines made before keep their one day.

## 32. More invites, linking up, and units

- **Invite allowance** (`access.js inviteStatus`): 10 to start, +3 per level above 1 (so it follows points), +2 for each invitee who reaches 100 durood, +10 for every 7 days of best streak. Qabila shows the breakdown and what unlocks the next ones.
- **Sharing**: WhatsApp, the phone's own share sheet (`navigator.share`, where available) and Copy.
- **"Who invited you?"** (`POST /api/me/inviter`, `game.js linkInviter`): a member who joined with the public or a founder code can name their inviter once, within 14 days, while nobody has joined through them. Their ancestry, the team totals above them, the active count and (if they already have 100 durood) the referral reward follow as if they had used that code. It uses one of the inviter's invites; the inviter is notified. Errors: `link_closed`, `inviter_unknown`, `invite_full`.
- **Units**: every number shows what it counts: a green `durood` tag for durood recited, a gold `pts` tag for points earned, plus `days` and `people`. "XP" is called points everywhere. Quests show the points they pay. The Me page explains the difference in one line.

## 33. Streak points, reorganised pages, and motion

- **Streak points**: a daily "Streak day N" quest pays 5 points per day of streak (up to 150 a day from day 30), once the day reaches 100 durood. Editing the day under 100 takes it back. `CFG.streakXpPer`, `CFG.streakXpCap`; `streakIfToday` follows the same shield rule as logging.
- **Today**: counter → Getting started (new members, three weeks, hideable) → Quests (durood quests, with streak) → Tasks today → Sunnah & Seerah (the Seerat Circle card lives here until joined) → 40-day challenge. The "everyone together" line never shows less than the member's own day.
- **Me**: latest badges as a strip, Badges / History collapsed, then Majlis, Murabbi and masul, the circle teacher claim (once joined) and How points work.
- **Tasks**: no duplicate Today list; open tasks sorted by deadline; the + button adds a task here.
- **Settings**: Language and display first; Security and Delete account folded.
- **Motion**: bars grow from their last value, newly finished quests pop, the header flame jumps when the streak grows, earned points float up, the daily goal bursts (with chime and vibration), level and badge cards wait until that settles, rows rise in when a page opens, and pulling down at the top refreshes the page. All of it is off under reduced motion.

## 34. Offline durood

Durood added with no connection is kept on the phone (`outbox` in local storage, each entry with its request id) and shown on the counter at once. It is sent when the connection returns (the `online` event, every 20 seconds, at start, and after any successful log); the request id makes a resend count once. If the server refuses an entry (e.g. the daily limit) the member is told and it is dropped. The member's last data is cached so the app opens offline on their last numbers, with a quiet bar saying so; it is cleared on sign-out.

## 35. MashaAllah on milestones

A member can say "MashaAllah" once on a caravan mate's milestone in the feed (`POST /api/cheer {id}`), never on their own and only on milestones their caravan can see. It earns no points, so there is nothing to farm; the owner sees "N said MashaAllah" on their own card.

## 36. Look: an Apple-style layer

The member app, sign-in and admin share one stylesheet; its last section restyles the original Swiss components in an iOS manner without changing the markup: grouped rounded cards (16px) on a soft grey ground (#f2f2f7, black in dark mode), a frosted sticky header and tab bar (backdrop blur), pill chips and rounded buttons in a deeper green (#00875a, AA with white text), iOS segmented controls, filled rounded fields with a focus ring, rounded numerals (ui-rounded where the system has it), sentence-case labels, grabber-topped sheets, blurred dialogs and toasts. The phone's status-bar colour follows the header.

## 37. Small comforts and checks

- **Streak nudge**: with a streak running and nothing recited today, Today says so; after 6 pm Pakistan time it says the streak ends at midnight.
- **Empty states**: an empty list shows a soft round icon and one kind line.
- **Large titles**: each page opens with a large title; the small one fades into the frosted header after 40px of scrolling.
- **Checks**: `npm test` (API), `npm run fuzz` (malformed input on every route, no 5xx), `npm run stress` (60 members at once, then a clean audit), `npm run test:dates` (the unit tests with the clock just after Pakistan midnight into a Monday, at the end of a day, and at New Year), `npm run e2e` (the whole app in a browser, English, Urdu, dark, desktop, the admin page, and axe-core WCAG A/AA rules on every page). CI runs all four.

## 38. Undo a just-added number

`POST /api/log` returns the new `entryId`; the "saved" toast offers Undo, which edits that entry to 0. An entry edited to 0 is removed: only its reversing row is written, it leaves the history, the quests and badges it paid are taken back as with any edit down, and if the member's total returns to 0 they stop counting as active in the trees above them. Negative numbers are refused.

## 39. Design review pass (iOS conventions)

- Quick add is a green + in the top bar (iOS keeps add actions there; a floating button covered list rows mid-scroll). It is left out on Today (the add box is on the page), on Caravan, Qabila and My people (their own invite/join buttons come first), Settings, and on wide screens (the sidebar has Add durood).
- Units read as quiet coloured words (durood green, points amber, days/people grey), one size, not pills.
- Compete scope is a scrolling row of chips; only the time/metric switch is a segmented control.
- The challenge card states its total once ("4,000 of 10 crore durood"); on day one it shows the day's share instead of "Exactly on plan". Any progress shows at least a sliver of bar.
- The goal bar lines up with the card's text, the star stays inside the card; the add sheet keeps today's total small so the field comes first; the tap counter's buttons sit inside the card; the streak sits in a pill like the bell; the frosted header is more opaque.
- Settings: Sounds and Vibration are iOS switches (`role=switch`) in a grouped list; the name under the photo is a heading, and the unconfirmed-email warning is an amber card.
- Member and profile pop-ups rise from the bottom as sheets on phones; "Remove this" on an assignment is red; stat labels say "Day streak" and "Points" without a repeated unit.
- Feed actions keep a gap between icon and label, and the first icon lines up with the post text. In a caravan the owner's remove column is kept on every row, so the scores line up.
- Navigation has one menu control per screen size: on phones the Browse tab opens the menu (no header button); on wide screens the header button is a sidebar icon labelled "Show/Hide sidebar".
- A caravan can have an optional display name in any script (e.g. Urdu, up to 40 characters, no links), set by its owner and shown on its page and in the caravan rankings; its unique English handle is still how it is found and invited. Admins can clear a display name.
- City search accepts Urdu for Pakistan's main cities (server/data/cities-ur.tsv, 95 names mapped to their English entries; Arabic-keyboard letters and spaces do not matter).
- Second review pass: the challenge tiles use lakh/crore like the rest of the card; list scores and their units share one right edge; Settings says Light/Dark and uses a gear icon; the goal bar's star is hidden at 0; the invite buttons share one height; Move deadline shows every option as a date ("Wed 28 Oct") with hairline dividers.

## 40. A phone with a wrong clock

Every reply carries the server's time (the HTTP `Date` header). When the phone's clock is more than two minutes off, the app shifts its own idea of "now" by the difference, so Today's date, deadlines offered when moving a task, the weekday picker, the evening streak nudge and "3h ago" all follow the server. Timers and animations keep the phone's clock. The e2e run opens the app with the phone a week fast and checks the date shown.

## 41. Page weight

English text is in `public/i18n.js`; Urdu text is in `public/i18n-ur.js` and is fetched only when Urdu is in use (before the first screen for Urdu members, or when switching in Settings), so English pages skip about 15 KB. English is always present as the fallback. Fonts load only where they are shown and are cached for a year: Nastaliq for Urdu, cut to the Urdu alphabet (about 117 KB per weight, from 159 KB; rendering of Urdu pages checked unchanged); an 18 KB cut of Amiri holding only the durood's letters for the welcome screens (was the full 79 KB font); a 1.6 KB cut holding only ﷺ for English text. `scripts/make-fonts.sh` rebuilds both from `scripts/fonts/amiri-source.woff2`, and a test fails if the durood text uses a letter the cut lacks. The e2e run checks that an English Today downloads neither the Urdu text nor an Urdu or Arabic font.

App files (HTML, scripts, styles) are sent brotli-compressed when the browser accepts it, gzip otherwise; the compressed copies are cached per file version. Version tags are weak (`W/"…"`) because both copies share one, and a returning browser gets `304 Not Modified` either way.

## 42. A weak signal

A request that gets no answer is given up: after 12 s for reads and for sends that are safe to repeat (they carry a request id), after 30 s for other writes. It then counts as no signal. A durood send that hung goes straight to the phone's outbox (no further retries that would hang too), shows on the counter at once, and is sent once the line clears; the request id makes sure it is counted once.

## 43. Urdu details

- Percentages in Urdu text are isolated left-to-right, so they read "0%", never "%0" (a test checks every one).
- Email and phone under the name in Settings follow the page's side; each is still written left-to-right.
- Members' cities show in Urdu for the 95 Pakistani cities in `server/data/cities-ur.tsv` (the list Urdu city search uses; a test keeps the two the same). Other cities show as stored; the city field in Settings keeps the stored name.

## 44. Starting colours

The installed app opens on the app's light grey, and a signed-in member's status bar is set to their header colour (light or dark) before the app has loaded. The welcome screen keeps navy.

## 45. Checks in the browser tests

Besides the flows: no WCAG A/AA failures (axe) on any page in light and dark; nothing tappable under 24 px on a phone; every stop Tab reaches shows a focus ring; a stalled connection queues a durood and sends it once; a wrong phone clock still shows the right day; English pages load no Urdu text or fonts. CI runs these with Playwright 1.48: run them with that version before pushing (a newer one has passed checks 1.48 fails).

## 46. Small polish (dates, rows, photos)

- Stored days are always written out in the member's language through one helper (`dayText`): History shows "Fri 23 Oct", profiles "Member since October 2026", saliks and razakars "Joined October 2026". A test fails if a raw `2026-10-23` is printed.
- A tap anywhere on a ranking row opens that member's profile (the photo stays the keyboard's button).
- The profile sheet's stats read "All time / Day streak / Level", labels under their numbers.
- In dark mode the chosen option of a two- or three-way switch is the lighter grey.
- The feed's weekly city card names the city as the city rankings do ("Lahore").
- New sunnah photos store their width and height; the feed reserves that space before the photo arrives, so nothing jumps on slow data.

## 47. Caching and crawlers

- API replies and every error reply (API errors, missing files) carry `Cache-Control: no-store`, so no phone or proxy keeps an error, and a remembered 404 cannot hide a file added by a later deploy.
- Profile photos are cached `private` for a year (their address changes with each new photo): kept on the member's phone, never by a shared proxy. Sunnah photos are `private` for a day.
- `robots.txt` lets search engines list the welcome page but not `/api/`, `/photos/`, `/avatars/` or `/admin.html` (which also carries `noindex`).
- Accessibility checks in the browser tests now also cover: 130% text on a 360 px phone (members' pages, both edges, and all admin tabs), the phone's Reduce motion setting, duplicate ids and labels without a field.

## 48. Daily reflection themes

The daily reflection always asks something specific, about the Seerah or the Sunnah. An administrator can write the question for a day (Admin, Content); on any day without one, members get that day's built-in theme: 30 in a cycle, alternating 15 events from the Seerah and 15 practices of the Sunnah (`server/reflection-themes.js`), each naming one event or practice and asking one concrete question about it, in English and Urdu. Seerah: the Trustworthy, the Black Stone and the cloak, Khadijah (RA) at Hira, Bilal (RA), Ta'if, Mi'raj, the cave of Thawr, the first mosque in Madinah, the brotherhood of Muhajirun and Ansar, Badr, Uhud, Hudaybiyyah, the Bedouin in the mosque, the conquest of Makkah, the Farewell Sermon. Sunnah: miswak, salam, a smile, fasting Mondays and Thursdays, visiting the sick, half a date in charity, istighfar, helping at home, playing with a child, the dua after the adhan, durood on Fridays, asking permission, before sleep, Duha, eating with Bismillah. The card shows "Today's theme: Seerah · Hudaybiyyah" above the question; the feed shows the question above each reflection. The theme is the same for everyone on a day, and an administrator's own question replaces it. Only well-known events and practices are used and no hadith wording is quoted, but this is religious content: an organiser or scholar should read the list once and change anything they prefer.

Also: the big counter and the celebration number are measured after drawing and shrunk to fit their card (a phone's own font-size setting scales them again); a badge celebration shows "New badge" above the number instead of repeating it.


## 49. WhatsApp message button

- A member's profile shows **Message on WhatsApp** unless the member has hidden their number. Numbers are visible by default (the community knows each other); `users.hide_phone` is the member's choice, set at sign-up (checkbox), in Settings (switch), or by an admin (`hide-phone` / `show-phone` on a member, after a complaint).
- Public profiles carry only a `whatsapp` true/false flag. The chat address comes from `GET /api/wa/:username`: signed-in only, 40 per hour per member, 404 for yourself, hidden, deleted or suspended members. Each open is logged in `wa_opens` (kept 90 days).
- Existing members see a one-time card on Today (local flag `wanote`) with a **Hide my number** button.
- Not built: a block-member button.
