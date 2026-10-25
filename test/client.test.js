// Static checks on the browser files: the translation tables and the error codes the server can send.
// These exist because a duplicated key silently replaced the WhatsApp invite text, and member-facing error codes had no message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');

/** A tiny scanner: walks the object literal and records every key under its path, so duplicates inside one object are found. */
function scanKeys(text) {
  const keys = new Map(); // path -> array of keys in order
  const stack = []; let i = text.indexOf('{'), lastKey = null, expectKey = false;
  const readString = (q) => { i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; if (q === '`' && text[i] === '$' && text[i + 1] === '{') { i += 2; let d = 1; while (d && i < text.length) { if (text[i] === '{') d++; else if (text[i] === '}') d--; else if (text[i] === '`' || text[i] === "'" || text[i] === '"') { readString(text[i]); continue; } i++; } continue; } i++; } i++; };
  const path = () => stack.join('.');
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === "'" || c === '"' || c === '`') { const start = i; readString(c); if (expectKey && /^\s*:/.test(text.slice(i, i + 4))) { /* quoted key */ const k = text.slice(start + 1, i - 1); lastKey = k; keys.get(path())?.push(k); expectKey = false; } continue; }
    if (c === '{') { stack.push(lastKey ?? 'root'); if (!keys.has(path())) keys.set(path(), []); expectKey = true; lastKey = null; i++; continue; }
    if (c === '}') { stack.pop(); expectKey = false; i++; continue; }
    if (c === '[') { let d = 1; i++; while (d && i < text.length) { if (text[i] === '[') d++; else if (text[i] === ']') d--; else if (text[i] === "'" || text[i] === '"' || text[i] === '`') { readString(text[i]); continue; } i++; } continue; }
    if (c === '(') { let d = 1; i++; while (d && i < text.length) { if (text[i] === '(') d++; else if (text[i] === ')') d--; else if (text[i] === "'" || text[i] === '"' || text[i] === '`') { readString(text[i]); continue; } i++; } continue; }
    if (c === ',') { expectKey = true; i++; continue; }
    const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 80));
    if (m && expectKey && /^\s*:/.test(text.slice(i + m[0].length, i + m[0].length + 4))) { lastKey = m[0]; keys.get(path()).push(m[0]); expectKey = false; i += m[0].length; continue; }
    if (m) { i += m[0].length; continue; }
    i++;
  }
  return keys;
}
const keys = scanKeys(src);

test('no translation key is defined twice inside one table', () => {
  const dupes = [];
  for (const [p, list] of keys) { const seen = new Set(); for (const k of list) { if (seen.has(k)) dupes.push(`${p}.${k}`); seen.add(k); } }
  assert.deepEqual(dupes, []);
});

test('English and Urdu have the same keys, in the main table and in the error table', () => {
  const sets = (p) => new Set(keys.get(p) || []);
  for (const table of ['root.en.err', 'root.en.badge']) {
    const en = sets(table), ur = sets(table.replace('.en.', '.ur.'));
    if (!en.size && !ur.size) continue;
    assert.deepEqual([...en].filter((k) => !ur.has(k)), [], `missing in Urdu: ${table}`);
    assert.deepEqual([...ur].filter((k) => !en.has(k)), [], `missing in English: ${table}`);
  }
  const en = sets('root.en'), ur = sets('root.ur');
  assert.deepEqual([...en].filter((k) => !ur.has(k)), [], 'keys missing in Urdu');
  assert.deepEqual([...ur].filter((k) => !en.has(k)), [], 'keys missing in English');
});

test('every translation key the app uses exists, and function-vs-string usage matches', async () => {
  const { I18N } = await import('../public/i18n.js');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  const used = new Map();
  for (const m of app.matchAll(/\bt\('([\w]+)'\)(\()?/g)) used.set(m[1], (used.get(m[1]) || false) || !!m[2]);
  const problems = [];
  for (const [k, called] of used) for (const lang of ['en', 'ur']) {
    const v = I18N[lang][k];
    if (v === undefined) { if (I18N.en[k] === undefined) problems.push(`${lang}: ${k} missing`); continue; }
    if (called && typeof v !== 'function') problems.push(`${lang}: ${k} is called but is not a function`);
  }
  assert.deepEqual(problems, []);
});

test('every error code a member can trigger has a message in both languages', async () => {
  const { I18N } = await import('../public/i18n.js');
  const codes = new Set();
  for (const f of fs.readdirSync(new URL('../server/', import.meta.url))) {
    if (!f.endsWith('.js')) continue;
    for (const m of fs.readFileSync(new URL(`../server/${f}`, import.meta.url), 'utf8').matchAll(/new HttpError\(\d+, '(\w+)'\)/g)) codes.add(m[1]);
  }
  // codes only an administrator or a script can reach, or that never show as text
  const adminOrTechnical = new Set(['forbidden', 'bad_path', 'method_not_allowed', 'bad_action', 'bad_cap', 'bad_code', 'bad_date', 'bad_days', 'bad_export', 'bad_lecture', 'bad_news', 'bad_prompt', 'bad_quiz', 'bad_sunnah', 'bad_target', 'bad_special', 'bad_subscription', 'bad_kind', 'bad_weekday', 'bad_day', 'bad_vote', 'mamulaat_bad_reply', 'bad_image', 'not_in_mamulaat_app', 'bad_role', 'own_role', 'last_owner', 'not_allowed', 'member_not_found', 'bad_login', 'bad_url', 'sunnah_in_use', 'photo_gone', 'remove_role_first']);
  const missing = [];
  for (const c of codes) if (!adminOrTechnical.has(c)) for (const lang of ['en', 'ur']) if (!I18N[lang].err[c]) missing.push(`${lang}:${c}`);
  assert.deepEqual(missing, []);
});
