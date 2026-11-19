DIP-FP-157.md
Story Summary
Replaces the default Next.js/Vercel favicon and "Create Next App" browser tab title with FlockPulse branding — the icon-only mark (FlockPulseLogo1_AP5.png, already confirmed as the correct asset for favicon use, per the earlier discussion) and the title "FlockPulse".
Repo Target
Web only.
Grounding Check

Confirmed earlier this session: app/favicon.ico is the unmodified Next.js starter icon, and app/layout.tsx's metadata.title is literally "Create Next App".
Real dependency, not yet resolved: the actual logo file (FlockPulseLogo1_AP5.png) was shared with Joseph in chat, not committed to either repo — CC will not have access to it automatically. Joseph needs to place the file somewhere CC can read it (e.g., drop it in the repo root or app/ directory before starting, or provide it directly in the CC session) before this DIP can actually be completed, not just planned.
Next.js App Router supports a special app/icon.png file (auto-detected, generates the appropriate favicon tags) as an alternative/replacement to app/favicon.ico — implementer's call on which convention to use, whichever is simpler given the actual source file's format/size.

Implementation Plan

Replace app/favicon.ico (or add app/icon.png per the App Router convention, removing the old favicon.ico if switching conventions) using FlockPulseLogo1_AP5.png as the source, sized appropriately for a small square favicon.
Change app/layout.tsx's metadata.title from "Create Next App" to "FlockPulse".
Check for any other still-default metadata (e.g. description) and update if still showing placeholder text.

Files to Create/Modify

app/favicon.ico (replaced) or app/icon.png (new)
app/layout.tsx

Branch Name
feature/FP-157-favicon-and-title
Jira Linkage

PDEEpicID: FP-5
PDEStoryID: FP-157

Stop Point
Save verbatim to documentation/dips/DIP-FP-157.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration.
Include full diffs in the completion report.
