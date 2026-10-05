import { createClient } from '@supabase/supabase-js';

// FP-222-adj-1: WHAT changed on an event since a member last opened it — the
// human labels the mobile "RECENTLY MODIFIED" strip shows ("Changed: Date & time,
// Location"). Labels only, never old/new values.
//
// How it is derived (no new table or trigger — the existing audit log):
//   - events.version is bumped by exactly three sources (listed below). Only one of
//     them, update_event_with_audit(), writes an audit_logs entry (entity_type
//     'event', action 'update') whose before_value / after_value are the whole
//     events row before and after, so after_value.version is the NEW version and
//     before_value.version the old one.
//   - For a member whose last_seen_version is L and whose event is now at version V
//     (V > L), every version L+1..V is accounted for:
//       * an audit entry with after_value.version = v -> compare before/after column
//         by column and map each differing column to a label (COLUMN_LABELS);
//       * NO audit entry for v -> the bump came from a non-audited source (a task
//         assignment change, or a removed member being pruned from tasks) -> 'Tasks'.
//   - Labels are de-duplicated and returned in LABEL_ORDER. If the event is modified
//     but nothing can be derived (e.g. an edit that saved identical values), the
//     answer is ['Details'].
//
// events.version bump sources. THIS LIST MUST STAY COMPLETE: a source added without
// an audit entry would be shown as 'Tasks' (wrong), a source with an audit entry that
// is not an 'update' would be invisible. scripts/test-fp222-adj1-what-changed.ts
// queries the database catalog for every function that bumps events.version and
// fails if the set differs from the lists below, so a new bump source is noticed.
export const AUDITED_VERSION_BUMP_SOURCES = [
  // Event-field edits (PATCH /api/events/:id). Writes write_audit_log(... 'event', id, 'update', ...).
  'update_event_with_audit',
] as const;

export const NON_AUDITED_VERSION_BUMP_SOURCES = [
  // create_task_assignment / update_task_assignment (only when the assignee really
  // changed) / delete_task_assignment / auto_assign_task_slots (only events it changed)
  // all call this. No audit entry.
  'bump_event_version_for_task_change',
  // AFTER UPDATE OF deleted_at trigger on members: removing a member (admin Remove or
  // in-app delete) prunes them from task assignments and bumps each affected event
  // once. No audit entry. (The one-time cleanup in migration 20261004000076 bumped
  // the same way, once, historically.)
  'prune_deleted_member_from_assignments',
] as const;

// The real events columns, mapped to the fixed vocabulary. (There is no
// "description" column: announcement_body — the write-up of an Announcement event —
// is the only free-text body, so it maps to 'Description'.)
const COLUMN_LABELS: Record<string, string> = {
  name: 'Name',
  announcement_body: 'Description',
  start_datetime: 'Date & time',
  end_datetime: 'Date & time',
  location_name: 'Location',
  location_address: 'Location',
  event_type_id: 'Event type',
  online_meeting_url: 'Online meeting',
  online_meeting_platform_label: 'Online meeting',
  online_meeting_resource_id: 'Online meeting',
  talk_id: 'Talk',
  rsvp_closure_days: 'RSVP settings',
  guests_allowed: 'RSVP settings',
  target: 'Invitees',
  status: 'Status',
};

// System columns: never a user-visible change.
const IGNORED_COLUMNS = new Set(['id', 'tenant_id', 'version', 'updated_at', 'created_at']);

export const LABEL_ORDER = [
  'Name', 'Description', 'Date & time', 'Location', 'Event type', 'Online meeting',
  'Talk', 'RSVP settings', 'Invitees', 'Status', 'Tasks', 'Details',
] as const;

type Json = unknown;

function sortedStrings(v: Json): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice().sort() : [];
}

// The invitee selector is compared as sets (order and absent-vs-empty arrays are not
// a change a person would call "Invitees changed").
function sameTarget(a: Json, b: Json): boolean {
  const x = (a && typeof a === 'object' ? a : {}) as { group_ids?: Json; member_ids?: Json };
  const y = (b && typeof b === 'object' ? b : {}) as { group_ids?: Json; member_ids?: Json };
  return JSON.stringify(sortedStrings(x.group_ids)) === JSON.stringify(sortedStrings(y.group_ids))
    && JSON.stringify(sortedStrings(x.member_ids)) === JSON.stringify(sortedStrings(y.member_ids));
}

function sameValue(column: string, a: Json, b: Json): boolean {
  if (column === 'target') return sameTarget(a, b);
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Labels for one audit entry: every column that differs between before and after,
// excluding system columns. A differing column with no mapping is 'Details'.
export function diffLabels(before: Json, after: Json): Set<string> {
  const labels = new Set<string>();
  if (!before || typeof before !== 'object' || !after || typeof after !== 'object') {
    labels.add('Details');   // an audit entry we cannot read: something changed
    return labels;
  }
  const b = before as Record<string, Json>;
  const a = after as Record<string, Json>;
  for (const column of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (IGNORED_COLUMNS.has(column)) continue;
    if (sameValue(column, b[column], a[column])) continue;
    labels.add(COLUMN_LABELS[column] ?? 'Details');
  }
  return labels;
}

export interface AuditEntryForDiff { before_value: Json; after_value: Json }

// Pure: the labels for one event, from the audit entries that carry a version greater
// than lastSeenVersion. Entries missing for part of the range (or unreadable) never
// throw — they fall back to 'Tasks' / 'Details' as described at the top.
export function deriveModifiedFields(
  lastSeenVersion: number, currentVersion: number, entries: AuditEntryForDiff[]
): string[] {
  const labels = new Set<string>();
  const audited = new Set<number>();

  for (const entry of entries) {
    const v = Number((entry.after_value as { version?: Json } | null)?.version);
    if (!Number.isInteger(v) || v <= lastSeenVersion || v > currentVersion) continue;
    audited.add(v);
    for (const label of diffLabels(entry.before_value, entry.after_value)) labels.add(label);
  }

  for (let v = lastSeenVersion + 1; v <= currentVersion; v++) {
    if (!audited.has(v)) { labels.add('Tasks'); break; }
  }

  if (labels.size === 0) labels.add('Details');
  return LABEL_ORDER.filter((l) => labels.has(l));
}

// ONE query for a whole batch of modified events (the audit log is indexed on
// (tenant_id, entity_type, entity_id)); the version filter is applied by the database
// against the smallest last_seen_version in the batch (jsonb numeric comparison), and
// each event then only uses the entries newer than ITS OWN last_seen_version.
// Note: PostgREST caps a response at its configured max rows; a batch with more audit
// entries than that would lose the surplus (shown as 'Tasks'), which is far beyond a
// realistic page of recently modified events.
export async function getModifiedFieldsByEvent(
  tenantId: string,
  items: { id: string; lastSeenVersion: number; currentVersion: number }[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (items.length === 0) return result;

  const minSeen = Math.min(...items.map((i) => i.lastSeenVersion));
  const { data, error } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
    .from('audit_logs')
    .select('entity_id, before_value, after_value')
    .eq('tenant_id', tenantId)
    .eq('entity_type', 'event')
    .eq('action', 'update')
    .in('entity_id', items.map((i) => i.id))
    .gt('after_value->version', minSeen);
  if (error) throw error;

  const byEvent = new Map<string, AuditEntryForDiff[]>();
  for (const row of (data ?? []) as { entity_id: string; before_value: Json; after_value: Json }[]) {
    if (!byEvent.has(row.entity_id)) byEvent.set(row.entity_id, []);
    byEvent.get(row.entity_id)!.push(row);
  }
  for (const item of items) {
    result.set(item.id, deriveModifiedFields(item.lastSeenVersion, item.currentVersion, byEvent.get(item.id) ?? []));
  }
  return result;
}
