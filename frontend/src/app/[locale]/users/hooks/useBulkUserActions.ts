import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApprovalView } from '@/services/userApprovals';
import { apiService } from '@/services/api';
import { extractApiErrorMessage } from '@/services/apiErrors';
import { User } from '../types';
import { getActionId } from '../utils';

export function useBulkUserActions({
  items,
  setItems,
  activeView,
  page,
  refreshAfterDecision,
  showNotification,
  tUsers,
}: {
  items: User[];
  setItems: React.Dispatch<React.SetStateAction<User[]>>;
  activeView: ApprovalView;
  page: number;
  refreshAfterDecision: () => Promise<void>;
  showNotification: (type: 'success' | 'error', message: string) => void;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  // Bulk approve/reject — only meaningful on the pending queue, backed by
  // the transactional /users/bulk-approve and /users/bulk-reject endpoints.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeView, page]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? new Set(items.map((user) => getActionId(user))) : new Set());
  }

  async function handleBulkApprove() {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkSubmitting) return;
    setBulkSubmitting(true);
    const previousItems = items;
    // Optimistic: approved users leave the pending queue immediately;
    // rolled back below if the transaction fails.
    setItems((prev) => prev.filter((user) => !selectedIds.has(getActionId(user))));
    try {
      await apiService.bulkApproveUsers(ids);
      showNotification('success', tUsers('bulk.approveSuccess', { count: ids.length }));
      setSelectedIds(new Set());
      await refreshAfterDecision();
    } catch (error) {
      setItems(previousItems);
      showNotification('error', extractApiErrorMessage(error, tUsers('bulk.approveFailed')));
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function handleBulkReject() {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkSubmitting) return;
    const trimmedReason = bulkRejectReason.trim();
    if (!trimmedReason) {
      showNotification('error', tUsers('bulk.reasonRequired'));
      return;
    }
    setBulkSubmitting(true);
    const previousItems = items;
    setItems((prev) => prev.filter((user) => !selectedIds.has(getActionId(user))));
    try {
      await apiService.bulkRejectUsers(ids, trimmedReason);
      showNotification('success', tUsers('bulk.rejectSuccess', { count: ids.length }));
      setSelectedIds(new Set());
      setBulkRejectReason('');
      await refreshAfterDecision();
    } catch (error) {
      setItems(previousItems);
      showNotification('error', extractApiErrorMessage(error, tUsers('bulk.rejectFailed')));
    } finally {
      setBulkSubmitting(false);
    }
  }

  return {
    selectedIds,
    bulkRejectReason,
    setBulkRejectReason,
    bulkSubmitting,
    toggleSelect,
    toggleSelectAll,
    handleBulkApprove,
    handleBulkReject,
  };
}
