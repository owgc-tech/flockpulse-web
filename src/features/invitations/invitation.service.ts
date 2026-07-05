import { createClient } from '@supabase/supabase-js';
import { insertInvitation, pendingInvitationExistsForEmail } from './invitation.repository';
import type { InvitationRow, MemberRole } from './invitation.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface InviteMemberInput {
  email: string;
  role: MemberRole;
  groupId?: string | null;
  redirectTo?: string;
}

export async function inviteMember(
  tenantId: string,
  invitedByMemberId: string,
  input: InviteMemberInput
): Promise<InvitationRow> {
  const { email, role, groupId = null, redirectTo } = input;

  // Guard: no duplicate pending invite for this email in this tenant.
  const alreadyPending = await pendingInvitationExistsForEmail(tenantId, email);
  if (alreadyPending) {
    const err = new Error(`A pending invitation for ${email} already exists`) as Error & { code: string };
    err.code = 'DUPLICATE_INVITE';
    throw err;
  }

  // Step 1: Create the pending Supabase Auth user via the Admin API.
  // inviteUserByEmail `data` maps to user_metadata (readable by the client).
  // app_metadata (JWT claims, not user-editable) requires a separate updateUserById call.
  // redirectTo points the invite link at the registration-completion route so the
  // registrant lands on /register/set-password with their access_token in the URL hash.
  const db = serviceClient();
  const { data: inviteData, error: inviteError } = await db.auth.admin.inviteUserByEmail(
    email,
    redirectTo ? { redirectTo } : undefined
  );
  if (inviteError) {
    const err = new Error(inviteError.message) as Error & { code: string };
    err.code = 'INVITE_FAILED';
    throw err;
  }

  const authUserId = inviteData.user.id;

  // Step 2: Write tenant_id, role, group_id into app_metadata immediately.
  // app_metadata is server-controlled (not writable by the invited user's JWT),
  // so FP-55's registration completion can trust these values unconditionally.
  const { error: metaError } = await db.auth.admin.updateUserById(authUserId, {
    app_metadata: { tenant_id: tenantId, role, group_id: groupId },
  });

  if (metaError) {
    // Auth user was created but metadata write failed — clean up so we don't
    // leave a dangling auth user with no tenant/role binding.
    await db.auth.admin.deleteUser(authUserId);
    const err = new Error(`Invite created but metadata write failed: ${metaError.message}`) as Error & { code: string };
    err.code = 'METADATA_WRITE_FAILED';
    throw err;
  }

  // Step 3: Record the invitation. Only reached if both Auth steps succeeded.
  return insertInvitation({
    tenantId,
    email,
    role,
    groupId,
    invitedBy: invitedByMemberId,
    authUserId,
  });
}
