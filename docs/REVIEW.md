# Adversarial review of Seerah Quest

Scope: the whole app as of the Step 3 commit (server, client, admin, push, data model). Method: read the code, then try to break it. Performance numbers come from synthetic databases (2,000 / 10,000 / 50,000 members, 40 days of reporting, 1.1M ledger rows at 50k) on the sandbox CPU, so read them as relative, not absolute. Not tested: real phones, real push services, real email, TLS and a reverse proxy, memory over days, true concurrent-user load.

## Verdict
Fine for the planned launch (200 to 2,000 members) **once the integrity and security items below are fixed**. It will not survive 10,000+ members without the performance fixes: one synchronous process does all the work, and a few endpoints freeze every user while they run.

## What held up
- The ledger is append-only (triggers block UPDATE/DELETE) and `audit()` reconciles every cache against it.
- All SQL is prepared; no injection path found. No cookies, so no CSRF. User text is escaped in the client and admin page (usernames are also restricted to `[a-z0-9_]`).
- A deep referral chain is cheap: badge checks cost 0.08 ms per ancestor, so depth 44 adds about 3.5 ms and depth 500 about 40 ms.
- Push encryption matches the RFC 8291 worked example byte for byte.

## Findings, worst first

### A. Integrity of the headline number (your top concern)
1. **A bad actor can inflate the 10-crore total.** Demonstrated: one fake member logged 500,000 in a day; the account was flagged and hidden from ranks, but the challenge total went 0 → 500,000. Flagged durood "still counts everywhere" by design.
   - The cap of 500,000 a day is about 83 hours of recitation at 100 a minute.
   - The public founders code has no use limit, so anyone can make many accounts (phone and email are unverified). 100 fake accounts at the cap would be 5 crore a day, half the target.
   - Sockpuppet descendants also inflate their inviter's caravan totals and the caravan boards, because flags are per person and ancestors still count the flagged durood.
   - **Fix:** count open and confirmed flags as "pending review" and leave them out of public, challenge and caravan totals until an admin clears them. Lower the daily cap (suggest 50,000, and 5,000 for the first week). Put a daily cap on public-code sign-ups. Consider phone verification.

### B. Scalability (single process, synchronous SQLite)
2. **Every log scans the whole challenge ledger.** `recordChallenge()` sums all `daily` rows since the start, after every write. Measured: 14 ms at 2k members, 107 ms at 10k, 570 ms at 50k, and it is almost all of a log's cost. Load test, 50 concurrent: 57 logs/s at 2k; 9 logs/s with p50 5.4 s at 10k, with dropped connections (ECONNRESET). **Fix:** keep a running challenge total updated inside the log and edit transactions.
3. **Heavy reads are uncached and block everyone.** At 50k: challenge caravan board 8.2 s, caravan average and growth boards 2.7 s each, weekly caravan total 1.2 s, weekly individual board 160 ms, `audit()` 5.6 s, weekly export 0.66 s. At 10k: 1.0 s, 0.3 s and 0.1 s for the first three. **Fix:** cache each board for 30 to 60 s, precompute weekly totals per member, and run `audit()` on a `VACUUM INTO` snapshot off-peak.
4. **Ceiling:** one instance only (in-process scheduler, in-memory rate limiter, SQLite on local disk). `node:sqlite` is still marked experimental. Plan to stay single-instance and make the hot paths cheap rather than scale out.
5. **Server timeouts are defaults.** Under an event-loop stall, keep-alive sockets get reset. Set `keepAliveTimeout` above the proxy's idle timeout, plus header and request timeouts.

### C. Security
6. **Rate limits key on the IP.** Behind a proxy without `TRUST_PROXY`, everyone shares one IP; on mobile carrier NAT many real people do too. Measured: 14 different people from one IP, 10 signed up, 4 were refused. With `TRUST_PROXY` the first `X-Forwarded-For` entry is trusted, so it is spoofable: 30 of 30 signups succeeded with fake addresses. **Fix:** use the platform's client-IP header or the right-most trusted hop; limit registration per invite code and per phone, and logins per account plus IP.
7. **The admin key has no brute-force protection.** 300 wrong guesses were all processed. Comparison is not constant-time. The key is the only protection for all member data and CSV exports. **Fix:** rate-limit and lock out, `timingSafeEqual`, put `/admin` behind the host's access control or an IP allowlist, use a long random key.
8. **Push endpoint is an SSRF primitive.** The server POSTs to whatever https URL a member registers. **Fix:** allow only known push hosts (FCM, Mozilla autopush, Windows, Apple).
9. **No security headers.** No CSP, `X-Frame-Options`, HSTS or `Referrer-Policy`; the admin page can be framed. **Fix:** add them in the server or at the proxy.
10. **Static server edge cases.** `GET /%` returns 500 and logs a stack trace (log spam); the path check uses `startsWith` without a separator.
11. **Sessions can't be revoked.** Tokens last 90 days. Verified: an old token still works after the password changes. **Fix:** a token version on the user, bumped on reset, change and logout.
12. **Account enumeration.** Registration reveals taken email and phone; `username-check` has no limit.
13. **Quiz is a nudge, not a check.** Wrong answers are reported per question, so a 3-question quiz was solved in 3 tries. Fine for small XP; don't treat it as proof of watching.

### D. Operations and data safety
14. **No backups exist.** The ledger is the only truth. Back up the DB (`VACUUM INTO` nightly, copied off the machine), the uploads, and `AUTH_SECRET` (losing it logs everyone out; the VAPID key lives in the DB). Test a restore.
15. **Photos.** Stored on local disk: lost on ephemeral hosts while the DB still points at them. They grow without bound (about 200 GB a year at 2,000 members posting 0.3 MB a day, my estimate) and are never deleted, not after verification and not when an account is deleted (a privacy problem: faces appear despite the rules). **Fix:** a persistent volume or object storage; delete after the post is decided plus 14 days; delete on account deletion.
16. **Email defaults to console.** With no `MAIL_PROVIDER`, reset and confirmation links are only written to the server log (which then holds live reset links). **Fix:** refuse to start in production without a provider.
17. **Push scheduler.** `setInterval` has no overlap guard; sends are sequential with a 10 s timeout each, so a slow push service can stack runs. A message is logged before sending, so a failed send is never retried. The daily reminder fires any time after the chosen hour (set 07:30 at 21:00 and it fires within a minute). **Fix:** run lock, small concurrency pool, a 3-hour window, delete the log row when a send fails.
18. **No visibility.** No health endpoint, metrics or error alerting; the audit only runs when someone opens the admin page. Add `/healthz`, structured logs and a scheduled audit.
19. **Schema changes are ad-hoc** (`addCol`, no version number). Add `PRAGMA user_version` migrations before the first real deploy.

### E. Policy risks to decide, not code
20. Everyone's username and city are public with no opt-out, phone and email are unverified, and consent is a footer link. Get a legal read for Pakistan and for diaspora members, and consider whether minors can join.
21. Sockpuppets can farm XP (500 per invitee's first log, 3-confirmation photo checks). XP has no cash value and ranks use durood only, so this is low risk.

## Status after the before-launch fixes
Fixed and tested: 1 (hold + lower caps + public-code cap; phone verification still open), 6, 7, 8, 9, 10, 11, 12 (only the username check is now rate-limited; registration still says which email or phone is taken), 14, 15 (retention and deletion; storage is still local disk, so use a persistent volume), 16, and the server timeouts in 5. The scheduler overlap guard from 17 is in; the reminder window and retry parts of 17 are not. Open: 2 and 3 (performance), 4, 13, 17 (rest), 18, 19, 20, 21.

## Status after the performance batch
Done and measured (synthetic databases, same machine, 50 concurrent clients): 2 fixed, 3 mostly fixed, 17 fixed.
- Per-day public totals (`day_totals`) replace the full challenge scan after every log. At 50,000 members a log's challenge step went from 624 ms to 0.4 ms; log throughput from about 1.6 per second to about 244 per second (10,000 members: 9 to 262 per second); `getMe` 644 ms to 8 ms.
- Boards are cached for 30 s (`PUBLIC_CACHE_MS`) and computed by adding up each member's days first, then spreading totals up the tree. Computation at 50,000 members: challenge caravan board 8.2 s to 1.6 s, caravan average and growth 2.7 s to 0.7 s, weekly caravan total 1.2 s to 0.5 s. Cached reads: about 1,400 to 2,900 per second. **Still true:** the first request after the cache expires computes the board on the main thread, so at 50,000 members one request in 30 s per board takes up to 1.6 s and pauses everyone for that long; at 10,000 it is about a fifth of that. Moving board computation to a worker is the next step if that matters.
- The audit runs on a worker thread (event-loop stall while it ran: 3 ms; it takes about 9 s at 50,000 members), nightly after 03:00 Pakistan time, and the admin page shows the last result and last backup.
- Reminders: only within three hours after the chosen time, a total failure to push is retried up to four times, sends run ten at a time.
- Not done: 4 (single instance by design), 18 (metrics), 19 (schema versions), phone verification.

## Suggested order
- **Before launch:** 1, 6, 7, 9, 10, 11, 14, 15 (retention at least), 16.
- **Before about 5,000 members:** 2, 3, 5, 17, 18.
- **Anytime:** 8, 12, 13, 19, 20.
