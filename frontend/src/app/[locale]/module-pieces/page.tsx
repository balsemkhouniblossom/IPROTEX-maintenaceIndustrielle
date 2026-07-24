'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ResourceCrudPage, { CrudField } from '@/components/ResourceCrudPage';
import { apiService } from '@/services/api';
import { normalizeApiItems } from '@/services/pagination';
import type { CatalogueOption, ModuleTypeOption } from '@/types/maintenance-resources';

export default function ModulePiecesPage() {
  const t = useTranslations('resourceCrud');
  const [moduleTypes, setModuleTypes] = useState<ModuleTypeOption[]>([]);
  const [parts, setParts] = useState<CatalogueOption[]>([]);
  useEffect(() => { void Promise.all([apiService.getModuleTypes({ page: 1, limit: 100 }), apiService.getCatalogues({ page: 1, limit: 100 })]).then(([m, p]) => { setModuleTypes(normalizeApiItems<ModuleTypeOption>(m.data)); setParts(normalizeApiItems<CatalogueOption>(p.data)); }); }, []);
  const fields = useMemo<CrudField[]>(() => [
    { key: 'mod_type_id', label: t('modulePieces.fields.moduleType'), type: 'select', required: true, options: moduleTypes.map((m) => ({ value: m._id, label: `${m.mod_type_id}${m.nom_module ? ` — ${m.nom_module}` : ''}` })) },
    { key: 'part_id', label: t('modulePieces.fields.part'), type: 'select', required: true, options: parts.map((p) => ({ value: p._id, label: `${p.part_id}${p.nom_piece ? ` — ${p.nom_piece}` : ''}` })) },
    { key: 'quantite_standard', label: t('modulePieces.fields.quantity'), type: 'number', required: true },
  ], [moduleTypes, parts, t]);
  return <ResourceCrudPage title={t('modulePieces.title')} fields={fields} emptyForm={{ mod_type_id: '', part_id: '', quantite_standard: 1 }} load={(page, limit) => apiService.getModulePieces({ page, limit })} createItem={(d) => apiService.createModulePiece(d)} updateItem={(id, d) => apiService.updateModulePiece(id, d)} deleteItem={(id) => apiService.deleteModulePiece(id)} normalize={(form) => ({ ...form, quantite_standard: Number(form.quantite_standard) })} labels={{ add: t('common.add'), edit: t('common.edit'), delete: t('common.delete'), actions: t('common.actions'), cancel: t('common.cancel'), save: t('common.save'), loading: t('common.loading'), empty: t('modulePieces.empty'), confirmDelete: t('common.confirmDelete'), loadFailed: t('common.loadFailed'), saveFailed: t('common.saveFailed'), deleteFailed: t('common.deleteFailed') }} />;
}
