'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';

// FP-135: web's first sign-out control, invoked from UserAvatarMenu's popover.
export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
