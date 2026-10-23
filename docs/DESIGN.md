# Design notes

## Data model (SQLite, `server/db.js`)
- `users` – profile, running totals (`total`, `team_total`, `xp`), streak state, privacy flag.
- `daily(user_id, day, count)` – one row per person per Pakistan-time day; source for weekly boards.
- `ancestors(user_id, ancestor_id, depth)` – closure table. Signup copies the referrer's ancestor rows (depth+1) and adds a self row (depth 0). A durood log updates `team_total` for every ancestor with a single `UPDATE … WHERE id IN (SELECT ancestor_id …)`.
- `events` – idempotent one-off XP grants (`lecture`, `referral`, `circle`, `quest`); the primary key stops double-claiming.
- `badges`, `lectures`, `lecture_starts`.

## Game economy (priority: durood > sunnah > seerah)
Durood is the primary activity; sunnah is a secondary quest and seerah a small bonus. All values live in `CFG` / `MILESTONE_XP` / `questState` in `server/game.js`.

| Source | XP | Tier |
|---|---|---|
| each durood | 1 | durood |
| daily goal quest | 100 | durood |
| weekly total quest (7 × daily goal) | 300 | durood |
| 5 active days in a week | 200 | durood |
| invite quest (one new person this week) | 250 | durood |
| invitee's first durood (paid to referrer) | 500 | durood / network |
| personal durood milestone (1K / 10K / 100K / 1M) | 100 / 500 / 2,500 / 10,000 | durood |
| streak badge (7 / 30 / 100 days) | 100 / 500 / 2,000 | durood |
| collective milestone: what your invitees recited together (10K / 100K / 1M / 10M) | 500 / 2,500 / 10,000 / 50,000 | durood / network |
| verified sunnah photo (poster) | 60 | sunnah |
| reviewer whose vote matches the outcome | 5 | sunnah |
| sunnah quests (post / review 3) | 30 / 15 | sunnah |
| finish a lecture | 100 (set per lecture) + 30 quest | seerah |
| claim Seerat Circle sign-up (once) | 300 | seerah |

Collective milestones count only the downline's durood (`team_total - total`), never the member's own durood a second time.
Leaderboards rank durood only; sunnah and seerah never affect ranks except through XP/level.
Level n starts at `100·(n-1)²` XP. Titles repeat the top title after level 10.

## Sincerity (riya) safeguards
Public ranking is the default by request, with a one-tap opt-out, an intention reminder on Home and Ranks, and an "improvement-only" style of quests (goals, not rank). Consider later: hide exact counts on boards, show tiers instead.

## Scaling path
1. Postgres + connection pool; keep the closure table (add index on `(ancestor_id, depth)`).
2. Redis for rate limits and cached leaderboards (refresh every 30–60 s).
3. Batch `team_total` fan-out through a queue if trees get very deep (depth × writes per log).
4. Verified sign-up (WhatsApp OTP) and abuse review queue.
