import { useTranslations } from 'next-intl';
import { ApprovalStatus } from '@/services/userApprovals';

type UserTranslator = ReturnType<typeof useTranslations>;

type RoleBadgeProps = Readonly<{
  role?: string;
  tUsers: UserTranslator;
}>;

type VerificationBadgeProps = Readonly<{
  verified?: boolean;
  tUsers: UserTranslator;
}>;

type ApprovalStatusBadgeProps = Readonly<{
  status?: ApprovalStatus;
  tUsers: UserTranslator;
}>;

function roleBadgeClassName(role: string) {
  if (role === 'admin') {
    return 'bg-violet-100 text-violet-800';
  }

  return role === 'technician'
    ? 'bg-blue-100 text-blue-800'
    : 'bg-slate-100 text-slate-800';
}

function approvalStatusClassName(status?: ApprovalStatus) {
  if (status === 'approved') {
    return 'bg-green-100 text-green-800';
  }

  if (status === 'rejected') {
    return 'bg-red-100 text-red-800';
  }

  return status === 'pending'
    ? 'bg-amber-100 text-amber-800'
    : 'bg-slate-100 text-slate-700';
}

export function RoleBadge({
  role,
  tUsers,
}: RoleBadgeProps) {
  if (role !== 'operator' && role !== 'technician' && role !== 'admin') {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
        {tUsers('approvals.unknownRole')}
      </span>
    );
  }

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${roleBadgeClassName(role)}`}>
      {tUsers(`roles.${role}`)}
    </span>
  );
}

export function VerificationBadge({
  verified,
  tUsers,
}: VerificationBadgeProps) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-medium ${
        verified
          ? 'bg-green-100 text-green-800'
          : 'bg-amber-100 text-amber-800'
      }`}
    >
      {verified
        ? tUsers('approvals.emailVerified')
        : tUsers('approvals.emailNotVerified')}
    </span>
  );
}

export function ApprovalStatusBadge({
  status,
  tUsers,
}: ApprovalStatusBadgeProps) {
  const label = status
    ? tUsers(`approvals.status.${status}`)
    : tUsers('approvals.status.legacy');

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${approvalStatusClassName(status)}`}>
      {label}
    </span>
  );
}
