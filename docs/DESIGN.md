# Design notes

## Data model (SQLite, `server/db.js`)
- `users` – profile, running totals (`total`, `team_total`, `xp`), streak state, privacy flag.
- `daily(user_id, day, count)` – one row per person per Pakistan-time day; source for weekly boards.
- `ancestors(user_id, ancestor_id, depth)` – closure table. Signup copies the referrer's ancestor rows (depth+1) and adds a self row (depth 0). A durood log updates `team_total` for every ancestor with a single `UPDATE … WHERE id IN (SELECT ancestor_id …)`.
- `events` – idempotent one-off XP grants (`lecture`, `referral`, `circle`, `quest`); the primary key stops double-claiming.
- `badges`, `lectures`, `lecture_starts`.

## Game economy
| Source | XP |
|---|---|
| each durood | 1 |
| invitee's first durood (paid to referrer) | 500 |
| finish a lecture | 300 (configurable per lecture) |
| claim Seerat Circle sign-up | 1,000 (once) |
| daily quests | goal 50, lecture 100 |
| weekly quests | 5 active days 200, invite 250 |

Level n starts at `100·(n-1)²` XP. Titles repeat the top title after level 10.

## Sincerity (riya) safeguards
Public ranking is the default by request, with a one-tap opt-out, an intention reminder on Home and Ranks, and an "improvement-only" style of quests (goals, not rank). Consider later: hide exact counts on boards, show tiers instead.

## Scaling path
1. Postgres + connection pool; keep the closure table (add index on `(ancestor_id, depth)`).
2. Redis for rate limits and cached leaderboards (refresh every 30–60 s).
3. Batch `team_total` fan-out through a queue if trees get very deep (depth × writes per log).
4. Verified sign-up (WhatsApp OTP) and abuse review queue.
