import { createClient } from '@supabase/supabase-js';
import type { RsvpRow } from './rsvp.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function isExpectedAttendee(
  tenantId: string,
  eventId: string,
  memberId: string
): Promise<boolean> {
  const { count } = await serviceClient()
    .from('event_attendees')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('event_id', eventId)
    .eq('member_id', memberId);

  return (count ?? 0) > 0;
}

export async function getEventForRsvp(
  tenantId: string,
  eventId: string
): Promise<{ status: string; start_datetime: string } | null> {
  const { data } = await serviceClient()
    .from('events')
    .select('status, start_datetime')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .single();

  return data ?? null;
}

export async function checkBlockedByGuard(eventId: string): Promise<boolean> {
  // First real caller of block_actions_on_cancelled_or_locked() — built in FP-13
  // migration 20260629000005. Returns true if event is CANCELLED or LOCKED.
  const { data } = await serviceClient().rpc('block_actions_on_cancelled_or_locked', {
    p_event_id: eventId,
  });

  return data === true;
}

export async function upsertRsvp(
  tenantId: string,
  eventId: string,
  memberId: string,
  rsvpStatus: 'YES' | 'NO',
  rsvpReason: string | null
): Promise<RsvpRow> {
  const now = new Date().toISOString();

  const { data, error } = await serviceClient()
    .from('rsvps')
    .upsert(
      {
        tenant_id: tenantId,
        event_id: eventId,
        member_id: memberId,
        rsvp_status: rsvpStatus,
        rsvp_reason: rsvpReason,
        responded_at: now,
        updated_at: now,
      },
      { onConflict: 'tenant_id,event_id,member_id' }
    )
    .select('id, tenant_id, event_id, member_id, rsvp_status, rsvp_reason, responded_at, created_at, updated_at')
    .single();

  if (error) throw error;

  // TODO(EPIC-10): write audit_logs entry (before/after RSVP state) once audit_logs table
  // and audit.service exist — see Engineering Spec §6. This is intentional scope discipline,
  // not an oversight — the audit_logs table belongs in EPIC-10/WP-2, not here.

  return data as RsvpRow;
}
