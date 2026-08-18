'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { apiService } from '@/services/api';
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from '@/services/dynamicSearch';
import Pagination from '@/components/Pagination';

interface Catalogue {
  _id: string;
  part_id: string;
  nom_piece: string;
  ref_constructeur: string;
  fabricant?: string;
  categorie_piece?: string;
}

function getCatalogueSubmitLabel(
  submitting: boolean,
  editing: boolean,
  savingLabel: string,
  updateLabel: string,
  createLabel: string,
): string {
  if (submitting) return savingLabel;
  return editing ? updateLabel : createLabel;
}

export default function CataloguesPage() {
  const t = useTranslations('catalogues');
  const common = useTranslations('common');
  const router = useRouter();

  const [catalogues, setCatalogues] = useState<Catalogue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCatalogue, setEditingCatalogue] = useState<Catalogue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [formData, setFormData] = useState({
    part_id: '',
    nom_piece: '',
    ref_constructeur: '',
    fabricant: '',
    categorie_piece: '',
  });

  async function loadCatalogues() {
    try {
      setLoading(true);

      const response = await apiService.getCatalogues({
        page,
        limit,
      });

      setCatalogues(response.data.items ?? []);

      // ✅ ADD THESE TWO LINES (IMPORTANT)
      setTotalItems(response.data.totalItems ?? 0);
      setTotalPages(response.data.totalPages ?? 1);

    } catch (error) {
      console.error('Error loading catalogues:', error);
    } finally {
      setLoading(false);
    }
  }

  async function refreshCatalogues() {
    await loadCatalogues();
    router.refresh();
    window.dispatchEvent(new Event('catalogues:changed'));
  }

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  const searchableFields = useMemo(() => getSearchableFields(catalogues), [catalogues]);

  const filteredCatalogues = useMemo(
    () =>
      Array.isArray(catalogues)
        ? catalogues.filter((catalogue) =>
          matchesDynamicSearch(catalogue, searchTerm, selectedSearchField),
        )
        : [],
    [catalogues, searchTerm, selectedSearchField],
  );

  function validateForm() {
    if (!formData.part_id.trim()) {
      showNotification('error', t('validation.partCodeRequired', { default: 'Part code is required' }));
      return false;
    }

    if (!formData.nom_piece.trim()) {
      showNotification('error', t('validation.partNameRequired'));
      return false;
    }

    if (!formData.ref_constructeur.trim()) {
      showNotification('error', t('validation.manufacturerRefRequired'));
      return false;
    }

    return true;
  }

  function resetForm() {
    setFormData({
      part_id: '',
      nom_piece: '',
      ref_constructeur: '',
      fabricant: '',
      categorie_piece: '',
    });
    setEditingCatalogue(null);
  }

  function openCreateModal() {
    resetForm();
    setShowModal(true);
  }

  function openEditModal(catalogue: Catalogue) {
    setEditingCatalogue(catalogue);
    setFormData({
      part_id: catalogue.part_id ?? '',
      nom_piece: catalogue.nom_piece ?? '',
      ref_constructeur: catalogue.ref_constructeur ?? '',
      fabricant: catalogue.fabricant ?? '',
      categorie_piece: catalogue.categorie_piece ?? '',
    });
    setShowModal(true);
  }

  async function handleDelete(catalogueId: string) {
    if (!confirm(t('messages.confirmDelete'))) {
      return;
    }

    try {
      await apiService.deleteCatalogue(catalogueId);
      await refreshCatalogues();
      showNotification('success', t('notifications.deleted'));
    } catch (error) {
      console.error('Error deleting catalogue:', error);
      showNotification('error', t('notifications.deleteFailed'));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        part_id: formData.part_id.trim(),
        nom_piece: formData.nom_piece.trim(),
        ref_constructeur: formData.ref_constructeur.trim(),
      };

      if (formData.fabricant.trim()) payload.fabricant = formData.fabricant.trim();
      if (formData.categorie_piece.trim()) payload.categorie_piece = formData.categorie_piece.trim();

      if (editingCatalogue) {
        await apiService.updateCatalogue(editingCatalogue._id, payload);
        showNotification('success', t('notifications.updated'));
      } else {
        await apiService.createCatalogue(payload);
        showNotification('success', t('notifications.created'));
      }

      setShowModal(false);
      resetForm();
      await refreshCatalogues();
    } catch (error) {
      console.error('Error saving catalogue:', error);
      showNotification('error', t('notifications.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    loadCatalogues();
    // loadCatalogues intentionally reads the current page; wrapping it would change the existing request lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);




  useEffect(() => {
    const handleCataloguesChanged = () => {
      loadCatalogues();
    };

    window.addEventListener('catalogues:changed', handleCataloguesChanged);
    window.addEventListener('focus', handleCataloguesChanged);

    return () => {
      window.removeEventListener('catalogues:changed', handleCataloguesChanged);
      window.removeEventListener('focus', handleCataloguesChanged);
    };
    // keep the existing event listener lifecycle stable; loadCatalogues reads current state when the event fires.
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
          <button type="button"
            onClick={() => setNotification(null)}
            className="ml-2 text-gray-500 hover:text-gray-700"
            title={t('actions.cancel')}
          >
            ×
          </button>
        </div>
      )}

      <div className="bento-grid">
        <div className="col-span-full mb-6 bento-item">
          <div className="panel">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{t('header.title')}</h1>
                <p className="text-slate-600 mt-1">{t('header.subtitle')}</p>
              </div>

              <div className="flex items-center space-x-4">
                <div className="text-end">
                  <div className="text-3xl font-bold text-blue-600">{catalogues.length}</div>
                  <div className="text-sm text-slate-500">{t('stats.totalParts')}</div>
                </div>

                <button type="button" onClick={openCreateModal} className="btn-primary flex items-center space-x-2">
                  <PlusIcon className="w-4 h-4" />
                  <span>{t('actions.addPart')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-full bento-item panel">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="card-title">{t('table.title')}</div>
            <DynamicSearchControls
              className=""
              selectClassName="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              inputClassName="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full"
              selectedField={selectedSearchField}
              searchableFields={searchableFields}
              allFieldsLabel={common('allFields')}
              searchTerm={searchTerm}
              searchPlaceholder={t('search.placeholder')}
              onSearchTermChange={(value) => {
                setSearchTerm(value);
                setPage(1);
              }}

              onSelectedFieldChange={(value) => {
                setSelectedSearchField(value);
                setPage(1);
              }}
            />
          </div>

          <div className="wide-table-scroll">
            <table className="table wide-table">
              <colgroup>
                <col className="catalogues-table__code" />
                <col className="catalogues-table__name" />
                <col className="catalogues-table__manufacturer-ref" />
                <col className="catalogues-table__manufacturer" />
                <col className="catalogues-table__category" />
                <col className="catalogues-table__actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('table.partCode', { default: 'Part Code' })}</th>
                  <th>{t('table.partName')}</th>
                  <th>{t('table.manufacturerRef')}</th>
                  <th>{t('table.manufacturer')}</th>
                  <th>{t('table.category')}</th>
                  <th>{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredCatalogues.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gray-500">
                      {searchTerm ? t('messages.noSearchResults') : t('messages.noParts')}
                    </td>
                  </tr>
                ) : (
                  filteredCatalogues.map((part) => (
                    <tr key={part._id}>
                      <td className="font-medium">{part.part_id}</td>
                      <td>{part.nom_piece}</td>
                      <td>{part.ref_constructeur}</td>
                      <td>{part.fabricant || t('common.notAvailable')}</td>
                      <td>{part.categorie_piece || t('common.notAvailable')}</td>
                      <td>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(part)}
                            aria-label={`${t('actions.edit')} ${part.part_id}`}
                            title={t('actions.edit')}
                            className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <PencilIcon className="h-4 w-4 shrink-0" />
                            <span>{t('actions.edit')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(part._id)}
                            aria-label={`${t('actions.delete')} ${part.part_id}`}
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
        title={editingCatalogue ? t('modal.editTitle') : t('modal.createTitle')}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.partCode', { default: 'Part Code' })}</label>
              <input
                type="text"
                value={formData.part_id}
                onChange={(e) => setFormData({ ...formData, part_id: e.target.value })}
                className="input-field"
                placeholder={t('placeholders.enterPartCode', { default: 'Enter part code' })}
                title={t('form.partCode', { default: 'Part Code' })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.partName')}</label>
              <input
                type="text"
                value={formData.nom_piece}
                onChange={(e) => setFormData({ ...formData, nom_piece: e.target.value })}
                className="input-field"
                placeholder={t('placeholders.enterPartName')}
                title={t('form.partName')}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.manufacturerReference')}</label>
              <input
                type="text"
                value={formData.ref_constructeur}
                onChange={(e) => setFormData({ ...formData, ref_constructeur: e.target.value })}
                className="input-field"
                placeholder={t('placeholders.enterManufacturerRef')}
                title={t('form.manufacturerReference')}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.manufacturer')}</label>
              <input
                type="text"
                value={formData.fabricant}
                onChange={(e) => setFormData({ ...formData, fabricant: e.target.value })}
                className="input-field"
                placeholder={t('placeholders.enterManufacturer')}
                title={t('form.manufacturer')}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t('form.category')}</label>
            <input
              type="text"
              value={formData.categorie_piece}
              onChange={(e) => setFormData({ ...formData, categorie_piece: e.target.value })}
              className="input-field"
              placeholder={t('placeholders.enterCategory')}
              title={t('form.category')}
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
              className="btn-secondary"
            >
              {t('actions.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {getCatalogueSubmitLabel(
                submitting,
                Boolean(editingCatalogue),
                t('actions.saving'),
                t('actions.updatePart'),
                t('actions.createPart'),
              )}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
