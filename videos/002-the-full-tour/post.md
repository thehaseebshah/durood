# 002 · The full tour

Every feature of Seerah Quest in one promo: 4 min 10 s, 1080 × 1920. Sound effects only, no music. Cover: `poster.jpg`.

**Style, deliberately unlike 001.** 001 is a cinematic night (gold calligraphy, the Green Dome, dark screens). 002 uses the app's own Swiss identity:
- white paper, black ink and one green, giant Inter type on a hairline grid
- the eight-point star as the moving motif
- chapters announced on hard-edged full-bleed green and black panels
- word slams in the opening and flat mosaics of screens
- a black phone with the app's hard green offset shadow, showing light-mode screens
- spotlights with crop marks, and callouts as square black blocks

A 3D phone pans and zooms across the real screens and pauses on each feature. A spotlight picks out the feature, with an English and Urdu callout. A progress bar along the top shows the nine chapters.

Every screen is a capture of the real app (`tools/capture-tour.mjs`), including the goal-burst animation, which is captured frame by frame. Every spotlight sits where the capture measured the element.

## Chapters

| Time | Chapter | What is shown |
|---|---|---|
| 0:00 | Opening | A green star fills the frame · COUNT. COMPETE. GROW. TOGETHER. slam in on green, black and white panels · the durood in Arabic, word by word, with its meaning · the **Seerah Quest.** wordmark with سیرت کوئسٹ and "The full tour" · rows of screens slide past |
| 0:17 | 01 Join · شامل ہوں | Language choice (English or اردو) · the welcome slides ("free, never asks for money") · sign-up with an invite code, "No code? Request access", city |
| 0:35 | 02 Today · آج | The big count and daily goal · typing 313 → the real goal burst: goal reached, level up, new badge 10,000 · Undo · counting by tapping (16 real taps) · +100 / +500 / +1,000 · offline: durood waits on the phone · getting started and quests · the 8-day streak |
| 1:14 | 03 Sunnah & Seerah · سنت اور سیرت | Sunnah of the day: tick it, share a photo · lecture of the week: watch, quiz, comment · daily reflection · Seerat Circles: find or teach one |
| 1:39 | 04 Feed · فیڈ | Announcements, milestones, reflections, likes that earn points, weekly city results, MashaAllah on milestones, lecture comments and replies |
| 1:58 | 05 Caravan · کارواں | Caravan totals, the caravan streak, who has recited today, accepting join requests · the Qabila and inviting on WhatsApp |
| 2:21 | 06 Compete · مقابلہ | Five leaderboards in a 3D cover flow (People, League, Caravans, Qabila, Cities) · the 40-day challenge (10 crore) · weekly leagues · city against city · tap anyone to see their profile |
| 2:51 | 07 Me · میں | This week, all time, best streak · ten titles from Musafir to Muqarrab · 35 badges · fixing today's or yesterday's count, with every change on record |
| 3:10 | 08 Yours · آپ کی اپنی | The menu · the + button on every page · a light ↔ dark wipe · the phone flips to Urdu · a laptop opens on the desktop layout · reminders, sounds, profile |
| 3:41 | 09 Trust · اعتماد | Every durood counted exactly once · install it like an app · free, never asks for money (each on its own panel) |
| 3:52 | Finale | A mosaic of every screen, "Everything, in one app." · the icon, **Seerah Quest.**, the Seerat Circles dedication and **Ask a member for an invite code** |

## Text to post

> Seerah Quest, the full tour ﷺ
> Count every durood, keep your streak, recite with your caravan, learn the Seerah week by week, and race your city to the top. 10 crore durood in 40 days, every one dedicated to the Seerat Circles across Pakistan.
> Ask a member for an invite code.
>
> سیرت کوئسٹ کا مکمل تعارف۔ ہر درود گنیں، اپنا سلسلہ قائم رکھیں، کارواں کے ساتھ پڑھیں، ہفتہ بہ ہفتہ سیرت سیکھیں اور اپنے شہر کو سب سے آگے لائیں۔ دعوتی کوڈ کسی رکن سے لیں۔

`#durood #duroodshareef #SeerahQuest #seerah #درود_شریف #سیرت #Pakistan`

## Before posting

- **Length:** 4 min 10 s. TikTok accepts it in the app (up to 10 minutes) and YouTube posts it as a normal video. Instagram Reels and WhatsApp Status take less, so cut a chapter or two there (render a part with `--from` / `--to`).
- **Check the Urdu wording with someone qualified.**
- **The people are a seeded demo**, not real members. The challenge numbers on the Compete screens (day 8, "behind plan") come from that demo too.
- **One screen is left out on purpose:** the "10,000" badge card that follows the goal burst. The app clips its big number at phone width; the video stops on the frame before it.
