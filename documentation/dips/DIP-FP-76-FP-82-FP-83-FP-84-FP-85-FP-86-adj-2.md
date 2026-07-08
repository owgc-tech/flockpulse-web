**Instruction for CC — make True the default for the demographic fields**

Please create the CC Instruction to make True the default for the demographic fields.

1. **`app/admin/formation/FormationOverlay.tsx`** — the four `useState` initializers for the demographic checkboxes currently default to `false` when no existing item is present (create mode):
   ```
   const [forSingleMen, setForSingleMen] = useState(talkItem?.for_single_men ?? false);
   const [forSingleWomen, setForSingleWomen] = useState(talkItem?.for_single_women ?? false);
   const [forMarriedMen, setForMarriedMen] = useState(talkItem?.for_married_men ?? false);
   const [forMarriedWomen, setForMarriedWomen] = useState(talkItem?.for_married_women ?? false);
   ```
   Change each `?? false` to `?? true`. **Do not touch the `talkItem?.for_x` part** — editing an existing Talk must still show its actual saved values, not be forced to true. This only changes the default for a brand-new Talk.

2. **`src/features/formation/talk.repository.ts`** — `insertTalk`'s fallback values:
   ```
   for_single_men: input.forSingleMen ?? false,
   for_single_women: input.forSingleWomen ?? false,
   for_married_men: input.forMarriedMen ?? false,
   for_married_women: input.forMarriedWomen ?? false,
   ```
   Change each `?? false` to `?? true`. This keeps the DB-level default consistent with the client default even if a request somehow arrives without explicit values — same reasoning as the migration's existing backfill-to-all-true for legacy rows.

**Process:**
- Branch off current `dev`: `feature/FP-76-demographics-default-true`
- Run `npm run build` clean before pushing (standing requirement now — confirm 0 type errors)
- Re-run `npx tsx scripts/test-fp76-82-83-84-85-86-formation-admin.ts`, expect 19/19 still passing (test 4.2 specifically checks that all-false is rejected — this change doesn't affect that validation, only the default starting state)
- Open PR against `dev`, don't merge — I'll review, then you'll test and merge
