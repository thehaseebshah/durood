# Next features (requested 26 October 2026)

Nothing here is built yet. Each item says what you asked for, what the app does today, what to build, and the decisions that need an answer first. Sizes are rough: **S** about a day, **M** a few days, **L** a week or more.

Suggested order: 3 (smallest gap, maybe nothing to build), 1, 6, 5, 2, then 4 (largest).

---

## 1. Show lagging caravan members so the owner can remove them (S to M)

**Asked:** the app should show members of a caravan who are lagging behind, so the caravan manager can remove them.

**Today:** the Caravan page lists every member with this week's durood and a tick if they recited today. The owner already has a remove (×) button on each row. What is missing is *finding* the lagging ones: the owner has to read the whole list.

**Build:**
- An owner-only "Falling behind" section on the Caravan page: members who have recited nothing for N days, or are far below the caravan's average, sorted worst first, each with a **Remove** button (with a confirmation) and, as a softer first step, a **Nudge** (a push notification or message asking them to join in).
- New members get a grace period (for example 7 days) so they never appear straight away.
- Optionally tell the member when they are removed.

**Decide:**
- What counts as lagging: no durood for 3 days? Below the caravan's median for the week? Streak broken?
- Visible to the owner only (recommended, so nobody is shamed in front of the group).
- Whether removal sends the member a notification, and whether they can rejoin.
- It interacts with the caravan streak rule (a day counts when half of at least three members recite): removing members changes that maths, so say so in the confirmation.

---

## 2. A WhatsApp button on every profile (S to M, mostly privacy decisions)

**Asked:** each profile has a button letting anyone message that person on WhatsApp, since we already hold everyone's number.

**Today:** we hold a phone number for everyone, but the privacy notice (`public/privacy.html`) promises that only owners and organisers see it (and a linked murabbi in the Al-Burhan edition). No member can see another member's number, and the profile sheet shows none. A button for everyone breaks that promise: tapping it reveals the number.

**Why this needs care:** anyone could contact anyone, including women and young members, with no way to refuse. Members signed up under the current privacy notice. There is no "block a member" feature yet.

**Recommended build:**
- **Opt-in, off by default:** a Settings switch, "Let other members message me on WhatsApp". The button appears on a profile only if that member switched it on.
- The button opens `https://wa.me/<number>` through a signed-in server redirect (`/api/wa/<username>`), rate-limited and logged, so numbers never sit in page data or in the member list API where a script could harvest them.
- Update the privacy notice, the sign-up wording and the Settings text to match. Existing members get a one-time prompt rather than being switched on.
- Admins can switch it off for a member after a report.
- The stored number may not be on WhatsApp (the sign-up says "WhatsApp or phone number"): say so gracefully if the chat does not open.

**Decide:** opt-in for everyone (recommended), or only between people who share a caravan, Qabila or Al-Burhan link, or open to all. Whether to build a "block" button at the same time (recommended, and Google Play's user-generated-content rules expect one).

---

## 3. A masul gives one task to many people by team hashtag (S, may already be done)

**Asked:** a masul can assign a single task to many people at once using the team hashtags.

**Today, already built for one hashtag at a time.** A masul tags each razakar on **My people** (up to 5 tags each, such as `#shabab_lahore`). Tapping a tag in the filter row shows **"Give this team a task"**, which creates the task (or routine) for every razakar with that tag in one step. (`assignTeam` in `server/burhan.js`; tested.)

**So what is missing? Please say which of these you mean:**
- Choose **several hashtags at once** (everyone in `#lahore` or `#stage`), with nobody given the task twice.
- A **"Everyone I lead"** choice.
- **Hand-pick** people from a checklist.
- The tag filter is easy to miss: make "assign to a team" its own obvious button.
- See a team task as **one item** ("12 of 20 done") and edit or remove it for everyone at once. Today each person gets an independent copy.

**Build:** whichever of the above you choose; the multi-tag and "everyone" versions are small. The grouped view needs a "batch id" stored with each copy.

---

## 4. Weekly reading and listening material with a quiz (L)

**Asked:** the admin can add PDFs (and maybe audio) to the app as the week's reading material, and the quiz is taken from them.

**Today:** only watching: a lecture is a YouTube video with a minimum watch time, an XP reward, and a quiz the admin writes; the reward is paid after the quiz is passed.

**Build:** a "material" type beside lectures:
- Admin uploads a **PDF or audio file** (mp3 or m4a) with a title in English and Urdu, the week it belongs to, XP, and the quiz questions (reuse the lecture quiz screens and rules).
- Members read the PDF in the app or play the audio; the quiz is the proof of reading. Audio can also require a minimum listening time, like lectures. A PDF cannot be checked for being read, so only the quiz counts.
- It appears in the week's section next to the lecture and in the quests.

**Things that make this the biggest item:**
- **Uploads:** the server accepts photos as small base64 posts (400 KB). PDFs and audio need real streaming uploads with size caps (suggest PDF up to 15 MB, audio up to 40 MB), format checks and rate limits.
- **Storage:** files live on the server's disk (QA about 1 GB, production 3 GB) and **the nightly backup does not include uploaded files** (`server/backup.js` says so). Audio fills the disk quickly; needs a plan (cap per file, delete old weeks, or a separate backup).
- **Audio playback** needs HTTP range support (seeking) which the static file server does not have yet; without it audio will not seek on iPhones.
- Serve PDFs inline with a locked-down policy so a malicious PDF cannot run anything.
- Offline: optionally cache the current week's file on the phone.
- Copyright is the admin's responsibility; say so on the upload screen.

**Decide:** upload to our server (recommended, simplest for members) or let admins paste a link (cheaper, but members leave the app). Maximum file sizes. Whether old weeks stay readable.

---

## 5. Separate Seerah and Sunnah on Home, and as separate sidebar tabs (M)

**Asked:** separate Seerah and Sunnah sections on Home, and separate tabs for each in the sidebar.

**Today:** Home has one folded section, "Sunnah & Seerah", holding: the Sunnah of the day (tick or post a photo), the week's lecture(s), the daily reflection, and the Seerat Circle card. The sidebar has Today, Feed, Compete, Caravan, Qabila, Tasks, My people, Me and Settings.

**Build:**
- **Home:** two sections, **Sunnah** (the day's sunnah, tick or photo, a link to past sunnahs) and **Seerah** (the week's lecture or reading, the Seerat Circle card).
- **Sidebar:** two new pages. **Sunnah**: today's sunnah, your sunnah history and streak, the photos from the community. **Seerah**: this week's lecture and reading material, past ones you have not finished, the Seerat Circle.
- The daily reflection now alternates between Seerah and Sunnah themes, so it needs a home: either its own small section on Home above both, or shown under whichever kind today's theme is.
- Keep the bottom bar at four tabs; the new pages live in the sidebar and under Browse.
- The quests that count sunnah and lectures keep working.

**Decide:** where the reflection goes (recommended: its own section on Home); whether the bottom bar should change.

---

## 6. Repeatable 40-day challenges with start and end dates (M)

**Asked:** the 40-day challenge is not a one-time thing; admins can create more when one ends, and set start and end dates.

**Today:** there is one global challenge kept in settings (start date, number of days, target of 10 crore); the admin can change those values but cannot keep a history or schedule the next one. Starting a new one overwrites the old.

**Build:**
- A **challenges** list in Admin: name (English and Urdu), **start date, end date**, target, and status (upcoming, running, finished). Create several ahead of time; they must not overlap.
- The app shows the running one (or "starts on 10 November" for the next). The Challenge ranking and the daily-plan maths follow the running challenge.
- When one finishes it is **archived** with its final total and top members, and members can look at past challenges. Its milestones and badges stay with it.
- Today's challenge becomes "Challenge 1" so nothing is lost.
- Optional: a reminder when a challenge starts and when it is about to end.

**Decide:** is the 10 crore target the same each time or set per challenge? Do all members take part automatically (as now)? Does a finished challenge award anything (a badge for finishing)?

---

## Not a feature, but needed before launch

- The Android app's server address is currently the **QA** server (`android-app/capacitor.config.json`). A release build for members must point at the production server.
- The Android version is 1.2 (code 3). There is no "minimum version" check, so we cannot yet ask very old Android builds to update (see the update note below).

---

## Decision note: the app updates itself

The Android app is a thin shell around the website. It opens the live site, so deploying the website updates every phone straight away, with no Play Store update. (Browsers and installed web apps work the same way.) Only changes to the shell itself, such as new Android permissions, plugins, the icon or splash screen, need a new Play Store release.

**Good:** a bug or a security hole is fixed for everyone within minutes; nobody is stuck on an old version; no store review delay; one codebase for the website and the Android app. Google Play's rules allow it: they restrict an app from updating its own *native* code outside the store, but expressly allow JavaScript running inside a web view.

**Risks, and what to do about them:**
- A bad deploy reaches everyone at once. Keep the discipline already used: test on QA first, then production, and keep CI green. A server rollback takes seconds.
- If the server is down, a first-time open fails (an installed app still opens from its saved copy and keeps offline durood). Keep production healthy and the domain safe: the app is tied to one web address.
- Old Android builds can't be told to update when a native change ships. Add a small **minimum app version** check: the app reports its version, and the server answers "please update from the Play Store" when needed.
- Because content changes without store review, the app must always stay within Play's rules for user-generated content: reporting and moderation exist; a "block member" button does not (see item 2).
