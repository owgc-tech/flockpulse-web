'use client';

import { useState, useEffect, useActionState } from 'react';
import { startMFAEnrollAction, verifyMFAEnrollAction, type MFAEnrollVerifyState } from './actions';

const initialState: MFAEnrollVerifyState = {};

export default function MFAEnrollForm() {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    startMFAEnrollAction().then(result => {
      if ('error' in result) {
        setLoadError(result.error);
      } else {
        setFactorId(result.factorId);
        setQrCode(result.qrCode);
        setSecret(result.secret);
      }
    });
  }, []);

  const boundAction = factorId
    ? verifyMFAEnrollAction.bind(null, factorId)
    : async (_prev: MFAEnrollVerifyState, _fd: FormData) =>
        ({ error: 'Enrollment not started.' } as MFAEnrollVerifyState);

  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  const inputClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full tracking-widest text-center text-lg';

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {loadError}
      </div>
    );
  }

  if (!qrCode) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Setting up authenticator…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy).
        </p>
        {/* qr_code is returned as an SVG data URI — render directly */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrCode} alt="TOTP QR code" width={180} height={180} />
        <details className="w-full">
          <summary className="cursor-pointer text-xs text-zinc-400 dark:text-zinc-600">
            Can&apos;t scan? Enter the secret manually
          </summary>
          <p className="mt-2 break-all rounded bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {secret}
          </p>
        </details>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        {state.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {state.error}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="code" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Verification code
          </label>
          <input
            id="code" name="code" type="text" inputMode="numeric"
            pattern="[0-9]{6}" maxLength={6} required
            placeholder="000000"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? 'Verifying…' : 'Activate authenticator'}
        </button>
      </form>
    </div>
  );
}
