import { useTranslations } from 'next-intl';
import {
  CheckIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import ProfileAvatar from '@/components/ProfileAvatar';
import { ApprovalView } from '@/services/userApprovals';
import { User } from '../types';
import { getActionId, dateValueForView, formatDate } from '../utils';
import { RoleBadge, VerificationBadge, ApprovalStatusBadge } from './Badges';
import { UserIdentity } from './UserIdentity';

export function UserRow({
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
  tCommon,
}: {
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
  tCommon: ReturnType<typeof useTranslations>;
}) {
  const actionId = getActionId(user);
  const actionLoading = rowActionId === actionId;
  const approveDisabled = actionLoading || !user.is_verified;

  return (
    <tr aria-selected={selectable ? selected : undefined}>
      {selectable && (
        <td>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={tUsers('bulk.selectRow', { name: user.nom_complet || user.email || '' })}
          />
        </td>
      )}
      <td>
        <ProfileAvatar
          name={user.nom_complet}
          photo={user.photo}
          alt={user.nom_complet || tUsers('approvals.userAvatar')}
          size="sm"
        />
      </td>
      <td>
        <UserIdentity user={user} tUsers={tUsers} />
      </td>
      <td>
        <span className="user-table-text">{user.email || '—'}</span>
      </td>
      <td>
        <RoleBadge role={user.role} tUsers={tUsers} />
      </td>
      <td>
        <span className="user-table-text">{user.department || '—'}</span>
      </td>
      <td>
        <span className="user-table-text">{user.phone || '—'}</span>
      </td>
      <td>
        <VerificationBadge verified={user.is_verified} tUsers={tUsers} />
      </td>
      <td>
        <ApprovalStatusBadge status={user.approval_status} tUsers={tUsers} />
      </td>
      <td>
        <span className="user-table-text">
          {formatDate(dateValueForView(user, view), dateFormatter)}
        </span>
      </td>
      {view === 'rejected' && (
        <td>
          <span title={user.rejection_reason || ''} className="user-table-reason">
            {user.rejection_reason || '—'}
          </span>
        </td>
      )}
      {view === 'all' && (
        <>
          <td>
            <span
              className={`rounded-full px-2 py-1 text-xs ${
                user.is_active
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              {tUsers(`status.${user.is_active ? 'active' : 'inactive'}`)}
            </span>
          </td>
          <td>
            <span className="user-table-text">
              {formatDate(user.last_login, dateFormatter)}
            </span>
          </td>
          <td>
            {Array.isArray(user.login_history) && user.login_history.length > 0
              ? user.login_history.length
              : '—'}
          </td>
        </>
      )}
      <td>
        {view === 'pending' ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onApprove(user)}
              disabled={approveDisabled}
              title={
                !user.is_verified
                  ? tUsers('approvals.mustVerifyBeforeApproval')
                  : tUsers('approvals.actions.approve')
              }
              className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
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
              className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              <XMarkIcon className="h-4 w-4 shrink-0" />
              {tUsers('approvals.actions.reject')}
            </button>
            {!user.is_verified && (
              <span className="max-w-48 whitespace-normal text-xs leading-snug text-amber-700">
                {tUsers('approvals.mustVerifyBeforeApproval')}
              </span>
            )}
          </div>
        ) : view === 'all' ? (
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={tUsers('actions.viewDetails')}
              title={tUsers('actions.viewDetails')}
              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              onClick={() => onHistory(user)}
            >
              <EyeIcon className="h-4 w-4 shrink-0" />
              <span>{tUsers('actions.viewDetails')}</span>
            </button>
            <button
              type="button"
              aria-label={tUsers('actions.edit')}
              title={tUsers('actions.edit')}
              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              onClick={() => onEdit(user)}
            >
              <PencilIcon className="h-4 w-4 shrink-0" />
              <span>{tUsers('actions.edit')}</span>
            </button>
            <button
              type="button"
              aria-label={tUsers('actions.delete')}
              title={tUsers('actions.delete')}
              className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              onClick={() => onDelete(getActionId(user))}
            >
              <TrashIcon className="h-4 w-4 shrink-0" />
              <span>{tUsers('actions.delete')}</span>
            </button>
          </div>
        ) : (
          <span className="text-sm text-slate-500">
            {tCommon('notAvailable')}
          </span>
        )}
      </td>
    </tr>
  );
}
