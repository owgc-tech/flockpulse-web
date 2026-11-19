/**
 * FP-213: neutral wording check.
 * Run: npx tsx scripts/test-fp213-wording.ts
 *
 * 1. LABEL_ORDER contains 'Session' and not 'Talk'.
 * 2. No user-visible string literal or JSX text in app/ and src/ still contains
 *    Formation / Talk / Talks (any case, whole word), except the allowlist below.
 * 3. Report only (never fails): faith-specific words in user-visible strings.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LABEL_ORDER } from '../src/features/events/modifiedFields';

const ROOT = join(__dirname, '..');
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}

// ---- 1. label order ---------------------------------------------------------
console.log('=== LABEL_ORDER');
check("LABEL_ORDER contains 'Session'", (LABEL_ORDER as readonly string[]).includes('Session'));
check("LABEL_ORDER does not contain 'Talk'", !(LABEL_ORDER as readonly string[]).includes('Talk'));

// ---- file walk --------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

interface Found { file: string; line: number; text: string; kind: 'string' | 'jsx' }

// Light tokenizer: skips comments, collects string / template literals, then JSX text
// from what is left of the code.
function extract(src: string): { text: string; line: number; kind: 'string' | 'jsx' }[] {
  const out: { text: string; line: number; kind: 'string' | 'jsx' }[] = [];
  let code = '';
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; code += '\n'; } i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      const startLine = line;
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== q) {
        if (src[j] === '\\') { s += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        if (src[j] === '\n') { if (q !== '`') break; line++; }
        s += src[j];
        j++;
      }
      // ${...} expressions are code (variable names), not wording
      out.push({ text: q === '`' ? s.replace(/\$\{[^}]*\}/g, '') : s, line: startLine, kind: 'string' });
      code += ' '.repeat(Math.max(0, j - i + 1)).replace(/ /g, ' ');
      i = j + 1;
      continue;
    }
    if (c === '\n') line++;
    code += c;
    i++;
  }
  // JSX text: >text< on the code with comments/strings blanked.
  const re = />([^<>{}=;]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const upto = code.slice(0, m.index);
    out.push({ text, line: (upto.match(/\n/g)?.length ?? 0) + 1, kind: 'jsx' });
  }
  return out;
}

const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'src'))];
const all: Found[] = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  for (const e of extract(src)) {
    // import / export-from specifiers are not user-visible
    if (e.kind === 'string' && /^(\.{1,2}\/|@\/|next\/|react|@supabase|node:)/.test(e.text)) continue;
    all.push({ file: rel, ...e });
  }
}

// ---- 2. Formation / Talk(s) -------------------------------------------------
const WORDS = /\b(formation|talks?)\b/i;

// Explicit allowlist. Each rule says why the match is not user-visible wording.
const ALLOW: { name: string; reason: string; test: (f: Found) => boolean }[] = [
  {
    name: 'API paths',
    reason: '/api/talks, /api/formation/progress are API contracts the mobile app calls (not renamed)',
    test: (f) => /(^|[`'"\s])\/api\//.test(f.text) || /\/api\/(talks|formation)/.test(f.text),
  },
  {
    name: 'internal discriminator',
    reason: "a bare 'talk' / 'talks' value that is a table name, entity key or column alias, never shown",
    test: (f) => f.kind === 'string' && /^(talk|talks|formation)$/.test(f.text),
  },
  {
    name: 'PostgREST select / SQL fragment',
    reason: 'column or embed names inside a query string (talks(...), talk_id), not displayed',
    test: (f) => f.kind === 'string' && /[(),:]/.test(f.text) && /^[a-z_*,()\s:!.>-]+$/i.test(f.text) && !/\s{2}/.test(f.text) && /\btalks?\(|\btalks?!|talks?\b[^ ]*\)/.test(f.text),
  },
  {
    name: 'database error substring',
    reason: "matches the text of a database trigger message ('Cannot soft-delete talk'); changing it would need a migration",
    test: (f) => f.text === 'Cannot soft-delete talk',
  },
  {
    name: 'event type code',
    reason: 'the FORMATION event type code is kept (tenant data and logic key)',
    test: (f) => f.text === 'FORMATION',
  },
];

console.log('\n=== Formation / Talk(s) in user-visible strings');
const hits = all.filter((f) => WORDS.test(f.text));
const allowed = new Map<string, Found[]>();
const bad: Found[] = [];
for (const h of hits) {
  const rule = ALLOW.find((a) => a.test(h));
  if (rule) allowed.set(rule.name, [...(allowed.get(rule.name) ?? []), h]);
  else bad.push(h);
}
for (const [name, list] of allowed) {
  const rule = ALLOW.find((a) => a.name === name)!;
  console.log(`  allowlisted: ${name} (${list.length}) -- ${rule.reason}`);
  for (const h of list) console.log(`      ${h.file}:${h.line}  ${JSON.stringify(h.text).slice(0, 110)}`);
}
for (const b of bad) console.log(`  FOUND  ${b.file}:${b.line} [${b.kind}]  ${JSON.stringify(b.text).slice(0, 140)}`);
check('no user-visible Formation / Talk(s) left', bad.length === 0, `${bad.length} found`);

// ---- 3. report only: faith-specific words ------------------------------------
console.log('\n=== Report only: faith-specific words in user-visible strings (does not fail)');
const FAITH = /\b(Pastoral|Prayer|Church|Bible|Scripture|Worship|Ministry|Fellowship|Parish|Congregation|Sermon|Pastor|Faith|God|Spirit|Shepherd|Retreat|Gospel|Holy|Devotion|Praise)\b/i;
const faith = all.filter((f) => FAITH.test(f.text));
for (const f of faith) console.log(`  ${f.file}:${f.line} [${f.kind}]  ${JSON.stringify(f.text).slice(0, 140)}`);
console.log(`  (${faith.length} occurrences)`);

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
