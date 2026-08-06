import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { inviteMember, listInvitations } from '@/src/features/invitations/invitation.service';
import { listRoleCatalog } from '@/src/features/role-catalog/role-catalog.service';
import { ROLE_LABELS } from '@/src/lib/auth/roleLabels';

const requireAdmin = requireRole('ADMIN');

// GET /api/invitations — Admin lists all invitations for the tenant with resolved names.
// Optional ?status=PENDING|ACCEPTED|REVOKED filter.
export const GET = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const status = new URL(req.url).searchParams.get('status') ?? null;
    if (status && !['PENDING', 'ACCEPTED', 'REVOKED'].includes(status)) {
      return errorResponse('INVALID_VALUE', 'status must be PENDING, ACCEPTED, or REVOKED', 400);
    }
    try {
      let invitations = await listInvitations(ctx.tenantId);
      if (status) invitations = invitations.filter(i => i.status === status);
      return NextResponse.json({ data: invitations });
    } catch {
      return errorResponse('INTERNAL_ERROR', 'Failed to fetch invitations', 500);
    }
  }));

// POST /api/invitations — Admin sends an invite email to a prospective member.
// role and groupId are locked at invite time — never editable by the registrant.
// tenant_id is always derived server-side from the calling Admin's JWT.
export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { email, role, groupId } = body;

    if (!email) return errorResponse('MISSING_FIELD', 'email required', 400);
    if (!role) return errorResponse('MISSING_FIELD', 'role required', 400);
    if (!['ADMIN', 'LEADER', 'MEMBER'].includes(role)) {
      return errorResponse('INVALID_VALUE', 'role must be ADMIN, LEADER, or MEMBER', 400);
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return errorResponse('INVALID_VALUE', 'email must be a valid email address', 400);
    }

    try {
      // DIP-FP-192-web: this endpoint's public contract (a bare `role` of
      // ADMIN/LEADER/MEMBER) predates the catalog and is kept as-is here —
      // unlike InviteForm.tsx (which now picks a specific catalog entry
      // directly), this route has no UI of its own and an unknown set of
      // external callers, so changing what it accepts would be a breaking
      // change outside this DIP's scope. Resolved internally instead: find
      // the catalog entry named exactly what ROLE_LABELS[role] used to
      // display (e.g. 'ADMIN' -> "Admin"), falling back to the first entry
      // of that tier if the tenant has since renamed it.
      const catalog = await listRoleCatalog(ctx.tenantId);
      const roleLabel = ROLE_LABELS[role as keyof typeof ROLE_LABELS];
      const roleEntry = catalog.find(e => e.name === roleLabel) ?? catalog.find(e => e.tier === role);
      if (!roleEntry) {
        return errorResponse('INVALID_VALUE', `No role_catalog entry found for tier ${role}`, 422);
      }

      // Derive the app's own origin from the incoming request so redirectTo works
      // correctly in every environment (local, staging, production) without a
      // separate env var. The invite link lands on /register/set-password where
      // the registrant sets their password before completing their profile.
      const origin = new URL(req.url).origin;
      const invitation = await inviteMember(ctx.tenantId, ctx.memberId, {
        email,
        roleCatalogEntryId: roleEntry.id,
        groupId: groupId ?? null,
        redirectTo: `${origin}/register/set-password`,
      });
      return NextResponse.json({ data: invitation }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'DUPLICATE_INVITE') return errorResponse('DUPLICATE_INVITE', (err as Error).message, 409);
      if (code === 'INVITE_FAILED') return errorResponse('INVITE_FAILED', (err as Error).message, 502);
      if (code === 'METADATA_WRITE_FAILED') return errorResponse('METADATA_WRITE_FAILED', (err as Error).message, 500);
      throw err;
    }
  }));
