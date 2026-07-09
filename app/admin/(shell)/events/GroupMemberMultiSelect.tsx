'use client';

import type { GroupOption, MemberOption } from '@/src/features/events/event.types';

interface Props {
  groups: GroupOption[];
  members: MemberOption[];
  groupIds: string[];
  memberIds: string[];
  onToggleGroup: (id: string) => void;
  onToggleMember: (id: string) => void;
  groupsLabel?: string;
  membersLabel?: string;
}

// Extracted from EventForm.tsx's original Target picker (FP-107) — reused for both Target and
// the new Food Assignment field so the two pickers can never diverge in behavior, same reasoning
// as RepeatsFields being factored out in DIP-FP-106.
export default function GroupMemberMultiSelect({
  groups, members, groupIds, memberIds, onToggleGroup, onToggleMember,
  groupsLabel = 'Groups', membersLabel = 'Individual members',
}: Props) {
  return (
    <>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{groupsLabel}</p>
      <div className="flex flex-wrap gap-2">
        {groups.map(g => (
          <label key={g.id} className="flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950">
            <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => onToggleGroup(g.id)} />
            {g.name}
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">{membersLabel}</p>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {members.map(m => (
          <label key={m.id} className="flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950">
            <input type="checkbox" checked={memberIds.includes(m.id)} onChange={() => onToggleMember(m.id)} />
            {m.first_name} {m.last_name}
          </label>
        ))}
      </div>
    </>
  );
}
