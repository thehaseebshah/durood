# 002 · The full tour

Every feature of Seerah Quest in one promo: 4 min 11 s, 1080 × 1920, night-sky style. A 3D phone pans and zooms across real dark-mode screens, pauses on each feature and spotlights it with an English and Urdu callout. Nine chapters, each with a title card; a progress bar along the top shows where you are. Sound effects only, no music. Cover: `poster.jpg`.

Every screen is a capture of the real app (`tools/capture-tour.mjs`), including the goal-burst animation, which is captured frame by frame. Every spotlight sits on the position the capture measured.

## Chapters

| Time | Chapter | What is shown |
|---|---|---|
| 0:00 | Opening | Al-Ahzab 33:56 in gold over the Green Dome · "Now a whole nation answers, together." · the eight-point star unfolds into **Seerah Quest · سیرت کوئسٹ** · app screens rush past |
| 0:17 | 01 Join · شامل ہوں | Language choice (English or اردو) · the welcome slides ("free, never asks for money") · sign-up with an invite code, "No code? Request access", city |
| 0:35 | 02 Today · آج | The big count and daily goal · typing 313 → the real goal burst: goal reached, level up, new badge 10,000 · Undo · counting by tapping (16 real taps) · +100 / +500 / +1,000 · offline: durood waits on the phone · getting started and quests · the 8-day streak |
| 1:14 | 03 Sunnah & Seerah · سنت اور سیرت | Sunnah of the day: tick it, share a photo · lecture of the week: watch, quiz, comment · daily reflection · Seerat Circles: find or teach one |
| 1:39 | 04 Feed · فیڈ | Announcements, milestones, reflections, likes that earn points, weekly city results, MashaAllah on milestones, lecture comments and replies |
| 1:58 | 05 Caravan · کارواں | Caravan totals, the caravan streak, who has recited today, accepting join requests · the Qabila and inviting on WhatsApp |
| 2:21 | 06 Compete · مقابلہ | Five leaderboards in a 3D cover flow (People, League, Caravans, Qabila, Cities) · the 40-day challenge (10 crore) · weekly leagues · city against city · tap anyone to see their profile |
| 2:51 | 07 Me · میں | This week, all time, best streak · ten titles from Musafir to Muqarrab · 35 badges · fixing today's or yesterday's count, with every change on record |
| 3:10 | 08 Yours · آپ کی اپنی | The menu · the + button on every page · a dark ↔ light wipe · the phone flips to Urdu · a laptop opens on the desktop layout · reminders, sounds, profile |
| 3:41 | 09 Trust · اعتماد | Every durood counted exactly once · install it like an app · free, never asks for money |
| 3:53 | Finale | A 3D wall of every screen, then the icon, the name, the Seerat Circles dedication and **Ask a member for an invite code** |

## Text to post

> Seerah Quest, the full tour ﷺ
> Count every durood, keep your streak, recite with your caravan, learn the Seerah week by week, and race your city to the top. 10 crore durood in 40 days, every one dedicated to the Seerat Circles across Pakistan.
> Ask a member for an invite code.
>
> سیرت کوئسٹ کا مکمل تعارف۔ ہر درود گنیں، اپنا سلسلہ قائم رکھیں، کارواں کے ساتھ پڑھیں، ہفتہ بہ ہفتہ سیرت سیکھیں اور اپنے شہر کو سب سے آگے لائیں۔ دعوتی کوڈ کسی رکن سے لیں۔

`#durood #duroodshareef #SeerahQuest #seerah #درود_شریف #سیرت #Pakistan`

## Before posting

- **Length:** 4 min 11 s. TikTok accepts it in the app (up to 10 minutes) and YouTube posts it as a normal video; Instagram Reels and WhatsApp Status take less, so cut a chapter or two there (render a part with `--from` / `--to`).
- **Check the Quran text and the Urdu wording with someone qualified.** The ayah is shown without the pause mark, in plain spelling.
- **The people are a seeded demo**, not real members. The challenge numbers on the Compete screens (day 8, "behind plan") come from that demo too.
- **One screen is left out on purpose:** the "10,000" badge card that follows the goal burst. The app clips its big number at phone width (see the note in `scene.html`); the video stops on the frame before it.
- The Green Dome is a drawn silhouette, not a photograph.
