'use client';
import Pagination from '@/components/Pagination';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { translateEnumValue } from '@/services/enumTranslations';
import DashboardLayout from '@/components/DashboardLayout';
import { apiService } from '@/services/api';
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
  getModule,
  getMachineId,
  getMachineLabel,
  frequencyLabel,
  frequencyTranslationKey,
  maintenanceTypeLabel,
  mergeOptions,
} from './utils';
import { fetchAllPaginated } from '@/services/pagination';
import { Modal } from '@/components/Modal';
import MachineHealthBadge from '@/components/predictive-maintenance/MachineHealthBadge';
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
  const tEnums = useTranslations('common.enums');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const formatFrequency = (plan: MaintenancePlan) => {
    const key = frequencyTranslationKey(plan.frequence, plan.unite_frequence);
    return key ? t(`frequencyLabels.${key}`, { count: plan.frequence }) : frequencyLabel(plan.frequence, plan.unite_frequence, plan.frequence_label);
  };
  const formatMaintenanceType = (value: string) => {
    if (value === 'corrective_history') return t('legacyCorrectiveHistory');
    const translated = translateEnumValue(tEnums, 'maintenanceTypes', value);
    return translated === value ? maintenanceTypeLabel(value) : translated;
  };

  const [modules, setModules] = useState<ModuleEntity[]>([]);
  const [modulesError, setModulesError] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<MaintenancePlan | null>(null);
  const [relatedOrders, setRelatedOrders] = useState<Array<{ _id: string; ot_id: string; status: string }>>([]);
  const [relatedOrdersLoading, setRelatedOrdersLoading] = useState(false);
  const [relatedOrdersError, setRelatedOrdersError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MaintenancePlan | null>(null);
  const { planHealth } = usePlanHealth();
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [formData, setFormData] = useState<PlanFormData>({
    plan_id: '',
    machineId: '',
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
    initialFilters: { status: '', typeMaintenance: '', machineId: '', frequencyUnit: '' },
    pageSize: 10,
  });

  const loadFormOptions = useCallback(async () => {
    try {
      setModules(await fetchAllPaginated<ModuleEntity>((params) => apiService.getModules(params)));
      setModulesError(false);
    } catch (error) {
      console.error('Error loading modules:', error);
      setModulesError(true);
    }
  }, []);

  useEffect(() => {
    void loadFormOptions();
  }, [loadFormOptions]);

  useEffect(() => {
    const planId = searchParams.get('planId');
    if (!planId) return;
    let active = true;
    apiService.getMaintenancePlan(planId)
      .then((response) => { if (active) setSelectedPlan(response.data as MaintenancePlan); })
      .catch(() => { /* The list retains its own loading/error state. */ });
    return () => { active = false; };
  }, [searchParams]);

  useEffect(() => {
    if (!selectedPlan) return;
    let active = true;
    setRelatedOrdersLoading(true);
    setRelatedOrdersError(false);
    fetchAllPaginated<{ _id: string; ot_id: string; status: string; plan_id?: string | { _id: string } }>(
      (params) => apiService.getWorkOrders(params), 100,
    ).then((orders) => {
      if (!active) return;
      setRelatedOrders(orders.filter((order) =>
        (typeof order.plan_id === 'string' ? order.plan_id : order.plan_id?._id) === selectedPlan._id));
    }).catch(() => { if (active) setRelatedOrdersError(true); })
      .finally(() => { if (active) setRelatedOrdersLoading(false); });
    return () => { active = false; };
  }, [selectedPlan]);

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
      machineId: '',
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
    if (getMachineId(modules.find((module) => module._id === formData.module_id)) !== formData.machineId) {
      showNotification('error', t('moduleMachineMismatch'));
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
      machineId: getMachineId(getModule(plan.module_id, modules)),
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
  const machineOptions = useMemo(() => {
    const byId = new Map<string, string>();
    modules.forEach((module) => {
      const id = getMachineId(module);
      if (id) byId.set(id, getMachineLabel(module, modules, '—'));
    });
    return Array.from(byId, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [modules]);
  const frequencyOptions = useMemo(() =>
    Array.from(new Set(table.items.map((plan) => plan.unite_frequence).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [table.items]);
  const typeOptions = useMemo(() =>
    Array.from(new Set([...MAINTENANCE_TYPE_OPTIONS, ...table.items.map((plan) => plan.type_maintenance)])).sort((a, b) => a.localeCompare(b)),
    [table.items]);
  // These two relationship/frequency filters operate on the current server page only.
  // The backend API has no corresponding filters; pagination totals remain authoritative.
  const visiblePlans = useMemo(() => table.items.filter((plan) => {
    const module = getModule(plan.module_id, modules);
    return (!table.filters.machineId || getMachineId(module) === table.filters.machineId)
      && (!table.filters.frequencyUnit || plan.unite_frequence === table.filters.frequencyUnit);
  }), [table.items, table.filters.machineId, table.filters.frequencyUnit, modules]);

  const columns: DataTableColumn<MaintenancePlan>[] = useMemo(
    () => [
      {
        key: 'plan_id',
        header: t('table.planCode'),
        width: '9rem',
        render: (plan) => <span className="font-medium">{plan.plan_id || '—'}</span>,
      },
      {
        key: 'machine',
        header: t('machineLabel'),
        width: '9rem',
        render: (plan) => <div className="space-y-1"><span>{getMachineLabel(getModule(plan.module_id, modules), modules, '—')}</span><MachineHealthBadge status={planHealth[plan._id]} /></div>,
      },
      {
        key: 'module_id',
        header: t('table.module'),
        width: '9rem',
        render: (plan) => getModuleLabel(plan.module_id, modules, '—'),
      },
      {
        key: 'type_maintenance',
        header: t('table.maintenanceType'),
        width: '8rem',
        render: (plan) => formatMaintenanceType(plan.type_maintenance),
      },
      {
        key: 'instruction',
        header: t('table.instruction'),
        width: 'minmax(10rem, 1.5fr)',
        render: (plan) => <span className="block truncate" title={plan.instruction}>{cleanInstruction(plan.instruction) || '—'}</span>,
      },
      {
        key: 'frequence',
        header: t('table.frequency'),
        width: '11rem',
        render: (plan) => formatFrequency(plan),
      },
      {
        key: 'responsable',
        header: t('table.responsable'),
        width: '8rem',
        render: (plan) => cleanResponsable(plan.responsable) || '—',
      },
      {
        key: 'status',
        header: t('table.status', { default: 'Status' }),
        sortable: true,
        width: '8rem',
        render: (plan) => {
          const status = plan.status || 'active';
          return <StatusBadge label={t(`status.${status}`, { default: status })} colorClassName={STATUS_BADGE_CLASSES[status]} />;
        },
      },
      {
        key: 'actions',
        header: tCommon('table.actions'),
        align: 'end',
        width: '12rem',
        render: (plan) => {
          const status = plan.status || 'active';
          const isArchived = status === 'archived';
          return (
            <div className="flex flex-nowrap justify-end gap-2">
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setSelectedPlan(plan)} aria-label={`${t('view')} ${plan.plan_id}`}>{t('view')}</button>
              {!isArchived ? (
                <button type="button"
                  className="btn-secondary p-2"
                  title={t('actions.edit')}
                  aria-label={`${t('actions.edit')} ${plan.plan_id}`}
                  onClick={() => handleEdit(plan)}
                >
                  <PencilIcon className="w-4 h-4" />
                </button>
              ) : null}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tCommon, modules, planHealth],
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
          <button type="button"
            className="ml-2 flex items-center justify-center text-gray-600 hover:text-gray-800"
            style={{ minWidth: 24, minHeight: 24 }}
            aria-label={tCommon('dismiss')}
            onClick={() => setNotification(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="space-y-4 min-w-0">
        <div>
          <div className="panel">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{t('workspaceTitle')}</h1>
                <p className="text-slate-600 mt-1">{t('workspaceSubtitle')}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">
                    {table.totalItems}
                  </div>
                  <div className="text-sm text-slate-500">{t('totalPlans')}</div>
                </div>
                <button type="button" onClick={handleCreate} className="btn-primary flex items-center gap-2">
                  <PlusIcon className="w-4 h-4" />
                  <span>{t('addPlan')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="panel min-w-0">
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Plan status">
            {(['', 'draft', 'active', 'paused', 'archived', 'completed'] as const).map((status) => (
              <button
                key={status || 'all'}
                type="button"
                className={table.filters.status === status ? 'btn-primary' : 'btn-secondary'}
                aria-pressed={table.filters.status === status}
                onClick={() => { table.setFilters({ ...table.filters, status }); table.setPage(1); }}
              >
                {status ? t(`status.${status}`) : t('allTab')}
              </button>
            ))}
          </div>
          <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
              <input
                type="search"
                value={table.searchInput}
                onChange={(e) => table.setSearchInput(e.target.value)}
                className="input-field w-full min-w-0"
                placeholder={t('searchPlans')}
                aria-label={t('searchPlans')}
              />
              <select
                value={table.filters.machineId}
                onChange={(e) => { table.setFilters({ ...table.filters, machineId: e.target.value }); table.setPage(1); }}
                className="input-field w-full min-w-0"
                aria-label={t('filterMachine')}
              >
                <option value="">{t('allMachines')}</option>
                {machineOptions.map((machine) => <option key={machine.id} value={machine.id}>{machine.label}</option>)}
              </select>
              <select
                value={table.filters.typeMaintenance}
                onChange={(e) => { table.setFilters({ ...table.filters, typeMaintenance: e.target.value }); table.setPage(1); }}
                className="input-field w-full min-w-0"
                aria-label={t('table.maintenanceType')}
              >
                <option value="">{t('filters.allTypes')}</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {formatMaintenanceType(type)}
                  </option>
                ))}
              </select>
              <select
                value={table.filters.frequencyUnit}
                onChange={(e) => { table.setFilters({ ...table.filters, frequencyUnit: e.target.value }); table.setPage(1); }}
                className="input-field w-full min-w-0"
                aria-label={t('filterFrequency')}
              >
                <option value="">{t('allFrequencies')}</option>
                {frequencyOptions.map((unit) => <option key={unit} value={unit}>{frequencyTranslationKey(1, unit) ? t(`frequencyLabels.${frequencyTranslationKey(1, unit)}`) : frequencyLabel(1, unit)}</option>)}
              </select>
          </div>
          {modulesError && <div role="alert" className="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm">{t('moduleLoadFailed')} <button type="button" className="underline" onClick={() => void loadFormOptions()}>{tCommon('retry')}</button></div>}
          {(table.filters.machineId || table.filters.frequencyUnit) && <p className="mb-3 text-xs text-slate-600">{t('pageFilterScope')}</p>}
          {(table.searchInput || Object.values(table.filters).some(Boolean)) && <button type="button" className="btn-secondary mb-3" onClick={() => { table.setSearchInput(''); table.setFilters({ status: '', typeMaintenance: '', machineId: '', frequencyUnit: '' }); table.setPage(1); }}>{t('resetFilters')}</button>}

          <details className="mb-4 text-sm">
            <summary className="cursor-pointer font-medium">{t('savedViewsLabel')}</summary>
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
          </details>

          <VirtualizedDataTable
            columns={columns}
            rows={visiblePlans}
            rowKey={(plan) => plan._id}
            loading={table.loading}
            error={table.error}
            onRetry={table.reload}
            emptyMessage={table.searchInput || table.filters.machineId || table.filters.frequencyUnit || table.filters.status || table.filters.typeMaintenance ? t('empty.search') : t('empty.default')}
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
      <Modal isOpen={Boolean(selectedPlan)} onClose={() => setSelectedPlan(null)} title={selectedPlan ? `${t('table.planCode')} ${selectedPlan.plan_id}` : t('view')}>
        {selectedPlan && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">{t('ruleExplanation')}</p>
            {selectedPlan.unite_frequence === 'loading' && <p role="note" className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900">{t('loadingWarning')}</p>}
            <h3 className="font-semibold">{t('generalInformation')}</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="font-semibold">{t('machineLabel')}</dt><dd>{getMachineLabel(getModule(selectedPlan.module_id, modules), modules, '—')}</dd></div>
              <div><dt className="font-semibold">{t('table.module')}</dt><dd>{getModuleLabel(selectedPlan.module_id, modules, '—')}</dd></div>
              <div><dt className="font-semibold">{t('table.maintenanceType')}</dt><dd>{formatMaintenanceType(selectedPlan.type_maintenance)}</dd></div>
              <div><dt className="font-semibold">{t('table.frequency')}</dt><dd>{formatFrequency(selectedPlan)}</dd></div>
              <div><dt className="font-semibold">{t('table.responsable')}</dt><dd>{cleanResponsable(selectedPlan.responsable) || '—'}</dd></div>
              <div><dt className="font-semibold">{t('table.maintenanceCode')}</dt><dd>{selectedPlan.maintenance_code || '—'}</dd></div>
              <div><dt className="font-semibold">{t('table.huileGraisse')}</dt><dd>{selectedPlan.huile_graisse || '—'}</dd></div>
              <div><dt className="font-semibold">{t('table.documentation')}</dt><dd>{selectedPlan.documentation || '—'}</dd></div>
              <div><dt className="font-semibold">{t('machineHealthLabel')}</dt><dd><MachineHealthBadge status={planHealth[selectedPlan._id]} /></dd></div>
            </dl>
            <div><h3 className="font-semibold">{t('table.instruction')}</h3><p className="whitespace-pre-wrap break-words">{cleanInstruction(selectedPlan.instruction) || '—'}</p></div>
            <section className="border-t pt-3" aria-label={t('relatedWorkOrders')}>
              <h3 className="font-semibold">{t('relatedWorkOrders')}</h3>
              {relatedOrdersLoading ? <p>{t('loadingRelatedWorkOrders')}</p> : null}
              {relatedOrdersError ? <p role="alert">{t('relatedWorkOrdersFailed')} <button type="button" className="underline" onClick={() => setSelectedPlan({ ...selectedPlan })}>{tCommon('retry')}</button></p> : null}
              {!relatedOrdersLoading && !relatedOrdersError && relatedOrders.length === 0 ? <p>{t('noRelatedWorkOrders')}</p> : null}
              {!relatedOrdersLoading && !relatedOrdersError && relatedOrders.length > 0 && <ul className="mt-2 space-y-2">
                {relatedOrders.map((order) => <li key={order._id}><Link className="text-blue-700 underline" href={`/${locale}/work-orders/${order._id}`}>{order.ot_id}</Link> <span className="text-slate-500">{translateEnumValue(tEnums, 'workOrderStatuses', order.status)}</span></li>)}
              </ul>}
            </section>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {(AVAILABLE_TRANSITIONS[selectedPlan.status || 'active'] || []).map((action) => (
                <button key={action} type="button" className="btn-secondary" onClick={() => { void handleTransition(selectedPlan, action); setSelectedPlan(null); }}>{t(`actions.${action}`)}</button>
              ))}
              {selectedPlan.status !== 'archived' && <button type="button" className="btn-danger" onClick={() => { void handleDelete(selectedPlan); setSelectedPlan(null); }}>{t('actions.delete')}</button>}
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
}
