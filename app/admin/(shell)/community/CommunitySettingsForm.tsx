'use client';

import { useRef, useState, useTransition } from 'react';
import {
  updateCommunityDetailsAction, updateCommunityNameAction, updateCommunityRsvpSettingsAction,
  updateCommunityInviteEmailAction, updateCommunityTimezoneAction, uploadLogoAction,
} from './actions';
import RichTextEditor from './RichTextEditor';

interface Props {
  token: string;
  communityName: string;
  initialLogoUrl: string | null;
  initialTagline: string | null;
  initialDescription: string | null;
  initialAttendanceWindowHours: number;
  initialRsvpClosureDaysDefault: number;
  initialRsvpNudgeDays1: number;
  initialRsvpNudgeDays2: number;
  initialRsvpNudgeDays3: number;
  // DIP-FP-196-web: null means "using the platform default" — pre-filled
  // with real wording by the seed migration for tenants that existed before
  // this DIP, so in practice these are rarely actually null in the UI.
  initialInviteEmailSubject: string | null;
  initialInviteEmailBody: string | null;
  // DIP-FP-198-web: NOT NULL DEFAULT 'America/Toronto' — never null.
  initialTimezone: string;
  // DIP-FP-114-web: Admin-tier only — Leader-tier gets a read-only view.
  canEdit: boolean;
}

const DEFAULT_INVITE_SUBJECT_PLACEHOLDER = 'You have been invited to join {{tenant_name}} on FlockPulse';
const DEFAULT_INVITE_BODY_PLACEHOLDER = '<p>You have been invited to join {{tenant_name}} on FlockPulse.</p>';
// DIP-FP-198-web: native ES2022+ API, already usable given this app's
// Next.js/Node runtime — no new package needed for a full valid-IANA-name
// list. Sorted for a predictable dropdown order.
const TIMEZONE_OPTIONS = Intl.supportedValuesOf('timeZone').sort();

const TAGLINE_MAX = 150;
const DESCRIPTION_MAX = 500;
const NAME_MAX = 150;
const INVITE_EMAIL_SUBJECT_MAX = 200;

export default function CommunitySettingsForm({
  token, communityName, initialLogoUrl, initialTagline, initialDescription,
  initialAttendanceWindowHours, initialRsvpClosureDaysDefault,
  initialRsvpNudgeDays1, initialRsvpNudgeDays2, initialRsvpNudgeDays3,
  initialInviteEmailSubject, initialInviteEmailBody, initialTimezone, canEdit,
}: Props) {
  const [name, setName] = useState(communityName);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [tagline, setTagline] = useState(initialTagline ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [attendanceWindowHours, setAttendanceWindowHours] = useState(String(initialAttendanceWindowHours));
  const [rsvpClosureDaysDefault, setRsvpClosureDaysDefault] = useState(String(initialRsvpClosureDaysDefault));
  const [rsvpNudgeDays1, setRsvpNudgeDays1] = useState(String(initialRsvpNudgeDays1));
  const [rsvpNudgeDays2, setRsvpNudgeDays2] = useState(String(initialRsvpNudgeDays2));
  const [rsvpNudgeDays3, setRsvpNudgeDays3] = useState(String(initialRsvpNudgeDays3));
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [logoSaved, setLogoSaved] = useState(false);
  const [rsvpSettingsError, setRsvpSettingsError] = useState<string | null>(null);
  const [rsvpSettingsSaved, setRsvpSettingsSaved] = useState(false);
  const [inviteEmailSubject, setInviteEmailSubject] = useState(initialInviteEmailSubject ?? '');
  const [inviteEmailBody, setInviteEmailBody] = useState(initialInviteEmailBody ?? '');
  const [inviteEmailBodyIsEmpty, setInviteEmailBodyIsEmpty] = useState(!initialInviteEmailBody);
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteEmailSaved, setInviteEmailSaved] = useState(false);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [timezoneSaved, setTimezoneSaved] = useState(false);
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

  function handleInviteEmailSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteEmailError(null);
    setInviteEmailSaved(false);
    const fd = new FormData(e.currentTarget);
    // DIP-FP-196-web: Tiptap's "empty" editor still outputs markup like
    // <p></p>, not an empty string — sending that through would defeat the
    // "clear the field to reset to the platform default" semantics the
    // server action relies on (a plain .trim() on <p></p> is still truthy).
    // inviteEmailBodyIsEmpty is Tiptap's own isEmpty check, tracked via
    // RichTextEditor's onChange, so this overrides the hidden field's raw
    // value with a real empty string when the admin has genuinely cleared it.
    if (inviteEmailBodyIsEmpty) fd.set('inviteEmailBody', '');
    startTransition(async () => {
      const res = await updateCommunityInviteEmailAction(token, fd);
      if (res.error) { setInviteEmailError(res.error); return; }
      setInviteEmailSaved(true);
    });
  }

  function handleTimezoneSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTimezoneError(null);
    setTimezoneSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateCommunityTimezoneAction(token, fd);
      if (res.error) { setTimezoneError(res.error); return; }
      setTimezoneSaved(true);
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

            <div className="flex flex-col gap-2">
              <label className={labelClass}>RSVP nudge reminders (days before closure)</label>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-500 dark:text-zinc-400">1st nudge</label>
                  <input
                    name="rsvpNudgeDays1"
                    type="number"
                    min={0}
                    max={90}
                    value={rsvpNudgeDays1}
                    onChange={e => { setRsvpNudgeDays1(e.target.value); setRsvpSettingsSaved(false); }}
                    className={inputClass}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-500 dark:text-zinc-400">2nd nudge</label>
                  <input
                    name="rsvpNudgeDays2"
                    type="number"
                    min={0}
                    max={90}
                    value={rsvpNudgeDays2}
                    onChange={e => { setRsvpNudgeDays2(e.target.value); setRsvpSettingsSaved(false); }}
                    className={inputClass}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-500 dark:text-zinc-400">3rd nudge</label>
                  <input
                    name="rsvpNudgeDays3"
                    type="number"
                    min={0}
                    max={90}
                    value={rsvpNudgeDays3}
                    onChange={e => { setRsvpNudgeDays3(e.target.value); setRsvpSettingsSaved(false); }}
                    className={inputClass}
                    required
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Attendance Reporting and Confirmation Window (hours)</label>
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
              <p className="text-zinc-500 dark:text-zinc-400">RSVP closure default (days)</p>
              <p>{rsvpClosureDaysDefault}</p>
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">RSVP nudge reminders (days before closure)</p>
              <p>{rsvpNudgeDays1}, {rsvpNudgeDays2}, {rsvpNudgeDays3}</p>
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">Attendance Reporting and Confirmation Window (hours)</p>
              <p>{attendanceWindowHours}</p>
            </div>
          </div>
        )}
      </div>

      {/* Timezone — DIP-FP-198-web */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Timezone</h2>
        <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
          Used to determine the correct calendar day for date-based rules, such as member unavailability.
        </p>
        {canEdit ? (
          <form onSubmit={handleTimezoneSave} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Timezone</label>
              <select
                name="timezone"
                value={timezone}
                onChange={e => { setTimezone(e.target.value); setTimezoneSaved(false); }}
                className={inputClass}
              >
                {TIMEZONE_OPTIONS.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>

            {timezoneError && <p className="text-sm text-red-600 dark:text-red-400">{timezoneError}</p>}
            {timezoneSaved && <p className="text-sm text-green-600 dark:text-green-400">Timezone saved.</p>}
            <div>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isPending ? 'Saving…' : 'Save timezone'}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{timezone}</p>
        )}
      </div>

      {/* Invitation Email — DIP-FP-196-web */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Invitation Email</h2>
        <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
          Customize the subject and message new members receive when invited. Available placeholders:{' '}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">{'{{invite_link}}'}</code>,{' '}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">{'{{tenant_name}}'}</code>,{' '}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">{'{{invitee_email}}'}</code>.
          Clear a field to reset it to the default.
        </p>
        {canEdit ? (
          <form onSubmit={handleInviteEmailSave} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Subject</label>
              <input
                name="inviteEmailSubject"
                type="text"
                maxLength={INVITE_EMAIL_SUBJECT_MAX}
                value={inviteEmailSubject}
                onChange={e => { setInviteEmailSubject(e.target.value); setInviteEmailSaved(false); }}
                placeholder={DEFAULT_INVITE_SUBJECT_PLACEHOLDER}
                className={inputClass}
              />
              <p className="text-right text-xs text-zinc-400">{inviteEmailSubject.length}/{INVITE_EMAIL_SUBJECT_MAX}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Body</label>
              <RichTextEditor
                content={inviteEmailBody || DEFAULT_INVITE_BODY_PLACEHOLDER}
                onChange={(html, isEmpty) => {
                  setInviteEmailBody(html);
                  setInviteEmailBodyIsEmpty(isEmpty);
                  setInviteEmailSaved(false);
                }}
              />
              {/* RichTextEditor isn't a native form input — its current HTML
                  is mirrored here so handleInviteEmailSave's FormData read
                  picks it up, same pattern the file input above uses via its
                  own ref/onChange, just via a hidden field instead. */}
              <input type="hidden" name="inviteEmailBody" value={inviteEmailBody} readOnly />
            </div>

            {inviteEmailError && <p className="text-sm text-red-600 dark:text-red-400">{inviteEmailError}</p>}
            {inviteEmailSaved && <p className="text-sm text-green-600 dark:text-green-400">Invitation email saved.</p>}
            <div>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isPending ? 'Saving…' : 'Save invitation email'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4 text-sm text-zinc-700 dark:text-zinc-300">
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">Subject</p>
              <p>{inviteEmailSubject || DEFAULT_INVITE_SUBJECT_PLACEHOLDER}</p>
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">Body</p>
              <div
                className="[&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                dangerouslySetInnerHTML={{ __html: inviteEmailBody || DEFAULT_INVITE_BODY_PLACEHOLDER }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
