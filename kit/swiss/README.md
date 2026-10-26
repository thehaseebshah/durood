# Swiss promo kit

The engine and look behind **002 "The full tour"**. A new video is one short page: it loads `swiss.css` and `engine.js` and calls `Promo.run({...})` with its words and its storyboard. Everything else is built in: the camera, the spotlights, the panels, the sound cues and the timing.

| File | What it is |
|---|---|
| `swiss.css` | The look: white paper, black ink, one green (`#00a86b`), Inter, Nastaliq for Urdu, Amiri for Arabic |
| `engine.js` | Builds the page and draws any moment `t`: `window.seek(t)`, `window.DURATION`, `window.CUES`, `window.POSTER`, `window.ready` |
| `starter.html` | A complete short promo (about 1 minute) to copy and change |

## Start a new video

```bash
mkdir -p videos/003-my-promo
cp kit/swiss/starter.html videos/003-my-promo/scene.html      # two folders down, so the ../../ paths work
# edit the words and the story, then look at stills (prints the timing too):
node tools/stills.mjs videos/003-my-promo /tmp/sheet.png 6 3 12 20 30 45
# render (about 7 minutes for 4 minutes of video on 4 cores):
node tools/render.mjs videos/003-my-promo --jobs 4
```

New screens: `APP_DIR=../app node tools/capture-tour.mjs assets/tour` recaptures everything, including `manifest.json` with where each element sits. Read the manifest to see which screens and element keys exist (`node -e "const m=require('./assets/tour/manifest.json'); for (const k in m) console.log(k, Object.keys(m[k].r||{}).join(' '))"`).

## `Promo.run({...})`

| Field | What it is |
|---|---|
| `assets` | Folder of the captured screens and `manifest.json`, e.g. `'../../assets/tour/'` |
| `brand` | `{ en, ur }`: the small name at the top while the tour runs |
| `open.slams` | The opening's word slams: `[[second, panel, word, urdu], ...]`. Panel `'g'` green, `'k'` black, `'p'` paper. Wrap the full stop in `<em>` to colour it. Keep words short (about 9 letters at most at 200 px; set a smaller `font-size` on a span for longer words) |
| `open.durood` | `{ ar, en }`: Arabic shown word by word (`<br>` splits the lines), then its meaning |
| `open.logo` | `{ line1, line2, ur, tag, tagUr }`: the wordmark and the black tag under it |
| `offline` | `{ title, big, small }`: the card shown over the phone in a segment with `offline: true` |
| `laptop` | The screen shown on the laptop (a capture name, e.g. `'desktop'`) |
| `mosaic` | Capture names for the rows of screens (end of the opening, and the closing wall) |
| `wall` | `{ en, ur }`: the black block over the closing mosaic |
| `finale` | `{ icon, name, ur, line, lineUr, cta, ctaUr }`: the closing card |
| `story` | The storyboard, below |

## The storyboard

A list played one after the other; each item has a duration `d` in seconds. The first item is always `{ type: 'open', d: 17.5 }` (the opening is fixed at 17.5 s) and the last is `{ type: 'final', d: ... }`.

| Item | How to write it |
|---|---|
| Chapter panel (2.4 s) | `C('03', 'Title', 'اردو', 'One line.', 'ایک سطر')`. Panels alternate green and black; the progress bar has one cell per chapter |
| Phone segment | `P(shot, seconds, [kicker, heading, urdu], steps, more)`. `shot` is a capture name. A caption left as `undefined` carries on from the segment before |
| Cover flow | `{ type: 'deck', d, cards: [shots], tags: [[en, ur], ...], cap: [...] }` |
| Laptop | `{ type: 'laptop', d, cap: [...] }` |
| Saying | `{ type: 'say', d, c: 'k' / 'g' / 'p', en, ur }`, a line on a full-bleed panel (`<em>` for the green words) |
| Closing mosaic | `{ type: 'wall', d }` (optional) |

**Steps** (inside a phone segment) move the camera and put a spotlight on one thing:

```js
{ at: 1.4, key: 'tick', en: 'Did today’s sunnah? Tick it', ur: '…', z: 1.7 }
```

| Field | Meaning |
|---|---|
| `at` | Seconds into the segment |
| `key` | An element the capture measured (`manifest.json` → `r`), or |
| `rect` | `[x, y, w, h]` in the phone's CSS pixels (390 wide). On a whole page, `y` is from the top of the page; on a single view, as on screen |
| `en`, `ur` | The callout. Leave both out for a spotlight without words |
| `z` | Zoom (1 = the whole phone). Left out, it fits the element |
| `noSpot` | Move and zoom without a spotlight |
| `scroll` | Scroll a whole page to this many px instead of centring the element |
| `d` | How long the move takes (default 0.9 s) |

**More options** on a phone segment:

| Option | Effect |
|---|---|
| `tr: 'push'` / `'fade'` / `'sheet'` / `'cut'` | How it replaces the segment before. A `cut` to the same page continues from where it was scrolled, and a `cut` with no steps keeps the camera where it was |
| `seq: { fps, max }` | Play a frame-by-frame capture (e.g. `burst`) at `fps`, stopping at frame `max` |
| `seq: { frame: 12 }` | Hold one frame of a sequence |
| `seq: { taps: true, start, every }` | Play the tap captures with a ripple on the button |
| `seq: { hold: 16 }` | Hold one tap capture |
| `wipe: 'today-dark'` | A diagonal wipe to another capture and back (light ↔ dark) |
| `flip: 'today-ur'` | The phone turns round and shows another capture (English → Urdu) |
| `offline: true` | The no-signal card over the screen |
| `flame: true` | Green stars burst from the middle (used on the streak) |
| `hit: true` | A soft impact sound at the start |

## Things learned making 002

- **Check every spotlight with stills.** A re-capture can change the order of things (the feed especially). Use a `rect` where the order may change, and a `key` where an element has its own selector.
- **Callouts sit below the spotlight when there is room**, otherwise above. Very large zooms near the bottom push the callout up over the screen, which is fine.
- **Captions need room.** Keep headings to about 30 characters; they wrap to two lines at 86 px.
- **Times are laid end to end**, so changing one duration moves everything after it. `tools/stills.mjs` prints the new timing.
- **Sound** comes from the cues the engine makes (whooshes on transitions, a thump on panels, ticks on spotlights, taps). `tools/render.mjs --silent` leaves it out.
