import { createClient } from '@supabase/supabase-js';

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
