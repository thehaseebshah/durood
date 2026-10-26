# Status: what was done and what is left

Last updated 26 October 2026. Branch `claude/durood-social-rpg-app-cwz6av`, mirrored to `dev`. Everything below is deployed to **QA** (seerah-quest-qa.fly.dev), not to production. All commits listed passed GitHub CI on both branches, the last one being `a32e7a2`.

For how the app behaves, read `docs/SPEC.md`. Sections 39 to 47 describe this work. This file is the short version, plus what still needs a person.

## Earlier work (before this stretch)

- **Security and stability:** server hardening, rate limits, request time limits, constant-time key checks, scrypt passwords, security headers and CSP.
- **Points and data integrity:** the points ledger, a nightly data check that runs on its own thread, and an append-only record of every durood entry.
- **Features:**
  - caravans (v2)
  - profiles with photos
  - admin accounts with roles
  - sunnah scheduling
  - Seerat Circles
  - Al-Burhan relationships, tasks with deadlines, routines and team tags
  - majalis
  - streak points
- **Design:** Todoist-style navigation and an Apple-style look in light and dark, with page and sheet animations, sounds, vibration and undo.
- **Urdu and page weight:**
  - Urdu throughout, loaded only for Urdu members
  - fonts cut down to the letters used
  - the offline cache holds only what every member needs
- **Robustness:**
  - a wrong phone clock corrected by the server's time
  - Urdu and Arabic digits accepted in phone numbers
  - city search in Urdu
  - caravan display names in any script

## This stretch

**Speed and reliability**
- App files are sent brotli-compressed, about 16% smaller than gzip, for example `app.js` went from 49 KB to 41 KB. File version tags are weak, so the gzip and brotli copies share one tag.
- A weak signal no longer hangs the app. Requests give up after 12 s (reads and durood sends) or 30 s (other writes). A durood that hangs goes straight to the phone's outbox and is sent once later.
- New sunnah photos store their size, so the feed keeps their space before they load and nothing jumps.
- Members no longer see a navy flash on opening. The installed app's splash and the status bar start in the member's own colours.

**Look and feel**
- Dark mode: the chosen option in two- and three-way switches is now the lighter grey.
- Tapping anywhere on a ranking row opens that member's profile.
- Tapping the current tab while scrolled down glides back to the top, as on iOS.
- Profile sheet: "Member since October 2026", "Day streak", and labels under their numbers.
- Dates read as dates everywhere (History, reflections, "Joined …") instead of `2026-10-23`.
- The feed's city card says "Lahore", as the rankings do.
- Larger tap areas for the Settings switches and the "Send link again" link.
- With the phone's large text (130%), the Seerat Circle buttons wrap instead of pushing past their card. The admin page's long code examples wrap too.
- Caravan search:
  - finds a caravan by its display name in any script
  - results show the name, the @handle and "N members"
  - "no result" points to creating one
  - a wildcard no longer lists every caravan

**Urdu**
- Percentages read "0%", not "%0".
- The email and phone line in Settings sits on the right.
- Members' cities show in Urdu for the 95 Pakistani cities that Urdu city search knows.

**Security and privacy**
- Error replies are never cached (`no-store`).
- Profile photos are cached on the member's phone only, never by a shared proxy.
- `robots.txt` keeps search engines out of the API, photos and the admin page.

**Code quality**
- 8 unused translation strings removed in both languages.

**New automated checks**

These are in `npm test` and `scripts/e2e.mjs`. Each new browser check was confirmed to catch the fault it guards against, apart from the large-text check (confirmed only by a manual scan before the fix).

| What is checked | Where |
|---|---|
| No tap target under 24 px on a phone, on any page with folds open | browser tests |
| Every keyboard stop shows a focus ring, in light and dark | browser tests |
| No duplicate ids, and every label points at a field | browser tests |
| At 130% text on a 360 px phone, nothing runs off either edge; same for all 11 admin tabs | browser tests |
| With Reduce motion on, nothing animates | browser tests |
| A stalled connection sends the durood to the outbox, and it is counted once | browser tests |
| Tapping a ranking row opens the profile; tapping the current tab returns to the top | browser tests |
| A feed photo's space is kept before it loads | browser tests |
| Brotli and gzip, weak version tags and 304 replies | unit tests |
| No-store on errors, private profile photos, robots.txt | unit tests |
| Urdu percentages are protected | unit tests |
| Urdu city names match the search list | unit tests |
| Raw dates are never printed | unit tests |
| Searching by Urdu caravan name | unit tests |
| Photo size is stored | unit tests |

**Checked and found fine (nothing to change)**
- 3,000 members: member pages answer in about 1 to 6 ms, admin lists in about 4 ms.
- Security headers on QA.
- Signed-out screens at large text, in English and Urdu.
- Reduce motion.
- Native date and time controls in dark mode.
- Server logs locally and on QA.

**Totals now:** 194 unit tests and the full browser suite pass, along with the wrong-date, random-input (2,190 requests to 146 routes, 0 server errors) and 60-member load tests.

## Member guide (from another session, merged in)

`guide/` holds 13 beginner tutorials as a small website and a PDF (`guide/seerah-quest-guide.pdf`), with screenshots of the app, merged from the `guide` branch.
- `npm run guide` builds the pages; `npm run guide:pdf` also prints the PDF.
- `npm run guide:shots` retakes the screenshots on a throwaway database. They were retaken after the merge, so History shows the new date format.
- After a visible change to the app, run `guide:shots` and then `guide:pdf`.
- The `promos` branch (two promo videos) shares no history with the app and was left separate.

## What is left

**Needs a person or a decision**
- **Production:** none of this work is deployed there yet (see `docs/DEPLOY.md`). The Android APK was not rebuilt.
- **Phone verification:** there is no SMS provider yet, so phone numbers are not confirmed.
- **Privacy page:** it still needs the organiser's contact details.
- **QA test accounts:** QA still has the `smoke_*` test accounts. Remove them before real members use it.
- **Hadith references:** a scholar should review the hadith references in the sunnah and Seerah content.

**Small, known, left as is**
- The task deadline box shows dates in the phone's own format (for example US order on a US-set phone). Changing it would mean replacing the phone's date picker.
- Each deploy has a few seconds of downtime. There is one server, because the database (SQLite) lives on its own disk. Durood sent in that gap waits on the phone and goes through after.
- The Urdu caravan search is covered by unit tests only. The browser test for it was rejected and not added.

**Housekeeping**
- One self check-in is still scheduled for 04:00 UTC; it would resume the improvement loop. Cancel it if the loop should stay stopped.
- When testing locally, run the browser tests with Playwright **1.48.2**, the version CI uses. One check passed on a newer version but failed in CI.
