import { getDashboardPath } from './authRedirect.ts';
import { getLoginRedirectForAuthFailure } from './authErrors.ts';

export type SessionRole = 'admin' | 'technician' | 'operator';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type SessionUser = {
  role?: string | null;
  is_active?: boolean;
  is_verified?: boolean;
  profile_completed?: boolean;
  approval_status?: ApprovalStatus | string;
};

export type ProtectedRouteDecision =
  | { status: 'allow' }
  | { status: 'redirect'; to: string; reason: string }
  | { status: 'deny'; to: string; reason: string };

const KNOWN_ROLES = new Set<SessionRole>(['admin', 'technician', 'operator']);
const SUPPORTED_LOCALES = new Set(['ar', 'de', 'en', 'es', 'fr', 'it']);

export function normalizeRole(role?: string | null): SessionRole | null {
  const normalized = role?.trim().toLowerCase();
  return KNOWN_ROLES.has(normalized as SessionRole)
    ? (normalized as SessionRole)
    : null;
}

export function normalizeLocale(locale?: string | null): string {
  return locale && SUPPORTED_LOCALES.has(locale) ? locale : 'en';
}

export function getLocaleFromPath(pathname?: string | null): string {
  const firstSegment = pathname?.split('/').filter(Boolean)[0];
  return normalizeLocale(firstSegment);
}

export function inferRequiredRoleFromPath(
  pathname?: string | null,
): SessionRole | null {
  const segments = pathname?.split('/').filter(Boolean) ?? [];
  const routeRoot = segments.length > 1 ? segments[1] : segments[0];

  if (routeRoot === 'operator') return 'operator';
  if (routeRoot === 'technician') return 'technician';
  return null;
}

export function getAccountStateRedirect(
  locale: string,
  user?: SessionUser | null,
): { to: string; reason: string } | null {
  const safeLocale = normalizeLocale(locale);

  if (!user) {
    return {
      to: getLoginRedirectForAuthFailure(safeLocale, null),
      reason: 'missing-session',
    };
  }

  if (user.profile_completed === false) {
    return {
      to: `/${safeLocale}/auth/complete-profile`,
      reason: 'profile-incomplete',
    };
  }

  if (user.approval_status === 'pending') {
    return {
      to: getLoginRedirectForAuthFailure(safeLocale, 'ACCOUNT_PENDING_APPROVAL'),
      reason: 'approval-pending',
    };
  }

  if (user.approval_status === 'rejected') {
    return {
      to: getLoginRedirectForAuthFailure(safeLocale, 'ACCOUNT_REJECTED'),
      reason: 'approval-rejected',
    };
  }

  if (user.is_active !== true) {
    return {
      to: getLoginRedirectForAuthFailure(safeLocale, 'ACCOUNT_INACTIVE'),
      reason: 'inactive',
    };
  }

  if (user.is_verified !== true) {
    return {
      to: getLoginRedirectForAuthFailure(safeLocale, 'EMAIL_NOT_VERIFIED'),
      reason: 'email-unverified',
    };
  }

  if (user.approval_status && user.approval_status !== 'approved') {
    return {
      to: getLoginRedirectForAuthFailure(safeLocale, 'ACCOUNT_PENDING_APPROVAL'),
      reason: 'approval-unknown',
    };
  }

  if (!normalizeRole(user.role)) {
    return {
      to: getLoginRedirectForAuthFailure(safeLocale, 'ACCOUNT_ROLE_NOT_ALLOWED'),
      reason: 'role-invalid',
    };
  }

  return null;
}

export function evaluateProtectedRouteAccess(params: {
  user?: SessionUser | null;
  pathname?: string | null;
  requiredRole?: string;
  allowedRoles?: string[];
  locale?: string;
}): ProtectedRouteDecision {
  const locale = normalizeLocale(params.locale ?? getLocaleFromPath(params.pathname));
  const accountRedirect = getAccountStateRedirect(locale, params.user);

  if (accountRedirect) {
    return { status: 'redirect', ...accountRedirect };
  }

  const role = normalizeRole(params.user?.role);
  const inferredRole = inferRequiredRoleFromPath(params.pathname);
  const requiredRole = normalizeRole(params.requiredRole) ?? inferredRole;
  const allowedRoles = params.allowedRoles
    ?.map((candidate) => normalizeRole(candidate))
    .filter((candidate): candidate is SessionRole => Boolean(candidate));

  if (requiredRole && role !== requiredRole) {
    return redirectToOwnDashboard(locale, role, 'required-role-mismatch');
  }

  if (allowedRoles?.length && (!role || !allowedRoles.includes(role))) {
    return redirectToOwnDashboard(locale, role, 'allowed-role-mismatch');
  }

  return { status: 'allow' };
}

function redirectToOwnDashboard(
  locale: string,
  role: SessionRole | null,
  reason: string,
): ProtectedRouteDecision {
  const ownDashboard = getDashboardPath(locale, role);

  return ownDashboard
    ? { status: 'deny', to: ownDashboard, reason }
    : {
        status: 'redirect',
        to: getLoginRedirectForAuthFailure(locale, 'ACCOUNT_ROLE_NOT_ALLOWED'),
        reason,
      };
}
