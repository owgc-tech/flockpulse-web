DIP-FP-162-picker-component.md
Story Summary
Replaces the checkbox-list group/member picker (GroupMemberMultiSelect web, MemberGroupPicker mobile) with a search-and-chips pattern on both platforms: one merged, alphabetically-sorted list (groups first, then a divider, then individuals), a search box filtering as you type, and selected items shown as removable chips instead of a second scrollable box. Built with an individual-only mode from day one (excludes groups from results entirely), unused until FP-163 wires it up.
Repo Target
Both flockpulse-web and flockpulse-mobile.
Grounding Check
Confirmed live:

Web: GroupMemberMultiSelect (app/admin/(shell)/events/GroupMemberMultiSelect.tsx) is used in exactly two places in EventForm.tsx — the event's core Target selector, and (post Phase 3) once per visible task in the Tasks section loop.
Mobile: MemberGroupPicker (src/features/shared/components/MemberGroupPicker.tsx) is used in create.tsx and edit.tsx — Target selector plus once per visible task. [id].tsx's only reference is a comment, not real usage.
Not scoped to Tasks — this is the same component behind the single highest-stakes selection in the whole app (who gets invited to an event at all). Any regression here is broad, not narrow.
Domain rules: no conflict — UI component only, no data model change.

Implementation Plan

Web: build a new component (e.g. GroupMemberChipPicker.tsx) replacing GroupMemberMultiSelect at both call sites in EventForm.tsx. Single search input; results list merges groups (A-Z) then a visual divider then individuals (A-Z), filtered live by the search text; selecting an item adds a removable chip to a "selected" area, removes it from further results. New individualOnly?: boolean prop — when true, groups are excluded from results entirely (search and select individuals only).
Mobile: build the equivalent native component (e.g. GroupMemberChipPicker.tsx under src/features/shared/components/), same interaction and sort/divider behavior adapted to RN (text input + FlatList/scrollable results + wrapping chip row), same individualOnly prop, replacing MemberGroupPicker at both call sites in create.tsx/edit.tsx.
Preserve the existing external value/onChange contract ({ group_ids, member_ids }) at both call sites if reasonably possible, to minimize churn at each of the four call sites — implementer's call if a shape change is genuinely warranted, not dictated here.

Files to Create/Modify
Web: new picker component; app/admin/(shell)/events/EventForm.tsx (both call sites)
Mobile: new picker component; app/(app)/events/create.tsx, app/(app)/events/[id]/edit.tsx (both call sites each)
Migration Files
Not applicable.
Branch Name
feature/FP-162-picker-component (web), feature/FP-162-picker-component-mobile (mobile)
Commit Message
FP-162: replace checkbox group/member picker with search + chips (Target selector + Tasks)
Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-162

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-162-picker-component.md in both repos, frozen after save in each. Build/typecheck must pass cleanly in both. Open separate PRs against dev, do not merge. No migration.
Include full diffs in the completion report.
