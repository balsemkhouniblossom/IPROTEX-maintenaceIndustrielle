import { useTranslations } from 'next-intl';
import {
  CheckIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { ApprovalView } from '@/services/userApprovals';
import { User } from '../types';
import { getActionId, dateHeaderForView, dateValueForView, formatDate } from '../utils';
import { RoleBadge, VerificationBadge, ApprovalStatusBadge } from './Badges';
import { UserIdentity } from './UserIdentity';

export function UserCard(props: {
  user: User;
  view: ApprovalView;
  rowActionId: string | null;
  dateFormatter: Intl.DateTimeFormat;
  onApprove: (user: User) => void;
  onReject: (user: User) => void;
  onEdit: (user: User) => void;
  onDelete: (id?: string) => void;
  onHistory: (user: User) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  const {
    user,
    view,
    rowActionId,
    dateFormatter,
    onApprove,
    onReject,
    onEdit,
    onDelete,
    onHistory,
    selectable = false,
    selected = false,
    onToggleSelect,
    tUsers,
  } = props;
  const actionLoading = rowActionId === getActionId(user);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={tUsers('bulk.selectRow', { name: user.nom_complet || user.email || '' })}
            className="mt-1"
          />
        )}
        <UserIdentity user={user} tUsers={tUsers} />
        <ApprovalStatusBadge status={user.approval_status} tUsers={tUsers} />
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">{tUsers('table.role')}</span>
          <RoleBadge role={user.role} tUsers={tUsers} />
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">{tUsers('approvals.emailVerification')}</span>
          <VerificationBadge verified={user.is_verified} tUsers={tUsers} />
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">{dateHeaderForView(view, tUsers)}</span>
          <span>{formatDate(dateValueForView(user, view), dateFormatter)}</span>
        </div>
      </div>
      {view === 'pending' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onApprove(user)}
            disabled={actionLoading || !user.is_verified}
            title={!user.is_verified ? tUsers('approvals.mustVerifyBeforeApproval') : undefined}
            className="btn-primary flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckIcon className="h-4 w-4 shrink-0" />
            {actionLoading
              ? tUsers('approvals.actions.processing')
              : tUsers('approvals.actions.approve')}
          </button>
          <button
            type="button"
            onClick={() => onReject(user)}
            disabled={actionLoading}
            className="btn-danger flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <XMarkIcon className="h-4 w-4 shrink-0" />
            {tUsers('approvals.actions.reject')}
          </button>
          {!user.is_verified && (
            <p className="basis-full text-xs text-amber-700">
              {tUsers('approvals.mustVerifyBeforeApproval')}
            </p>
          )}
        </div>
      )}
      {view === 'all' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm"
            onClick={() => onHistory(user)}
          >
            <EyeIcon className="h-4 w-4 shrink-0" />
            {tUsers('actions.viewDetails')}
          </button>
          <button
            type="button"
            className="btn-secondary flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm"
            onClick={() => onEdit(user)}
          >
            <PencilIcon className="h-4 w-4 shrink-0" />
            {tUsers('actions.edit')}
          </button>
          <button
            type="button"
            className="btn-danger flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm"
            onClick={() => onDelete(getActionId(user))}
          >
            <TrashIcon className="h-4 w-4 shrink-0" />
            {tUsers('actions.delete')}
          </button>
        </div>
      )}
    </div>
  );
}
