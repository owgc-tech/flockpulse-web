Instructions for CC
Web repo (`owgc-tech/flockpulse-web`) — new branch `feature/FP-23-FP-26-adj-1-exclude-self-confirmation`:

1. `src/features/confirmations/confirmation.repository.ts` — add an `excludeMemberId` parameter to `getPendingConfirmations()`, and add `.neq('member_id', excludeMemberId)` to the initial query (alongside the existing `.eq('tenant_id', tenantId)` / `.eq('confirmation_status', 'PENDING_CONFIRMATION')`):
```ts
   export async function getPendingConfirmations(
     tenantId: string,
     memberIdFilter: string[] | null,
     excludeMemberId: string
   ): Promise<PendingConfirmationRow[]> {
     if (memberIdFilter !== null && memberIdFilter.length === 0) return [];

     let query = serviceClient()
       .from('member_attendance_reports')
       .select(`...`) // unchanged
       .eq('tenant_id', tenantId)
       .eq('confirmation_status', 'PENDING_CONFIRMATION')
       .neq('member_id', excludeMemberId);
     // ...rest unchanged
```
2. `src/features/confirmations/confirmation.service.ts` — pass `callerId` through as the new exclude param in `listPendingConfirmations()`:
```ts
   export async function listPendingConfirmations(
     tenantId: string,
     callerId: string,
     callerRole: Role
   ): Promise<PendingConfirmationRow[]> {
     let memberIdFilter: string[] | null = null;
     if (callerRole === 'LEADER') {
       memberIdFilter = await getAssignedMemberIds(tenantId, callerId);
     }
     return getPendingConfirmations(tenantId, memberIdFilter, callerId);
   }
```
3. Same file, `submitConfirmation()` — add the write-level guard right after fetching the self-report, before the existing Leader-scope check (applies equally to Leader and Admin — nobody confirms their own record, regardless of tier):
```ts
   if (selfReport.member_id === callerId) {
     throw serviceError('FORBIDDEN_SCOPE', 'You cannot confirm your own self-report');
   }
```
No route-handler change needed — `FORBIDDEN_SCOPE` already maps to 403 there.
4. Run `npm run build`, show the full diff.
Save as `documentation/dips/DIP-FP-23-FP-26-adj-1.md`, commit `FP-23-FP-26-adj-1: exclude caller's own self-report from confirmations list and block self-confirmation`, push, open PR against `dev`.
