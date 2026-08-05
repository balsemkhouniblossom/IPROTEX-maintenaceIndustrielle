'use client';
import Pagination from '@/components/Pagination';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import DashboardLayout from '@/components/DashboardLayout';
import { apiService } from '@/services/api';
import MachineHealthBadge from '@/components/predictive-maintenance/MachineHealthBadge';
import { displayText } from '@/services/displayValues';
import { extractApiErrorMessage } from '@/services/apiErrors';
import { StatusBadge } from '@/components/StatusBadge';
import { VirtualizedDataTable, DataTableColumn } from '@/components/VirtualizedDataTable';
import { SavedViewsBar } from '@/components/SavedViewsBar';
import { useServerTable, ServerTableQuery } from '@/hooks/useServerTable';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  MaintenancePlan,
  MaintenancePlanStatus,
  MaintenancePlanTransitionAction,
  MaintenancePlansFilters,
  ModuleEntity,
} from './types';
import {
  STATUS_BADGE_CLASSES,
  MAINTENANCE_TYPE_OPTIONS,
  cleanInstruction,
  cleanResponsable,
  getModuleLabel,
  mergeOptions,
} from './utils';
import { usePlanHealth } from './hooks/usePlanHealth';
import { useSavedMaintenancePlanViews } from './hooks/useSavedMaintenancePlanViews';
import { PlanFormModal, PlanFormData } from './components/PlanFormModal';

// Only the transitions valid for the plan's current status are ever
// offered — this mirrors the backend's own transition table exactly, so
// the UI never presents an action the server would reject.
const AVAILABLE_TRANSITIONS: Record<
  MaintenancePlanStatus,
  MaintenancePlanTransitionAction[]
> = {
  draft: ['activate', 'archive'],
  active: ['pause', 'complete', 'archive'],
  paused: ['resume', 'archive'],
  completed: ['archive'],
  archived: [],
};

export default function MaintenancePlansPage() {
  const t = useTranslations('maintenancePlans');
  const tCommon = useTranslations('common');

  const [modules, setModules] = useState<ModuleEntity[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MaintenancePlan | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const { planHealth } = usePlanHealth();
  const [formData, setFormData] = useState<PlanFormData>({
    plan_id: '',
    module_id: '',
    type_maintenance: 'preventive',
    frequence: '1',
    unite_frequence: 'semaine',
    maintenance_code: '',
    frequence_label: '',
    instruction: '',
    responsable: '',
    huile_graisse: '',
    documentation: '',
  });

  const fetcher = useCallback(
    async (query: ServerTableQuery<MaintenancePlansFilters>, signal: AbortSignal) => {
      const response = await apiService.getMaintenancePlans(
        {
          page: query.page,
          limit: query.limit,
          search: query.search || undefined,
          sort: query.sort,
          status: query.filters.status || undefined,
          typeMaintenance: query.filters.typeMaintenance || undefined,
        },
        { signal },
      );
      const items = (response.data.items ?? []).map((plan: MaintenancePlan) => ({
        ...plan,
        instruction: cleanInstruction(plan.instruction),
        responsable: cleanResponsable(plan.responsable),
      }));
      return {
        items,
        page: response.data.page ?? query.page,
        limit: response.data.limit ?? query.limit,
        totalItems: response.data.totalItems ?? 0,
        totalPages: response.data.totalPages ?? 1,
      };
    },
    [],
  );

  const table = useServerTable<MaintenancePlan, MaintenancePlansFilters>({
    fetcher,
    initialFilters: { status: '', typeMaintenance: '' },
    pageSize: 10,
  });

  const loadFormOptions = useCallback(async () => {
    try {
      const modulesResponse = await apiService.getModules();
      const modulesData = Array.isArray(modulesResponse.data)
        ? modulesResponse.data
        : modulesResponse.data?.items ??
        modulesResponse.data?.data ??
        modulesResponse.data?.modules ??
        [];
      setModules(modulesData);
    } catch (error) {
      console.error('Error loading modules:', error);
    }
  }, []);

  useEffect(() => {
    void loadFormOptions();
  }, [loadFormOptions]);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  }

  const { savedViews, activeSavedViewId, applySavedView, saveCurrentView, deleteSavedView } =
    useSavedMaintenancePlanViews({
      searchInput: table.searchInput,
      filters: table.filters,
      sort: table.sort,
      setSearchInput: table.setSearchInput,
      setFilters: table.setFilters,
      setSort: table.setSort,
      setPage: table.setPage,
      showNotification,
      tCommon,
    });

  function resetForm() {
    setFormData({
      plan_id: '',
      module_id: '',
      type_maintenance: 'preventive',
      frequence: '1',
      unite_frequence: 'semaine',
      maintenance_code: '',
      frequence_label: '',
      instruction: '',
      responsable: '',
      huile_graisse: '',
      documentation: '',
    });
    setEditingPlan(null);
  }

  function validateForm(): boolean {
    if (!formData.plan_id.trim()) {
      showNotification('error', t('notifications.planCodeRequired', { default: 'Plan code is required' }));
      return false;
    }
    if (!formData.module_id.trim()) {
      showNotification('error', t('notifications.moduleRequired'));
      return false;
    }
    if (!formData.type_maintenance.trim()) {
      showNotification('error', t('notifications.maintenanceTypeRequired'));
      return false;
    }
    if (!formData.unite_frequence.trim()) {
      showNotification('error', t('notifications.frequencyUnitRequired'));
      return false;
    }
    const frequencyValue = Number(formData.frequence);
    if (!Number.isFinite(frequencyValue) || frequencyValue <= 0) {
      showNotification('error', t('notifications.frequencyPositive'));
      return false;
    }
    return true;
  }

  function handleCreate() {
    resetForm();
    setShowModal(true);
  }

  function handleEdit(plan: MaintenancePlan) {
    setEditingPlan(plan);
    setFormData({
      plan_id: plan.plan_id || '',
      module_id: typeof plan.module_id === 'string' ? plan.module_id : plan.module_id?._id || '',
      type_maintenance: plan.type_maintenance || 'preventive',
      frequence: String(plan.frequence ?? 1),
      unite_frequence: plan.unite_frequence || 'semaine',
      maintenance_code: plan.maintenance_code || '',
      frequence_label: plan.frequence_label || '',
      instruction: cleanInstruction(plan.instruction),
      responsable: cleanResponsable(plan.responsable),
      huile_graisse: plan.huile_graisse || '',
      documentation: plan.documentation || '',
    });
    setShowModal(true);
  }

  async function handleDelete(plan: MaintenancePlan) {
    if (!confirm(t('notifications.confirmDelete'))) return;

    try {
      await apiService.deleteMaintenancePlan(plan._id, plan.version);
      showNotification('success', t('notifications.deleteSuccess'));
      await table.reload();
    } catch (error) {
      console.error('Error deleting maintenance plan:', error);
      showNotification('error', extractApiErrorMessage(error, t('notifications.deleteFailed')));
    }
  }

  const TRANSITION_CONFIRM_KEYS: Record<MaintenancePlanTransitionAction, string> = {
    activate: 'notifications.confirmActivate',
    pause: 'notifications.confirmPause',
    resume: 'notifications.confirmResume',
    archive: 'notifications.confirmArchive',
    complete: 'notifications.confirmComplete',
  };

  async function handleTransition(plan: MaintenancePlan, action: MaintenancePlanTransitionAction) {
    if (!confirm(t(TRANSITION_CONFIRM_KEYS[action]))) return;

    try {
      await apiService.transitionMaintenancePlan(plan._id, action);
      showNotification('success', t('notifications.transitionSuccess'));
      await table.reload();
    } catch (error) {
      console.error('Error transitioning maintenance plan:', error);
      showNotification('error', extractApiErrorMessage(error, t('notifications.transitionFailed')));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    try {
      const payload = {
        plan_id: formData.plan_id.trim(),
        module_id: formData.module_id,
        type_maintenance: formData.type_maintenance.trim(),
        frequence: Number(formData.frequence),
        unite_frequence: formData.unite_frequence.trim(),
        maintenance_code: formData.maintenance_code.trim() || undefined,
        frequence_label: formData.frequence_label.trim() || undefined,
        instruction: cleanInstruction(formData.instruction) || undefined,
        responsable: cleanResponsable(formData.responsable) || undefined,
        huile_graisse: formData.huile_graisse.trim() || undefined,
        documentation: formData.documentation.trim() || undefined,
      };

      if (editingPlan) {
        await apiService.updateMaintenancePlan(editingPlan._id, {
          ...payload,
          expected_version: editingPlan.version,
        });
        showNotification('success', t('notifications.updateSuccess'));
      } else {
        await apiService.createMaintenancePlan(payload);
        showNotification('success', t('notifications.createSuccess'));
      }

      setShowModal(false);
      resetForm();
      await table.reload();
    } catch (error) {
      console.error('Error saving maintenance plan:', error);
      showNotification('error', extractApiErrorMessage(error, t('notifications.saveFailed')));
    } finally {
      setSubmitting(false);
    }
  }

  const planIdOptions = useMemo(() => mergeOptions(table.items.map((plan) => plan.plan_id)), [table.items]);
  const maintenanceCodeOptions = useMemo(
    () => mergeOptions(table.items.map((plan) => plan.maintenance_code), ['W1', 'W2', 'W3', 'W4', 'W5', 'W6']),
    [table.items],
  );
  const frequenceLabelOptions = useMemo(
    () => mergeOptions(table.items.map((plan) => plan.frequence_label), ['Monthly', 'Quarterly', 'Semi-annual', 'Annual']),
    [table.items],
  );

  const columns: DataTableColumn<MaintenancePlan>[] = useMemo(
    () => [
      {
        key: 'plan_id',
        header: t('table.planCode', { default: 'Plan Code' }),
        width: '9rem',
        render: (plan) => <span className="font-medium">{displayText(plan.plan_id, tCommon('notAvailable'))}</span>,
      },
      {
        key: 'module_id',
        header: t('table.module'),
        width: '9rem',
        render: (plan) => getModuleLabel(plan.module_id, modules, tCommon('notAvailable')),
      },
      {
        key: 'status',
        header: t('table.status', { default: 'Status' }),
        sortable: true,
        width: '9rem',
        render: (plan) => {
          const status = plan.status || 'active';
          return <StatusBadge label={t(`status.${status}`, { default: status })} colorClassName={STATUS_BADGE_CLASSES[status]} />;
        },
      },
      {
        key: 'type_maintenance',
        header: t('table.maintenanceType'),
        width: '8rem',
        render: (plan) => plan.type_maintenance,
      },
      {
        key: 'frequence',
        header: t('table.frequency'),
        width: '6rem',
        render: (plan) => plan.frequence,
      },
      {
        key: 'unite_frequence',
        header: t('table.frequencyUnit'),
        width: '7rem',
        render: (plan) => plan.unite_frequence,
      },
      {
        key: 'instruction',
        header: t('table.instruction'),
        width: 'minmax(10rem, 1.5fr)',
        render: (plan) => cleanInstruction(plan.instruction) || tCommon('notAvailable'),
      },
      {
        key: 'responsable',
        header: t('table.responsable'),
        width: '8rem',
        render: (plan) => cleanResponsable(plan.responsable) || tCommon('notAvailable'),
      },
      {
        key: 'huile_graisse',
        header: t('table.huileGraisse'),
        width: '7rem',
        render: (plan) => plan.huile_graisse || tCommon('notAvailable'),
      },
      {
        key: 'documentation',
        header: t('table.documentation'),
        width: '9rem',
        render: (plan) => plan.documentation || tCommon('notAvailable'),
      },
      {
        key: 'machine_health',
        header: t('table.machineHealth', { default: 'Machine Health' }),
        width: '7rem',
        render: (plan) => <MachineHealthBadge status={planHealth[plan._id]} />,
      },
      {
        key: 'actions',
        header: tCommon('table.actions'),
        align: 'end',
        // Wide enough to fit the worst case (3 transition buttons + edit +
        // delete, for an active plan) on a single line. These buttons must
        // never wrap: rows are absolutely positioned at fixed intervals by
        // the virtualizer (no dynamic remeasurement), so a row that wraps
        // to two lines grows taller than its allotted slot and visually
        // overlaps the row below it.
        width: 'minmax(24rem, 40rem)',
        render: (plan) => {
          const status = plan.status || 'active';
          const isArchived = status === 'archived';
          const availableActions = AVAILABLE_TRANSITIONS[status] || [];
          return (
            <div className="flex flex-nowrap justify-end gap-2">
              {availableActions.map((action) => (
                <button
                  key={action}
                  className="btn-secondary whitespace-nowrap px-2 py-1 text-xs"
                  title={t(`actions.${action}`)}
                  onClick={() => handleTransition(plan, action)}
                >
                  {t(`actions.${action}`)}
                </button>
              ))}
              {!isArchived ? (
                <button
                  className="btn-secondary p-2"
                  title={t('actions.edit')}
                  aria-label={`${t('actions.edit')} ${plan.plan_id}`}
                  onClick={() => handleEdit(plan)}
                >
                  <PencilIcon className="w-4 h-4" />
                </button>
              ) : null}
              {!isArchived ? (
                <button
                  className="btn-danger p-2"
                  title={t('actions.delete')}
                  aria-label={`${t('actions.delete')} ${plan.plan_id}`}
                  onClick={() => handleDelete(plan)}
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              ) : null}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tCommon, planHealth, modules],
  );

  return (
    <DashboardLayout title={t('title')}>
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center gap-2 ${notification.type === 'success'
            ? 'bg-green-100 text-green-800 border border-green-200'
            : 'bg-red-100 text-red-800 border border-red-200'
            }`}
        >
          {notification.type === 'success' ? <CheckCircleIcon className="w-5 h-5" /> : <ExclamationTriangleIcon className="w-5 h-5" />}
          <span>{notification.message}</span>
          <button
            className="ml-2 flex items-center justify-center text-gray-600 hover:text-gray-800"
            style={{ minWidth: 24, minHeight: 24 }}
            aria-label={tCommon('dismiss')}
            onClick={() => setNotification(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="bento-grid">
        <div className="col-span-full mb-6 bento-item">
          <div className="panel">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{t('heading')}</h1>
                <p className="text-slate-600 mt-1">{t('description')}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">
                    {table.totalItems}
                  </div>
                  <div className="text-sm text-slate-500">{t('totalPlans')}</div>
                </div>
                <button onClick={handleCreate} className="btn-primary flex items-center gap-2">
                  <PlusIcon className="w-4 h-4" />
                  <span>{t('addPlan')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-full bento-item panel">
          <div className="flex flex-wrap items-center justify-between mb-4 gap-4">
            <div className="card-title">{t('allPlans')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={table.searchInput}
                onChange={(e) => table.setSearchInput(e.target.value)}
                className="input-field"
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
              />
              <select
                value={table.filters.status}
                onChange={(e) => { table.setFilters({ ...table.filters, status: e.target.value }); table.setPage(1); }}
                className="input-field"
                aria-label={t('table.status', { default: 'Status' })}
              >
                <option value="">{t('filters.allStatuses')}</option>
                {(Object.keys(STATUS_BADGE_CLASSES) as MaintenancePlanStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`, { default: status })}
                  </option>
                ))}
              </select>
              <select
                value={table.filters.typeMaintenance}
                onChange={(e) => { table.setFilters({ ...table.filters, typeMaintenance: e.target.value }); table.setPage(1); }}
                className="input-field"
                aria-label={t('table.maintenanceType')}
              >
                <option value="">{t('filters.allTypes')}</option>
                {MAINTENANCE_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4">
            <SavedViewsBar
              views={savedViews}
              activeViewId={activeSavedViewId}
              onApply={applySavedView}
              onSaveCurrent={(name) => void saveCurrentView(name)}
              onDelete={(view) => void deleteSavedView(view)}
              saveLabel={tCommon('savedViews.save')}
              namePlaceholder={tCommon('savedViews.namePlaceholder')}
              emptyLabel={tCommon('savedViews.empty')}
              deleteLabel={tCommon('savedViews.delete')}
            />
          </div>

          <VirtualizedDataTable
            columns={columns}
            rows={table.items}
            rowKey={(plan) => plan._id}
            loading={table.loading}
            error={table.error}
            onRetry={table.reload}
            emptyMessage={table.searchInput ? t('empty.search') : t('empty.default')}
            loadingLabel={tCommon('loading')}
            errorRetryLabel={tCommon('retry')}
            sortField={table.sortField}
            sortDirection={table.sortDirection}
            onSortChange={table.toggleSort}
            ariaLabel={t('allPlans')}
          />

          <div className="col-span-full mt-4">
            <Pagination
              page={table.page}
              totalPages={table.totalPages}
              totalItems={table.totalItems}
              limit={table.limit}
              onPageChange={table.setPage}
            />
          </div>
        </div>
      </div>

      <PlanFormModal
        isOpen={showModal}
        editingPlan={editingPlan}
        formData={formData}
        setFormData={setFormData}
        submitting={submitting}
        modules={modules}
        planIdOptions={planIdOptions}
        maintenanceCodeOptions={maintenanceCodeOptions}
        frequenceLabelOptions={frequenceLabelOptions}
        onClose={() => setShowModal(false)}
        onSubmit={handleSubmit}
        t={t}
        tCommon={tCommon}
      />
    </DashboardLayout>
  );
}
