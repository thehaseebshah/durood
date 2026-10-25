import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_KEY = 'test-admin';
process.env.REG_LIMIT_PER_HOUR = '1000';
process.env.MAX_DAILY_NEW = '50000'; // first-week limit is tested on its own
process.env.PUBLIC_CACHE_MS = '0';
process.env.PUBLIC_FOUNDERS_CODE = 'TESTFOUND';

const { createServer } = await import('../server/index.js');
const { db } = await import('../server/db.js');
const { audit } = await import('../server/audit.js');
const { dayOf, weekStart } = await import('../server/game.js');
const { outbox } = await import('../server/mail.js');

let server, base, n = 0;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  if (path === '/api/log' && body && body.rid === undefined) body = { ...body, rid: crypto.randomUUID() };
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const A = { 'x-admin-key': 'test-admin' };
const admin = (m, p, body) => api(m, '/api/admin' + p, { headers: A, body });
const signup = (username, invite = 'TESTFOUND', extra = {}) => {
  n += 1;
  return api('POST', '/api/register', { body: { username, email: `${username}@x.pk`, phone: `0302${String(3000000 + n)}`, password: 'secret1', cityId: 1172451, invite, ...extra } });
};
const shift = (day, d) => new Date(Date.parse(day + 'T00:00:00Z') + d * 86400e3).toISOString().slice(0, 10);
const uid = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;

// writes a past day straight into the ledger and its caches, consistently, so edits and spikes can be tested
function seedDay(username, daysAgo, count) {
  const id = uid(username), day = shift(dayOf(), -daysAgo);
  db.prepare('INSERT INTO entries (user_id, day, count, rid, created_at) VALUES (?,?,?,?,?)').run(id, day, count, `seed-${username}-${daysAgo}-${crypto.randomUUID()}`, Date.now());
  db.prepare('INSERT INTO daily (user_id, day, count) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count').run(id, day, count);
  db.prepare('UPDATE users SET total = total + ?, xp = xp + ? WHERE id = ?').run(count, count, id);
  db.prepare('INSERT INTO day_totals (day, total) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET total = total + excluded.total').run(day, count);
  db.prepare('UPDATE users SET team_total = team_total + ? WHERE id IN (SELECT ancestor_id FROM ancestors WHERE user_id = ?)').run(count, id);
  return db.prepare('SELECT MAX(id) id FROM entries WHERE user_id = ?').get(id).id;
}

test('sign-up needs an invite code; the public founders code works and an admin can switch it off', async () => {
  assert.equal((await signup('no_code', '')).error, 'invite_required');
  assert.equal((await signup('bad_code', 'NOPE1234')).error, 'bad_invite');
  const ok = await signup('founder_a', 'testfound');
  assert.ok(ok.token, 'case-insensitive');
  assert.equal(db.prepare("SELECT invited_via FROM users WHERE username = 'founder_a'").get().invited_via, 'public');
  assert.equal((await api('GET', '/api/invite-check?code=TESTFOUND')).valid, true);
  await admin('POST', '/public-code', { enabled: false });
  assert.equal((await signup('founder_b')).error, 'bad_invite');
  assert.equal((await api('GET', '/api/invite-check?code=TESTFOUND')).valid, false);
  await admin('POST', '/public-code', { enabled: true });
  assert.ok((await signup('founder_b')).token);
  assert.equal((await api('GET', '/api/admin/invites')).status, 403);
});

test('founder codes: issued by an admin, limited uses, revocable, roots of their own caravan', async () => {
  const f = await admin('POST', '/invites', { label: 'Lahore lead', maxUses: 2 });
  assert.match(f.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const first = await signup('lahore_1', f.code);
  assert.ok(first.token);
  assert.equal(db.prepare("SELECT referrer_id, invited_via FROM users WHERE username = 'lahore_1'").get().referrer_id, null);
  assert.ok((await signup('lahore_2', f.code.toLowerCase().replace('-', ''))).token);
  assert.equal((await signup('lahore_3', f.code)).error, 'invite_used');
  const g = await admin('POST', '/invites', { label: 'to revoke' });
  assert.ok((await signup('rev_ok', g.code)).token);
  await admin('POST', `/invites/${g.code}/revoke`);
  assert.equal((await signup('rev_no', g.code)).error, 'invite_revoked');
  const list = await admin('GET', '/invites');
  assert.equal(list.invites.find((i) => i.code === f.code).joined, 2);
});

test('waitlist: request, admin approves into a single-use code, rejection and repeats are handled', async () => {
  assert.equal((await api('POST', '/api/waitlist', { body: { name: 'A', phone: '0300 1111111' } })).error, 'bad_name');
  assert.equal((await api('POST', '/api/waitlist', { body: { name: 'Sara Khan', phone: 'abc' } })).error, 'bad_phone');
  assert.equal((await api('POST', '/api/waitlist', { body: { name: 'Sara Khan', phone: '0300 1111111', email: 'sara@x.pk', city: 'Multan' } })).ok, true);
  assert.equal((await api('POST', '/api/waitlist', { body: { name: 'Sara Khan', phone: '03001111111' } })).ok, true); // repeat looks the same
  const list = await admin('GET', '/waitlist');
  assert.equal(list.requests.length, 1);
  assert.equal(list.requests[0].phone, '+923001111111');
  outbox.length = 0;
  const ap = await admin('POST', `/waitlist/${list.requests[0].id}`, { action: 'approve' });
  assert.match(ap.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(ap.emailed, false); // the test server only logs mail, and says so
  assert.equal(ap.mailOff, true);
  assert.ok(outbox.some((m) => m.to === 'sara@x.pk' && m.text.includes(ap.code)));
  assert.ok((await signup('sara_k', ap.code)).token);
  assert.equal((await signup('sara_k2', ap.code)).error, 'invite_used');
  assert.equal((await admin('POST', `/waitlist/${list.requests[0].id}`, { action: 'approve' })).error, 'already_resolved');
  await api('POST', '/api/waitlist', { body: { name: 'No Thanks', phone: '03002222222' } });
  const w2 = (await admin('GET', '/waitlist')).requests[0];
  assert.equal((await admin('POST', `/waitlist/${w2.id}`, { action: 'reject' })).ok, true);
  assert.equal((await admin('GET', '/waitlist?status=rejected')).requests.length, 1);
});

test('member invite cap: 10 to start, more for level, active invitees and streaks; suspended members cannot invite', async () => {
  const host = await signup('host_m');
  const st = (await api('GET', '/api/me', { token: host.token })).invites;
  assert.deepEqual([st.cap, st.used, st.left, st.nextAt], [10, 0, 10, 7]);
  assert.deepEqual(st.from, { start: 10, level: 0, active: 0, streak: 0 });
  for (let i = 0; i < 10; i++) assert.ok((await signup(`kid_${i}`, 'host_m')).token, `invite ${i}`);
  assert.equal((await signup('kid_x', 'host_m')).error, 'invite_full');
  assert.equal((await api('GET', '/api/invite-check?code=host_m')).valid, false);
  db.prepare("UPDATE users SET best_streak = 7 WHERE username = 'host_m'").run();
  const me = await api('GET', '/api/me', { token: host.token });
  assert.deepEqual([me.invites.cap, me.invites.used, me.invites.left, me.invites.nextAt], [20, 10, 10, 14]);
  assert.ok((await signup('kid_x', 'host_m')).token);
  db.prepare("UPDATE users SET best_streak = 21 WHERE username = 'host_m'").run();
  assert.equal((await api('GET', '/api/me', { token: host.token })).invites.cap, 40);
  // points: level 3 (400 points) adds 2 levels x 3
  db.prepare("UPDATE users SET xp = 400 WHERE username = 'host_m'").run();
  assert.equal((await api('GET', '/api/me', { token: host.token })).invites.cap, 46);
  // each invitee who reaches 100 durood adds 2
  db.prepare("UPDATE users SET total = 100 WHERE username IN ('kid_0', 'kid_1')").run();
  const g = (await api('GET', '/api/me', { token: host.token })).invites;
  assert.equal(g.cap, 50); assert.equal(g.from.active, 4);
  db.prepare("UPDATE users SET xp = 0, total = 0 WHERE username IN ('host_m', 'kid_0', 'kid_1')").run();
  // founder-code and waitlist members never use up anyone's cap
  assert.equal((await api('GET', '/api/me', { token: (await signup('free_m')).token })).invites.used, 0);
});

test('who invited you: a member who joined with a founder code links to their inviter once, early, and the tree and reward follow', async () => {
  const grand = await signup('lk_grand'), host = await signup('lk_host', 'lk_grand'), kid = await signup('lk_kid');
  assert.equal((await api('GET', '/api/me', { token: kid.token })).canLinkInviter, true);
  await api('POST', '/api/log', { token: kid.token, body: { count: 150 } });
  assert.equal((await api('POST', '/api/me/inviter', { token: kid.token, body: { username: 'lk_kid' } })).error, 'inviter_unknown');
  assert.equal((await api('POST', '/api/me/inviter', { token: kid.token, body: { username: 'nobody_here' } })).error, 'inviter_unknown');
  const r = await api('POST', '/api/me/inviter', { token: kid.token, body: { username: '@lk_host' } });
  assert.equal(r.inviter, 'lk_host'); assert.equal(r.me.inviter, 'lk_host'); assert.equal(r.me.canLinkInviter, false);
  const h = await api('GET', '/api/me', { token: host.token });
  assert.equal(h.team.direct, 1); assert.equal(h.team.total, 150);
  assert.equal(h.xp, 750); // the referral reward (500) and the weekly invite quest (250), as if the code had been used
  assert.equal(h.invites.used, 1); assert.equal(h.invites.from.active, 2);
  assert.equal((await api('GET', '/api/me', { token: grand.token })).team.total, 150); // the whole line above gets the total
  // only once
  assert.equal((await api('POST', '/api/me/inviter', { token: kid.token, body: { username: 'lk_grand' } })).error, 'link_closed');
  // not after 14 days, and not once someone joined through you
  const late = await signup('lk_late');
  db.prepare("UPDATE users SET created_at = ? WHERE username = 'lk_late'").run(Date.now() - 15 * 864e5);
  assert.equal((await api('POST', '/api/me/inviter', { token: late.token, body: { username: 'lk_host' } })).error, 'link_closed');
  const top = await signup('lk_top'); await signup('lk_under', 'lk_top');
  assert.equal((await api('POST', '/api/me/inviter', { token: top.token, body: { username: 'lk_host' } })).error, 'link_closed');
  assert.deepEqual(audit().problems, []);
});

test('streak points: the daily streak quest pays more the longer the streak, once the day reaches 100, and edits take it back', async () => {
  const m = await signup('stk_m'), id = uid('stk_m');
  let me = await api('GET', '/api/me', { token: m.token });
  let q = me.quests.find((x) => x.id === 'streak');
  assert.deepEqual([q.streakDay, q.xp, q.goal, q.done], [1, 5, 100, false]);
  await api('POST', '/api/log', { token: m.token, body: { count: 50 } });
  assert.equal((await api('GET', '/api/me', { token: m.token })).quests.find((x) => x.id === 'streak').done, false); // under 100: not yet
  await api('POST', '/api/log', { token: m.token, body: { count: 50 } });
  assert.equal((await api('GET', '/api/me', { token: m.token })).quests.find((x) => x.id === 'streak').done, true);
  // a member on day 12 of a streak, reciting today: 60 points; day 40 is capped at 150
  const day = dayOf(), yesterday = shift(day, -1);
  db.prepare("DELETE FROM daily WHERE user_id = ? AND day = ?").run(id, yesterday);
  const k = await signup('stk_k'), kid = uid('stk_k');
  db.prepare('UPDATE users SET streak = 11, last_day = ? WHERE id = ?').run(yesterday, kid);
  q = (await api('GET', '/api/me', { token: k.token })).quests.find((x) => x.id === 'streak');
  assert.deepEqual([q.streakDay, q.xp], [12, 60]);
  db.prepare('UPDATE users SET streak = 39 WHERE id = ?').run(kid);
  q = (await api('GET', '/api/me', { token: k.token })).quests.find((x) => x.id === 'streak');
  assert.deepEqual([q.streakDay, q.xp], [40, 150]);
  const before = (await api('GET', '/api/me', { token: k.token })).xp;
  const r = await api('POST', '/api/log', { token: k.token, body: { count: 120 } });
  me = await api('GET', '/api/me', { token: k.token });
  assert.equal(me.streak, 40);
  assert.ok(me.xp - before >= 120 + 150, `gained ${me.xp - before}`);
  // edited down under 100: the streak points go back
  const h = await api('GET', '/api/history', { token: k.token });
  const entry = h.days[0].entries[0];
  await api('PATCH', `/api/entries/${entry.id}`, { token: k.token, body: { count: 20 } });
  assert.equal((await api('GET', '/api/me', { token: k.token })).quests.find((x) => x.id === 'streak').done, false);
  assert.deepEqual(audit().problems, []);
});

test('undo: an entry edited to 0 is removed; totals, quests and history follow, and the ledger stays exact', async () => {
  const m = await signup('undo_m');
  const r = await api('POST', '/api/log', { token: m.token, body: { count: 3130 } });
  assert.ok(r.entryId);
  assert.equal(r.me.today, 3130);
  assert.ok(r.me.quests.find((q) => q.id === 'goal').done);
  const u = await api('PATCH', `/api/entries/${r.entryId}`, { token: m.token, body: { count: 0, rid: 'undo-test-rid-1' } });
  assert.equal(u.me.today, 0); assert.equal(u.me.total, 0);
  assert.equal(u.me.quests.find((q) => q.id === 'goal').done, false); // the goal quest it paid is taken back
  assert.equal(u.history.days.flatMap((d) => d.entries).length, 0); // the entry is gone from the history
  assert.equal((await api('PATCH', `/api/entries/${r.entryId}`, { token: m.token, body: { count: 0, rid: 'undo-test-rid-2' } })).error, 'entry_superseded'); // only once
  assert.equal((await api('PATCH', `/api/entries/${r.entryId}`, { token: m.token, body: { count: -5, rid: 'undo-test-rid-3' } })).error, 'bad_count');
  // an invited member's only entry taken back: the inviter's Qabila no longer counts them as active, and nothing is left over
  const kid = await signup('undo_kid', 'undo_m');
  const k = await api('POST', '/api/log', { token: kid.token, body: { count: 40 } });
  assert.equal((await api('GET', '/api/me', { token: m.token })).team.total, 40);
  await api('PATCH', `/api/entries/${k.entryId}`, { token: kid.token, body: { count: 0, rid: 'undo-test-kid-1' } });
  assert.equal((await api('GET', '/api/me', { token: m.token })).team.total, 0);
  assert.deepEqual(audit().problems, []);
});

test('suspending a member, or a whole branch, locks them out but keeps their durood in the totals', async () => {
  const root = await signup('branch_root');
  const kid = await signup('branch_kid', 'branch_root');
  const grand = await signup('branch_grand', 'branch_kid');
  const other = await signup('branch_other');
  await api('POST', '/api/log', { token: grand.token, body: { count: 500 } });
  const before = (await api('GET', '/api/public')).total;
  assert.equal((await admin('POST', '/members/branch_kid', { action: 'suspend', branch: true })).affected, 2);
  assert.equal((await api('POST', '/api/login', { body: { id: 'branch_grand', password: 'secret1' } })).error, 'suspended');
  assert.equal((await api('GET', '/api/me', { token: kid.token })).error, 'suspended');
  assert.ok((await api('GET', '/api/me', { token: root.token })).username, 'the root is untouched');
  assert.equal((await signup('via_kid', 'branch_kid')).error, 'bad_invite');
  const board = await api('GET', '/api/leaderboard?type=users&period=all', { token: other.token });
  assert.ok(!board.rows.some((r) => r.username === 'branch_grand'));
  assert.equal((await api('GET', '/api/public')).total, before, 'totals are unchanged');
  await admin('POST', '/members/branch_kid', { action: 'unsuspend', branch: true });
  assert.ok((await api('POST', '/api/login', { body: { id: 'branch_grand', password: 'secret1' } })).token);
  assert.deepEqual(audit().problems, []);
});

test('editing an entry: reversing entry plus replacement, caches follow, history shows the change', async () => {
  const root = await signup('ed_root');
  const u = await signup('ed_user', 'ed_root');
  const log = await api('POST', '/api/log', { token: u.token, body: { count: 3000 } });
  assert.equal(log.me.today, 3000);
  let h = await api('GET', '/api/history', { token: u.token });
  assert.equal(h.days[0].total, 3000);
  const entry = h.days[0].entries[0];
  assert.equal(entry.count, 3000);

  const rid = 'edit-test-0001';
  const e1 = await api('PATCH', `/api/entries/${entry.id}`, { token: u.token, body: { count: 300, rid } });
  assert.equal(e1.me.today, 300);
  assert.equal(e1.me.total, 300);
  const rootMe = await api('GET', '/api/me', { token: root.token });
  assert.equal(rootMe.team.total, 300, 'caravan totals follow the edit');
  const again = await api('PATCH', `/api/entries/${entry.id}`, { token: u.token, body: { count: 300, rid } });
  assert.equal(again.duplicate, true);
  assert.equal(again.me.today, 300, 'a retry is counted once');

  h = e1.history;
  const now = h.days[0].entries;
  assert.equal(now.length, 1);
  assert.equal(now[0].count, 300);
  assert.equal(now[0].original, 3000);
  assert.deepEqual(now[0].edits.map((x) => [x.from, x.to]), [[3000, 300]]);
  assert.equal((await api('PATCH', `/api/entries/${entry.id}`, { token: u.token, body: { count: 50 } })).error, 'entry_superseded');
  const e2 = await api('PATCH', `/api/entries/${now[0].id}`, { token: u.token, body: { count: 313 } });
  assert.deepEqual(e2.history.days[0].entries[0].edits.map((x) => [x.from, x.to]), [[3000, 300], [300, 313]]);
  assert.equal((await api('PATCH', `/api/entries/${now[0].id}`, { token: u.token, body: { count: 313 } })).error, 'entry_superseded');
  const cur = e2.history.days[0].entries[0].id;
  assert.equal((await api('PATCH', `/api/entries/${cur}`, { token: u.token, body: { count: 313 } })).error, 'no_change');
  assert.equal((await api('PATCH', `/api/entries/${cur}`, { token: u.token, body: { count: -1 } })).error, 'bad_count'); // (0 removes an entry: see the undo test)
  assert.equal((await api('PATCH', `/api/entries/${cur}`, { token: u.token, body: { count: 1.5 } })).error, 'bad_count');
  assert.equal((await api('PATCH', `/api/entries/${cur}`, { token: u.token, body: { count: 100001 } })).error, 'bad_count');
  const stranger = await signup('ed_stranger');
  assert.equal((await api('PATCH', `/api/entries/${cur}`, { token: stranger.token, body: { count: 5 } })).error, 'not_found');
  assert.deepEqual(audit().problems, []);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM entries WHERE user_id = ?").get(uid('ed_user')).n, 5, 'original + 2 edits x 2 rows, nothing erased');
});

test('edit window: yesterday is editable, anything older is locked; the daily cap still applies', async () => {
  const u = await signup('win_user');
  // on a Monday, yesterday is in last week, which an earlier test's durood has already closed (closed weeks are locked by design); reopen it so this checks the edit window alone
  db.prepare('DELETE FROM settings WHERE key = ?').run(`week_closed:${weekStart(shift(dayOf(), -1))}`);
  const yEntry = seedDay('win_user', 1, 400);
  const oldEntry = seedDay('win_user', 3, 400);
  const day2 = seedDay('win_user', 2, 400);
  const h = await api('GET', '/api/history', { token: u.token });
  const yDay = h.days.find((d) => d.day === shift(dayOf(), -1));
  assert.equal(yDay.editable, true);
  assert.equal(h.days.find((d) => d.day === shift(dayOf(), -2)).editable, false);
  const ok = await api('PATCH', `/api/entries/${yEntry}`, { token: u.token, body: { count: 250 } });
  assert.equal(ok.history.days.find((d) => d.day === yDay.day).total, 250);
  assert.equal((await api('PATCH', `/api/entries/${day2}`, { token: u.token, body: { count: 250 } })).error, 'edit_window');
  assert.equal((await api('PATCH', `/api/entries/${oldEntry}`, { token: u.token, body: { count: 250 } })).error, 'edit_window');
  seedDay('win_user', 1, 49_000);                        // yesterday is now close to the 50,000 daily cap
  const small = seedDay('win_user', 1, 100);
  assert.equal((await api('PATCH', `/api/entries/${small}`, { token: u.token, body: { count: 20_000 } })).error, 'daily_cap');
  assert.equal((await api('PATCH', `/api/entries/${small}`, { token: u.token, body: { count: 50 } })).history.days.find((d) => d.day === yDay.day).entries.length, 3, 'editing down is always allowed');
  assert.deepEqual(audit().problems, [], 'edits to yesterday keep the ledger consistent');
});

test('flags: over 20,000 in a day hides the member from ranks until an admin reviews; clear, confirm, hide, unhide', async () => {
  const u = await signup('flag_big');
  const watcher = await signup('flag_watcher');
  await api('POST', '/api/log', { token: u.token, body: { count: 15000 } });
  assert.equal((await api('GET', '/api/me', { token: u.token })).hiddenFromRanks, false);
  const r = await api('POST', '/api/log', { token: u.token, body: { count: 6000 } });
  assert.equal(r.me.hiddenFromRanks, true);
  assert.equal(r.me.total, 21000, 'still counted');
  let board = await api('GET', '/api/leaderboard?type=users&period=week', { token: watcher.token });
  assert.ok(!board.rows.some((x) => x.username === 'flag_big'));
  const open = (await admin('GET', '/flags')).flags.filter((f) => f.username === 'flag_big');
  assert.equal(open.length, 1);
  assert.equal(open[0].reason, 'daily_20k');
  await admin('POST', `/flags/${open[0].id}`, { action: 'clear' });
  assert.equal((await api('GET', '/api/me', { token: u.token })).hiddenFromRanks, false);
  board = await api('GET', '/api/leaderboard?type=users&period=week', { token: watcher.token });
  assert.ok(board.rows.some((x) => x.username === 'flag_big'), 'visible again once cleared');

  const v = await signup('flag_conf');
  await api('POST', '/api/log', { token: v.token, body: { count: 30000 } }).catch(() => {});
  await api('POST', '/api/log', { token: v.token, body: { count: 100 } });
  const fv = (await admin('GET', '/flags')).flags.find((f) => f.username === 'flag_conf');
  await admin('POST', `/flags/${fv.id}`, { action: 'confirm' });
  assert.equal((await api('GET', '/api/me', { token: v.token })).hiddenFromRanks, true);
  await admin('POST', '/members/flag_conf', { action: 'unhide' });
  assert.equal((await api('GET', '/api/me', { token: v.token })).hiddenFromRanks, false);
  await admin('POST', '/members/flag_big', { action: 'hide' });
  assert.equal((await api('GET', '/api/me', { token: u.token })).hiddenFromRanks, true);
  await admin('POST', '/members/flag_big', { action: 'unhide' });
  assert.deepEqual(audit().problems, []);
});

test('flags: a 10x spike over the recent average is flagged for established members only, with a floor', async () => {
  const u = await signup('spike_u');
  for (let d = 1; d <= 7; d++) seedDay('spike_u', d, 100);          // average 100 a day
  db.prepare("UPDATE users SET created_day = ? WHERE username = 'spike_u'").run(shift(dayOf(), -10));
  await api('POST', '/api/log', { token: u.token, body: { count: 1500 } });
  assert.equal((await api('GET', '/api/me', { token: u.token })).hiddenFromRanks, false, 'below the 2,000 floor');
  const r = await api('POST', '/api/log', { token: u.token, body: { count: 600 } });  // 2,100 > 10 x 100
  assert.equal(r.me.hiddenFromRanks, true);
  assert.equal((await admin('GET', '/flags')).flags.find((f) => f.username === 'spike_u').reason, 'spike_10x');

  const fresh = await signup('fresh_spike');
  const rf = await api('POST', '/api/log', { token: fresh.token, body: { count: 5000 } });
  assert.equal(rf.me.hiddenFromRanks, false, 'new members are only flagged above 20,000');
  const back = await signup('spike_back');                          // returning after a quiet week: no baseline, no spike flag
  db.prepare("UPDATE users SET created_day = ? WHERE username = 'spike_back'").run(shift(dayOf(), -30));
  assert.equal((await api('POST', '/api/log', { token: back.token, body: { count: 5000 } })).me.hiddenFromRanks, false);
});

test('an edit that pushes a day over 20,000 is flagged too', async () => {
  const u = await signup('edit_flag');
  const first = await api('POST', '/api/log', { token: u.token, body: { count: 100 } });
  const id = (await api('GET', '/api/history', { token: u.token })).days[0].entries[0].id;
  const r = await api('PATCH', `/api/entries/${id}`, { token: u.token, body: { count: 25000 } });
  assert.equal(first.me.hiddenFromRanks, false);
  assert.equal(r.me.hiddenFromRanks, true);
});

test('password reset: link by email, single use, expires, same answer for unknown addresses', async () => {
  const u = await signup('reset_u');
  outbox.length = 0;
  const unknown = await api('POST', '/api/password/forgot', { body: { email: 'nobody@x.pk' } });
  assert.equal(unknown.ok, true);
  assert.equal(outbox.length, 0, 'no email for an unregistered address');
  assert.equal((await api('POST', '/api/password/forgot', { body: { email: 'bad' } })).error, 'bad_email');
  assert.equal((await api('POST', '/api/password/forgot', { body: { email: 'reset_u@x.pk' } })).ok, true);
  const mail = outbox.find((m) => m.to === 'reset_u@x.pk' && m.subject.startsWith('Reset'));
  assert.ok(mail, 'a reset email was sent');
  const token = /\?reset=([\w-]+)/.exec(mail.text)[1];
  assert.equal((await api('POST', '/api/password/reset', { body: { token, password: 'abc' } })).error, 'bad_password');
  assert.equal((await api('POST', '/api/password/reset', { body: { token: 'garbage', password: 'newpass1' } })).error, 'bad_token');
  const done = await api('POST', '/api/password/reset', { body: { token, password: 'newpass1' } });
  assert.ok(done.token);
  assert.equal((await api('POST', '/api/login', { body: { id: 'reset_u', password: 'secret1' } })).status, 401);
  assert.ok((await api('POST', '/api/login', { body: { id: 'reset_u', password: 'newpass1' } })).token);
  assert.equal((await api('POST', '/api/password/reset', { body: { token, password: 'again123' } })).error, 'bad_token', 'single use');

  await api('POST', '/api/password/forgot', { body: { email: 'reset_u@x.pk' } });
  const t2 = /\?reset=([\w-]+)/.exec(outbox.filter((m) => m.to === 'reset_u@x.pk' && m.subject.startsWith('Reset')).at(-1).text)[1];
  db.prepare('UPDATE tokens SET expires_at = ?').run(Date.now() - 1000);
  assert.equal((await api('POST', '/api/password/reset', { body: { token: t2, password: 'late1234' } })).error, 'bad_token', 'expired');
  // an admin can also hand over a link when email fails
  const link = await admin('POST', '/members/reset_u', { action: 'reset-link' });
  assert.match(link.url, /\?reset=[\w-]+/);
  assert.ok(u.token);
});

test('email confirmation: a link is sent at sign-up, never blocks login, and confirms the address', async () => {
  outbox.length = 0;
  const u = await signup('conf_u');
  assert.equal(u.me.emailVerified, false);
  assert.ok((await api('POST', '/api/login', { body: { id: 'conf_u', password: 'secret1' } })).token, 'login works unconfirmed');
  const mail = outbox.find((m) => m.to === 'conf_u@x.pk' && m.subject.startsWith('Confirm'));
  const token = /\?confirm=([\w-]+)/.exec(mail.text)[1];
  assert.equal((await api('POST', '/api/email/confirm', { body: { token } })).ok, true);
  assert.equal((await api('GET', '/api/me', { token: u.token })).emailVerified, true);
  assert.equal((await api('POST', '/api/email/confirm', { body: { token } })).error, 'bad_token');
  outbox.length = 0;
  const changed = await api('PATCH', '/api/me', { token: u.token, body: { email: 'conf_new@x.pk' } });
  assert.equal(changed.error, 'password_needed', 'a stolen session cannot change the email without the password');
  const changed2 = await api('PATCH', '/api/me', { token: u.token, body: { email: 'conf_new@x.pk', password: 'secret1' } });
  assert.equal(changed2.emailVerified, false, 'a new address must be confirmed again');
  assert.ok(outbox.some((m) => m.to === 'conf_new@x.pk'));
  assert.equal((await api('PATCH', '/api/me', { token: u.token, body: { email: 'reset_u@x.pk', password: 'secret1' } })).error, 'email_taken');
});

test('deleting an account anonymises the person but keeps their durood in every total', async () => {
  const root = await signup('del_root');
  const u = await signup('del_user', 'del_root');
  const kid = await signup('del_kid', 'del_user');
  await api('POST', '/api/log', { token: u.token, body: { count: 800 } });
  await api('POST', '/api/log', { token: kid.token, body: { count: 200 } });
  const before = await api('GET', '/api/public');
  const rootBefore = (await api('GET', '/api/me', { token: root.token })).team.total;
  assert.equal((await api('DELETE', '/api/me', { token: u.token, body: { password: 'wrong' } })).status, 401);
  assert.equal((await api('DELETE', '/api/me', { token: u.token, body: { password: 'secret1' } })).ok, true);
  const gone = db.prepare("SELECT * FROM users WHERE deleted_at IS NOT NULL ORDER BY id DESC LIMIT 1").get();
  assert.match(gone.username, /^member_\d+$/);
  assert.match(gone.email, /@deleted\.invalid$/);
  assert.equal(gone.city, '');
  assert.equal((await api('POST', '/api/login', { body: { id: 'del_user', password: 'secret1' } })).status, 401);
  assert.equal((await api('GET', '/api/me', { token: u.token })).status, 401);
  const after = await api('GET', '/api/public');
  assert.equal(after.total, before.total, 'national durood unchanged');
  assert.equal(after.members, before.members - 1, 'members exclude the anonymised account');
  assert.equal((await api('GET', '/api/me', { token: root.token })).team.total, rootBefore, 'caravan totals unchanged');
  assert.equal((await signup('via_deleted', 'del_user')).error, 'bad_invite');
  assert.equal((await signup('member_77')).error, 'bad_username', 'member_<id> is reserved for anonymised accounts');
  const board = await api('GET', '/api/leaderboard?type=users&period=all', { token: root.token });
  assert.ok(!board.rows.some((r) => /^member_\d+$/.test(r.username)));
  assert.equal(db.prepare('SELECT referrer_id FROM users WHERE username = ?').get('del_kid').referrer_id, gone.id, 'the tree is intact');
  assert.deepEqual(audit().problems, []);
});

test('audit catches a tampered edit chain', async () => {
  const u = await signup('chain_u');
  await api('POST', '/api/log', { token: u.token, body: { count: 100 } });
  const id = (await api('GET', '/api/history', { token: u.token })).days[0].entries[0].id;
  await api('PATCH', `/api/entries/${id}`, { token: u.token, body: { count: 150 } });
  assert.deepEqual(audit().problems, []);
  db.exec('DROP TRIGGER entries_no_update');
  db.prepare("UPDATE entries SET count = -999 WHERE kind = 'reverse' AND user_id = ?").run(uid('chain_u'));
  assert.ok(audit().problems.some((p) => p.kind === 'edit_chain'));
});
