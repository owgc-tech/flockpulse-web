// FP-254 follow-up: pure, import-free helpers for the "Registration complete" screen, so the client
// component can use them without pulling server-only code (middleware.ts imports next/server and
// supabase-js) into the browser bundle.
//
// The role values mirror the Role type in src/lib/auth/middleware.ts (DIP-FP-113-web):
//   Admin tier : ADMIN, SR_COORDINATOR, COORDINATOR, COMMUNITY_SERVANT
//   Leader tier: LEADER, PASTORAL_LEADER
//   Member     : MEMBER
// Anything else (null, undefined, an unknown string) is treated as "not a web user": no login button.
const WEB_LOGIN_ROLES: ReadonlySet<string> = new Set([
  'ADMIN',
  'SR_COORDINATOR',
  'COORDINATOR',
  'COMMUNITY_SERVANT',
  'LEADER',
  'PASTORAL_LEADER',
]);

// True for every role except Member (Members use the phone app, not the web login).
export function showContinueToLogin(role: string | null | undefined): boolean {
  return typeof role === 'string' && WEB_LOGIN_ROLES.has(role);
}
