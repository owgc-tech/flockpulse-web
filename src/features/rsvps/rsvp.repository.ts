import { createClient } from '@supabase/supabase-js';
import type { RsvpRow, RsvpStatus } from './rsvp.types';

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

export async function getEventExistsForTenant(
  tenantId: string,
  eventId: string
): Promise<boolean> {
  const { count } = await serviceClient()
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('id', eventId)
    .eq('tenant_id', tenantId);

  return (count ?? 0) > 0;
}

export async function getEventEffectiveStatus(eventId: string): Promise<string | null> {
  const { data } = await serviceClient().rpc('get_event_effective_status', {
    p_event_id: eventId,
  });

  return data ?? null;
}

// FP-133: fetches the event's start time and per-event RSVP closure override
// (null = use the tenant default) for the closure-cutoff computation in
// submitRsvp().
export async function getEventClosureInfo(
  eventId: string
): Promise<{ start_datetime: string; rsvp_closure_days: number | null } | null> {
  const { data } = await serviceClient()
    .from('events')
    .select('start_datetime, rsvp_closure_days')
    .eq('id', eventId)
    .single();

  return data ?? null;
}

// FP-133: tenant-level default for the closure cutoff — 0 preserves today's
// behavior (cutoff = event start).
export async function getTenantRsvpClosureDaysDefault(tenantId: string): Promise<number> {
  const { data } = await serviceClient()
    .from('tenants')
    .select('rsvp_closure_days_default')
    .eq('id', tenantId)
    .single();

  return data?.rsvp_closure_days_default ?? 0;
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
  rsvpStatus: RsvpStatus,
  rsvpReason: string | null
): Promise<RsvpRow> {
  const { data, error } = await serviceClient().rpc('upsert_rsvp_with_audit', {
    p_tenant_id: tenantId,
    p_event_id: eventId,
    p_member_id: memberId,
    p_rsvp_status: rsvpStatus,
    p_rsvp_reason: rsvpReason,
    p_actor_member_id: memberId,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return row as RsvpRow;
}
