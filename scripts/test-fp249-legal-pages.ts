/**
 * FP-249 legal pages tests. Pure: reads the four real files in content/legal/ and calls the helpers in
 * src/features/legal-pages/legal-content.ts. No network, no database (assertLocalDb with allowUnset, as the other pure scripts do).
 * NOT covered: the rendered HTML (checked separately by fetching `npm run dev:local`), dark mode, a phone.
 * Also run scripts/test-site-gate.ts (the gate must be unchanged).
 */
import fs from 'node:fs';
import path from 'node:path';
import { GATE_PUBLIC_PATHS } from '../src/lib/site-gate';
import {
  hasUnfinishedMarkers,
  resolveLegalHref,
  stripChangeLog,
} from '../src/features/legal-pages/legal-content';
import { assertLocalDb } from './lib/assert-local-db';

// FP-263: pure script, no database; refuses only if a hosted URL is set in the environment.
assertLocalDb(undefined, { allowUnset: true });

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const FILES = ['privacy-policy', 'terms-of-service', 'support-page', 'account-deletion-page'] as const;
// Expected number of unfinished markers in the TEXT ABOVE the change log (date lines only).
const EXPECTED_MARKER_LINES: Record<(typeof FILES)[number], number> = {
  'privacy-policy': 2,
  'terms-of-service': 2,
  'support-page': 1,
  'account-deletion-page': 1,
};
// What each stripped file must still end with.
const ENDS_WITH: Record<(typeof FILES)[number], RegExp> = {
  'privacy-policy': /support@flockpulse\.ca[\s\S]*we will give you one\.\n$/,
  'terms-of-service': /support@flockpulse\.ca[\s\S]*we will give you one\.\n$/,
  'support-page': /\[Delete your account\]\(account-deletion-page\.md\)\n$/,
  'account-deletion-page': /\[support@flockpulse\.ca\]\(mailto:support@flockpulse\.ca\)\. Our Privacy Officer is Joseph Punzalan\.\n$/,
};

const raw: Record<string, string> = {};
const stripped: Record<string, string> = {};
for (const f of FILES) {
  raw[f] = fs.readFileSync(path.join(process.cwd(), 'content', 'legal', `${f}.md`), 'utf8');
  stripped[f] = stripChangeLog(raw[f]);
}

// --- stripChangeLog on the four real files
for (const f of FILES) {
  check(`${f}: raw file has a "## Change log" section`, /^## Change log/m.test(raw[f]));
  check(`${f}: stripped text has no "Change log"`, !/change log/i.test(stripped[f]));
  check(`${f}: stripped text has no change-log table rows ("| 1.")`, !/^\| \d+\.\d+ \|/m.test(stripped[f]));
  check(`${f}: stripped text still ends with its contact / closing text`, ENDS_WITH[f].test(stripped[f]));
  check(`${f}: stripped text does not end with a dangling "---"`, !/---\s*$/.test(stripped[f]));
  check(`${f}: stripped text is a prefix of the file (nothing above the log was changed)`,
    raw[f].replace(/\r\n/g, '\n').startsWith(stripped[f].trimEnd()));
}
check('stripChangeLog: text without a change log is returned unchanged', stripChangeLog('# A\n\ntext\n') === '# A\n\ntext\n');
check('stripChangeLog: removes the trailing --- and the section',
  stripChangeLog('# A\n\ntext\n\n---\n\n## Change log\n\n| 1 | x |\n') === '# A\n\ntext\n');
check('stripChangeLog: a --- inside the text (not right before the log) is kept',
  stripChangeLog('a\n\n---\n\nb\n\n---\n\n## Change log\n\nz\n') === 'a\n\n---\n\nb\n');
check('stripChangeLog: CRLF input', !/change log/i.test(stripChangeLog('a\r\n\r\n---\r\n\r\n## Change log\r\n\r\nz\r\n')));

// --- resolveLegalHref
check('privacy-policy.md -> /privacy', resolveLegalHref('privacy-policy.md') === '/privacy');
check('terms-of-service.md -> /terms', resolveLegalHref('terms-of-service.md') === '/terms');
check('support-page.md -> /support', resolveLegalHref('support-page.md') === '/support');
check('account-deletion-page.md -> /delete-account', resolveLegalHref('account-deletion-page.md') === '/delete-account');
check('mailto: unchanged', resolveLegalHref('mailto:support@flockpulse.ca') === 'mailto:support@flockpulse.ca');
check('https: unchanged', resolveLegalHref('https://example.com/a') === 'https://example.com/a');
check('unknown value unchanged', resolveLegalHref('something-else.md') === 'something-else.md');
check("'constructor' (object key, not a link) unchanged", resolveLegalHref('constructor') === 'constructor');
check("'' unchanged", resolveLegalHref('') === '');

// --- hasUnfinishedMarkers on the stripped text
for (const f of FILES) {
  check(`${f}: stripped text has unfinished markers (date placeholders)`, hasUnfinishedMarkers(stripped[f]));
  const todecide = (stripped[f].match(/\[TO DECIDE/g) ?? []).length;
  const check_ = (stripped[f].match(/\[CHECK/g) ?? []).length;
  check(`${f}: exactly ${EXPECTED_MARKER_LINES[f]} [TO DECIDE (got ${todecide}) and no [CHECK (got ${check_})`,
    todecide === EXPECTED_MARKER_LINES[f] && check_ === 0);
  const markerLines = stripped[f].split('\n').filter((l) => l.includes('[TO DECIDE'));
  check(`${f}: every marker is on an "Effective date" / "Last updated" line`,
    markerLines.length === EXPECTED_MARKER_LINES[f] &&
      markerLines.every((l) => /^\*\*(Effective date|Last updated):\*\*/.test(l)));
}
check('hasUnfinishedMarkers: false for a sample without markers', !hasUnfinishedMarkers('# A\n\nAll done. [a link](x.md)\n'));
check('hasUnfinishedMarkers: true for [CHECK', hasUnfinishedMarkers('x [CHECK: y] z'));
// The change logs QUOTE the markers, which is why the check must run after stripChangeLog.
const quotedInLogs = FILES.filter((f) => hasUnfinishedMarkers(raw[f]) && raw[f].split('## Change log')[1]?.match(/\[TO DECIDE|\[CHECK/));
console.log(`INFO  files whose change log quotes a marker: ${quotedInLogs.join(', ') || 'none'}`);

// --- links
for (const f of FILES) {
  const hrefs = [...stripped[f].matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  check(`${f}: no link still ends in .md after resolveLegalHref (${hrefs.length} links)`,
    hrefs.every((h) => !/\.md$/i.test(resolveLegalHref(h))));
  check(`${f}: every .md link is one of the four known files`,
    hrefs.filter((h) => /\.md$/i.test(h)).every((h) => resolveLegalHref(h) !== h));
}

// --- the site gate is unchanged
check('GATE_PUBLIC_PATHS is still empty', GATE_PUBLIC_PATHS.length === 0);

console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
