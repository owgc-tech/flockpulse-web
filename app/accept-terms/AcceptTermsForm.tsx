'use client';

import { useActionState, useState } from 'react';
import { acceptTermsAction, type AcceptTermsState } from './actions';
import { AcceptTermsCheckbox, ConfirmAdultCheckbox } from '@/src/features/legal/LegalCheckboxes';

const initialState: AcceptTermsState = {};

export default function AcceptTermsForm() {
  const [state, formAction, isPending] = useActionState(acceptTermsAction, initialState);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [confirmAdult, setConfirmAdult] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <AcceptTermsCheckbox checked={acceptTerms} onChange={setAcceptTerms} />
        <ConfirmAdultCheckbox checked={confirmAdult} onChange={setConfirmAdult} />
      </div>

      <button
        type="submit"
        disabled={isPending || !acceptTerms || !confirmAdult}
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? 'Saving…' : 'Continue'}
      </button>

      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
        If you do not agree, you can delete your account.
      </p>
    </form>
  );
}
