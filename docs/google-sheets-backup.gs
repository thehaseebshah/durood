// Paste this into the Apps Script of your Google Sheet (Extensions > Apps Script), set SECRET below, then Deploy > New deployment >
// Web app > Execute as: Me, Who has access: Anyone. Copy the web app URL into SHEETS_URL on the server (and SECRET into SHEETS_TOKEN).
const SECRET = 'put-a-long-random-secret-here';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body.token || body.token !== SECRET) return out({ ok: false, error: 'bad token' });
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      // People: everyone, rewritten each time
      const people = sheet(ss, 'People', ['phone', 'name', 'city', 'joined', 'caravan']);
      writeAll(people, [['phone', 'name', 'city', 'joined', 'caravan']].concat(body.people.map((p) => [p.phone, p.name, p.city, p.joined, p.caravan || ''])), [1]);
      // Caravans: the groups (name, link name, target)
      const cars = sheet(ss, 'Caravans', ['slug', 'name', 'target']);
      writeAll(cars, [['slug', 'name', 'target']].concat((body.caravans || []).map((c) => [c.slug, c.name, c.target])), [1]);
      // Daily: one row per person per day; the days in this backup replace the same days from before, older days stay
      const daily = sheet(ss, 'Daily', ['day', 'phone', 'count', 'caravan']);
      const sent = {};
      body.daily.forEach((r) => { sent[r.day] = true; });
      const have = daily.getLastRow() > 1 ? daily.getRange(2, 1, daily.getLastRow() - 1, 4).getValues() : [];
      const kept = have.filter((r) => !sent[dayText(r[0])]);
      const rows = kept.map((r) => [dayText(r[0]), String(r[1]), r[2], String(r[3] || '')]).concat(body.daily.map((r) => [r.day, r.phone, r.count, r.caravan || '']));
      rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      writeAll(daily, [['day', 'phone', 'count', 'caravan']].concat(rows), [1, 2]);
      // Totals: one line per backup, so the history of the overall count is kept too
      const totals = sheet(ss, 'Totals', ['sent at', 'people', 'total', 'today']);
      totals.appendRow([body.sentAt, body.totals.people, body.totals.total, body.totals.today]);
      return out({ ok: true, rows: rows.length + body.people.length });
    } finally { lock.releaseLock(); }
  } catch (err) { return out({ ok: false, error: String(err) }); }
}

function doGet() { return out({ ok: true, hello: 'the backup receiver is running' }); }

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function sheet(ss, name, header) {
  let s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); s.appendRow(header); }
  return s;
}
function dayText(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Karachi', 'yyyy-MM-dd') : String(v); }
// text columns (phone numbers start with "+", days look like dates) are written as plain text so Sheets does not "fix" them
function writeAll(s, table, textCols) {
  s.clearContents();
  if (!table.length) return;
  textCols.forEach((c) => s.getRange(1, c, Math.max(table.length, s.getMaxRows()), 1).setNumberFormat('@'));
  s.getRange(1, 1, table.length, table[0].length).setValues(table);
}
