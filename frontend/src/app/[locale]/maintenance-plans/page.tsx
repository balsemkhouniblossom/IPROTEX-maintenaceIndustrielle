'use client';
import Pagination from '@/components/Pagination';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import DashboardLayout from '@/components/DashboardLayout';
import DynamicSearchControls from '@/components/DynamicSearchControls';
import { Modal } from '@/components/Modal';
import { apiService } from '@/services/api';
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from '@/services/dynamicSearch';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

interface ModuleEntity {
  _id: string;
  module_id?: string;
  localisation?: string;
}

interface MaintenancePlan {
  _id: string;
  plan_id: string;
  module_id: string | ModuleEntity;
  type_maintenance: string;
  frequence: number;
  unite_frequence: string;
  instruction?: string;
  responsable?: string;
  huile_graisse?: string;
  documentation?: string;
  maintenance_code?: string;
  frequence_label?: string;
}

const CUSTOM_OPTION = '__custom__';

const MAINTENANCE_TYPE_OPTIONS = ['preventive', 'corrective', 'inspection', 'lubrication'];
const FREQUENCE_OPTIONS = ['1', '2', '3', '4', '6', '12'];
const FREQUENCE_UNIT_OPTIONS = ['jour', 'semaine', 'mois', 'trimestre', 'semestre', 'an'];
const RESPONSABLE_OPTIONS = ['Maintenance', 'Operator', 'Supervisor', 'Quality'];
const HUILE_GRAISSE_OPTIONS = ['Huile', 'Graisse', 'Aucune'];
const DOCUMENTATION_OPTIONS = ['Maintenance plan', 'Machine maintenance plan', 'SOP', 'Checklist'];
const INSTRUCTION_OPTIONS = [
  'Visual inspection',
  'Clean and lubricate',
  'Check safety points',
  'Verify sensor status',
  'Tighten fittings and connectors',
];

function getSelectValue(options: string[], value: string): string {
  return options.includes(value) ? value : CUSTOM_OPTION;
}

function getNextFieldValue(options: string[], currentValue: string, selectedValue: string): string {
  if (selectedValue !== CUSTOM_OPTION) {
    return selectedValue;
  }
  return options.includes(currentValue) ? '' : currentValue;
}

function mergeOptions(dynamicValues: Array<string | undefined>, fixedValues: string[] = []): string[] {
  const values = [...fixedValues, ...dynamicValues]
    .map((value) => (value || '').trim())
    .filter(Boolean);

  return Array.from(new Set(values));
}

function getModuleLabel(value: string | ModuleEntity, modules: ModuleEntity[], fallback: string): string {
  if (!value) return fallback;
  if (typeof value === 'object') {
    return value.module_id || value.localisation || value._id;
  }
  const found = modules.find((module) => module._id === value);
  return found?.module_id || value || fallback;
}

export default function MaintenancePlansPage() {
  const t = useTranslations('maintenancePlans');
  const tCommon = useTranslations('common');

  const [plans, setPlans] = useState<MaintenancePlan[]>([]);
  const [modules, setModules] = useState<ModuleEntity[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MaintenancePlan | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [formData, setFormData] = useState({
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
  const loadData = async () => {
    try {
      setLoading(true);

      const [plansResponse, modulesResponse] = await Promise.all([
        apiService.getMaintenancePlans({ page, limit }),
        apiService.getModules(),
      ]);

      setPlans(plansResponse.data.items ?? []);
      setTotalItems(plansResponse.data.totalItems ?? 0);
      setTotalPages(plansResponse.data.totalPages ?? 1);

      const modulesData = Array.isArray(modulesResponse.data)
        ? modulesResponse.data
        : modulesResponse.data?.items ??
        modulesResponse.data?.data ??
        modulesResponse.data?.modules ??
        [];

      setModules(modulesData);
    } catch (error) {
      console.error('Error loading maintenance plans:', error);
      showNotification('error', t('notifications.loadFailed'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    loadData();
  }, [page]);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  }

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
      showNotification('error', t('notifications.planIdRequired'));
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
      instruction: plan.instruction || '',
      responsable: plan.responsable || '',
      huile_graisse: plan.huile_graisse || '',
      documentation: plan.documentation || '',
    });
    setShowModal(true);
  }

  async function handleDelete(planId: string) {
    if (!confirm(t('notifications.confirmDelete'))) return;

    try {
      await apiService.deleteMaintenancePlan(planId);
      showNotification('success', t('notifications.deleteSuccess'));
      await loadData();
    } catch (error) {
      console.error('Error deleting maintenance plan:', error);
      showNotification('error', t('notifications.deleteFailed'));
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
        instruction: formData.instruction.trim() || undefined,
        responsable: formData.responsable.trim() || undefined,
        huile_graisse: formData.huile_graisse.trim() || undefined,
        documentation: formData.documentation.trim() || undefined,
      };

      if (editingPlan) {
        await apiService.updateMaintenancePlan(editingPlan._id, payload);
        showNotification('success', t('notifications.updateSuccess'));
      } else {
        await apiService.createMaintenancePlan(payload);
        showNotification('success', t('notifications.createSuccess'));
      }

      setShowModal(false);
      resetForm();
      await loadData();
    } catch (error) {
      console.error('Error saving maintenance plan:', error);
      showNotification('error', t('notifications.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const searchablePlans = useMemo(
    () =>
      plans.map((plan) => ({
        ...plan,
        module_label: getModuleLabel(plan.module_id, modules, tCommon('notAvailable')),
      })),
    [plans, modules, tCommon],
  );

  const searchableFields = useMemo(() => getSearchableFields(searchablePlans), [searchablePlans]);

  const filteredPlans = useMemo(() => {
    const filtered = searchablePlans.filter((plan) =>
      matchesDynamicSearch(plan, searchTerm, selectedSearchField)
    );

    return filtered;
  }, [searchablePlans, searchTerm, selectedSearchField]);

  const planIdOptions = useMemo(() => mergeOptions(plans.map((plan) => plan.plan_id)), [plans]);
  const maintenanceCodeOptions = useMemo(
    () => mergeOptions(plans.map((plan) => plan.maintenance_code), ['W1', 'W2', 'W3', 'W4', 'W5', 'W6']),
    [plans],
  );
  const frequenceLabelOptions = useMemo(
    () => mergeOptions(plans.map((plan) => plan.frequence_label), ['Monthly', 'Quarterly', 'Semi-annual', 'Annual']),
    [plans],
  );

  if (loading) {
    return (
      <DashboardLayout title={t('title')}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

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
          <button className="ml-2 text-gray-600 hover:text-gray-800" onClick={() => setNotification(null)}>
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
                    {totalItems}
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
          <div className="flex items-center justify-between mb-4 gap-4">
            <div className="card-title">{t('allPlans')}</div>
            <DynamicSearchControls
              className=""
              selectClassName="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              inputClassName="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full"
              selectedField={selectedSearchField}
              onSelectedFieldChange={setSelectedSearchField}
              searchableFields={searchableFields}
              allFieldsLabel={tCommon('table.allFields', { default: 'All fields' })}
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              searchPlaceholder={t('searchPlaceholder')}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('table.maintenanceType')}</th>
                  <th>{t('table.frequency')}</th>
                  <th>{t('table.frequencyUnit')}</th>
                  <th>{t('table.instruction')}</th>
                  <th>{t('table.responsable')}</th>
                  <th>{t('table.huileGraisse')}</th>
                  <th>{t('table.documentation')}</th>
                  <th>{tCommon('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlans.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-gray-500">
                      {searchTerm ? t('empty.search') : t('empty.default')}
                    </td>
                  </tr>
                ) : (
                  filteredPlans.map((plan) => (
                    <tr key={plan._id}>
                      <td>{plan.type_maintenance}</td>
                      <td>{plan.frequence}</td>
                      <td>{plan.unite_frequence}</td>
                      <td>{plan.instruction || tCommon('notAvailable')}</td>
                      <td>{plan.responsable || tCommon('notAvailable')}</td>
                      <td>{plan.huile_graisse || tCommon('notAvailable')}</td>
                      <td>{plan.documentation || tCommon('notAvailable')}</td>
                      <td>
                        <div className="flex gap-2">
                          <button className="btn-secondary p-2" title={t('actions.edit')} onClick={() => handleEdit(plan)}>
                            <PencilIcon className="w-4 h-4" />
                          </button>
                          <button className="btn-danger p-2" title={t('actions.delete')} onClick={() => handleDelete(plan._id)}>
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="col-span-full">
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={totalItems}
                limit={limit}
                onPageChange={setPage}
              />
            </div>
          </div>

        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingPlan ? t('modal.edit') : t('modal.add')}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.planId')}</label>
            <select
              value={getSelectValue(planIdOptions, formData.plan_id)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  plan_id: getNextFieldValue(planIdOptions, prev.plan_id, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.planId')}
              required
            >
              <option value="">{t('placeholders.planId')}</option>
              {planIdOptions.map((planId) => (
                <option key={planId} value={planId}>
                  {planId}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(planIdOptions, formData.plan_id) === CUSTOM_OPTION && (
              <input
                type="text"
                value={formData.plan_id}
                onChange={(event) => setFormData((prev) => ({ ...prev, plan_id: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.planId')}
                required
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.module')}</label>
            <select
              value={formData.module_id}
              onChange={(event) => setFormData((prev) => ({ ...prev, module_id: event.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.module')}
              required
            >
              <option value="">{t('placeholders.module')}</option>
              {(Array.isArray(modules) ? modules : []).map((module) => (
                <option key={module._id} value={module._id}>
                  {module.module_id || module._id}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.maintenanceType')}</label>
              <select
                value={getSelectValue(MAINTENANCE_TYPE_OPTIONS, formData.type_maintenance)}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    type_maintenance: getNextFieldValue(MAINTENANCE_TYPE_OPTIONS, prev.type_maintenance, event.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                title={t('form.maintenanceType')}
                required
              >
                {MAINTENANCE_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value={CUSTOM_OPTION}>{t('custom')}</option>
              </select>
              {getSelectValue(MAINTENANCE_TYPE_OPTIONS, formData.type_maintenance) === CUSTOM_OPTION && (
                <input
                  type="text"
                  value={formData.type_maintenance}
                  onChange={(event) => setFormData((prev) => ({ ...prev, type_maintenance: event.target.value }))}
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder={t('placeholders.maintenanceType')}
                  required
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.frequency')}</label>
              <select
                value={getSelectValue(FREQUENCE_OPTIONS, formData.frequence)}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    frequence: getNextFieldValue(FREQUENCE_OPTIONS, prev.frequence, event.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                title={t('form.frequency')}
                required
              >
                {FREQUENCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value={CUSTOM_OPTION}>{t('custom')}</option>
              </select>
              {getSelectValue(FREQUENCE_OPTIONS, formData.frequence) === CUSTOM_OPTION && (
                <input
                  type="number"
                  min="1"
                  value={formData.frequence}
                  onChange={(event) => setFormData((prev) => ({ ...prev, frequence: event.target.value }))}
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder={t('placeholders.frequency')}
                  required
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.frequencyUnit')}</label>
            <select
              value={getSelectValue(FREQUENCE_UNIT_OPTIONS, formData.unite_frequence)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  unite_frequence: getNextFieldValue(FREQUENCE_UNIT_OPTIONS, prev.unite_frequence, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.frequencyUnit')}
              required
            >
              {FREQUENCE_UNIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(FREQUENCE_UNIT_OPTIONS, formData.unite_frequence) === CUSTOM_OPTION && (
              <input
                type="text"
                value={formData.unite_frequence}
                onChange={(event) => setFormData((prev) => ({ ...prev, unite_frequence: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.frequencyUnit')}
                required
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.maintenanceCode')}</label>
              <select
                value={getSelectValue(maintenanceCodeOptions, formData.maintenance_code)}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    maintenance_code: getNextFieldValue(maintenanceCodeOptions, prev.maintenance_code, event.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                title={t('form.maintenanceCode')}
              >
                <option value="">{t('placeholders.maintenanceCode')}</option>
                {maintenanceCodeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value={CUSTOM_OPTION}>{t('custom')}</option>
              </select>
              {getSelectValue(maintenanceCodeOptions, formData.maintenance_code) === CUSTOM_OPTION && (
                <input
                  type="text"
                  value={formData.maintenance_code}
                  onChange={(event) => setFormData((prev) => ({ ...prev, maintenance_code: event.target.value }))}
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder={t('placeholders.maintenanceCode')}
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.frequencyLabel')}</label>
              <select
                value={getSelectValue(frequenceLabelOptions, formData.frequence_label)}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    frequence_label: getNextFieldValue(frequenceLabelOptions, prev.frequence_label, event.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                title={t('form.frequencyLabel')}
              >
                <option value="">{t('placeholders.frequencyLabel')}</option>
                {frequenceLabelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value={CUSTOM_OPTION}>{t('custom')}</option>
              </select>
              {getSelectValue(frequenceLabelOptions, formData.frequence_label) === CUSTOM_OPTION && (
                <input
                  type="text"
                  value={formData.frequence_label}
                  onChange={(event) => setFormData((prev) => ({ ...prev, frequence_label: event.target.value }))}
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder={t('placeholders.frequencyLabel')}
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.responsable')}</label>
            <select
              value={getSelectValue(RESPONSABLE_OPTIONS, formData.responsable)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  responsable: getNextFieldValue(RESPONSABLE_OPTIONS, prev.responsable, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.responsable')}
            >
              <option value="">{t('placeholders.responsable')}</option>
              {RESPONSABLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(RESPONSABLE_OPTIONS, formData.responsable) === CUSTOM_OPTION && (
              <input
                type="text"
                value={formData.responsable}
                onChange={(event) => setFormData((prev) => ({ ...prev, responsable: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.responsable')}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.huileGraisse')}</label>
            <select
              value={getSelectValue(HUILE_GRAISSE_OPTIONS, formData.huile_graisse)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  huile_graisse: getNextFieldValue(HUILE_GRAISSE_OPTIONS, prev.huile_graisse, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.huileGraisse')}
            >
              <option value="">{t('placeholders.huileGraisse')}</option>
              {HUILE_GRAISSE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(HUILE_GRAISSE_OPTIONS, formData.huile_graisse) === CUSTOM_OPTION && (
              <input
                type="text"
                value={formData.huile_graisse}
                onChange={(event) => setFormData((prev) => ({ ...prev, huile_graisse: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.huileGraisse')}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.documentation')}</label>
            <select
              value={getSelectValue(DOCUMENTATION_OPTIONS, formData.documentation)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  documentation: getNextFieldValue(DOCUMENTATION_OPTIONS, prev.documentation, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.documentation')}
            >
              <option value="">{t('placeholders.documentation')}</option>
              {DOCUMENTATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(DOCUMENTATION_OPTIONS, formData.documentation) === CUSTOM_OPTION && (
              <input
                type="text"
                value={formData.documentation}
                onChange={(event) => setFormData((prev) => ({ ...prev, documentation: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.documentation')}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('form.instruction')}</label>
            <select
              value={getSelectValue(INSTRUCTION_OPTIONS, formData.instruction)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  instruction: getNextFieldValue(INSTRUCTION_OPTIONS, prev.instruction, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.instruction')}
            >
              <option value="">{t('placeholders.instruction')}</option>
              {INSTRUCTION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(INSTRUCTION_OPTIONS, formData.instruction) === CUSTOM_OPTION && (
              <textarea
                rows={5}
                value={formData.instruction}
                onChange={(event) => setFormData((prev) => ({ ...prev, instruction: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.instruction')}
              />
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
              {t('actions.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? tCommon('saving') : editingPlan ? t('actions.update') : t('actions.create')}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
