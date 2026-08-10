import {
  listMemberUnavailabilityRanges,
  insertMemberUnavailabilityRange,
  updateMemberUnavailabilityRange,
  deleteMemberUnavailabilityRange,
} from './member_unavailability.repository';
import type { MemberUnavailabilityRangeRow } from './member_unavailability.repository';

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDate(label: string, value: unknown): string {
  if (typeof value !== 'string' || !DATE_RE.test(value) || isNaN(new Date(value).getTime())) {
    throw err('VALIDATION_ERROR', `${label} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

// DIP-FP-190-web: self-service, mobile-only (no web UI for filing) —
// memberId is always supplied by the caller (ctx.memberId from the JWT),
// never a request parameter, matching FP-187's self-service pattern.
export async function listMyUnavailability(memberId: string, tenantId: string): Promise<MemberUnavailabilityRangeRow[]> {
  return listMemberUnavailabilityRanges(memberId, tenantId);
}

export async function createMyUnavailability(
  memberId: string, tenantId: string, startDate: unknown, endDate: unknown
): Promise<MemberUnavailabilityRangeRow> {
  const start = validateDate('startDate', startDate);
  const end = validateDate('endDate', endDate);
  if (end < start) {
    throw err('VALIDATION_ERROR', 'endDate must be on or after startDate');
  }
  return insertMemberUnavailabilityRange(memberId, tenantId, start, end);
}

// DIP-FP-190-web-adj-2: real atomic update, closing the edit gap flagged
// during FP-190's own testing — a genuine UPDATE, not a delete-then-recreate.
// Same validateDate/end-after-start validation as createMyUnavailability,
// reused directly, not reimplemented.
export async function updateMyUnavailability(
  id: string, memberId: string, tenantId: string, startDate: unknown, endDate: unknown
): Promise<MemberUnavailabilityRangeRow> {
  const start = validateDate('startDate', startDate);
  const end = validateDate('endDate', endDate);
  if (end < start) {
    throw err('VALIDATION_ERROR', 'endDate must be on or after startDate');
  }
  const updated = await updateMemberUnavailabilityRange(id, memberId, tenantId, start, end);
  if (!updated) throw err('NOT_FOUND', 'Unavailability range not found');
  return updated;
}

export async function deleteMyUnavailability(id: string, memberId: string, tenantId: string): Promise<void> {
  const deleted = await deleteMemberUnavailabilityRange(id, memberId, tenantId);
  if (!deleted) throw err('NOT_FOUND', 'Unavailability range not found');
}
