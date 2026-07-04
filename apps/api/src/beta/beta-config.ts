/**
 * Closed-beta launch switches. All read from the environment so the beta
 * flow can be toggled without a deploy artifact change:
 *
 * - BETA_MODE=true      → signups join a waitlist on the 'beta' tier and must
 *                         be approved by an admin before they can use the app.
 * - ADMIN_EMAILS=a,b    → accounts created with these emails get role 'admin'
 *                         (and are auto-approved), enabling /admin endpoints.
 *
 * The web app mirrors the toggle as NEXT_PUBLIC_BETA_MODE.
 */

export type BetaStatus = 'pending' | 'approved';

export function isBetaMode(): boolean {
  return process.env.BETA_MODE === 'true';
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.toLowerCase());
}

/** Fields stamped onto a new user row at signup. */
export function signupUserFields(email: string): {
  role: 'user' | 'admin';
  betaStatus: BetaStatus | null;
} {
  const admin = isAdminEmail(email);
  if (!isBetaMode()) {
    return { role: admin ? 'admin' : 'user', betaStatus: null };
  }
  return {
    role: admin ? 'admin' : 'user',
    betaStatus: admin ? 'approved' : 'pending',
  };
}

/** Tier a fresh signup lands on. */
export function signupTierId(): 'beta' | 'free' {
  return isBetaMode() ? 'beta' : 'free';
}
