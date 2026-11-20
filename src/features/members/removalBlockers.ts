// FP-258: pure helpers (no I/O) that turn "why can't this person be removed" into plain,
// kind sentences. No ids, no names. Used by members/service.ts (the API `message`) and
// MemberEditForm.tsx (the admin screen).

export type RemovalBlockers = {
  assignedMemberCount: number;
  ownedGroupCount: number;
  ownedEventCount: number;
  lastAdmin: boolean;
};

export type RemovalAudience = 'self' | 'admin';
export type BlockerKey = 'lastAdmin' | 'assignedMembers' | 'groups' | 'events';

export const EMPTY_BLOCKERS: RemovalBlockers = {
  assignedMemberCount: 0,
  ownedGroupCount: 0,
  ownedEventCount: 0,
  lastAdmin: false,
};

// Shown when a role change would leave a community with no Administrator (role PATCH).
export const LAST_ADMIN_DEMOTION_MESSAGE =
  "This is the community's only Administrator, so their role can't be changed. Make another member an Administrator first.";

export function hasBlockers(b: RemovalBlockers): boolean {
  return b.lastAdmin || b.assignedMemberCount > 0 || b.ownedGroupCount > 0 || b.ownedEventCount > 0;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// One sentence per block that is present, in this order: last Admin, members led, groups, events.
export function blockerSentences(
  b: RemovalBlockers,
  audience: RemovalAudience
): { key: BlockerKey; text: string }[] {
  const self = audience === 'self';
  const out: { key: BlockerKey; text: string }[] = [];

  if (b.lastAdmin) {
    out.push({
      key: 'lastAdmin',
      text: self
        ? "You are this community's only Administrator. Make another member an Administrator first, or email support@flockpulse.ca to close the community."
        : "This is the community's only Administrator. Make another member an Administrator first.",
    });
  }
  if (b.assignedMemberCount > 0) {
    const n = b.assignedMemberCount;
    out.push({
      key: 'assignedMembers',
      text: self
        ? `You lead ${n} ${plural(n, 'member', 'members')}. Ask your Administrator to assign them to another leader first.`
        : `This member leads ${n} ${plural(n, 'member', 'members')}. Reassign them first.`,
    });
  }
  if (b.ownedGroupCount > 0) {
    const n = b.ownedGroupCount;
    out.push({
      key: 'groups',
      text: self
        ? `You own ${n} ${plural(n, 'group', 'groups')}. Ask your Administrator to give them to someone else first.`
        : `This member owns ${n} ${plural(n, 'group', 'groups')}. Give them to someone else first.`,
    });
  }
  if (b.ownedEventCount > 0) {
    const n = b.ownedEventCount;
    out.push({
      key: 'events',
      text: self
        ? `You own ${n} upcoming ${plural(n, 'event', 'events')}. Ask your Administrator to give them to someone else first.`
        : `This member owns ${n} upcoming ${plural(n, 'event', 'events')}. Give them to someone else first.`,
    });
  }
  return out;
}

export function describeBlockers(b: RemovalBlockers, audience: RemovalAudience): string[] {
  return blockerSentences(b, audience).map((s) => s.text);
}

export function blockersMessage(b: RemovalBlockers, audience: RemovalAudience): string {
  return describeBlockers(b, audience).join(' ');
}

// The 409 body fields: a count is sent only when it is greater than 0 (omitted otherwise, so
// older clients that test `!== undefined` / `!== null` behave as before); lastAdmin is true or omitted.
export function blockerResponseFields(b: Partial<RemovalBlockers>): {
  assignedMemberCount?: number;
  ownedGroupCount?: number;
  ownedEventCount?: number;
  lastAdmin?: true;
} {
  const out: {
    assignedMemberCount?: number;
    ownedGroupCount?: number;
    ownedEventCount?: number;
    lastAdmin?: true;
  } = {};
  if ((b.assignedMemberCount ?? 0) > 0) out.assignedMemberCount = b.assignedMemberCount;
  if ((b.ownedGroupCount ?? 0) > 0) out.ownedGroupCount = b.ownedGroupCount;
  if ((b.ownedEventCount ?? 0) > 0) out.ownedEventCount = b.ownedEventCount;
  if (b.lastAdmin === true) out.lastAdmin = true;
  return out;
}

// The full 409 body used by DELETE /api/members, DELETE /api/members/me and the role PATCH.
export function conflictBody(err: { message: string } & Partial<RemovalBlockers>) {
  return {
    error: {
      code: 'INVALID_STATE_TRANSITION' as const,
      message: err.message,
      ...blockerResponseFields(err),
    },
  };
}
