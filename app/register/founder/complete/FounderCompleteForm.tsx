'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { createTenantAndFoundingAdmin } from '@/src/features/founder-registration/founder-registration.service';

type PageState = 'loading' | 'ready' | 'submitting' | 'error';

const GENDER_OPTIONS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
];

const MARITAL_OPTIONS = [
  { value: 'SINGLE', label: 'Single' },
  { value: 'MARRIED', label: 'Married' },
  { value: 'WIDOWED', label: 'Widowed' },
  { value: 'DIVORCED', label: 'Divorced' },
  { value: 'SEPARATED', label: 'Separated' },
];

function supabaseBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function FounderCompleteForm() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>('loading');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [communityName, setCommunityName] = useState('');
  const [description, setDescription] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [birthdate, setBirthdate] = useState('');

  // Right column ref for measuring rendered height to set textarea height.
  const rightColRef = useRef<HTMLDivElement>(null);
  const communityNameFieldRef = useRef<HTMLDivElement>(null);
  const [textareaHeight, setTextareaHeight] = useState<number | null>(null);

  // Measure right column height after each render so the textarea fills the left column exactly.
  // useLayoutEffect avoids a visible jump on first paint.
  useLayoutEffect(() => {
    if (!rightColRef.current || !communityNameFieldRef.current) return;
    const rightHeight = rightColRef.current.getBoundingClientRect().height;
    const nameFieldHeight = communityNameFieldRef.current.getBoundingClientRect().height;
    // Gap between Community Name field and textarea is gap-5 = 20px (Tailwind default 4 = 1rem = 16px, gap-5 = 20px).
    const gap = 20;
    const computed = rightHeight - nameFieldHeight - gap;
    setTextareaHeight(computed > 80 ? computed : 80);
  });

  // Establish session on mount.
  // Two valid arrival paths:
  //   A) Came directly from Screen 1 (local dev, enable_confirmations=false):
  //      access token stored in sessionStorage by Screen 1.
  //   B) Arrived via email confirmation link (fpdb-dev, enable_confirmations=true):
  //      tokens delivered as #access_token=...&refresh_token=...&type=signup in URL hash.
  useEffect(() => {
    async function establishSession() {
      const db = supabaseBrowserClient();

      // Path A: token from Screen 1 via sessionStorage.
      const storedToken = sessionStorage.getItem('fp_founder_token');
      if (storedToken) {
        sessionStorage.removeItem('fp_founder_token');
        setSessionToken(storedToken);
        setPageState('ready');
        return;
      }

      // Path B: tokens from email confirmation link URL hash.
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');

      if (accessToken && refreshToken && type === 'signup') {
        const { error: sessionError } = await db.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          setError('Could not establish session from confirmation link: ' + sessionError.message);
          setPageState('error');
          return;
        }
        // Clear the hash so tokens aren't visible in the address bar.
        window.history.replaceState(null, '', window.location.pathname);
        setSessionToken(accessToken);
        setPageState('ready');
        return;
      }

      // No valid arrival path found — redirect back to Screen 1.
      router.replace('/register/founder');
    }

    establishSession();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionToken) return;
    setError(null);
    setPageState('submitting');

    try {
      const db = supabaseBrowserClient();

      await createTenantAndFoundingAdmin(sessionToken, {
        communityName,
        description: description.trim() || null,
        firstName,
        lastName,
        gender,
        maritalStatus,
        birthdate,
      });

      // Refresh session so new app_metadata claims (tenant_id, role, member_id)
      // propagate to the in-memory JWT before redirect.
      await db.auth.refreshSession();

      router.push('/login');
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Registration failed. Please try again.');
      setPageState('ready');
    }
  }

  if (pageState === 'loading') {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Verifying your account…</p>
      </div>
    );
  }

  if (pageState === 'error' && !sessionToken) {
    return (
      <div className="rounded-xl border border-red-200 bg-white p-6 dark:border-red-800 dark:bg-zinc-950">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  const isSubmitting = pageState === 'submitting';
  const inputClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';
  const fieldClass = 'flex flex-col gap-1.5';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Two-column layout divided by a vertical rule, both columns top-aligned */}
      <div className="flex items-start gap-0">
        {/* Left column: Community Name + Description */}
        <div className="flex flex-1 flex-col gap-5 pr-8">
          <div ref={communityNameFieldRef} className={fieldClass}>
            <label htmlFor="communityName" className={labelClass}>Community name</label>
            <input
              id="communityName" type="text" required
              value={communityName} onChange={e => setCommunityName(e.target.value)}
              placeholder="e.g. Grace Community Church"
              className={inputClass}
            />
          </div>

          <div className={fieldClass}>
            <label htmlFor="description" className={labelClass}>
              Description{' '}
              <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="A short description of your community…"
              style={textareaHeight !== null ? { height: textareaHeight } : undefined}
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>

        {/* Vertical rule */}
        <div className="w-px self-stretch bg-zinc-200 dark:bg-zinc-800" />

        {/* Right column: founder profile */}
        <div ref={rightColRef} className="flex flex-1 flex-col gap-5 pl-8">
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldClass}>
              <label htmlFor="firstName" className={labelClass}>First name</label>
              <input
                id="firstName" type="text" required
                value={firstName} onChange={e => setFirstName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className={fieldClass}>
              <label htmlFor="lastName" className={labelClass}>Last name</label>
              <input
                id="lastName" type="text" required
                value={lastName} onChange={e => setLastName(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className={fieldClass}>
            <label htmlFor="gender" className={labelClass}>Gender</label>
            <select
              id="gender" required
              value={gender} onChange={e => setGender(e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {GENDER_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className={fieldClass}>
            <label htmlFor="maritalStatus" className={labelClass}>Marital status</label>
            <select
              id="maritalStatus" required
              value={maritalStatus} onChange={e => setMaritalStatus(e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {MARITAL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className={fieldClass}>
            <label htmlFor="birthdate" className={labelClass}>Date of birth</label>
            <input
              id="birthdate" type="date" required
              value={birthdate} onChange={e => setBirthdate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isSubmitting ? 'Creating your community…' : 'Create community'}
        </button>
      </div>
    </form>
  );
}
