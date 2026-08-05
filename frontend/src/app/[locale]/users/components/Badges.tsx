import { useTranslations } from 'next-intl';
import { ApprovalStatus } from '@/services/userApprovals';

export function RoleBadge({
  role,
  tUsers,
}: {
  role?: string;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  if (role !== 'operator' && role !== 'technician' && role !== 'admin') {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
        {tUsers('approvals.unknownRole')}
      </span>
    );
  }

  const className =
    role === 'admin'
      ? 'bg-violet-100 text-violet-800'
      : role === 'technician'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-slate-100 text-slate-800';

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>
      {tUsers(`roles.${role}`)}
    </span>
  );
}

export function VerificationBadge({
  verified,
  tUsers,
}: {
  verified?: boolean;
  tUsers: ReturnType<typeof useTranslations>;
}) {
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
}: {
  status?: ApprovalStatus;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  const className =
    status === 'approved'
      ? 'bg-green-100 text-green-800'
      : status === 'rejected'
        ? 'bg-red-100 text-red-800'
        : status === 'pending'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-700';
  const label = status
    ? tUsers(`approvals.status.${status}`)
    : tUsers('approvals.status.legacy');

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
