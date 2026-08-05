import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SavedView } from '@/components/SavedViewsBar';
import { apiService } from '@/services/api';
import { extractApiErrorMessage } from '@/services/apiErrors';
import { MaintenancePlansFilters, SavedMaintenancePlansQuery } from '../types';

export function useSavedMaintenancePlanViews({
  searchInput,
  filters,
  sort,
  setSearchInput,
  setFilters,
  setSort,
  setPage,
  showNotification,
  tCommon,
}: {
  searchInput: string;
  filters: MaintenancePlansFilters;
  sort: string | undefined;
  setSearchInput: (value: string) => void;
  setFilters: (filters: MaintenancePlansFilters) => void;
  setSort: (sort: string | undefined) => void;
  setPage: (page: number) => void;
  showNotification: (type: 'success' | 'error', message: string) => void;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);

  const loadSavedViews = useCallback(async () => {
    try {
      const response = await apiService.getSavedViews('maintenance-plans');
      setSavedViews(Array.isArray(response.data) ? response.data : []);
    } catch {
      // Non-fatal — the saved-views bar just stays empty.
    }
  }, []);

  useEffect(() => {
    void loadSavedViews();
  }, [loadSavedViews]);

  function applySavedView(view: SavedView) {
    const query = view.query as SavedMaintenancePlansQuery;
    setActiveSavedViewId(view._id);
    setSearchInput(query.search ?? '');
    setFilters({ status: query.status ?? '', typeMaintenance: query.typeMaintenance ?? '' });
    setSort(query.sort);
    setPage(1);
  }

  async function saveCurrentView(name: string) {
    try {
      const query: SavedMaintenancePlansQuery = {
        search: searchInput || undefined,
        status: filters.status || undefined,
        typeMaintenance: filters.typeMaintenance || undefined,
        sort,
      };
      const response = await apiService.createSavedView({ pageKey: 'maintenance-plans', name, query });
      setSavedViews((prev) => [response.data, ...prev]);
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tCommon('savedViews.save')));
    }
  }

  async function deleteSavedView(view: SavedView) {
    try {
      await apiService.deleteSavedView(view._id);
      setSavedViews((prev) => prev.filter((v) => v._id !== view._id));
      if (activeSavedViewId === view._id) setActiveSavedViewId(null);
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tCommon('savedViews.delete')));
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
