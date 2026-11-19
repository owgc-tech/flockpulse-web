/**
 * FP-261: "Always show on events" task setting.
 * Run: npx tsx scripts/test-fp261-always-show.ts
 *
 * Pure checks, no database:
 *  1. createTask / updateTask reject a non-boolean always_show with VALIDATION_ERROR
 *     (the validation runs before any database call).
 *  2. CORE_TASK_NAMES no longer exists in app/ or src/, and the three hardcoded
 *     names are not used as code (string literals) there.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createTask, updateTask } from '../src/features/tasks/task.service';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}

// a hardcoded task name inside quotes (quote characters written as hex escapes)
const QUOTED_NAME = new RegExp('[\x27\x22\x60](Prayer Leader|Food Assignment|Music)[\x27\x22\x60]');

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'NO_ERROR'; } catch (e) { return (e as { code?: string }).code ?? 'NO_CODE'; }
}

async function main() {
  console.log('=== always_show validation');
  for (const bad of ['true', 1, 0, null, {}, []]) {
    const c = await codeOf(createTask('t', { name: 'X', alwaysShow: bad as never }));
    check(`createTask rejects alwaysShow=${JSON.stringify(bad)}`, c === 'VALIDATION_ERROR', `code ${c}`);
    const u = await codeOf(updateTask('i', 't', { alwaysShow: bad as never }));
    check(`updateTask rejects alwaysShow=${JSON.stringify(bad)}`, u === 'VALIDATION_ERROR', `code ${u}`);
  }

  console.log('\n=== CORE_TASK_NAMES removed');
  const root = join(__dirname, '..');
  const files: string[] = [];
  (function walk(d: string) {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === '.next') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    }
  })(join(root, 'app'));
  (function walk(d: string) {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === '.next') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    }
  })(join(root, 'src'));
  const hits: string[] = [];
  const nameHits: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      const rel = `${relative(root, f).split(sep).join('/')}:${i + 1}`;
      if (/CORE_TASK_NAMES/.test(l)) hits.push(`${rel}  ${l.trim()}`);
      if (QUOTED_NAME.test(l)) nameHits.push(`${rel}  ${l.trim()}`);
    });
  }
  hits.forEach((h) => console.log('  FOUND ' + h));
  nameHits.forEach((h) => console.log('  FOUND ' + h));
  check('CORE_TASK_NAMES not present in app/ or src/', hits.length === 0, `${hits.length} found`);
  check('"Prayer Leader" / "Food Assignment" / "Music" not used as string literals in app/ or src/', nameHits.length === 0, `${nameHits.length} found`);

  console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
