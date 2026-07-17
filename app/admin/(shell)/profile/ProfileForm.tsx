'use client';

import { useState, useTransition } from 'react';
import { updateMyProfileAction } from './actions';

interface Props {
  token: string;
  email: string;
  initialFirstName: string;
  initialLastName: string;
  initialGender: string | null;
  initialMaritalStatus: string | null;
  initialBirthdate: string | null;
  groups: { id: string; name: string }[];
}

export default function ProfileForm({
  token, email, initialFirstName, initialLastName,
  initialGender, initialMaritalStatus, initialBirthdate, groups,
}: Props) {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [gender, setGender] = useState(initialGender ?? '');
  const [maritalStatus, setMaritalStatus] = useState(initialMaritalStatus ?? '');
  const [birthdate, setBirthdate] = useState(initialBirthdate ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateMyProfileAction(token, fd);
      if (res.error) { setError(res.error); return; }
      setSaved(true);
    });
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Email</label>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{email}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Groups</label>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {groups.length > 0 ? groups.map(g => g.name).join(', ') : 'No groups'}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>First name</label>
        <input
          name="firstName"
          type="text"
          required
          value={firstName}
          onChange={e => { setFirstName(e.target.value); setSaved(false); }}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Last name</label>
        <input
          name="lastName"
          type="text"
          required
          value={lastName}
          onChange={e => { setLastName(e.target.value); setSaved(false); }}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Gender</label>
        <select
          name="gender"
          value={gender}
          onChange={e => { setGender(e.target.value); setSaved(false); }}
          className={inputClass}
        >
          <option value="">Select…</option>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Marital status</label>
        <select
          name="maritalStatus"
          value={maritalStatus}
          onChange={e => { setMaritalStatus(e.target.value); setSaved(false); }}
          className={inputClass}
        >
          <option value="">Select…</option>
          <option value="SINGLE">Single</option>
          <option value="MARRIED">Married</option>
          <option value="WIDOWED">Widowed</option>
          <option value="DIVORCED">Divorced</option>
          <option value="SEPARATED">Separated</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Birthdate</label>
        <input
          name="birthdate"
          type="date"
          value={birthdate}
          onChange={e => { setBirthdate(e.target.value); setSaved(false); }}
          className={inputClass}
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-sm text-green-600 dark:text-green-400">Profile saved.</p>}

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}
