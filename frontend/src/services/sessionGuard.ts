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

/**
 * Single source of truth for "where should an authenticated user land"
 * (Complete Profile page, Google result page, etc. all defer to this
 * instead of re-implementing the lifecycle priority order themselves):
 * unauthenticated -> incomplete profile -> pending -> rejected -> inactive
 * -> role dashboard. Mirrors getAccountStateRedirect's priority, then
 * resolves the final "allowed" case to the user's own dashboard.
 */
export function getAuthenticatedAccountDestination(
  locale: string,
  user?: SessionUser | null,
): string {
  const safeLocale = normalizeLocale(locale);
  const accountRedirect = getAccountStateRedirect(safeLocale, user);

  if (accountRedirect) {
    return accountRedirect.to;
  }

  return (
    getDashboardPath(safeLocale, user?.role) ??
    getLoginRedirectForAuthFailure(safeLocale, 'ACCOUNT_ROLE_NOT_ALLOWED')
  );
}

export type CompleteProfileAccessDecision =
  | { status: 'loading' }
  | { status: 'redirect'; to: string }
  | { status: 'show-form' };

/**
 * Pure decision function behind the Complete Profile page's guard. Kept
 * separate from React so the loading race (redirecting on a transient
 * token=null/user=null before AuthContext finishes restoring the session)
 * can be unit tested without rendering the component, and so the page
 * doesn't re-implement its own copy of the account-lifecycle priority order.
 */
export function evaluateCompleteProfileAccess(params: {
  isLoading: boolean;
  token?: string | null;
  user?: SessionUser | null;
  locale: string;
}): CompleteProfileAccessDecision {
  const { isLoading, token, user } = params;
  const safeLocale = normalizeLocale(params.locale);

  if (isLoading) {
    return { status: 'loading' };
  }

  if (!token || !user) {
    return { status: 'redirect', to: `/${safeLocale}/auth/login` };
  }

  if (user.profile_completed === false) {
    return { status: 'show-form' };
  }

  return {
    status: 'redirect',
    to: getAuthenticatedAccountDestination(safeLocale, user),
  };
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
