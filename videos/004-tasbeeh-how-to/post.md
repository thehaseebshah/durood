# 004 · How to add your tasbeeh

A how-to guide for the **Tasbeeh** page (branch `tasbeeh-cloudflare`): 62 s, 1080 × 1920, English with Urdu on every line. Night navy and gold, the page's own colours, with a ring of 33 beads that counts through the intro and the end. Sound effects only. Cover: `poster.jpg`.

Every screen is the real page (`tools/capture-tasbeeh.mjs`, app commit `390b631`), running the real Worker on a seeded demo community, typed one character at a time. The member we follow is Ahmed Raza, 0300 1234567, Lahore (made up).

## Steps

| Time | On screen | Words |
|---|---|---|
| 0:00 | Bead ring, title | How to add your tasbeeh · اپنی تسبیح کیسے درج کریں · 5 easy steps, under a minute |
| 0:04 | Step 1: the page opens | Open the Tasbeeh link you were sent. No app to install. No password. |
| 0:09 | Step 2: the number is typed | Type your phone number. Your number is how the page knows you. |
| 0:13 | Step 3: name and city appear; Ahmed Raza, Lahore | First time only: a new number asks for your name and city. Asked once. Outside Pakistan? Choose "Other". |
| 0:22 | Step 4: 313 is typed, Add is tapped | Type today's count, then press Add. |
| 0:28 | Step 5: the totals, one box at a time | Today (yours big, everyone's under it) · this week, from Monday · everyone together towards the target |
| 0:39 | Next time: number, "Welcome back.", 100, Add | Just your number and your count. It all adds up: 313 + 100 = 413. |
| 0:50 | Good to know | Add as often as you like · pressed Add twice? It counts once · days follow Pakistan time, weeks start on Monday |
| 0:57 | End | JazakAllah. Every count you add joins everyone's target. |

## Text to post

> How to add your tasbeeh, in under a minute: open the link, type your phone number and today's count, press Add. The first time it also asks your name and city.
>
> اپنی تسبیح ایک منٹ میں درج کریں: لنک کھولیں، اپنا فون نمبر اور آج کی تعداد لکھیں اور Add دبائیں۔ پہلی بار نام اور شہر بھی پوچھا جائے گا۔

Send the Tasbeeh link with it.

## Before posting

- **The target on screen is 100,000,000**, the branch's default (`TARGET` in `wrangler.toml`). The words never say a number, so the video stays right if you change it; the screens would need recapturing to show a different target.
- **The totals are a demo community**, seeded over the past weeks.
- **The page's font is shown as Inter.** The page uses the phone's own font, and the capture machine has none, so Inter (close to the iPhone's) stands in.
- **Have someone check the Urdu wording.**
- Recapture after the page changes: `APP_DIR=../tasbeeh node tools/capture-tasbeeh.mjs assets/tasbeeh`, then `node tools/render.mjs videos/004-tasbeeh-how-to --jobs 4`.
