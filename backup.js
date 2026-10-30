// Sends a copy of the data to a Google Sheet twice a day, so the counts survive losing the server (see docs/google-sheets-backup.md).
// The sheet side is a tiny Google Apps Script web app (docs/google-sheets-backup.gs): no Google account keys are kept on the server,
// only the address of that script and a shared secret.

const DAYS_SENT = 3;   // each backup re-sends the last few days, so a missed one is repaired by the next
const dayOf = (t = Date.now()) => new Date(t + 5 * 3600e3).toISOString().slice(0, 10);

/** Everyone, plus each person's total per day for the last few days (the sheet keeps the older days from earlier backups). */
export function buildPayload(db, { now = Date.now(), days = DAYS_SENT } = {}) {
  const today = dayOf(now);
  const from = dayOf(now - (days - 1) * 86400e3);
  const people = db.prepare('SELECT phone, name, city, created_at FROM people ORDER BY id').all()
    .map((p) => ({ phone: p.phone, name: p.name, city: p.city, joined: dayOf(p.created_at) }));
  const daily = db.prepare(`SELECT e.day, p.phone, SUM(e.count) count FROM entries e JOIN people p ON p.id = e.person_id WHERE e.day >= ? GROUP BY e.day, p.id ORDER BY e.day, p.id`).all(from)
    .map((r) => ({ day: r.day, phone: r.phone, count: r.count }));
  const total = db.prepare('SELECT COALESCE(SUM(count), 0) n FROM entries').get().n;
  const todayTotal = db.prepare('SELECT COALESCE(SUM(count), 0) n FROM entries WHERE day = ?').get(today).n;
  return { sentAt: new Date(now).toISOString(), from, today, people, daily, totals: { people: people.length, total, today: todayTotal } };
}

/** One backup. Returns { ok, error? }; never throws. */
export async function sendBackup({ db, url, token, fetchImpl = fetch, now = Date.now() }) {
  if (!url) return { ok: false, error: 'not_configured' };
  try {
    const res = await fetchImpl(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, ...buildPayload(db, { now }) }), signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    let out; try { out = JSON.parse(text); } catch { out = null; }
    if (!res.ok || !out?.ok) return { ok: false, error: `the sheet answered ${res.status}: ${(out?.error || text).slice(0, 120)}` };
    return { ok: true, rows: out.rows ?? null };
  } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 160) }; }
}

/**
 * Runs a backup at the chosen hours (Pakistan time, default 6 and 18), and at start-up if the last good one is over 13 hours old.
 * A failed one is tried again after 30 minutes, up to six times. Returns { stop, status, runNow }.
 */
export function startBackups({ db, url = process.env.SHEETS_URL, token = process.env.SHEETS_TOKEN, hours = (process.env.BACKUP_HOURS || '6,18'), fetchImpl = fetch, log = console } = {}) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const get = (k) => db.prepare('SELECT value FROM meta WHERE key = ?').get(k)?.value ?? null;
  const set = (k, v) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  const at = String(hours).split(',').map((h) => Number(h.trim())).filter((h) => Number.isInteger(h) && h >= 0 && h < 24);
  const status = () => ({ configured: !!url, lastOkAt: Number(get('backup_ok_at')) || null, lastError: get('backup_error') || null, hours: at });
  let running = false, retries = 0, retryTimer = null, startTimer = null;
  async function runNow() {
    if (!url || running) return { ok: false, error: running ? 'busy' : 'not_configured' };
    running = true;
    try {
      const r = await sendBackup({ db, url, token, fetchImpl });
      if (r.ok) { set('backup_ok_at', Date.now()); set('backup_error', ''); retries = 0; log.log?.(`Backup sent to the sheet (${r.rows ?? '?'} rows).`); }
      else {
        set('backup_error', r.error); log.error?.(`Backup failed: ${r.error}`);
        if (retries < 6) { retries += 1; clearTimeout(retryTimer); retryTimer = setTimeout(runNow, 30 * 60e3); retryTimer.unref?.(); }
      }
      return r;
    } finally { running = false; }
  }
  if (!url) { log.log?.('Sheet backup is off (set SHEETS_URL and SHEETS_TOKEN to turn it on).'); return { stop() {}, status, runNow }; }
  const last = Number(get('backup_ok_at')) || 0;
  if (Date.now() - last > 13 * 3600e3) { startTimer = setTimeout(runNow, 5000); startTimer.unref?.(); } // a restart should not leave a long gap
  const tick = setInterval(() => {
    const t = new Date(Date.now() + 5 * 3600e3), key = `${t.toISOString().slice(0, 10)}-${t.getUTCHours()}`;
    if (at.includes(t.getUTCHours()) && get('backup_slot') !== key) { set('backup_slot', key); retries = 0; runNow(); }
  }, 60_000);
  tick.unref?.();
  return { stop() { clearInterval(tick); clearTimeout(retryTimer); clearTimeout(startTimer); }, status, runNow };
}
