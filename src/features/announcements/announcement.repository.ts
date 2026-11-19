import { createClient } from '@supabase/supabase-js';
import { getMembersAssignedToLeader } from '@/src/features/assignments/service';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface AnnouncementAcknowledgementRow {
  id: string;
  event_id: string;
  member_id: string;
  acknowledged_at: string;
}

// DIP-FP-191-web: repeated taps are harmless — ON CONFLICT (event_id, member_id)
// DO NOTHING (via ignoreDuplicates), then a follow-up SELECT returns the row
// regardless of whether this call created it or a prior one already had. A plain
// upsert().select().single() would throw "no rows returned" on the DO NOTHING
// path, breaking that idempotency guarantee — this two-step avoids that.
export async function createAnnouncementAcknowledgement(
  tenantId: string,
  eventId: string,
  memberId: string
): Promise<AnnouncementAcknowledgementRow> {
  const db = serviceClient();

  const { error: upsertError } = await db
    .from('announcement_acknowledgements')
    .upsert(
      { tenant_id: tenantId, event_id: eventId, member_id: memberId },
      { onConflict: 'event_id,member_id', ignoreDuplicates: true }
    );

  if (upsertError) throw upsertError;

  const { data, error } = await db
    .from('announcement_acknowledgements')
    .select('id, event_id, member_id, acknowledged_at')
    .eq('tenant_id', tenantId)
    .eq('event_id', eventId)
    .eq('member_id', memberId)
    .single();

  if (error) throw error;
  return data as AnnouncementAcknowledgementRow;
}

// Distinguishes "this event really is the tenant's Announcement system type"
// from any other event_type_id — the acknowledge endpoint must never be usable
// against a real event (self-reports/attendance own that path; see the DIP's
// non-negotiable separation requirement).
export async function isAnnouncementEvent(tenantId: string, eventId: string): Promise<boolean> {
  const db = serviceClient();

  const { data: event, error: eventError } = await db
    .from('events')
    .select('event_type_id')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .single();

  if (eventError || !event) return false;

  const { count } = await db
    .from('event_types')
    .select('id', { count: 'exact', head: true })
    .eq('id', event.event_type_id)
    .eq('tenant_id', tenantId)
    .eq('system_key', 'ANNOUNCEMENT');

  return (count ?? 0) > 0;
}

// DIP-FP-191-web-adj-1: per-caller acknowledgement state for GET /api/events/:id
// — null means this specific member hasn't acknowledged this specific event
// (including every non-Announcement event, which simply has no row here).
export async function getAcknowledgedAt(
  tenantId: string,
  eventId: string,
  memberId: string
): Promise<string | null> {
  const { data } = await serviceClient()
    .from('announcement_acknowledgements')
    .select('acknowledged_at')
    .eq('tenant_id', tenantId)
    .eq('event_id', eventId)
    .eq('member_id', memberId)
    .maybeSingle();

  return data?.acknowledged_at ?? null;
}

// DIP-FP-191-web-adj-2: batch equivalent of getAcknowledgedAt for a whole list
// — one query for the caller's own acknowledgement rows across eventIds,
// merged client-side by the caller (listEventsForMember), rather than a
// per-row query per event. Missing from the map means not yet acknowledged
// (or not an Announcement at all) — same "absence = null" contract as the
// single-event lookup above.
export async function getAcknowledgedAtMap(
  tenantId: string,
  memberId: string,
  eventIds: string[]
): Promise<Map<string, string>> {
  if (eventIds.length === 0) return new Map();

  const { data, error } = await serviceClient()
    .from('announcement_acknowledgements')
    .select('event_id, acknowledged_at')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .in('event_id', eventIds);

  if (error) throw error;

  return new Map((data ?? []).map((r: { event_id: string; acknowledged_at: string }) => [r.event_id, r.acknowledged_at]));
}

export interface AnnouncementRosterEntry {
  member_id: string;
  first_name: string;
  last_name: string;
  acknowledged_at: string | null;
}

// DIP-FP-191-web-adj-4: Announcement-scoped equivalent of getEventRoster()
// (events/service.ts) — same event_attendees-is-the-real-roster,
// getMembersAssignedToLeader()-scoping, left-join-by-member_id shape, just
// joined against announcement_acknowledgements instead of rsvps. Kept as a
// sibling function/endpoint rather than extending getEventRoster() itself —
// that one is deliberately RSVP-only (FP-67 Design Decision).
export async function getAnnouncementRoster(
  eventId: string,
  tenantId: string,
  scopeToLeaderMemberId?: string
): Promise<AnnouncementRosterEntry[]> {
  const db = serviceClient();

  const { data: attendees, error: attendeesError } = await db
    .from('event_attendees')
    .select('member_id, members(first_name, last_name)')
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId);

  if (attendeesError) throw attendeesError;

  let scopedAttendees = attendees ?? [];
  if (scopeToLeaderMemberId) {
    const assignedMembers = await getMembersAssignedToLeader(scopeToLeaderMemberId, tenantId);
    const assignedIds = new Set(assignedMembers.map((m) => (m as { id: string }).id));
    scopedAttendees = scopedAttendees.filter((a: { member_id: string }) => assignedIds.has(a.member_id));
  }

  const { data: acks, error: acksError } = await db
    .from('announcement_acknowledgements')
    .select('member_id, acknowledged_at')
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId);

  if (acksError) throw acksError;

  const ackByMember = new Map(
    (acks ?? []).map((a: { member_id: string; acknowledged_at: string }) => [a.member_id, a.acknowledged_at])
  );

  return scopedAttendees.map((a: { member_id: string; members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null }) => {
    const member = Array.isArray(a.members) ? a.members[0] : a.members;
    return {
      member_id: a.member_id,
      first_name: member?.first_name ?? '',
      last_name: member?.last_name ?? '',
      acknowledged_at: ackByMember.get(a.member_id) ?? null,
    };
  });
}
