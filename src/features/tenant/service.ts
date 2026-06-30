import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function getTenantSettings(tenantId: string) {
  const { data, error } = await serviceClient()
    .from('tenants')
    .select('id, name, attendance_window_hours, created_at')
    .eq('id', tenantId)
    .single();

  if (error) throw error;
  return data;
}

export async function updateTenantSettings(
  tenantId: string,
  input: { attendanceWindowHours?: number }
) {
  const patch: Record<string, unknown> = {};

  if (input.attendanceWindowHours !== undefined) {
    if (
      !Number.isInteger(input.attendanceWindowHours) ||
      input.attendanceWindowHours < 1 ||
      input.attendanceWindowHours > 720
    ) {
      const err = new Error('attendance_window_hours must be an integer between 1 and 720') as Error & { code: string };
      err.code = 'INVALID_VALUE';
      throw err;
    }
    patch.attendance_window_hours = input.attendanceWindowHours;
  }

  if (Object.keys(patch).length === 0) {
    const err = new Error('No updatable fields provided') as Error & { code: string };
    err.code = 'NO_FIELDS';
    throw err;
  }

  const { data, error } = await serviceClient()
    .from('tenants')
    .update(patch)
    .eq('id', tenantId)
    .select('id, name, attendance_window_hours')
    .single();

  if (error) throw error;
  return data;
}
