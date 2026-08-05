import { useTranslations } from 'next-intl';
import { ApprovalView } from '@/services/userApprovals';
import { User, UserRef } from './types';

export function getUserKey(user: UserRef) {
  return user.id || user._id || `${user.email}-${user.created_at}`;
}

export function getActionId(user: UserRef) {
  return user.id || user._id || '';
}

export function initials(name?: string) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function normalizeView(view: string | null): ApprovalView {
  return view === 'approved' ||
    view === 'rejected' ||
    view === 'all' ||
    view === 'pending'
    ? view
    : 'all';
}

export function formatBadgeCount(count: number) {
  return count > 99 ? '99+' : String(count);
}

export function formatDate(
  value: string | undefined,
  dateFormatter: Intl.DateTimeFormat,
) {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

export function dateHeaderForView(
  view: ApprovalView,
  tUsers: ReturnType<typeof useTranslations>,
) {
  if (view === 'approved') return tUsers('approvals.approvalDate');
  if (view === 'rejected') return tUsers('approvals.rejectionDate');
  return tUsers('approvals.requestDate');
}

export function dateValueForView(user: User, view: ApprovalView) {
  if (view === 'approved') return user.approved_at;
  if (view === 'rejected') return user.rejected_at;
  return user.created_at;
}

export function errorMessageForCode(
  code: string | null,
  tUsers: ReturnType<typeof useTranslations>,
) {
  const key = code ? `approvals.errors.${code}` : 'approvals.errors.generic';
  try {
    return tUsers(key);
  } catch {
    return tUsers('approvals.errors.generic');
  }
}
