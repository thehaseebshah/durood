# Durood Qafila: product spec after the feature interview

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
| Badges | Show **all 23**, locked ones greyed. The **7 that need cut features** (Sunnah x3, Reviewer x2, Student, Scholar) are labelled **"coming soon"**. |
| Streaks and shields | Keep. |
| Quests | Keep the four durood quests. Sunnah, review and lecture quests go with their features. |
| Sunnah photo verification | **Cut from v1** (code stays, switched off). |
| Seerah lectures | **Cut from v1** (code stays, switched off). |
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
