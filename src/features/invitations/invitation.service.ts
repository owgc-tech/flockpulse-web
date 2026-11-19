import { createClient } from '@supabase/supabase-js';
import { getInvitationById, insertInvitation, listInvitationsWithNames, pendingInvitationExistsForEmail } from './invitation.repository';
import { getRoleCatalogEntryById } from '@/src/features/role-catalog/role-catalog.service';
import { getTenantSettings } from '@/src/features/tenant/service';
import { sendEmail } from '@/src/lib/email/mailer';
import type { InvitationDisplayRow } from './invitation.types';
import type { InvitationRow } from './invitation.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// DIP-FP-196-web: kept byte-identical to the seed text in migration
// 20260809000068_tenant_invite_email_template.sql — this is what a tenant
// whose invite_email_subject/body are still NULL (not yet customized, or a
// tenant created after that migration ran) actually gets sent. If you change
// one, change the other.
//
// DIP-FP-201-web: the link is now a "bulletproof button" — inline style
// attribute, not a <style> block, since many email clients (Gmail, Outlook)
// strip <style> blocks entirely. Plain-text fallback link paragraph below is
// unchanged, for clients that strip inline styling too.
const DEFAULT_INVITE_SUBJECT = 'You have been invited to join {{tenant_name}} on FlockPulse';
const DEFAULT_INVITE_BODY =
  '<p>You have been invited to join {{tenant_name}} on FlockPulse.</p>' +
  '<p><a href="{{invite_link}}" style="background-color:#18181b;border-radius:9999px;color:#ffffff;display:inline-block;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:1.2;padding:12px 28px;text-align:center;text-decoration:none;">Accept your invitation</a></p>' +
  '<p>If the button above does not work, copy and paste this link into your browser:</p>' +
  '<p>{{invite_link}}</p>';

function renderInviteTemplate(template: string, vars: { inviteLink: string; tenantName: string; inviteeEmail: string }): string {
  return template
    .replaceAll('{{invite_link}}', vars.inviteLink)
    .replaceAll('{{tenant_name}}', vars.tenantName)
    .replaceAll('{{invitee_email}}', vars.inviteeEmail);
}

// DIP-FP-192-web: InviteForm.tsx now sends roleCatalogEntryId, not a role
// string — the server (not the client) derives role from the entry's tier,
// same "never trust a client-supplied role alongside the FK" principle
// applied to updateMember() in members/service.ts.
export interface InviteMemberInput {
  email: string;
  roleCatalogEntryId: string;
  groupId?: string | null;
  redirectTo?: string;
}

export async function inviteMember(
  tenantId: string,
  invitedByMemberId: string,
  input: InviteMemberInput
): Promise<InvitationRow> {
  const { email, roleCatalogEntryId, groupId = null, redirectTo } = input;

  // Throws NOT_FOUND if roleCatalogEntryId is missing/cross-tenant — the
  // route below maps that to a clean 422 rather than a raw FK-violation 500.
  const roleEntry = await getRoleCatalogEntryById(roleCatalogEntryId, tenantId);
  const role = roleEntry.tier;

  // Guard: no duplicate pending invite for this email in this tenant.
  const alreadyPending = await pendingInvitationExistsForEmail(tenantId, email);
  if (alreadyPending) {
    const err = new Error(`A pending invitation for ${email} already exists`) as Error & { code: string };
    err.code = 'DUPLICATE_INVITE';
    throw err;
  }

  // Step 1: DIP-FP-196-web — generate the invite link via the Admin API's
  // generateLink() instead of inviteUserByEmail(). This still creates the
  // pending Supabase Auth user (same as before), but — unlike
  // inviteUserByEmail(), which bakes user-creation and Supabase's own
  // auto-send into one inseparable call — does NOT trigger any email send.
  // redirectTo points the invite link at the registration-completion route so
  // the registrant lands on /register/set-password with their access_token
  // in the URL hash, same as before.
  const db = serviceClient();
  const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
    type: 'invite',
    email,
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (linkError || !linkData?.user) {
    const err = new Error(linkError?.message ?? 'Failed to generate invite link') as Error & { code: string };
    err.code = 'INVITE_FAILED';
    throw err;
  }

  const authUserId = linkData.user.id;
  const actionLink = linkData.properties.action_link;

  // Step 2: Write tenant_id, role, group_id into app_metadata immediately.
  // app_metadata is server-controlled (not writable by the invited user's JWT),
  // so FP-55's registration completion can trust these values unconditionally.
  //
  // DIP-FP-201-web: also writes role_catalog_entry_id, so CompleteProfileForm
  // can resolve the tenant's actual configured role title client-side —
  // role_catalog's RLS policy (tenant_id = get_tenant_id()) already reads
  // app_metadata.tenant_id out of the JWT, so this alone is enough to permit
  // that read once the registrant's access token is used as the bearer, no
  // new endpoint required.
  const { error: metaError } = await db.auth.admin.updateUserById(authUserId, {
    app_metadata: { tenant_id: tenantId, role, group_id: groupId, role_catalog_entry_id: roleCatalogEntryId },
  });

  if (metaError) {
    // Auth user was created but metadata write failed — clean up so we don't
    // leave a dangling auth user with no tenant/role binding.
    await db.auth.admin.deleteUser(authUserId);
    const err = new Error(`Invite created but metadata write failed: ${metaError.message}`) as Error & { code: string };
    err.code = 'METADATA_WRITE_FAILED';
    throw err;
  }

  // Step 3: Record the invitation. Unchanged from before this DIP.
  const invitation = await insertInvitation({
    tenantId,
    email,
    role,
    roleCatalogEntryId,
    groupId,
    invitedBy: invitedByMemberId,
    authUserId,
  });

  // Step 4: DIP-FP-196-web — send the actual email via the tenant's
  // configured template, using the new Mailtrap-backed sendEmail() utility.
  // Sequenced last, deliberately not rolled back on failure: both the Auth
  // identity and the invitation row already exist and are valid by this
  // point (the registrant could still complete registration if they somehow
  // obtained the link, and an admin can retry the send without recreating
  // anything) — same "the DB half is already committed, a delivery failure
  // here is a distinct, later problem" precedent FP-187's
  // AUTH_DELETE_FAILED established for self-deletion's own auth-step-after-
  // DB-commit ordering.
  const tenantSettings = await getTenantSettings(tenantId);
  const subject = tenantSettings.invite_email_subject ?? DEFAULT_INVITE_SUBJECT;
  const bodyTemplate = tenantSettings.invite_email_body ?? DEFAULT_INVITE_BODY;
  const html = renderInviteTemplate(bodyTemplate, {
    inviteLink: actionLink,
    tenantName: tenantSettings.name,
    inviteeEmail: email,
  });
  const renderedSubject = renderInviteTemplate(subject, {
    inviteLink: actionLink,
    tenantName: tenantSettings.name,
    inviteeEmail: email,
  });

  try {
    await sendEmail({ to: email, subject: renderedSubject, html });
  } catch (sendError: unknown) {
    // The invitation row and Auth identity both already exist and are valid
    // (see the comment above) — attach the invitation id to the error so
    // callers can still report a genuine partial success ("invite created,
    // email didn't send") instead of a plain failure, matching the
    // assignedMemberCount/ownedGroupCount convention already used elsewhere
    // in this codebase for attaching structured detail to a thrown error.
    const err = new Error(`Invitation created but the email failed to send: ${(sendError as Error).message}`) as Error & { code: string; invitationId?: string };
    err.code = 'EMAIL_SEND_FAILED';
    err.invitationId = invitation.id;
    throw err;
  }

  return invitation;
}

export async function listInvitations(tenantId: string): Promise<InvitationDisplayRow[]> {
  return listInvitationsWithNames(tenantId);
}

export async function revokeInvitation(
  tenantId: string,
  adminMemberId: string,
  invitationId: string
): Promise<void> {
  // Early check: fast, clear error before touching Auth — not the sole guard
  // (revoke_invitation() re-verifies with FOR UPDATE inside its own transaction).
  const invitation = await getInvitationById(tenantId, invitationId);
  if (!invitation) {
    const err = new Error('Invitation not found') as Error & { code: string };
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (invitation.status !== 'PENDING') {
    const err = new Error(`Only PENDING invitations can be revoked (current status: ${invitation.status})`) as Error & { code: string };
    err.code = 'NOT_PENDING';
    throw err;
  }

  const db = serviceClient();

  // Step 1: Delete the Auth user FIRST.
  // If this succeeds but the DB update (step 2) fails, the invitation stays PENDING
  // while the Auth credential is gone — blocks registration, the safe failure mode.
  // If DB updated first and deleteUser() failed, the invite would appear REVOKED while
  // the Auth credential still exists — registrant could still complete registration.
  const { error: deleteError } = await db.auth.admin.deleteUser(invitation.auth_user_id);
  if (deleteError) {
    const err = new Error(`Failed to delete Auth user: ${deleteError.message}`) as Error & { code: string };
    err.code = 'DELETE_USER_FAILED';
    throw err;
  }

  // Step 2: Atomically update status → REVOKED and write audit log.
  const { error: rpcError } = await db.rpc('revoke_invitation', {
    p_invitation_id: invitationId,
    p_admin_member_id: adminMemberId,
  });
  if (rpcError) {
    const err = new Error(rpcError.message) as Error & { code: string };
    err.code = rpcError.message.includes('PENDING') ? 'NOT_PENDING' : 'REVOKE_FAILED';
    throw err;
  }
}
