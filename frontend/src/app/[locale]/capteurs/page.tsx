'use client';

import { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import DynamicSearchControls from '@/components/DynamicSearchControls';
import { Modal } from '@/components/Modal';
import { apiService } from '@/services/api';
import { displayText, referenceDisplay } from '@/services/displayValues';
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from '@/services/dynamicSearch';
import { useRouter } from 'next/navigation';
import { CheckCircleIcon, ExclamationTriangleIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import Pagination from '@/components/Pagination';

interface Capteur {
  _id: string;
  capteur_id: string;
  module_id: string | { _id?: string; module_id?: string; localisation?: string };
  code_capteur: string;
  type_capteur: string;
  unite_mesure?: string;
  mqtt_topic?: string;
  seuil_avertissement?: number;
  seuil_critique?: number;
  frequence_echantillonnage?: number;
  is_active?: boolean;
  last_seen_at?: string;
  firmware_version?: string;
}

interface ModuleOption {
  _id: string;
  module_id?: string;
  localisation?: string;
}

function refId(value: Capteur['module_id']): string {
  return typeof value === 'string' ? value : value?._id ?? '';
}

export default function CapteursPage() {
  const tCapteurs = useTranslations('capteurs');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [capteurs, setCapteurs] = useState<Capteur[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [showModal, setShowModal] = useState(false);
  const [editingCapteur, setEditingCapteur] = useState<Capteur | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [formData, setFormData] = useState({
    capteur_id: '',
    module_id: '',
    code_capteur: '',
    type_capteur: '',
    unite_mesure: '',
    mqtt_topic: '',
    seuil_avertissement: '',
    seuil_critique: '',
    frequence_echantillonnage: '',
    is_active: true,
    last_seen_at: '',
    firmware_version: '',
  });

  async function loadCapteurs() {
    try {
      const response = await apiService.getCapteurs({
        page,
        limit,
      });
      const data = response.data;

      setCapteurs(data.items ?? []);
      setTotalPages(data.totalPages ?? 1);
      setTotalItems(data.totalItems ?? 0);
      setPage(data.page ?? 1);
      setLimit(data.limit ?? 10);
    } catch (error) {
      console.error('Error loading capteurs:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadModules() {
    try {
      const response = await apiService.getModules({ page: 1, limit: 200 });
      setModules(response.data.items ?? []);
    } catch (error) {
      console.error('Error loading modules:', error);
    }
  }

  async function refreshCapteurs() {
    await loadCapteurs();
    router.refresh();
    window.dispatchEvent(new Event('capteurs:changed'));
  }

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  const searchableFields = useMemo(() => getSearchableFields(capteurs), [capteurs]);

  const moduleById = useMemo(
    () => new Map(modules.map((module) => [module._id, module])),
    [modules],
  );

  function moduleLabel(value: Capteur['module_id']) {
    if (value && typeof value === 'object') {
      return referenceDisplay(value, ['module_id', 'localisation'], tCapteurs('na'));
    }

    const module = moduleById.get(String(value ?? ''));
    return module
      ? referenceDisplay(module, ['module_id', 'localisation'], tCapteurs('na'))
      : displayText(value, tCapteurs('na'));
  }

  const filteredCapteurs = useMemo(() => {
    const list = Array.isArray(capteurs) ? capteurs : [];

    return list.filter((capteur) =>
      matchesDynamicSearch(capteur, searchTerm, selectedSearchField)
    );
  }, [capteurs, searchTerm, selectedSearchField]);

  function resetForm() {
    setFormData({
      capteur_id: '',
      module_id: '',
      code_capteur: '',
      type_capteur: '',
      unite_mesure: '',
      mqtt_topic: '',
      seuil_avertissement: '',
      seuil_critique: '',
      frequence_echantillonnage: '',
      is_active: true,
      last_seen_at: '',
      firmware_version: '',
    });
    setEditingCapteur(null);
  }

  function validateForm() {
    if (!formData.capteur_id.trim()) {
      showNotification('error', tCapteurs('notifications.sensorReferenceRequired', { default: 'Sensor reference is required' }));
      return false;
    }
    if (!formData.module_id.trim()) {
      showNotification('error', tCapteurs('notifications.moduleRequired', { default: 'Module is required' }));
      return false;
    }
    if (!formData.code_capteur.trim()) {
      showNotification('error', tCapteurs('notifications.codeRequired'));
      return false;
    }
    if (!formData.type_capteur.trim()) {
      showNotification('error', tCapteurs('notifications.typeRequired'));
      return false;
    }
    return true;
  }

  function openCreateModal() {
    resetForm();
    setShowModal(true);
  }

  function openEditModal(capteur: Capteur) {
    setEditingCapteur(capteur);
    setFormData({
      capteur_id: capteur.capteur_id ?? '',
      module_id: refId(capteur.module_id),
      code_capteur: capteur.code_capteur ?? '',
      type_capteur: capteur.type_capteur ?? '',
      unite_mesure: capteur.unite_mesure ?? '',
      mqtt_topic: capteur.mqtt_topic ?? '',
      seuil_avertissement: capteur.seuil_avertissement != null ? String(capteur.seuil_avertissement) : '',
      seuil_critique: capteur.seuil_critique != null ? String(capteur.seuil_critique) : '',
      frequence_echantillonnage: capteur.frequence_echantillonnage != null ? String(capteur.frequence_echantillonnage) : '',
      is_active: capteur.is_active ?? true,
      last_seen_at: capteur.last_seen_at ? capteur.last_seen_at.slice(0, 16) : '',
      firmware_version: capteur.firmware_version ?? '',
    });
    setShowModal(true);
  }

  async function handleDelete(id: string) {
    if (!confirm(tCapteurs('notifications.confirmDelete'))) {
      return;
    }

    try {
      await apiService.deleteCapteur(id);
      await refreshCapteurs();
      showNotification('success', tCapteurs('notifications.deleted'));
    } catch (error) {
      console.error('Error deleting capteur:', error);
      showNotification('error', tCapteurs('notifications.deleteFailed'));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!validateForm()) return;

    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        capteur_id: formData.capteur_id,
        module_id: formData.module_id,
        code_capteur: formData.code_capteur,
        type_capteur: formData.type_capteur,
        is_active: formData.is_active,
      };

      if (formData.unite_mesure.trim()) payload.unite_mesure = formData.unite_mesure.trim();
      if (formData.mqtt_topic.trim()) payload.mqtt_topic = formData.mqtt_topic.trim();
      if (formData.firmware_version.trim()) payload.firmware_version = formData.firmware_version.trim();
      if (formData.last_seen_at) payload.last_seen_at = formData.last_seen_at;
      if (formData.seuil_avertissement.trim()) payload.seuil_avertissement = Number(formData.seuil_avertissement);
      if (formData.seuil_critique.trim()) payload.seuil_critique = Number(formData.seuil_critique);
      if (formData.frequence_echantillonnage.trim()) payload.frequence_echantillonnage = Number(formData.frequence_echantillonnage);

      if (editingCapteur) {
        await apiService.updateCapteur(editingCapteur._id, payload);
        showNotification('success', tCapteurs('notifications.updated'));
      } else {
        await apiService.createCapteur(payload);
        showNotification('success', tCapteurs('notifications.created'));
      }

      setShowModal(false);
      resetForm();
      await refreshCapteurs();
    } catch (error) {
      console.error('Error saving capteur:', error);
      showNotification('error', tCapteurs('notifications.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    loadCapteurs();
    // loadCapteurs intentionally reads the current pagination state; wrapping it here would change the page's existing refresh behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit]);

  useEffect(() => {
    void loadModules();
  }, []);

  useEffect(() => {
    const handleCapteursChanged = () => {
      loadCapteurs();
    };

    window.addEventListener('capteurs:changed', handleCapteursChanged);
    window.addEventListener('focus', handleCapteursChanged);

    return () => {
      window.removeEventListener('capteurs:changed', handleCapteursChanged);
      window.removeEventListener('focus', handleCapteursChanged);
    };
    // keep the existing event listener lifecycle stable; loadCapteurs reads current state when the event fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <DashboardLayout title={tCapteurs('pageTitle')}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={tCapteurs('pageTitle')}>
      {notification && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${notification.type === 'success'
          ? 'bg-green-100 text-green-800 border border-green-200'
          : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
          {notification.type === 'success' ? (
            <CheckCircleIcon className="w-5 h-5" />
          ) : (
            <ExclamationTriangleIcon className="w-5 h-5" />
          )}
          <span>{notification.message}</span>
          <button type="button"
            onClick={() => setNotification(null)}
            className="ml-2 text-gray-500 hover:text-gray-700"
          >
            ×
          </button>
        </div>
      )}

      <div className="bento-grid">
        {/* Header */}
        <div className="col-span-full mb-6 bento-item">
          <div className="panel">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{tCapteurs('heading')}</h1>
                <p className="text-slate-600 mt-1">{tCapteurs('description')}</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-end">
                  <div className="text-3xl font-bold text-blue-600">{filteredCapteurs.length}</div>
                  <div className="text-sm text-slate-500">{tCapteurs('totalSensors')}</div>
                </div>

                <button type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white font-medium shadow-md hover:bg-blue-700 transition-all duration-200"
                >
                  <PlusIcon className="w-5 h-5" />
                  <span>{tCapteurs('addCapteur')}</span>
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
              searchPlaceholder={tCapteurs('searchPlaceholder')}
            />
          </div>
        </div>

        {/* Capteurs Table */}
        <div className="col-span-full bento-item panel">
          <div className="card-title">{tCapteurs('allSensors')}</div>
          <div className="wide-table-scroll">
            <table className="table wide-table">
              <colgroup>
                <col className="capteurs-table__reference" />
                <col className="capteurs-table__code" />
                <col className="capteurs-table__type" />
                <col className="capteurs-table__module" />
                <col className="capteurs-table__unit" />
                <col className="capteurs-table__mqtt" />
                <col className="capteurs-table__warning" />
                <col className="capteurs-table__critical" />
                <col className="capteurs-table__sampling" />
                <col className="capteurs-table__firmware" />
                <col className="capteurs-table__lastseen" />
                <col className="capteurs-table__status" />
                <col className="capteurs-table__actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>{tCapteurs('table.sensorReference', { default: 'Sensor Reference' })}</th>
                  <th>{tCapteurs('table.code')}</th>
                  <th>{tCapteurs('table.type')}</th>
                  <th>{tCapteurs('table.module')}</th>
                  <th>{tCapteurs('table.unit')}</th>
                  <th>{tCapteurs('table.mqttTopic')}</th>
                  <th>{tCapteurs('table.warningThreshold')}</th>
                  <th>{tCapteurs('table.criticalThreshold')}</th>
                  <th>{tCapteurs('table.samplingFrequency')}</th>
                  <th>{tCapteurs('table.firmwareVersion')}</th>
                  <th>{tCapteurs('table.lastSeen')}</th>
                  <th>{tCapteurs('table.status')}</th>
                  <th>{tCommon('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredCapteurs.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-center py-8 text-gray-500">
                      {searchTerm ? tCapteurs('empty.search') : tCapteurs('empty.default')}
                    </td>
                  </tr>
                ) : (
                  filteredCapteurs.map((capteur) => (
                    <tr key={capteur._id}>
                      <td>{capteur.capteur_id || tCapteurs('na')}</td>
                      <td>{capteur.code_capteur || tCapteurs('na')}</td>
                      <td>{capteur.type_capteur || tCapteurs('na')}</td>
                      <td>{moduleLabel(capteur.module_id)}</td>
                      <td>{capteur.unite_mesure || tCapteurs('na')}</td>
                      <td title={capteur.mqtt_topic || ''}>{capteur.mqtt_topic || tCapteurs('na')}</td>
                      <td>{capteur.seuil_avertissement ?? tCapteurs('na')}</td>
                      <td>{capteur.seuil_critique ?? tCapteurs('na')}</td>
                      <td>{capteur.frequence_echantillonnage ?? tCapteurs('na')}</td>
                      <td>{capteur.firmware_version || tCapteurs('na')}</td>
                      <td>
                        {capteur.last_seen_at
                          ? new Date(capteur.last_seen_at).toLocaleString()
                          : tCapteurs('na')}
                      </td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${capteur.is_active !== false
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                          }`}>
                          {capteur.is_active !== false ? tCapteurs('active') : tCapteurs('inactive')}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(capteur)}
                            aria-label={`${tCommon('edit')} ${capteur.capteur_id}`}
                            title={tCommon('edit')}
                            className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <PencilIcon className="h-4 w-4 shrink-0" />
                            <span>{tCommon('edit')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(capteur._id)}
                            aria-label={`${tCommon('delete')} ${capteur.capteur_id}`}
                            title={tCommon('delete')}
                            className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <TrashIcon className="h-4 w-4 shrink-0" />
                            <span>{tCommon('delete')}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              limit={limit}
              onPageChange={(newPage) => setPage(newPage)}
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
        title={editingCapteur ? tCapteurs('modal.edit') : tCapteurs('modal.add')}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tCapteurs('form.sensorReference', { default: 'Sensor Reference' })}
              </label>
              <input
                type="text"
                value={formData.capteur_id}
                onChange={(e) => setFormData({ ...formData, capteur_id: e.target.value })}
                className="input-field w-full"
                placeholder={tCapteurs('placeholders.sensorReference', { default: 'Sensor Reference' })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tCapteurs.has('form.module') ? tCapteurs('form.module') : tCapteurs('table.module')}
              </label>
              <select
                value={formData.module_id}
                onChange={(e) => setFormData({ ...formData, module_id: e.target.value })}
                className="input-field w-full"
                required
              >
                <option value="">{tCapteurs('table.module')}</option>
                {modules.map((module) => (
                  <option key={module._id} value={module._id}>
                    {referenceDisplay(module, ['module_id', 'localisation'], tCapteurs('na'))}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{tCapteurs('form.code')}</label>
              <input
                type="text"
                value={formData.code_capteur}
                onChange={(e) => setFormData({ ...formData, code_capteur: e.target.value })}
                className="input-field w-full"
                placeholder={tCapteurs('placeholders.code')}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{tCapteurs('form.type')}</label>
              <input
                type="text"
                value={formData.type_capteur}
                onChange={(e) => setFormData({ ...formData, type_capteur: e.target.value })}
                className="input-field w-full"
                placeholder={tCapteurs('placeholders.type')}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{tCapteurs('form.unit')}</label>
              <input
                type="text"
                value={formData.unite_mesure}
                onChange={(e) => setFormData({ ...formData, unite_mesure: e.target.value })}
                className="input-field w-full"
                placeholder={tCapteurs('placeholders.unit')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{tCapteurs('form.mqttTopic')}</label>
              <input
                type="text"
                value={formData.mqtt_topic}
                onChange={(e) => setFormData({ ...formData, mqtt_topic: e.target.value })}
                className="input-field w-full"
                placeholder={tCapteurs('placeholders.mqttTopic')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{tCapteurs('form.warningThreshold')}</label>
              <input
                type="number"
                value={formData.seuil_avertissement}
                onChange={(e) => setFormData({ ...formData, seuil_avertissement: e.target.value })}
                className="input-field w-full"
                placeholder={tCapteurs('placeholders.warningThreshold')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{tCapteurs('form.criticalThreshold')}</label>
              <input
                type="number"
                value={formData.seuil_critique}
                onChange={(e) => setFormData({ ...formData, seuil_critique: e.target.value })}
                className="input-field w-full"
                placeholder={tCapteurs('placeholders.criticalThreshold')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{tCapteurs('form.samplingFrequency')}</label>
              <input
                type="number"
                value={formData.frequence_echantillonnage}
                onChange={(e) => setFormData({ ...formData, frequence_echantillonnage: e.target.value })}
                className="input-field w-full"
                placeholder={tCapteurs('placeholders.samplingFrequency')}
              />
            </div>

            <div>
              <label htmlFor="last_seen_at" className="block text-sm font-medium text-gray-dark mb-1">{tCapteurs('form.lastSeen')}</label>
              <input
                id="last_seen_at"
                type="datetime-local"
                title={tCapteurs('form.lastSeen')}
                value={formData.last_seen_at}
                onChange={(e) => setFormData({ ...formData, last_seen_at: e.target.value })}
                className="input-field w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{tCapteurs('form.firmwareVersion')}</label>
              <input
                type="text"
                value={formData.firmware_version}
                onChange={(e) => setFormData({ ...formData, firmware_version: e.target.value })}
                className="input-field w-full"
                placeholder={tCapteurs('placeholders.firmwareVersion')}
              />
            </div>

            <div className="flex items-center gap-2 mt-8">
              <input
                id="is_active"
                type="checkbox"
                aria-label={tCapteurs('form.active')}
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-gray-dark">
                {tCapteurs('form.active')}
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
              className="btn-secondary px-4 py-2"
              disabled={submitting}
            >
              {tCommon('cancel')}
            </button>
            <button
              type="submit"
              className="btn-primary px-4 py-2"
              disabled={submitting}
            >
              {submitting
                ? tCommon('saving')
                : editingCapteur
                  ? tCapteurs('button.update')
                  : tCapteurs('button.create')}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
