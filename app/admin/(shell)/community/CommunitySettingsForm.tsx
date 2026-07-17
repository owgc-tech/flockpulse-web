'use client';

import { useRef, useState, useTransition } from 'react';
import {
  updateCommunityDetailsAction, updateCommunityNameAction, updateCommunityRsvpSettingsAction, uploadLogoAction,
} from './actions';

interface Props {
  token: string;
  communityName: string;
  initialLogoUrl: string | null;
  initialTagline: string | null;
  initialDescription: string | null;
  initialAttendanceWindowHours: number;
  initialRsvpClosureDaysDefault: number;
  // DIP-FP-114-web: Admin-tier only — Leader-tier gets a read-only view.
  canEdit: boolean;
}

const TAGLINE_MAX = 150;
const DESCRIPTION_MAX = 500;
const NAME_MAX = 150;

export default function CommunitySettingsForm({
  token, communityName, initialLogoUrl, initialTagline, initialDescription,
  initialAttendanceWindowHours, initialRsvpClosureDaysDefault, canEdit,
}: Props) {
  const [name, setName] = useState(communityName);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [tagline, setTagline] = useState(initialTagline ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [attendanceWindowHours, setAttendanceWindowHours] = useState(String(initialAttendanceWindowHours));
  const [rsvpClosureDaysDefault, setRsvpClosureDaysDefault] = useState(String(initialRsvpClosureDaysDefault));
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [logoSaved, setLogoSaved] = useState(false);
  const [rsvpSettingsError, setRsvpSettingsError] = useState<string | null>(null);
  const [rsvpSettingsSaved, setRsvpSettingsSaved] = useState(false);
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

  function handleDetailsSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDetailsError(null);
    setDetailsSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateCommunityDetailsAction(token, fd);
      if (res.error) { setDetailsError(res.error); return; }
      setDetailsSaved(true);
    });
  }

  function handleNameSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNameError(null);
    setNameSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateCommunityNameAction(token, fd);
      if (res.error) { setNameError(res.error); return; }
      setNameSaved(true);
    });
  }

  function handleRsvpSettingsSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRsvpSettingsError(null);
    setRsvpSettingsSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateCommunityRsvpSettingsAction(token, fd);
      if (res.error) { setRsvpSettingsError(res.error); return; }
      setRsvpSettingsSaved(true);
    });
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <div className="flex flex-col gap-8">
      {/* Community name */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Community Name</h2>
        {canEdit ? (
          <form onSubmit={handleNameSave} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <input
                name="name"
                value={name}
                onChange={e => { setName(e.target.value); setNameSaved(false); }}
                maxLength={NAME_MAX}
                required
                className={inputClass}
              />
            </div>
            {nameError && <p className="text-sm text-red-600 dark:text-red-400">{nameError}</p>}
            {nameSaved && <p className="text-sm text-green-600 dark:text-green-400">Name saved.</p>}
            <div>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isPending ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">{communityName}</p>
        )}
      </div>

      {/* Logo */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Community Logo</h2>
        {canEdit ? (
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
        ) : (
          previewUrl && (
            <img
              src={previewUrl}
              alt="Logo"
              className="h-20 w-20 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700"
            />
          )
        )}
      </div>

      {/* Community Details — tagline + description, one save */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Community Details</h2>
        {canEdit ? (
          <form onSubmit={handleDetailsSave} className="flex flex-col gap-5">
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
                onChange={e => { setTagline(e.target.value); setDetailsSaved(false); }}
                className={`${inputClass} resize-none`}
                placeholder="e.g. Serving the city of Portland since 1998"
              />
              <p className="text-right text-xs text-zinc-400">{tagline.length}/{TAGLINE_MAX}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>
                Description{' '}
                <span className="font-normal text-zinc-400">(optional, longer description of your community)</span>
              </label>
              <textarea
                name="description"
                rows={4}
                maxLength={DESCRIPTION_MAX}
                value={description}
                onChange={e => { setDescription(e.target.value); setDetailsSaved(false); }}
                className={`${inputClass} resize-none`}
                placeholder="Tell members about your community — its history, mission, or values."
              />
              <p className="text-right text-xs text-zinc-400">{description.length}/{DESCRIPTION_MAX}</p>
            </div>

            {detailsError && <p className="text-sm text-red-600 dark:text-red-400">{detailsError}</p>}
            {detailsSaved && <p className="text-sm text-green-600 dark:text-green-400">Details saved.</p>}
            <div>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isPending ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4 text-sm text-zinc-700 dark:text-zinc-300">
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">Tagline</p>
              <p>{tagline || '—'}</p>
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">Description</p>
              <p>{description || '—'}</p>
            </div>
          </div>
        )}
      </div>

      {/* RSVP & Attendance */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">RSVP &amp; Attendance</h2>
        {canEdit ? (
          <form onSubmit={handleRsvpSettingsSave} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Attendance window (hours)</label>
              <input
                name="attendanceWindowHours"
                type="number"
                min={1}
                max={720}
                value={attendanceWindowHours}
                onChange={e => { setAttendanceWindowHours(e.target.value); setRsvpSettingsSaved(false); }}
                className={inputClass}
                required
              />
              <p className="text-xs text-zinc-400">Hours after an event ends before attendance locks</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>RSVP closure default (days)</label>
              <input
                name="rsvpClosureDaysDefault"
                type="number"
                min={0}
                max={90}
                value={rsvpClosureDaysDefault}
                onChange={e => { setRsvpClosureDaysDefault(e.target.value); setRsvpSettingsSaved(false); }}
                className={inputClass}
                required
              />
              <p className="text-xs text-zinc-400">RSVP closes this many days before an event starts — 0 = at event start</p>
            </div>

            {rsvpSettingsError && <p className="text-sm text-red-600 dark:text-red-400">{rsvpSettingsError}</p>}
            {rsvpSettingsSaved && <p className="text-sm text-green-600 dark:text-green-400">RSVP &amp; attendance settings saved.</p>}
            <div>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isPending ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4 text-sm text-zinc-700 dark:text-zinc-300">
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">Attendance window (hours)</p>
              <p>{attendanceWindowHours}</p>
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">RSVP closure default (days)</p>
              <p>{rsvpClosureDaysDefault}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
