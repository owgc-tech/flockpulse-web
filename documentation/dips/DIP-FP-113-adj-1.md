Web repo (`owgc-tech/flockpulse-web`, branch off `dev`)
Branch: `feature/FP-113-adj-1-role-dropdowns` (adjustment to already-merged FP-113 work — per the `-adj-N` convention, since this is a post-merge gap in already-shipped code, not new scope).
1. `app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx` — add the four missing options to the role `<select>` (currently lines 146–149):
```tsx
<select className={inputClass} value={role} onChange={e => setRole(e.target.value as MemberRole)}>
  <option value="MEMBER">Member</option>
  <option value="PASTORAL_LEADER">Pastoral Leader</option>
  <option value="LEADER">Leader</option>
  <option value="COMMUNITY_SERVANT">Community Servant</option>
  <option value="COORDINATOR">Coordinator</option>
  <option value="SR_COORDINATOR">Sr. Coordinator</option>
  <option value="ADMIN">Admin</option>
</select>
```
(Ordered low-to-high rank per `ROLE_HIERARCHY` in `src/lib/auth/middleware.ts` — Member(0) → Pastoral Leader/Leader(2) → Community Servant/Coordinator/Sr. Coordinator(3) → Admin(4) — so the dropdown reads as an ascending ladder. `MemberRole` already includes all four values in `src/features/members/member.types.ts`, so no type changes needed.)
2. `app/admin/invite/InviteForm.tsx` — same four options, same order, in the `<select id="role">` block (currently lines 64–66).
3. `app/admin/invite/actions.ts` — widen the hardcoded allow-list in `sendInviteAction`:
```ts
const VALID_INVITE_ROLES: MemberRole[] = [
  'MEMBER', 'PASTORAL_LEADER', 'LEADER', 'COMMUNITY_SERVANT', 'COORDINATOR', 'SR_COORDINATOR', 'ADMIN',
];
if (!VALID_INVITE_ROLES.includes(role)) return { error: 'Invalid role' };
```
This is the critical fix — without it, inviting someone as e.g. `COORDINATOR` will still fail with "Invalid role" even after the dropdown offers it, since this check runs before `inviteMember()` is ever called.
4. Leave `app/api/members/route.ts`'s `POST` allow-list alone for now — it's not in either form's call path, and widening every hardcoded role list repo-wide isn't in scope for this adjustment. Flag it as a candidate for a quick follow-up grep sweep if you want completeness, but not blocking.
5. Run `npm run build` (not just `tsc --noEmit` — this is Next.js, and the standing rule is the real build must pass clean). Show the full diff for all three files.
Save this as `documentation/dips/DIP-FP-113-adj-1.md` verbatim (adjustment-file convention), commit message `FP-113-adj-1: add new roles to member edit/invite dropdowns and invite action allow-list`, push, open PR against `dev`. Standard merge-before-test rule applies here (web, not mobile) — I'll review the diff, then you merge and test against the deployed dev environment.
