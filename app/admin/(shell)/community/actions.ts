'use server';

import { createClient } from '@supabase/supabase-js';
import { updateTenantSettings, uploadTenantLogo } from '@/src/features/tenant/service';

async function getAdminContext(token: string): Promise<{ tenantId: string; memberId: string } | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;

  if (!tenantId || !memberId || role !== 'ADMIN') return null;
  return { tenantId, memberId };
}

function mapError(e: unknown): string {
  const code = (e as { code?: string }).code;
  const msg = (e as Error).message ?? 'An unexpected error occurred';
  if (code === 'VALIDATION_ERROR' || code === 'INVALID_VALUE') return msg;
  return 'An unexpected error occurred. Please try again.';
}

export interface CommunityActionResult<T = undefined> {
  data?: T;
  error?: string;
}

export async function updateCommunityDetailsAction(
  token: string,
  formData: FormData
): Promise<CommunityActionResult> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };

  const tagline = (formData.get('tagline') as string | null)?.trim() || null;
  const description = (formData.get('description') as string | null)?.trim() || null;
  try {
    await updateTenantSettings(ctx.tenantId, { tagline, description });
    return {};
  } catch (e) { return { error: mapError(e) }; }
}

export async function uploadLogoAction(
  token: string,
  formData: FormData
): Promise<CommunityActionResult<{ logoUrl: string }>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };

  const file = formData.get('logo') as File | null;
  if (!file || file.size === 0) return { error: 'No file selected' };

  try {
    const logoUrl = await uploadTenantLogo(ctx.tenantId, file);
    return { data: { logoUrl } };
  } catch (e) { return { error: mapError(e) }; }
}
