'use client';

import { useActionState } from 'react';
import { sendInviteAction, type InviteActionState } from './actions';
import type { RoleCatalogEntryRow } from '@/src/features/role-catalog/role-catalog.types';

interface Group {
  id: string;
  name: string;
}

interface InviteFormProps {
  token: string;
  groups: Group[];
  // DIP-FP-192-web: sourced from the tenant's role_catalog, same order the
  // 7 hardcoded <option> tags used to have.
  roleCatalog: RoleCatalogEntryRow[];
}

const initialState: InviteActionState = {};

export default function InviteForm({ token, groups, roleCatalog }: InviteFormProps) {
  const boundAction = sendInviteAction.bind(null, token);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  if (state.success) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
        Invite sent successfully. The recipient will receive an email to complete registration.
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="member@example.com"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="roleCatalogEntryId" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Role
        </label>
        <select
          id="roleCatalogEntryId"
          name="roleCatalogEntryId"
          required
          defaultValue={roleCatalog[0]?.id ?? ''}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {roleCatalog.map(entry => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </select>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Role cannot be changed by the registrant — this is permanent until an Admin updates it.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="groupId" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Group <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <select
          id="groupId"
          name="groupId"
          defaultValue=""
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="">No Group Yet</option>
          {groups.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="mt-1 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? 'Sending…' : 'Send invite'}
      </button>
    </form>
  );
}
