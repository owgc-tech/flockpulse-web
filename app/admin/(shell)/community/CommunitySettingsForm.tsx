'use client';

import { useRef, useState, useTransition } from 'react';
import { updateTaglineAction, uploadLogoAction } from './actions';

interface Props {
  token: string;
  communityName: string;
  initialLogoUrl: string | null;
  initialTagline: string | null;
}

const TAGLINE_MAX = 150;

export default function CommunitySettingsForm({
  token, communityName, initialLogoUrl, initialTagline,
}: Props) {
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [tagline, setTagline] = useState(initialTagline ?? '');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [taglineError, setTaglineError] = useState<string | null>(null);
  const [taglineSaved, setTaglineSaved] = useState(false);
  const [logoSaved, setLogoSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialLogoUrl);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setLogoError(null);
    setLogoSaved(false);
  }

  function handleLogoUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLogoError(null);
    setLogoSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await uploadLogoAction(token, fd);
      if (res.error) { setLogoError(res.error); return; }
      if (res.data) {
        setLogoUrl(res.data.logoUrl);
        setPreviewUrl(res.data.logoUrl);
        setLogoSaved(true);
      }
    });
  }

  function handleTaglineSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTaglineError(null);
    setTaglineSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateTaglineAction(token, fd);
      if (res.error) { setTaglineError(res.error); return; }
      setTaglineSaved(true);
    });
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <div className="flex flex-col gap-8">
      {/* Community name — read only */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Community Name</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Community name is set during registration and cannot be changed here.
        </p>
        <p className="mt-2 text-base font-medium text-zinc-900 dark:text-zinc-100">{communityName}</p>
      </div>

      {/* Logo */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Community Logo</h2>
        <form onSubmit={handleLogoUpload} className="flex flex-col gap-4">
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Logo preview"
              className="h-20 w-20 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700"
            />
          )}
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Upload logo</label>
            <input
              ref={fileRef}
              name="logo"
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFileChange}
              className="text-sm text-zinc-700 dark:text-zinc-300 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 dark:file:bg-zinc-800 dark:file:text-zinc-300"
            />
            <p className="text-xs text-zinc-400">Square image, minimum 256×256 px, PNG or JPG, max 2 MB</p>
          </div>
          {logoError && <p className="text-sm text-red-600 dark:text-red-400">{logoError}</p>}
          {logoSaved && <p className="text-sm text-green-600 dark:text-green-400">Logo updated.</p>}
          <div>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isPending ? 'Uploading…' : 'Upload logo'}
            </button>
          </div>
        </form>
      </div>

      {/* Tagline */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Tagline</h2>
        <form onSubmit={handleTaglineSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>
              Tagline{' '}
              <span className="font-normal text-zinc-400">(optional, shown below your community name)</span>
            </label>
            <textarea
              name="tagline"
              rows={2}
              maxLength={TAGLINE_MAX}
              value={tagline}
              onChange={e => { setTagline(e.target.value); setTaglineSaved(false); }}
              className={`${inputClass} resize-none`}
              placeholder="e.g. Serving the city of Portland since 1998"
            />
            <p className="text-right text-xs text-zinc-400">{tagline.length}/{TAGLINE_MAX}</p>
          </div>
          {taglineError && <p className="text-sm text-red-600 dark:text-red-400">{taglineError}</p>}
          {taglineSaved && <p className="text-sm text-green-600 dark:text-green-400">Tagline saved.</p>}
          <div>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isPending ? 'Saving…' : 'Save tagline'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
