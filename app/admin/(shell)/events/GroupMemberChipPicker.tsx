'use client';

import { useState } from 'react';
import type { GroupOption, MemberOption } from '@/src/features/events/event.types';

interface Props {
  groups: GroupOption[];
  members: MemberOption[];
  groupIds: string[];
  memberIds: string[];
  onToggleGroup: (id: string) => void;
  onToggleMember: (id: string) => void;
  // FP-162: one label for the whole picker now — the old two-section layout
  // (groupsLabel/membersLabel) no longer applies once groups and individuals
  // share a single merged, searchable list.
  label?: string;
  // FP-162: groundwork for FP-163, unused by any call site yet — when true,
  // groups are excluded from results entirely (search/select individuals only).
  individualOnly?: boolean;
}

// DIP-FP-162: replaces GroupMemberMultiSelect's two-checkbox-list layout with a single
// search-and-chips picker — one merged, alphabetically-sorted list (groups, a divider,
// then individuals), filtered live by the search text, with selections shown as
// removable chips instead of a second scrollable checkbox box. Preserves the same
// groupIds/memberIds + onToggleGroup/onToggleMember contract as the component it
// replaces, so call sites only need the component swapped, not their surrounding state.
export default function GroupMemberChipPicker({
  groups, members, groupIds, memberIds, onToggleGroup, onToggleMember,
  label = 'Select', individualOnly = false,
}: Props) {
  const [search, setSearch] = useState('');

  const selectedGroups = groups
    .filter(g => groupIds.includes(g.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedMembers = members
    .filter(m => memberIds.includes(m.id))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));

  const query = search.trim().toLowerCase();

  const matchingGroups = individualOnly ? [] : groups
    .filter(g => !groupIds.includes(g.id))
    .filter(g => g.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));

  const matchingMembers = members
    .filter(m => !memberIds.includes(m.id))
    .filter(m => `${m.first_name} ${m.last_name}`.toLowerCase().includes(query))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));

  function selectGroup(id: string) {
    onToggleGroup(id);
    setSearch('');
  }
  function selectMember(id: string) {
    onToggleMember(id);
    setSearch('');
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</p>

      {(selectedGroups.length > 0 || selectedMembers.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {selectedGroups.map(g => (
            <span
              key={g.id}
              className="flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            >
              {g.name}
              <button
                type="button"
                onClick={() => onToggleGroup(g.id)}
                aria-label={`Remove ${g.name}`}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ×
              </button>
            </span>
          ))}
          {selectedMembers.map(m => (
            <span
              key={m.id}
              className="flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            >
              {m.first_name} {m.last_name}
              <button
                type="button"
                onClick={() => onToggleMember(m.id)}
                aria-label={`Remove ${m.first_name} ${m.last_name}`}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={individualOnly ? 'Search individual members…' : 'Search groups or individual members…'}
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />

      <div className="max-h-48 overflow-y-auto rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {matchingGroups.length === 0 && matchingMembers.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-500">No matches</p>
        ) : (
          <>
            {matchingGroups.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => selectGroup(g.id)}
                className="block w-full px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                {g.name}
              </button>
            ))}
            {matchingGroups.length > 0 && matchingMembers.length > 0 && (
              <div className="border-t border-zinc-100 dark:border-zinc-800" />
            )}
            {matchingMembers.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => selectMember(m.id)}
                className="block w-full px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                {m.first_name} {m.last_name}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
