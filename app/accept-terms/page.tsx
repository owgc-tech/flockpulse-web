import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getAcceptanceRequired } from '@/src/features/legal/acceptance.service';
import { TermsLinks } from '@/src/features/legal/LegalCheckboxes';
import { signOutAction } from '@/app/admin/(shell)/actions';
import AcceptTermsForm from './AcceptTermsForm';

// FP-254: one-time screen for existing members. Outside the admin shell (the shell redirects here),
// but requires a signed-in user. Already accepted (or nothing required): straight on to /admin.
export default async function AcceptTermsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  if (!tenantId || !memberId) redirect('/login');

  let required = true;
  try {
    required = await getAcceptanceRequired(memberId, tenantId);
  } catch {
    // If the check itself fails, show the screen; accepting is harmless and the action re-checks nothing else.
  }
  if (!required) redirect('/admin');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <img src="/flockpulse-logo.png" alt="FlockPulse" className="mb-4 h-auto w-full" />
        <h1 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Please confirm to continue</h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          We updated our <TermsLinks withThe={false} />. Please read them, then confirm below. FlockPulse does not ask for your birthdate.
        </p>
        <AcceptTermsForm />
        <form action={signOutAction} className="mt-4 text-center">
          <button type="submit" className="text-xs text-zinc-400 underline hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
