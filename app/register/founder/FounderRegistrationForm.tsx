'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { createTenantAndFoundingAdmin } from '@/src/features/founder-registration/founder-registration.service';

type PageState = 'idle' | 'submitting' | 'error';

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

export default function FounderRegistrationForm() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>('idle');
  const [error, setError] = useState<string | null>(null);

  const [communityName, setCommunityName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setPageState('submitting');

    try {
      const db = supabaseBrowserClient();

      // signUp() with user_metadata stashing all profile fields.
      // With enable_confirmations = false (local config), the session is returned
      // immediately — no email confirmation step. For production environments with
      // enable_confirmations = true, see PR description for the confirmation-link
      // handling approach.
      const { data: signUpData, error: signUpError } = await db.auth.signUp({
        email,
        password,
        options: {
          data: {
            community_name:  communityName,
            first_name:      firstName,
            last_name:       lastName,
            gender,
            marital_status:  maritalStatus,
            birthdate,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setPageState('error');
        return;
      }

      const session = signUpData.session;
      if (!session) {
        // enable_confirmations = true in production: a confirmation email was sent.
        // The founder must click the link before continuing.
        setError(
          'A confirmation email has been sent. Please check your inbox and click the link to complete registration.'
        );
        setPageState('error');
        return;
      }

      // Session available immediately — call the service to create tenant + member.
      await createTenantAndFoundingAdmin(session.access_token, {
        communityName,
        firstName,
        lastName,
        gender,
        maritalStatus,
        birthdate,
      });

      // Refresh the session so the new app_metadata claims (tenant_id, role, member_id)
      // propagate to the in-memory JWT before we redirect.
      await db.auth.refreshSession();

      router.push('/login');
    } catch (err: unknown) {
      const msg = (err as Error).message ?? 'Registration failed. Please try again.';
      setError(msg);
      setPageState('error');
    }
  }

  const isSubmitting = pageState === 'submitting';

  const inputClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';
  const fieldClass = 'flex flex-col gap-1.5';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className={fieldClass}>
        <label htmlFor="communityName" className={labelClass}>Community name</label>
        <input
          id="communityName" type="text" required
          value={communityName} onChange={e => setCommunityName(e.target.value)}
          placeholder="e.g. Grace Community Church"
          className={inputClass}
        />
      </div>

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

      <div className="grid grid-cols-2 gap-4">
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
      </div>

      <div className={fieldClass}>
        <label htmlFor="birthdate" className={labelClass}>Date of birth</label>
        <input
          id="birthdate" type="date" required
          value={birthdate} onChange={e => setBirthdate(e.target.value)}
          className={inputClass}
        />
      </div>

      <hr className="border-zinc-100 dark:border-zinc-800" />

      <div className={fieldClass}>
        <label htmlFor="email" className={labelClass}>Email address</label>
        <input
          id="email" type="email" required
          value={email} onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          className={inputClass}
        />
      </div>

      <div className={fieldClass}>
        <label htmlFor="password" className={labelClass}>Password</label>
        <input
          id="password" type="password" required minLength={8}
          value={password} onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <div className={fieldClass}>
        <label htmlFor="confirmPassword" className={labelClass}>Confirm password</label>
        <input
          id="confirmPassword" type="password" required minLength={8}
          value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-1 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isSubmitting ? 'Creating your community…' : 'Create community'}
      </button>

      <p className="text-center text-xs text-zinc-400 dark:text-zinc-600">
        Already have an account?{' '}
        <a href="/login" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
          Sign in
        </a>
      </p>
    </form>
  );
}
