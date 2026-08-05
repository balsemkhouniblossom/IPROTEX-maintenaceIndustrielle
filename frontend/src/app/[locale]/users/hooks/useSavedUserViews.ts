import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SavedView } from '@/components/SavedViewsBar';
import { apiService } from '@/services/api';
import { extractApiErrorMessage } from '@/services/apiErrors';
import {
  ApprovalRole,
  ApprovalView,
  EmailVerificationFilter,
} from '@/services/userApprovals';

export function useSavedUserViews({
  activeView,
  setActiveView,
  setSearchInput,
  setDebouncedSearch,
  setRoleFilter,
  setVerificationFilter,
  setSortOrder,
  setPage,
  debouncedSearch,
  roleFilter,
  verificationFilter,
  sortOrder,
  showNotification,
  tUsers,
}: {
  activeView: ApprovalView;
  setActiveView: (view: ApprovalView) => void;
  setSearchInput: (value: string) => void;
  setDebouncedSearch: (value: string) => void;
  setRoleFilter: (value: ApprovalRole | 'all') => void;
  setVerificationFilter: (value: EmailVerificationFilter) => void;
  setSortOrder: (value: 'asc' | 'desc') => void;
  setPage: (value: number) => void;
  debouncedSearch: string;
  roleFilter: ApprovalRole | 'all';
  verificationFilter: EmailVerificationFilter;
  sortOrder: 'asc' | 'desc';
  showNotification: (type: 'success' | 'error', message: string) => void;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);

  const loadSavedViews = useCallback(async () => {
    try {
      const response = await apiService.getSavedViews('users');
      setSavedViews(Array.isArray(response.data) ? response.data : []);
    } catch {
      // Non-fatal — the saved-views bar just stays empty.
    }
  }, []);

  useEffect(() => {
    void loadSavedViews();
  }, [loadSavedViews]);

  function applySavedView(view: SavedView) {
    const query = view.query as {
      view?: ApprovalView;
      search?: string;
      role?: ApprovalRole | 'all';
      verification?: EmailVerificationFilter;
      sortOrder?: 'asc' | 'desc';
    };
    setActiveSavedViewId(view._id);
    if (query.view) setActiveView(query.view);
    setSearchInput(query.search ?? '');
    setDebouncedSearch(query.search ?? '');
    if (query.role) setRoleFilter(query.role);
    if (query.verification) setVerificationFilter(query.verification);
    if (query.sortOrder) setSortOrder(query.sortOrder);
    setPage(1);
  }

  async function saveCurrentView(name: string) {
    try {
      const query = {
        view: activeView,
        search: debouncedSearch,
        role: roleFilter,
        verification: verificationFilter,
        sortOrder,
      };
      const response = await apiService.createSavedView({ pageKey: 'users', name, query });
      setSavedViews((prev) => [response.data, ...prev]);
      showNotification('success', tUsers('savedViews.saved'));
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tUsers('savedViews.saveFailed')));
    }
  }

  async function deleteSavedView(view: SavedView) {
    try {
      await apiService.deleteSavedView(view._id);
      setSavedViews((prev) => prev.filter((v) => v._id !== view._id));
      if (activeSavedViewId === view._id) setActiveSavedViewId(null);
      showNotification('success', tUsers('savedViews.deleted'));
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tUsers('savedViews.deleteFailed')));
    }
  }

  return {
    savedViews,
    activeSavedViewId,
    applySavedView,
    saveCurrentView,
    deleteSavedView,
  };
}
