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
