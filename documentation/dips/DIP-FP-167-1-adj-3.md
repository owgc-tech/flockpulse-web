Story Summary
Post-merge fix (-adj-3) to FP-167 Phase 1's Events admin page. The column header row is not currently sticky at all — it scrolls away with the data, following two prior failed attempts (adj-1: wrong position/overlap; adj-2: fixed the overlap's root cause but the header stopped sticking entirely). This DIP directs a third attempt at the specific untried combination identified by grounding against both prior PRs' actual diffs, not a fresh guess.
Repo Target
Web (Next.js, owgc-tech/flockpulse-web) — single file, app/admin/(shell)/events/EventsTable.tsx.
Grounding Check

Read FP-167's Jira comment (10355) in full, plus the actual diffs and commit messages of PR #107 (46f5ba9) and PR #108 (49a0a5f) — not just summaries.
Traced the live DOM ancestor chain from app/admin/(shell)/layout.tsx's <main className="flex-1 overflow-y-auto"> down through EventsTable.tsx to the <th> elements. Confirmed directly: no ancestor besides <main> currently has non-visible overflow — the "check for another clipping ancestor" hypothesis from the Jira comment does not hold given the current code; do not re-spend time re-checking it.
Identified the actual untested variable: <thead>-level sticky (adj-1's approach) has never been tried together with the overflow-hidden-removed wrapper (adj-2's fix). Each was tested in isolation, combined with the other attempt's approach, not with each other.
No schema/table/column names involved — pure frontend CSS/layout, no domain-rule conflicts, no migrations, no atomicity or error-code considerations.

Implementation Plan

In EventsTable.tsx, move position: sticky back to the <thead> element (as adj-1 did), removing it from the individual <th> elements (as adj-2 has it now). Keep stickyThStyle's top: bandHeight logic — move it to the <thead> (a single style/className application, not five).
Keep adj-2's overflow-hidden removal from the rounded-corner wrapper <div> and its corner-cell-based rounding treatment (rounded-tl-xl etc.) — that fix was real and independently verified; do not revert it.
Keep the rounded-tl-xl/rounded-tr-xl classes on the header's end <th> cells (still needed for the visual corner now that the wrapper itself isn't clipping) — but they no longer need position: sticky themselves once it's on <thead>.
Before committing to this as the fix, verify empirically via direct DOM measurement (getBoundingClientRect()), the same rigor adj-2 used — check at minimum 3 scroll positions (0px, ~300px, ~700px) that: (a) the header is visibly present and pinned at bandHeight once scrolled past that point, not absent; (b) no overlap into the first/second data row. Do not rely on "should work" reasoning alone — the last two attempts each looked correct on paper and weren't.
If this combination still doesn't work, do not attempt a fourth CSS variation unprompted. Stop, document exactly what was observed (DOM measurements, screenshots/description of the failure mode) in the PR description, and leave FP-167's header sticky problem for Joseph to decide how to proceed — including the option of an entirely different technical approach (e.g., a synthetic sticky header built from a fixed-position clone synced to scroll via JS, rather than native CSS position: sticky). Do not silently degrade the fix or ship something partially working without flagging it clearly.
npm run build must pass cleanly before pushing.

Files to Create/Modify

app/admin/(shell)/events/EventsTable.tsx (modify)

Migration Files (if applicable)
None.
Branch Name
feature/FP-167-1-adj-3-sticky-header-not-sticking
Commit Message
FP-167-1-adj-3: try thead-level sticky combined with overflow-hidden already removed (untested combination from adj-1/adj-2)
Pull Request Description
Maps to the underlying story's sticky-header acceptance criteria ("sticky title/create-button/filter band" — unaffected, already working; column header row must also stay visible on scroll — this is the piece under repair). Must include:

Confirmation of which combination was tried and the DOM measurement results at each scroll position tested.
If it worked: explicit before/after description matching what "stuck correctly, no overlap" looks like at each tested position.
If it did not work: full description of the failure mode observed (not sticking / overlapping / something new), per step 5 above — flagged clearly rather than left ambiguous.

Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-167

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-167-1-adj-3.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
