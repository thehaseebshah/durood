# Seerah Quest · promos

Short promo and how-to videos for the app, made for portrait feeds (TikTok, Reels, Shorts, WhatsApp Status): **1080 × 1920, 30 fps, H.264 MP4**.

This branch holds content only; the app lives on the main branch. PDF guides can get their own branch later.

## What's here

| Path | What it is |
|---|---|
| `videos/NNN-slug/` | One video per folder: `scene.html` (the source), the rendered `.mp4`, `poster.jpg` (cover) and `post.md` (storyboard, captions, text to post) |
| `assets/shots/` | Real screenshots of the app (dark mode), captured by `tools/capture.mjs` |
| `assets/fonts/`, `assets/icon-512.png` | The app's own fonts (Inter, Noto Nastaliq Urdu, Amiri) and icon |
| `tools/capture.mjs` | Starts the app on a throwaway database, seeds a demo community over the past week, screenshots the screens |
| `tools/render.mjs` | Renders a `scene.html` to MP4 frame by frame (exact timing on any machine) |
| `tools/sfx.mjs` | Synthesises the sound effects from the scene's cue list (no music, no samples) |

## Videos

| # | Title | Length | Kind |
|---|---|---|---|
| 001 | [Every durood counts](videos/001-every-durood-counts/post.md) | 56 s | Promo |

## Making or changing a video

Needs Node 22.13+, Playwright with Chromium, and ffmpeg.

```bash
# 1. a checkout of the app next to this one (only needed to refresh screenshots)
git worktree add ../app claude/durood-social-rpg-app-cwz6av
APP_DIR=../app node tools/capture.mjs assets/shots

# 2. preview: open videos/001-every-durood-counts/scene.html through any static server
#    (it plays in real time; click to restart). Check one frame:
node tools/render.mjs videos/001-every-durood-counts --still 12.4

# 3. render the MP4 and poster (a few minutes for a minute of video; --silent for no sound effects)
node tools/render.mjs videos/001-every-durood-counts
```

A new video: copy a folder to `videos/NNN-slug/`, edit the text (each element's `data-in` / `data-out` say when it appears and leaves) and the timeline at the top of its `<script>`, render.

## House rules

- **Real screens only.** Every app screen shown is a screenshot of the actual app (`tools/capture.mjs`), never a mock-up. The names in them are a seeded demo community, not real members.
- **Style:** night sky, gold and the app's green; heavy Inter numerals, the eight-point star; the app shown in dark mode. Urdu in Nastaliq with every English line.
- **Keep text clear of the platform's buttons:** nothing important in the bottom 300 px or the right-hand 120 px.
- **No music.** Sound effects only (synthesised); add a recitation or voice-over in the app you post from, if wanted.
- Quran, hadith and figures are quoted with their source and checked by someone qualified before posting.
