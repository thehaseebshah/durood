# 003 · Everything

The whole app as released (the Al-Burhan edition) in one promo, 4 min 59 s, 1080 × 1920. It covers:
- durood, Sunnah, Seerah, caravans and rankings
- **tasks, routines and deadlines**
- **My people:** murabbi and salik, masul and razakar, and teams
- **majalis**
- the Learn pages and the lecture player
- the caravan owner's "Falling behind" list, named and scheduled challenges, Message on WhatsApp, and the admin page for organisers

Built on the Swiss promo kit, in the same look as 002. Sound effects only, no music. Cover: `poster.jpg`.

Every screen is a capture of the real app (`tools/capture-full.mjs`, app commit `75f51db`). Real animations are captured frame by frame: the goal burst, ticking a task, and both swipes. The demo community is **all men, with made-up names**. Ahmed Raza is the member we follow. Bilal is his masul, Umar his murabbi, Hamza and Ali his saliks, and five razakars sit in two teams.

## Chapters

| Time | Chapter | What is shown |
|---|---|---|
| 0:00 | Opening | RECITE. ORGANISE. LEAD. TOGETHER. · the durood word by word · **Seerah Quest.** "Everything in it" · rows of screens |
| 0:17 | 01 Join | Language · free, never asks for money · sign-up with an invite code, request access, city |
| 0:31 | 02 Today | The count and the goal · typing 313 → goal burst, level up, badge 10,000 · Undo · tapping · +100/+500/+1,000 · offline · getting started and quests · the streak |
| 1:05 | 03 Tasks | Today's tasks on Today · deadlines, a late task (red ring, fewer points), own tasks 10 points, from the masul 30 points, asking for more time, routines on chosen days, done with points · ticking (points and Undo) · swipe right to finish, swipe left to move the deadline (Today / in 3 days / next week / a date) · adding a task or a routine |
| 1:45 | 04 My people | A salik's request · your saliks · your razakars in teams · filter by team · a razakar's report (tasks, routines, teams, give a new one) · a salik's report (durood, streak, badges, reflections, mamulaat) |
| 2:16 | 05 Me | This week, all time, best streak · Musafir to Muqarrab · 35 badges · your majlis · murabbi and masul, and who sees what · fixing a count, on record |
| 2:37 | 06 Learn | The Sunnah page (tick, photo, posts, community) · the Seerah page (this week's lecture, Seerat Circles, earlier lectures) · the lecture player and its quiz · the daily reflection question |
| 3:00 | 07 Feed | News, milestones, reflections, likes that earn points, MashaAllah, weekly city results |
| 3:15 | 08 Caravan | Totals, the caravan streak, who has recited, join requests · the owner's Falling behind list · the Qabila, invites on WhatsApp, more invites as you grow |
| 3:39 | 09 Compete | Six boards in a cover flow (People, League, Caravans, Qabila, Cities, Majalis) · the named challenge and the next one · majlis against majlis · a profile with Message on WhatsApp |
| 4:03 | 10 Yours | The menu · the + button · light ↔ dark · Tasks flips to Urdu · the laptop shows Tasks · photo, sounds, reminders |
| 4:31 | 11 Organisers | The admin page: challenges, invites, waitlist, content, members |
| 4:39 | 12 Trust | Counted exactly once · free |
| 4:47 | Finale | The mosaic, "Everything, in one app." · Seerah Quest · invite code |

## Text to post

> Everything in Seerah Quest, in five minutes ﷺ
> Count your durood. Keep your tasks and routines. Guide your saliks and razakars. Learn the Seerah week by week. Recite with your caravan and race your city and majlis to the top.
> Ask a member for an invite code.
>
> سیرت کوئسٹ، پانچ منٹ میں۔ درود گنیں، اپنے کام اور معمولات سنبھالیں، اپنے سالکین اور رضاکاروں کی رہنمائی کریں، ہفتہ بہ ہفتہ سیرت سیکھیں، کارواں کے ساتھ پڑھیں اور اپنے شہر اور مجلس کو سب سے آگے لائیں۔ دعوتی کوڈ کسی رکن سے لیں۔

`#durood #duroodshareef #SeerahQuest #seerah #درود_شریف #سیرت`

## Before posting

- **This shows the Al-Burhan edition.** Tasks, My people, murabbi and masul, mamulaat and majalis are only in that edition. For a public audience, post 002 instead.
- **Data is a demo:**
  - The mamulaat percentages come from a stand-in for the Mamulaat app.
  - The challenge numbers ("day 9", "behind plan") and the phone numbers and emails in the salik report are all made up.
- **The lecture player shows a plain dark screen with a play button** instead of a YouTube video, because the demo lecture has no real video.
- **Two things are left out on purpose:**
  - The "10,000" badge card after the goal burst: the app clips its big number at phone width.
  - The yellow "email not confirmed" box in Settings, which is only touched in passing.
- **Have someone check the Urdu wording.**
- **Length:** 4:59 suits TikTok and YouTube. Cut chapters for Reels or WhatsApp Status (`--from` / `--to`).
