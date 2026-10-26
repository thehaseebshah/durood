# Next features (requested 26 October 2026)

Nothing here is built yet. Each item says what you asked for, what the app does today, what to build, and the decisions that need an answer first. Sizes are rough: **S** about a day, **M** a few days, **L** a week or more.

Suggested order: 3, 2, 1, 6, 5, then 4.

**Decisions made so far (26 October):**
- WhatsApp: a member's number is **visible to other members by default**, and a member can choose to hide it (item 2).
- Team tasks: add an **"Everyone I lead"** option (item 3).
- Reading material: **store the PDFs and audio on Google Drive, not on our server**, to avoid hosting cost (item 4).

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

## 2. A WhatsApp button on every profile (S)

**Asked:** each profile has a button letting anyone message that person on WhatsApp, since we already hold everyone's number.

**Decided:** the number is **visible by default** (we are one community and mostly know each other). A member who does not want to be contacted can **hide their number** in Settings. Hiding is the exception, not something members must opt into.

**Today:** we hold a phone number for everyone. No member can see another's number, and the profile sheet shows none. The privacy notice (`public/privacy.html`) currently says the opposite of the new behaviour (only organisers see numbers). It needs a one-line change to match when this ships; that is not a blocker.

**Build:**
- A **"Hide my number from other members"** switch in Settings (off by default). The button appears on a profile unless that member has hidden their number.
- The button opens `https://wa.me/<number>` through a signed-in server redirect (`/api/wa/<username>`), so numbers are not in the public member data where a script could collect them in bulk. The redirect is rate-limited and logged.
- If someone's number is not on WhatsApp the chat will simply not open; say so gently.
- Admins can hide a number on a member's behalf after a complaint.

**Worth adding, not required:**
- Show the "hide my number" choice **on the sign-up form** as well, so a person who wants privacy can choose it before their number is ever visible.
- A **one-time notice to existing members** ("Other members can now message you on WhatsApp. Hide your number?") so nobody finds out by surprise.
- A **block member** button (hide my profile and number from this one person). Google Play expects a way to block when members can contact each other.

---

## 3. A masul gives one task to many people by team hashtag (S)

**Asked:** a masul can assign a single task to many people at once using the team hashtags.

**Today, already built for one hashtag at a time.** A masul tags each razakar on **My people** (up to 5 tags each, such as `#shabab_lahore`). Tapping a tag in the filter row shows **"Give this team a task"**, which creates the task (or routine) for every razakar with that tag in one step. (`assignTeam` in `server/burhan.js`; tested.)

**Decided to add:** an **"Everyone I lead"** option, giving the task to all of the masul's razakars at once.

**Still open (say if you want any of these):**
- Choose **several hashtags at once** (everyone in `#lahore` or `#stage`), with nobody given the task twice.
- **Hand-pick** people from a checklist.
- Make "assign to a team" its own obvious button (the tag filter is easy to miss).
- See a team task as **one item** ("12 of 20 done") and edit or remove it for everyone at once. Today each person gets an independent copy; this needs a "batch id" stored with each copy.

**Build:** a small chooser at the top of the assign form: *One person / A team (#tag) / Everyone I lead*, using the same task form and the same rules (a deadline is required, plain text, no links).

---

## 4. Weekly reading and listening material with a quiz, kept on Google Drive (M)

**Asked:** the admin can add PDFs (and maybe audio) to the app as the week's reading material, and the quiz is taken from them. **Decided:** keep the files on Google Drive so our server does not store or serve them.

**Today:** only watching. A lecture is a YouTube video with a minimum watch time, an XP reward, and a quiz the admin writes; the reward is paid after the quiz is passed.

**How Drive fits.** The admin uploads the file to Google Drive, sets it to "Anyone with the link can view", and pastes the link into the admin page. The app takes only the file's ID from the link and builds the address itself (members never see an admin-typed address, and only Drive addresses are accepted). Members read or play it inside the app in Drive's own viewer, the same way lectures play in YouTube's. This removes the hard parts of hosting files ourselves: no upload code, no storage cost, no backups, no seeking support for audio.

**Build:**
- A **"material"** type beside lectures: title in English and Urdu, the week it belongs to, XP, the Drive link, and a quiz (reuse the lecture quiz screens and rules). It shows with the week's lecture and in the quests.
- The member opens the PDF or plays the audio in the app (Drive viewer in a frame; the page's security policy gets one new allowed address, `drive.google.com`) with an "Open in Drive" link as a fallback.
- An admin **"Test preview"** button and a plain reminder: "set sharing to Anyone with the link, or members will see *You need access*".
- Old weeks stay available in a list.

**Limits to know about:**
- **We cannot tell whether a PDF or audio was actually read or heard.** Drive's viewer is Google's page, so we get no play time or page events. The quiz is the only proof (it would have been for a PDF on our own server too). Lectures on YouTube keep their minimum watch time.
- **Drive can throttle a very popular file** ("Sorry, you can't view or download this file at this time") if many people open it in a short time. A weekly file opened by a few hundred members should be fine; a few thousand might hit it. Keeping the link type pluggable lets us move to another host later without redoing the feature.
- It works in the Android app's web view and in browsers, but **needs trying with a real file on a real phone before we rely on it.**
- The file is reachable by anyone who has the link, not only members. Fine for community material; copyright is the admin's responsibility.
- No offline reading.

**Audio alternative worth considering:** upload audio to YouTube as an unlisted video (a still picture with the sound). It then works **today** as an ordinary lecture, with the minimum listening time and the quiz, and YouTube has no throttling. PDFs would be the only new thing. Drive for PDFs plus YouTube for audio may be the most reliable mix.

**Decide:** Drive for both, or Drive for PDFs and YouTube for audio. Whether old weeks stay readable.

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
