import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  hasUnfinishedMarkers,
  resolveLegalHref,
  stripChangeLog,
  type LegalDocument,
} from './legal-content';

// FP-249: renders one of the four text files in content/legal/ as a public page. Server Component:
// the file is read with fs when the (force-static) page is built, so nothing runs in the browser.
// No raw HTML support (react-markdown's default) and no dangerouslySetInnerHTML.

function readLegalFile(doc: LegalDocument): string {
  // process.cwd() plus literal folder names, so Next/Vercel include content/legal/** in the build.
  return fs.readFileSync(path.join(process.cwd(), 'content', 'legal', `${doc}.md`), 'utf8');
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-6 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-10 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{children}</h3>
  ),
  p: ({ children }) => <p className="my-4 leading-7 text-zinc-700 dark:text-zinc-300">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-4 list-disc space-y-2 pl-6 text-zinc-700 dark:text-zinc-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 list-decimal space-y-2 pl-6 text-zinc-700 dark:text-zinc-300">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-7">{children}</li>,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-zinc-100 dark:bg-zinc-900">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-zinc-200 px-3 py-2 font-semibold text-zinc-900 dark:border-zinc-700 dark:text-zinc-50">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-zinc-200 px-3 py-2 align-top text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
      {children}
    </td>
  ),
  a: ({ href, children }) => {
    const target = resolveLegalHref(href ?? '');
    const cls = 'text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300';
    return isExternal(target) ? (
      <a href={target} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    ) : (
      <a href={target} className={cls}>
        {children}
      </a>
    );
  },
  strong: ({ children }) => <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{children}</strong>,
  hr: () => <hr className="my-8 border-zinc-200 dark:border-zinc-800" />,
  code: ({ children }) => (
    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-sm text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </code>
  ),
};

export default function LegalPage({ doc }: { doc: LegalDocument }) {
  // The change log is internal: strip it FIRST, before anything else looks at the text.
  const markdown = stripChangeLog(readLegalFile(doc));

  // Unfinished text ([TO DECIDE ...], [CHECK ...]) must never be published by accident.
  // Previews and local development still render it, so the date placeholders stay visible there.
  if (process.env.VERCEL_ENV === 'production' && hasUnfinishedMarkers(markdown)) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-black">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <Link href="/" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            FlockPulse
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {markdown}
        </ReactMarkdown>
      </main>
    </div>
  );
}
