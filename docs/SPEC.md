# Durood Qafila: product spec after the feature interview

Status: decisions from the interview, plus items flagged **[CONFIRM]** where answers conflict or need a number. Nothing here is built yet except what already exists in the MVP.

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
| Implausible totals | Flag at **20,000 in a day or 10x the member's weekly average**. Flagged members still count privately but are hidden from public ranks until an admin reviews. **[CONFIRM]** the baseline rule for new members (see 6). |
| Individual ranks | Exact counts, weekly and all-time. |
| Caravan boards | Three: **total, average per active member, growth this week**. **[CONFIRM]** definition of "active" (see 6). |
| Levels and titles | Keep titles and progress bar. **Hide raw XP numbers.** |
| Badges | Show **all 23**, locked ones greyed. **[CONFIRM]** 7 of the 23 can no longer be earned (see 6). |
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
| Inviter view | Names, city and counts, **regardless of the invitee's rank setting**. **[CONFIRM]** privacy conflict (see 6). |
| Consent | **Footer link** to a one-page privacy notice. |
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

**Me:** profile; **History** (last two days editable, older read-only); badges (grid, locked greyed); settings (daily goal, city, rank visibility, reminders, language, mode); delete account; log out. Footer: privacy notice.

**Intro (first run only):** language choice, then three screens: purpose, how counting works, how caravans work.

**Admin (separate page):** invite codes; flagged members; announcements; exports.

## 4. Data and rules to add
- `invites` (code, owner, created, revoked, uses), founders code, `waitlist` (name, phone, city, status).
- Entry history: edits recorded as reversing plus replacement entries; edits only for today and yesterday; the audit still reconciles to the ledger.
- `flags` (member, reason, date, status).
- `announcements`; push subscriptions; reminder time per member.
- Anonymisation job for deletions; totals unaffected.
- Password reset tokens (single use, short expiry) and a mail sender.

## 5. Build order
1. **Access and accuracy:** invite codes, founders code, waitlist, admin page; edits and History; flags; password reset; footer privacy notice.
2. **Home and structure:** new Home, four tabs, intro screens, Ranks, three caravan boards, hide XP, Circle card, feature switches for sunnah and seerah.
3. **Reach:** News feed, push notifications and reminders, admin announcements, exports.

## 6. Open items for you (flagged by the interview)
1. **Unearnable badges.** With photo verification and lectures cut, 7 badges can never be earned (Sunnah Keeper, Seven, Thirty; Trusted Reviewer, Pillar of Trust; Student, Scholar). Showing all 23 means seven stay grey forever.
2. **Inviter sees counts regardless of rank setting.** This contradicts today's promise that opting out hides you from your inviter. Either change the setting's wording, or keep an inviter-hidden option.
3. **Consent as a footer link only.** Phone numbers are personal data and deletion needs explaining; a tick-box at sign-up is a stronger record of consent.
4. **"Active member" and the new-member baseline** for the average board and the 10x flag.
5. **Notification prompt timing.** After the first completed streak day means no reminder is possible before then, so day-one members get none.
6. **Unverified email and reset links.** A mistyped email strands the account. A cheap fix: send a confirmation link at sign-up without blocking login.
7. **The tap counter and the News bell** are my proposals; you didn't choose them.
