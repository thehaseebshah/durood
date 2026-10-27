# Seerah Quest · promos

Short promo and how-to videos and posters for the app, made for portrait feeds (TikTok, Reels, Shorts, WhatsApp Status): **1080 × 1920, 30 fps, H.264 MP4**.

This branch holds content only; the app lives on the main branch. PDF guides can get their own branch later.

## What's here

| Path | What it is |
|---|---|
| `posters/NNN-slug/` | One poster per folder: `poster.html` (the source), the rendered `poster.png` and `post.md` (wording and text to post) |
| `videos/NNN-slug/` | One video per folder: `scene.html` (the source), the rendered `.mp4`, `poster.jpg` (cover) and `post.md` (storyboard, captions, text to post) |
| `assets/shots/` | Real screenshots of the app (dark mode), captured by `tools/capture.mjs` (used by 001) |
| `assets/tour/` | Every screen of the app (light mode) for the full tour, captured by `tools/capture-tour.mjs`: phone views, whole pages, animation frames and `manifest.json` (page heights and where each UI element sits) |
| `assets/full/` | Every screen of the released app (the Al-Burhan edition: tasks, My people, majalis too), light mode, captured by `tools/capture-full.mjs` (used by 003) |
| `assets/fonts/`, `assets/icon-512.png` | The app's own fonts (Inter, Noto Nastaliq Urdu, Amiri) and icon |
| `tools/capture.mjs` | Starts the app on a throwaway database, seeds a demo community over the past week, screenshots the screens |
| `tools/capture-tour.mjs` | The same for every screen, with whole scrolling pages, frame-by-frame animations and measured element positions for spotlights |
| `tools/capture-full.mjs` | The same for the released app, with tasks and routines, My people, murabbi and masul (the Mamulaat app stood in for), majalis, the Learn pages, the admin page, and real tick and swipe animations |
| `tools/render.mjs` | Renders a `scene.html` to MP4 frame by frame (exact timing on any machine); `--jobs 4` splits the work over four browsers |
| `tools/sfx.mjs` | Synthesises the sound effects from the scene's cue list (no music, no samples) |
| `tools/poster.mjs` | Renders a `poster.html` to PNG (1080 × 1920 unless the page sets another size) |
| `tools/stills.mjs` | A contact sheet of stills from a scene, to check a video without rendering it; also prints its timing |
| `kit/swiss/` | **The Swiss promo kit**: the engine and look of 002, plus a starter page. A new video is one short page with its words and storyboard ([how](kit/swiss/README.md)) |
| `.claude/skills/promo-video/` | Step-by-step instructions for Claude sessions making the next promo |

## Videos

| # | Title | Length | Kind |
|---|---|---|---|
| 001 | [Every durood counts](videos/001-every-durood-counts/post.md) | 56 s | Promo |
| 002 | [The full tour](videos/002-the-full-tour/post.md) | 4 min 10 s | Promo: every feature of the public edition, chapter by chapter, in the app's Swiss style |
| 003 | [Everything](videos/003-everything/post.md) | 4 min 59 s | Promo: the whole released app, with tasks, routines, My people and majalis |

## Posters

| # | Title | Size | Kind |
|---|---|---|---|
| 001 | [Seerah Quest has launched](posters/001-launched/post.md) | 1080 × 1920 | Launch: founder's codes for those who intend to register 20 people and monitor their durood for 7 days |

## Making or changing a video

Needs Node 22.13+, Playwright with Chromium, and ffmpeg.

```bash
# 1. a checkout of the app next to this one (only needed to refresh screenshots)
git worktree add ../app claude/durood-social-rpg-app-cwz6av
APP_DIR=../app node tools/capture.mjs assets/shots
APP_DIR=../app node tools/capture-tour.mjs assets/tour
APP_DIR=../app node tools/capture-full.mjs assets/full

# 2. preview: open videos/001-every-durood-counts/scene.html through any static server
#    (it plays in real time; click to restart). Check one frame:
node tools/render.mjs videos/001-every-durood-counts --still 12.4

# 3. render the MP4 and poster (a few minutes for a minute of video; --silent for no sound effects)
node tools/render.mjs videos/001-every-durood-counts
node tools/render.mjs videos/002-the-full-tour --jobs 4
```

**A new video:** copy `kit/swiss/starter.html` to `videos/NNN-slug/scene.html`, write its words and storyboard, check stills with `tools/stills.mjs`, then render with `--jobs 4`. Everything the kit can do is in [kit/swiss/README.md](kit/swiss/README.md). 001 is a standalone scene in its own night-sky style; copy its folder for another video in that look.

## House rules

- **Real screens only.** Every app screen shown is a screenshot of the actual app (the capture tools), never a mock-up. The people in them are a seeded demo community: **men only, with made-up names**, never real members.
- **Each video keeps the app version it was made from.** 001 was captured from app commit `99dde04`, 002 from `ea51602` and 003 from `75f51db`; recapture from that commit to change only the data.
- **Style:** each promo has its own look (001: night sky and gold, dark screens; 002: the app's Swiss white, black and green, light screens). Common to all: heavy Inter, the eight-point star, Urdu in Nastaliq with every English line.
- **Keep text clear of the platform's buttons:** nothing important in the bottom 300 px or the right-hand 120 px.
- **No music.** Sound effects only (synthesised); add a recitation or voice-over in the app you post from, if wanted.
- Quran, hadith and figures are quoted with their source and checked by someone qualified before posting.
