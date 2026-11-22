// FP-249: pure helpers for the public legal pages. No React and no Next.js imports, so they can be
// tested directly (scripts/test-fp249-legal-pages.ts).

export type LegalDocument =
  | 'privacy-policy'
  | 'terms-of-service'
  | 'support-page'
  | 'account-deletion-page';

// Removes the trailing "---" rule plus the "## Change log" section and everything after it.
// The change log is internal (ticket names, history) and must never be shown publicly.
// If the text has no "## Change log" heading it is returned unchanged.
export function stripChangeLog(markdown: string): string {
  const heading = /^## Change log[ \t]*\r?$/m.exec(markdown);
  if (!heading) return markdown;
  let text = markdown.slice(0, heading.index).trimEnd();
  if (/(^|\n)---$/.test(text)) {
    text = text.slice(0, text.length - 3).trimEnd();
  }
  return text + '\n';
}

const LEGAL_LINKS: Record<string, string> = {
  'privacy-policy.md': '/privacy',
  'terms-of-service.md': '/terms',
  'support-page.md': '/support',
  'account-deletion-page.md': '/delete-account',
};

// Maps a link to one of the four source files to the real route. mailto:, https: and any other
// value are returned unchanged.
export function resolveLegalHref(href: string): string {
  return Object.prototype.hasOwnProperty.call(LEGAL_LINKS, href) ? LEGAL_LINKS[href] : href;
}

// True if the text still holds an unfinished marker. Call it on text that has ALREADY been through
// stripChangeLog: the change logs quote these words as history.
export function hasUnfinishedMarkers(markdown: string): boolean {
  return markdown.includes('[TO DECIDE') || markdown.includes('[CHECK');
}
