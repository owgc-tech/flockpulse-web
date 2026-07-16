import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface AuditLogFilters {
  entityType?: string;
  entityId?: string;
  action?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface AuditLogRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  before_value: unknown;
  after_value: unknown;
  created_at: string;
}

// actor_id has no FK — audit_logs preserves it permanently even past member
// deletion (see 20260629000017_audit_logs.sql's own comment) — so this can't
// be a PostgREST embed; actor names are resolved via a separate lookup.
// A genuinely NULL actor_id is a system action (e.g. the auto-resolved
// DID_NOT_ATTEND write in submit_self_report_no() has no human actor) and is
// labeled "System"; an actor_id that no longer matches any member row is a
// deleted member and is labeled accordingly — neither case errors or blanks.
export async function getAuditLogs(
  tenantId: string,
  filters: AuditLogFilters
): Promise<AuditLogRow[]> {
  const db = serviceClient();

  let query = db
    .from('audit_logs')
    .select('id, entity_type, entity_id, action, actor_id, before_value, after_value, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (filters.entityType) query = query.eq('entity_type', filters.entityType);
  if (filters.entityId) query = query.eq('entity_id', filters.entityId);
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.actorId) query = query.eq('actor_id', filters.actorId);
  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
  if (filters.dateTo) query = query.lte('created_at', filters.dateTo);

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const rows = data as {
    id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    actor_id: string | null;
    before_value: unknown;
    after_value: unknown;
    created_at: string;
  }[];

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => id !== null))];

  const actorMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors, error: actorError } = await db
      .from('members')
      .select('id, first_name, last_name')
      .eq('tenant_id', tenantId)
      .in('id', actorIds);

    if (actorError) throw actorError;
    for (const a of (actors ?? []) as { id: string; first_name: string; last_name: string }[]) {
      actorMap.set(a.id, `${a.first_name} ${a.last_name}`);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action: row.action,
    actor_id: row.actor_id,
    actor_name: row.actor_id === null ? 'System' : (actorMap.get(row.actor_id) ?? 'Deleted Member'),
    before_value: row.before_value,
    after_value: row.after_value,
    created_at: row.created_at,
  }));
}
