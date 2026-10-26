---
name: promo-video
description: Make a new Seerah Quest promo or how-to video on the promos branch (portrait 1080x1920 MP4 for TikTok, Reels, Shorts) with the Swiss promo kit, real app captures, spotlights and bilingual callouts. Use when asked for a new promo, a feature video, a shorter cut of an existing one, or to refresh the screens in one.
---

# Making a promo video

Everything lives on the `promos` branch, which has no history in common with the app. Read `README.md` and `kit/swiss/README.md` there first; this is the order of work and what to watch for.

## 1. The app's screens

The captures need a checkout of the app branch (`claude/durood-social-rpg-app-cwz6av`) next to this one:

```bash
git worktree add --detach ../app origin/claude/durood-social-rpg-app-cwz6av   # or update an existing one
APP_DIR=../app node tools/capture-tour.mjs assets/tour                         # about 2 minutes; MODE=dark for dark screens
```

It seeds a made-up community of 30 members over a week (deterministic), then saves every screen as `<name>.jpg` (the phone's view), `<name>-full.jpg` (the whole scrolling page), frame sequences (`burst-NN`, `tap-NN`, `type-N`) and `manifest.json`. The manifest holds each page's height, header and tab bar, and the box of each known element (`r`). Look at the captures before using them, for example with a contact sheet in Python.

To show a screen that is not captured yet, add it to `tools/capture-tour.mjs`: `view()` for one screen, `full()` for a whole page, `frames()` to step through a real animation. Add a selector to `SPOTS` if the video will spotlight a new element.

## 2. The storyboard

Copy `kit/swiss/starter.html` to `videos/NNN-slug/scene.html` and write the story (fields in `kit/swiss/README.md`). Keep to the house rules in `README.md`:
- only real screens
- Urdu with every English line
- nothing important in the bottom 300 px or the right 120 px
- no music
- Quran and hadith quoted with their source, and flagged for a qualified person to check

A new visual style belongs in a new kit next to `kit/swiss`, not in edits to the shared one. 001 keeps its own night-sky scene, and 002 must stay pixel-identical.

## 3. Check before rendering

```bash
node tools/stills.mjs videos/NNN-slug /tmp/sheet.png 6 <seconds...>    # prints the timing, writes a contact sheet
```

Look at the sheet with the Read tool. Check every spotlight lands on its element, callouts don't cover what they point at, captions fit in two lines, and transitions have no empty frames. Pick seconds a little after each step's `at` (a spotlight appears 0.55 s after its step starts).

## 4. Render and publish

```bash
node tools/render.mjs videos/NNN-slug --jobs 4     # MP4 with sound effects + poster.jpg (cover at window.POSTER)
ffmpeg -i videos/NNN-slug/NNN-slug.mp4 -af volumedetect -vn -f null - 2>&1 | grep volume   # sound present (mean about -30 dB)
```

Then:
- Pull a few frames from the MP4 with ffmpeg and look at them.
- Write `post.md`: the storyboard with times, the text to post in English and Urdu, and a "Before posting" list.
- Add the video to the table in `README.md`.
- Commit and push to `promos`, then send the MP4 and poster to the user.

## Pitfalls already met

- **A lecture belongs to the week it is created in.** The capture creates it at today's date; the week starts on Monday.
- **The goal burst celebrates a badge only when the 313 crosses one.** The seed makes Ayesha's total 9,900, so it crosses 10,000. The badge card that follows clips its big number at phone width, an app bug, so the video stops at frame 12.
- **A spotlight on a re-captured feed can shift**, because new milestones appear at the top. Use rects there.
- **`tools/sfx.mjs` filters must stay stable.** It throws if the mix comes out silent. Never skip the volume check.
- **When checking a scene in a browser, serve `.css` and `.js` with the right content types.** The tools do this; a stylesheet served as `application/octet-stream` is ignored.
