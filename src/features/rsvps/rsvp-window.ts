// FP-134: single source of truth for "when does RSVP close" — used by both
// rsvp.service.ts's RSVP_CLOSED write guard and events/service.ts's read-path
// rsvp_closure_at field, so mobile never re-derives this arithmetic client-side.
export function computeRsvpClosureAt(
  startDatetime: string,
  eventOverrideDays: number | null,
  tenantDefaultDays: number
): string {
  const closureDays = eventOverrideDays ?? tenantDefaultDays;
  const cutoffMs = new Date(startDatetime).getTime() - closureDays * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString();
}
