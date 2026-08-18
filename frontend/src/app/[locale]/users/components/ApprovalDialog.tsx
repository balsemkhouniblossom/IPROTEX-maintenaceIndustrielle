import { useTranslations } from 'next-intl';
import { Modal } from '@/components/Modal';
import { ActionTarget, MAX_REJECTION_REASON_LENGTH } from '../types';
import { RoleBadge } from './Badges';

type ApprovalDialogProps = Readonly<{
  target: ActionTarget;
  reason: string;
  reasonError: string;
  loading: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  tUsers: ReturnType<typeof useTranslations>;
}>;

function confirmButtonLabel(
  loading: boolean,
  isReject: boolean,
  tUsers: ReturnType<typeof useTranslations>,
) {
  if (loading) {
    return tUsers('approvals.actions.processing');
  }

  return isReject
    ? tUsers('approvals.actions.confirmReject')
    : tUsers('approvals.actions.confirmApprove');
}

export function ApprovalDialog({
  target,
  reason,
  reasonError,
  loading,
  onReasonChange,
  onClose,
  onApprove,
  onReject,
  tUsers,
}: ApprovalDialogProps) {
  if (!target) return null;
  const isReject = target.type === 'reject';
  const remaining = MAX_REJECTION_REASON_LENGTH - reason.length;
  const invalidReason = isReject && (!reason.trim() || reason.length > MAX_REJECTION_REASON_LENGTH);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={
        isReject
          ? tUsers('approvals.dialog.rejectTitle')
          : tUsers('approvals.dialog.approveTitle')
      }
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold text-slate-800">{target.user.nom_complet}</p>
          <p className="text-sm text-slate-600">{target.user.email}</p>
          <div className="mt-2">
            <RoleBadge role={target.user.role} tUsers={tUsers} />
          </div>
        </div>
        {isReject ? (
          <div>
            <label htmlFor="rejection-reason" className="mb-1 block text-sm font-medium text-slate-700">
              {tUsers('approvals.rejectionReason')}
            </label>
            <textarea
              id="rejection-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              maxLength={MAX_REJECTION_REASON_LENGTH + 20}
              aria-invalid={!!reasonError || invalidReason}
              aria-describedby="rejection-reason-help"
              className="input-field min-h-28"
            />
            <div id="rejection-reason-help" className="mt-1 flex justify-between text-xs">
              <span className={reasonError ? 'text-red-700' : 'text-slate-500'}>
                {reasonError || tUsers('approvals.validation.reasonRequired')}
              </span>
              <span className={remaining < 0 ? 'text-red-700' : 'text-slate-500'}>
                {remaining}
              </span>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-base font-semibold text-slate-800">
              {tUsers('approvals.dialog.approveQuestion')}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {tUsers('approvals.dialog.approveDescription')}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            {tUsers('approvals.actions.cancel')}
          </button>
          <button
            type="button"
            className={isReject ? 'btn-danger' : 'btn-primary'}
            onClick={isReject ? onReject : onApprove}
            disabled={loading || invalidReason}
          >
            {confirmButtonLabel(loading, isReject, tUsers)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
