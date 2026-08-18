'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import DashboardLayout from '@/components/DashboardLayout';
import DynamicSearchControls from '@/components/DynamicSearchControls';
import { Modal } from '@/components/Modal';
import Pagination from '@/components/Pagination';
import { apiService } from '@/services/api';
import { displayText } from '@/services/displayValues';
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from '@/services/dynamicSearch';

interface WorkOrderRef {
  _id: string;
  ot_id?: string;
}

interface TechnicianRef {
  _id: string;
  nom_complet?: string;
}

interface InterventionReport {
  _id: string;
  report_id: string;
  ot_id: string | WorkOrderRef;
  technician_id: string | TechnicianRef;
  date_debut: string;
  date_fin: string;
  cause_racine?: string;
  description_action?: string;
  etat_final?: string;
  validation_responsable?: string;
}

interface WorkOrderItem {
  _id: string;
  ot_id: string;
}

interface UserItem {
  _id: string;
  nom_complet: string;
  role?: string;
}

function getWorkOrderLabel(ot: string | WorkOrderRef): string {
  if (typeof ot === 'string') return displayText(ot, '');
  return displayText(ot?.ot_id, '');
}

function getTechnicianLabel(user: string | TechnicianRef): string {
  if (typeof user === 'string') return displayText(user, '');
  return displayText(user?.nom_complet, '');
}

function getRefId(ref: string | { _id: string }): string {
  return typeof ref === 'string' ? ref : ref?._id || '';
}

export default function InterventionReportsPage() {
  const t = useTranslations('interventionReports');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [reports, setReports] = useState<InterventionReport[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderItem[]>([]);
  const [technicians, setTechnicians] = useState<UserItem[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [showModal, setShowModal] = useState(false);
  const [editingReport, setEditingReport] = useState<InterventionReport | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [formData, setFormData] = useState({
    report_id: '',
    ot_id: '',
    technician_id: '',
    date_debut: '',
    date_fin: '',
    cause_racine: '',
    description_action: '',
    etat_final: '',
    validation_responsable: '',
  });

  const loadData = useCallback(async () => {
    try {
      const [reportsRes, workOrdersRes, usersRes] = await Promise.all([
        apiService.getInterventionReports({ page, limit }),
        apiService.getWorkOrders(),
        apiService.getUsers(),
      ]);

      setReports(reportsRes.data.items || []);
      setTotalItems(reportsRes.data.totalItems || 0);
      setTotalPages(reportsRes.data.totalPages || 1);
      const workOrdersRaw = workOrdersRes.data;

      const workOrdersData = Array.isArray(workOrdersRaw)
        ? workOrdersRaw
        : Array.isArray(workOrdersRaw?.items)
          ? workOrdersRaw.items
          : Array.isArray(workOrdersRaw?.data)
            ? workOrdersRaw.data
            : [];

      setWorkOrders(workOrdersData); const usersRaw = usersRes.data;

      // normalize users into an array no matter backend shape
      const usersData = Array.isArray(usersRaw)
        ? usersRaw
        : Array.isArray(usersRaw?.items)
          ? usersRaw.items
          : Array.isArray(usersRaw?.data)
            ? usersRaw.data
            : Array.isArray(usersRaw?.users)
              ? usersRaw.users
              : [];

      setTechnicians(
        usersData.filter((user: UserItem) => user.role === 'technician')
      );
    } catch (error) {
      console.error('Error loading intervention reports:', error);
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  async function refreshReports() {
    await loadData();
    router.refresh();
    window.dispatchEvent(new Event('intervention-reports:changed'));
  }

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  const searchableReports = useMemo(
    () =>
      reports.map((report) => ({
        ...report,
        work_order_label: getWorkOrderLabel(report.ot_id),
        technician_label: getTechnicianLabel(report.technician_id),
      })),
    [reports],
  );

  const searchableFields = useMemo(() => getSearchableFields(searchableReports), [searchableReports]);

  const filteredReports = useMemo(
    () => searchableReports.filter((report) => matchesDynamicSearch(report, searchTerm, selectedSearchField)),
    [searchableReports, searchTerm, selectedSearchField],
  );

  function resetForm() {
    setFormData({
      report_id: '',
      ot_id: '',
      technician_id: '',
      date_debut: '',
      date_fin: '',
      cause_racine: '',
      description_action: '',
      etat_final: '',
      validation_responsable: '',
    });
    setEditingReport(null);
  }

  function validateForm(): boolean {
    if (!formData.report_id.trim()) {
      showNotification('error', t('notifications.reportReferenceRequired', { default: 'Report reference is required' }));
      return false;
    }
    if (!formData.ot_id) {
      showNotification('error', t('notifications.workOrderRequired'));
      return false;
    }
    if (!formData.technician_id) {
      showNotification('error', t('notifications.technicianRequired'));
      return false;
    }
    if (!formData.date_debut) {
      showNotification('error', t('notifications.startDateRequired'));
      return false;
    }
    if (!formData.date_fin) {
      showNotification('error', t('notifications.endDateRequired'));
      return false;
    }
    return true;
  }

  function openCreateModal() {
    resetForm();
    setShowModal(true);
  }

  function openEditModal(report: InterventionReport) {
    setEditingReport(report);
    setFormData({
      report_id: report.report_id ?? '',
      ot_id: getRefId(report.ot_id),
      technician_id: getRefId(report.technician_id),
      date_debut: report.date_debut ? report.date_debut.slice(0, 16) : '',
      date_fin: report.date_fin ? report.date_fin.slice(0, 16) : '',
      cause_racine: report.cause_racine ?? '',
      description_action: report.description_action ?? '',
      etat_final: report.etat_final ?? '',
      validation_responsable: report.validation_responsable ?? '',
    });
    setShowModal(true);
  }

  async function handleDelete(id: string) {
    if (!confirm(t('notifications.confirmDelete'))) return;

    try {
      await apiService.deleteInterventionReport(id);
      await refreshReports();
      showNotification('success', t('notifications.deleted'));
    } catch (error) {
      console.error('Error deleting intervention report:', error);
      showNotification('error', t('notifications.deleteFailed'));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        report_id: formData.report_id.trim(),
        ot_id: formData.ot_id,
        technician_id: formData.technician_id,
        date_debut: formData.date_debut,
        date_fin: formData.date_fin,
      };

      if (formData.cause_racine.trim()) payload.cause_racine = formData.cause_racine.trim();
      if (formData.description_action.trim()) payload.description_action = formData.description_action.trim();
      if (formData.etat_final.trim()) payload.etat_final = formData.etat_final.trim();
      if (formData.validation_responsable.trim()) payload.validation_responsable = formData.validation_responsable.trim();

      if (editingReport) {
        await apiService.updateInterventionReport(editingReport._id, payload);
        showNotification('success', t('notifications.updated'));
      } else {
        await apiService.createInterventionReport(payload);
        showNotification('success', t('notifications.created'));
      }

      setShowModal(false);
      resetForm();
      await refreshReports();
    } catch (error) {
      console.error('Error saving intervention report:', error);
      showNotification('error', t('notifications.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleChanged = () => {
      loadData();
    };

    window.addEventListener('intervention-reports:changed', handleChanged);
    window.addEventListener('focus', handleChanged);

    return () => {
      window.removeEventListener('intervention-reports:changed', handleChanged);
      window.removeEventListener('focus', handleChanged);
    };
    // keep the existing event listener lifecycle stable; loadData reads current state when the event fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <DashboardLayout title={t('title')}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('title')}>
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${notification.type === 'success'
            ? 'bg-green-100 text-green-800 border border-green-200'
            : 'bg-red-100 text-red-800 border border-red-200'
            }`}
        >
          {notification.type === 'success' ? (
            <CheckCircleIcon className="w-5 h-5" />
          ) : (
            <ExclamationTriangleIcon className="w-5 h-5" />
          )}
          <span>{notification.message}</span>
          <button type="button" onClick={() => setNotification(null)} className="ml-2 text-gray-500 hover:text-gray-700" title={tCommon('close')}>
            x
          </button>
        </div>
      )}

      <div className="bento-grid">
        <div className="col-span-full mb-6 bento-item">
          <div className="panel">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{t('heading')}</h1>
                <p className="text-slate-600 mt-1">{t('description')}</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-end">
                  <div className="text-3xl font-bold text-blue-600">{totalItems}</div>
                  <div className="text-sm text-slate-500">{t('totalReports')}</div>
                </div>
                <button type="button" onClick={openCreateModal} className="btn-primary flex items-center space-x-2">
                  <PlusIcon className="w-4 h-4" />
                  <span>{t('actions.add')}</span>
                </button>
              </div>
            </div>

            <DynamicSearchControls
              selectedField={selectedSearchField}
              onSelectedFieldChange={setSelectedSearchField}
              searchableFields={searchableFields}
              allFieldsLabel={tCommon('table.allFields', { default: 'All fields' })}
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              searchPlaceholder={t('searchPlaceholder')}
            />
          </div>
        </div>

        <div className="col-span-full bento-item panel">
          <div className="card-title">{t('allReports')}</div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('table.reportReference', { default: 'Report Reference' })}</th>
                  <th>{t('table.workOrder')}</th>
                  <th>{t('table.technician')}</th>
                  <th>{t('table.startDate')}</th>
                  <th>{t('table.endDate')}</th>
                  <th>{t('table.finalState')}</th>
                  <th>{tCommon('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-500">
                      {searchTerm ? t('empty.search') : t('empty.default')}
                    </td>
                  </tr>
                ) : (
                  filteredReports.map((report) => (
                    <tr key={report._id}>
                      <td className="font-medium">{report.report_id}</td>
                      <td>{getWorkOrderLabel(report.ot_id) || tCommon('notAvailable')}</td>
                      <td>{getTechnicianLabel(report.technician_id) || tCommon('notAvailable')}</td>
                      <td>{report.date_debut ? new Date(report.date_debut).toLocaleString() : tCommon('notAvailable')}</td>
                      <td>{report.date_fin ? new Date(report.date_fin).toLocaleString() : tCommon('notAvailable')}</td>
                      <td>{report.etat_final || tCommon('notAvailable')}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(report)}
                            aria-label={`${t('actions.edit')} ${report.report_id}`}
                            title={t('actions.edit')}
                            className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <PencilIcon className="h-4 w-4 shrink-0" />
                            <span>{t('actions.edit')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(report._id)}
                            aria-label={`${t('actions.delete')} ${report.report_id}`}
                            title={t('actions.delete')}
                            className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <TrashIcon className="h-4 w-4 shrink-0" />
                            <span>{t('actions.delete')}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-6">
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

      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingReport ? t('modal.edit') : t('modal.add')}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.reportReference', { default: 'Report Reference' })}</label>
              <input
                type="text"
                value={formData.report_id}
                onChange={(e) => setFormData({ ...formData, report_id: e.target.value })}
                className="input-field"
                title={t('form.reportReference', { default: 'Report Reference' })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.workOrder')}</label>
              <select
                value={formData.ot_id}
                onChange={(e) => setFormData({ ...formData, ot_id: e.target.value })}
                className="input-field"
                title={t('form.workOrder')}
                required
              >
                <option value="">{t('placeholders.selectWorkOrder')}</option>
                {workOrders.map((wo) => (
                  <option key={wo._id} value={wo._id}>
                    {wo.ot_id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.technician')}</label>
              <select
                value={formData.technician_id}
                onChange={(e) => setFormData({ ...formData, technician_id: e.target.value })}
                className="input-field"
                title={t('form.technician')}
                required
              >
                <option value="">{t('placeholders.selectTechnician')}</option>
                {technicians.map((tech) => (
                  <option key={tech._id} value={tech._id}>
                    {tech.nom_complet}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.startDate')}</label>
              <input
                type="datetime-local"
                value={formData.date_debut}
                onChange={(e) => setFormData({ ...formData, date_debut: e.target.value })}
                className="input-field"
                title={t('form.startDate')}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.endDate')}</label>
              <input
                type="datetime-local"
                value={formData.date_fin}
                onChange={(e) => setFormData({ ...formData, date_fin: e.target.value })}
                className="input-field"
                title={t('form.endDate')}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.finalState')}</label>
              <input
                type="text"
                value={formData.etat_final}
                onChange={(e) => setFormData({ ...formData, etat_final: e.target.value })}
                className="input-field"
                title={t('form.finalState')}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.rootCause')}</label>
            <textarea
              value={formData.cause_racine}
              onChange={(e) => setFormData({ ...formData, cause_racine: e.target.value })}
              className="input-field"
              title={t('form.rootCause')}
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.actionDescription')}</label>
            <textarea
              value={formData.description_action}
              onChange={(e) => setFormData({ ...formData, description_action: e.target.value })}
              className="input-field"
              title={t('form.actionDescription')}
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.responsibleValidation')}</label>
            <input
              type="text"
              value={formData.validation_responsable}
              onChange={(e) => setFormData({ ...formData, validation_responsable: e.target.value })}
              className="input-field"
              title={t('form.responsibleValidation')}
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
              {tCommon('cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? tCommon('saving') : editingReport ? t('actions.update') : t('actions.create')}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
