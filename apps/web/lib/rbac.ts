/**
 * Role-based access control helpers.
 *
 * Usage at the top of a Server Action:
 *
 *   const session = await getSession();
 *   requireRole(session, ['OWNER', 'ADMIN']);
 *
 * Throws a PermissionError that the UI surfaces as a 403-style message.
 */

import type { MembershipRole } from '@pcs/db';
import type { Session } from './auth';

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

const ORDER: MembershipRole[] = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'];

export function roleAtLeast(role: MembershipRole, minimum: MembershipRole): boolean {
  return ORDER.indexOf(role) >= ORDER.indexOf(minimum);
}

/**
 * Throw if the session's role is not in the allowed set.
 */
export function requireRole(
  session: Session,
  allowed: MembershipRole | MembershipRole[],
): void {
  const allowedArr = Array.isArray(allowed) ? allowed : [allowed];
  if (!allowedArr.includes(session.membership.role)) {
    throw new PermissionError(
      `This action requires one of: ${allowedArr.join(', ')}. You are a ${session.membership.role}.`,
    );
  }
}

/**
 * Throw if the session's role is below the given minimum.
 * Convenience wrapper for the common "ADMIN or higher" check.
 */
export function requireMinRole(session: Session, minimum: MembershipRole): void {
  if (!roleAtLeast(session.membership.role, minimum)) {
    throw new PermissionError(
      `This action requires ${minimum} or higher. You are a ${session.membership.role}.`,
    );
  }
}
