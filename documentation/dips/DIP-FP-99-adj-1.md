Good catch — confirmed the root cause, and it needs a small web-side fix too, not just mobile. Let me walk through it, then give you the merge order.
Root cause
`GET /api/confirmations/pending`'s `PendingConfirmationRow` (both web and mobile) genuinely never carried event info — only `event_id`. The web repository function (`getPendingConfirmations`) already collects a `Set` of unique `eventIds` (to fetch RSVP rows), which is the natural place to also join in event details — it's just never done. This needs a small addition on both sides: web has to actually return the fields, mobile has to display them.
The fix — web (`owgc-tech/flockpulse-web`)
`src/features/confirmations/confirmation.types.ts` — add four fields to `PendingConfirmationRow`:

```ts
export interface PendingConfirmationRow {
  self_report_id: string;
  event_id: string;
  event_name: string;
  event_start_datetime: string;
  event_end_datetime: string;
  event_location_name: string;
  member_id: string;
  member_first_name: string;
  member_last_name: string;
  self_report_status: string;
  feedback: string | null;
  star_rating: number | null;
  submitted_at: string;
  rsvp_status: string | null;
  rsvp_reason: string | null;
}
```

`src/features/confirmations/confirmation.repository.ts`, in `getPendingConfirmations()` — right after the existing `eventIds` computation (used today for the RSVP fetch), add an events fetch and map it in:

```ts
const { data: eventData, error: eventError } = await serviceClient()
  .from('events')
  .select('id, name, start_datetime, end_datetime, location_name')
  .eq('tenant_id', tenantId)
  .in('id', eventIds);

if (eventError) throw eventError;

const eventMap = new Map<string, { name: string; start_datetime: string; end_datetime: string; location_name: string }>();
for (const e of (eventData ?? []) as { id: string; name: string; start_datetime: string; end_datetime: string; location_name: string }[]) {
  eventMap.set(e.id, e);
}
```

Then in the final `.map()`, add:

```ts
const event = eventMap.get(row['event_id'] as string);
return {
  self_report_id:    row['id'] as string,
  event_id:          row['event_id'] as string,
  event_name:            event?.name ?? '',
  event_start_datetime:  event?.start_datetime ?? '',
  event_end_datetime:    event?.end_datetime ?? '',
  event_location_name:   event?.location_name ?? '',
  member_id:         row['member_id'] as string,
  // ...rest unchanged
```

Tenant-scoped the same way every other query in this function already is.
The fix — mobile (`owgc-tech/flockpulse-mobile`)
`src/features/confirmations/types.ts` — mirror the same four fields (and update the doc comment, which currently says event name/date are not included — that's no longer true).
`app/(app)/(tabs)/confirmations/index.tsx` — add a date-range formatter and render event info above the member name:

```ts
function formatEventRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dateLabel = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dateLabel}, ${startTime} – ${endTime}`;
}
```

In `ConfirmationItem`, above the existing member-name `Text`:

```tsx
<Text style={styles.eventName}>{item.event_name}</Text>
<Text style={styles.meta}>{formatEventRange(item.event_start_datetime, item.event_end_datetime)}</Text>
<Text style={styles.meta}>{item.event_location_name}</Text>
```

Add `eventName: { fontSize: 15, fontWeight: "700", color: "#111" }` to the stylesheet.
Rewritten, complete instructions for CC
Web repo (`owgc-tech/flockpulse-web`) — new branch `feature/FP-99-adj-1-confirmation-event-info` (adjustment, since FP-99's PR #10 already merging without this):

1. `confirmation.types.ts` + `confirmation.repository.ts` — the event-join fix above.
2. Run `npm run build`, show full diff.
3. Save `documentation/dips/DIP-FP-99-adj-1.md`, commit `FP-99-adj-1: include event info in pending confirmations`, push, open PR against `dev`. Don't merge — I review, you merge.
Mobile repo (`owgc-tech/flockpulse-mobile`) — same branch as before, PR #11 (`feature/FP-96-FP-97-adj-1-reminder-and-role-refresh`), now with six fixes total:

1. `app/(app)/_layout.tsx` — the `readyUserIdRef` fix (stop re-triggering Face ID/passcode on every token refresh).
2. `src/features/profile/components/Avatar.tsx` — expand `ROLE_LABELS` to all seven roles.
3. `app/(app)/events/[id]/self-report.tsx` — dedicated `submitButton` style (drop the oversized shared `.button` reuse).
4. `app/(app)/events/create.tsx` and `app/(app)/events/[id]/edit.tsx` — the Done-button iOS date/time picker redesign, identically in both.
5. `src/features/confirmations/types.ts` + `app/(app)/(tabs)/confirmations/index.tsx` — the event-info display fix above.
Run `npx tsc --noEmit`, show the full diff for all six files. No new DIP — same PR #11, note all of this in the PR description. Push to the same branch.
