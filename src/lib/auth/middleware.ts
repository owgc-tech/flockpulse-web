import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// DIP-FP-113-web: SR_COORDINATOR/COORDINATOR/COMMUNITY_SERVANT are
// Admin-tier synonyms (identical access to ADMIN); PASTORAL_LEADER is a
// Leader-tier synonym (identical access to LEADER, permanently coexisting
// with it, not replacing it).
export type Role =
  | 'ADMIN'
  | 'LEADER'
  | 'MEMBER'
  | 'SR_COORDINATOR'
  | 'COORDINATOR'
  | 'COMMUNITY_SERVANT'
  | 'PASTORAL_LEADER';

export interface AuthContext {
  userId: string;
  role: Role;
  tenantId: string;
  memberId: string;
}

export type RouteHandler = (
  req: NextRequest,
  ctx: AuthContext,
  params?: Record<string, string>
) => Promise<NextResponse>;

const ROLE_HIERARCHY: Record<Role, number> = {
  ADMIN: 3,
  SR_COORDINATOR: 3,
  COORDINATOR: 3,
  COMMUNITY_SERVANT: 3,
  LEADER: 2,
  PASTORAL_LEADER: 2,
  MEMBER: 1,
};

// requireRole()'s rank comparison already makes "at least this rank" checks
// safe across the new synonyms with zero changes at any call site. This
// covers the different case a couple of routes need: "is this caller
// specifically at Leader-tier (not Admin-tier)" for RBAC *scoping*, not
// gating — e.g. "scope the roster to the caller's own assigned members
// unless they're Admin-tier, in which case show everyone." A literal
// `role === 'LEADER'` there would silently treat a PASTORAL_LEADER account
// as if it were Admin-tier (falls through to the unscoped branch) — this is
// rank-based instead, so it's correct for any current or future role added
// at LEADER's rank, not just PASTORAL_LEADER specifically.
export function isExactlyLeaderTier(role: Role): boolean {
  return ROLE_HIERARCHY[role] === ROLE_HIERARCHY.LEADER;
}

// DIP-FP-114-web: rank-based equivalents of the "is this caller in tier X"
// checks needed outside requireRole()'s gating use case — e.g. Server Component
// page guards, which run their own auth check independent of the API route
// layer and can't use requireRole() directly. Mirrors is_admin_tier()/
// is_leader_tier_or_above() added at the RLS layer in FP-113 — same rank
// logic, kept in one place at each layer rather than re-derived ad hoc.
export function isAdminTier(role: Role): boolean {
  return ROLE_HIERARCHY[role] === ROLE_HIERARCHY.ADMIN;
}

export function isLeaderTierOrAbove(role: Role): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.LEADER;
}

export function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function requireRole(minimumRole: Role) {
  return function withRole(handler: RouteHandler): RouteHandler {
    return async (req, ctx, params) => {
      if (ROLE_HIERARCHY[ctx.role] < ROLE_HIERARCHY[minimumRole]) {
        return errorResponse('FORBIDDEN_ROLE', `Requires ${minimumRole} or higher`, 403);
      }
      return handler(req, ctx, params);
    };
  };
}

export async function withAuth(
  req: NextRequest,
  handler: RouteHandler,
  params?: Record<string, string>
): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse('AUTH_REQUIRED', 'Missing authorization header', 401);
  }

  const token = authHeader.slice(7);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return errorResponse('INVALID_TOKEN', 'Invalid or expired token', 401);
  }

  // tenant_id is always derived server-side from the JWT — never from request body/query.
  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  if (!tenantId) {
    return errorResponse('INVALID_TOKEN', 'Token missing tenant_id claim', 401);
  }

  // Look up the member record to get role and memberId.
  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: member, error: memberError } = await serviceClient
    .from('members')
    .select('id, role, tenant_id')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single();

  if (memberError || !member) {
    return errorResponse('INVALID_TOKEN', 'No active member record for this user', 401);
  }

  // Sanity check: member's tenant must match JWT tenant claim.
  if (member.tenant_id !== tenantId) {
    return errorResponse('CROSS_TENANT_ACCESS', 'Tenant mismatch', 403);
  }

  const ctx: AuthContext = {
    userId: user.id,
    role: member.role as Role,
    tenantId,
    memberId: member.id,
  };

  return handler(req, ctx, params);
}
