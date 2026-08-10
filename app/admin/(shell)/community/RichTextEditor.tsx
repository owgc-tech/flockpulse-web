'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface Props {
  content: string;
  // isEmpty is Tiptap's own emptiness check (editor.isEmpty), not a plain
  // string comparison — an "empty" editor still outputs markup like
  // <p></p>, so the caller can't reliably tell from the HTML string alone
  // whether the admin actually cleared the field (matters for "empty means
  // reset to platform default" semantics upstream).
  onChange: (html: string, isEmpty: boolean) => void;
}

const editorClass =
  'min-h-[160px] rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 ' +
  '[&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline';

// DIP-FP-196-web: net-new dependency (@tiptap/react + @tiptap/starter-kit).
// immediatelyRender: false is required for Next.js App Router SSR — without
// it, useEditor's non-nullable overload runs immediately during server
// render and causes a hydration mismatch. Confirmed against the actually-
// installed package's own type definitions (Tiptap v3.29.2) before writing
// this, not assumed from general Tiptap familiarity.
export default function RichTextEditor({ content, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.isEmpty);
    },
    editorProps: {
      attributes: { class: editorClass },
    },
  });

  if (!editor) return null;

  const toolbarButtonClass = (active: boolean) =>
    `rounded px-2 py-1 text-xs font-medium transition-colors ${
      active
        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
        : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800'
    }`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-1.5 dark:border-zinc-800 dark:bg-zinc-900">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={toolbarButtonClass(editor.isActive('bold'))}>
          Bold
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={toolbarButtonClass(editor.isActive('italic'))}>
          Italic
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={toolbarButtonClass(editor.isActive('bulletList'))}>
          • List
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={toolbarButtonClass(editor.isActive('orderedList'))}>
          1. List
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          className={toolbarButtonClass(false)}
        >
          Clear formatting
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
