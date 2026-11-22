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

// --- hasUnfinishedMarkers
for (const f of FILES) {
  // Final text: the marker expectations moved to the go-live block below (none left above the change log).
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

// --- FP-249 follow-up: header logo and date lines (renderer)
const renderer = fs.readFileSync(path.join(process.cwd(), 'src', 'features', 'legal-pages', 'LegalPage.tsx'), 'utf8');
check('LegalPage source: header has the logo <img src="/flockpulse-logo.png" alt="FlockPulse">',
  /<img src="\/flockpulse-logo\.png" alt="FlockPulse"/.test(renderer));
check('LegalPage source: the logo sits on a white wrapper (bg-white) inside the Link to "/"',
  /<Link href="\/" className="[^"]*bg-white[^"]*">\s*<img src="\/flockpulse-logo\.png"/.test(renderer));
check('LegalPage source: no plain-text "FlockPulse" Link any more', !/<Link[^>]*>\s*FlockPulse\s*<\/Link>/.test(renderer));
check('LegalPage source: the p component has whitespace-pre-line',
  /p: \(\{ children \}\) => \(\s*<p className="[^"]*whitespace-pre-line/.test(renderer));
// Every paragraph (outside lists, tables, headings) with a single line break is an intended one: the date lines
// (and, in Support / Account Deletion, the "operated by" line followed by "Last updated").
for (const f of FILES) {
  const paras = stripped[f].replace(/\r\n/g, '\n').trimEnd().split(/\n{2,}/)
    .filter((b) => b.includes('\n') && !/^(#|\||---|\s*([-*+]|\d+\.) )/.test(b));
  check(`${f}: the only paragraph containing a line break is the two-line date paragraph (found ${paras.length})`,
    paras.length === 1 && /\*\*Last updated:\*\*/.test(paras[0]) && paras[0].split('\n').length === 2);
}

// Rendered output: reads the HTML that `npx next build` produced (run the build first).
const BUILT = path.join(process.cwd(), '.next', 'server', 'app');
if (!fs.existsSync(path.join(BUILT, 'privacy.html'))) {
  console.log('INFO  SKIPPED rendered-HTML checks: no .next build output (run `npx next build` first)');
} else {
  for (const page of ['privacy', 'terms', 'support', 'delete-account']) {
    const html = fs.readFileSync(path.join(BUILT, `${page}.html`), 'utf8');
    const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
    check(`${page} (built): header has <img> with src="/flockpulse-logo.png" and alt="FlockPulse"`,
      /<img[^>]*src="\/flockpulse-logo\.png"/.test(header) && /alt="FlockPulse"/.test(header));
    check(`${page} (built): header has no plain-text "FlockPulse" link`, !/<a [^>]*>\s*FlockPulse\s*<\/a>/.test(header));
    check(`${page} (built): the logo link goes to "/"`, /<a [^>]*href="\/"[^>]*>\s*<img/.test(header));
    const para = /<p [^>]*>(?:(?!<\/p>)[\s\S])*Last updated(?:(?!<\/p>)[\s\S])*<\/p>/.exec(html)?.[0] ?? '';
    check(`${page} (built): the "Last updated" paragraph has whitespace-pre-line`, /class="[^"]*whitespace-pre-line/.test(para));
  }
  for (const page of ['privacy', 'terms']) {
    const html = fs.readFileSync(path.join(BUILT, `${page}.html`), 'utf8');
    const m = /<strong[^>]*>Effective date:<\/strong>([\s\S]*?)<strong[^>]*>Last updated:<\/strong>/.exec(html);
    check(`${page} (built): "Effective date" and "Last updated" are separated by a line break in the text`,
      !!m && m[1].includes('\n') && !m[1].includes('<br'));
  }
}

// --- FP-249 go-live: final text, no unfinished markers, exact date lines, cross-links
const DATE_LINES: Record<(typeof FILES)[number], string[]> = {
  'privacy-policy': ['**Effective date:** 2026-11-21', '**Last updated:** 2026-11-23'],
  'terms-of-service': ['**Effective date:** 2026-11-21', '**Last updated:** 2026-11-23'],
  'support-page': ['**Last updated:** 2026-11-23'],
  'account-deletion-page': ['**Last updated:** 2026-11-23'],
};
for (const f of FILES) {
  check(`${f}: no unfinished marker in the stripped text`, !hasUnfinishedMarkers(stripped[f]));
  check(`${f}: no [TO DECIDE and no [CHECK above the change log`,
    !stripped[f].includes('[TO DECIDE') && !stripped[f].includes('[CHECK'));
  const dateLines = stripped[f].split('\n').filter((l) => /^\*\*(Effective date|Last updated):\*\*/.test(l));
  check(`${f}: date lines are exactly ${JSON.stringify(DATE_LINES[f])}`,
    JSON.stringify(dateLines) === JSON.stringify(DATE_LINES[f]));
  check(`${f}: no carriage return in the file (LF only)`, !raw[f].includes('\r'));
}
check('terms-of-service links to privacy-policy.md', stripped['terms-of-service'].includes('](privacy-policy.md)'));
check('terms-of-service links to privacy-policy.md in section 1.4 and in section 11', (() => {
  const t = stripped['terms-of-service'];
  const p14 = t.split('\n').find((l) => l.startsWith('**1.4 ')) ?? '';
  const i11 = t.search(/^## 11\. /m);
  const rest11 = i11 === -1 ? '' : t.slice(i11 + 3);
  const n11 = rest11.search(/^## /m);
  const s11 = n11 === -1 ? rest11 : rest11.slice(0, n11);
  return p14.includes('](privacy-policy.md)') && s11.includes('](privacy-policy.md)');
})());
check('privacy-policy links to terms-of-service.md', stripped['privacy-policy'].includes('](terms-of-service.md)'));
check('GATE_PUBLIC_PATHS is exactly the four legal pages',
  JSON.stringify(GATE_PUBLIC_PATHS) === JSON.stringify(['/privacy', '/terms', '/support', '/delete-account']));

// --- the site gate

console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
