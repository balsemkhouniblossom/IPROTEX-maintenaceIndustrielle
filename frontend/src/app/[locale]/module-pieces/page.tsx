'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ResourceCrudPage, { CrudField } from '@/components/ResourceCrudPage';
import { apiService } from '@/services/api';
import { normalizeApiItems } from '@/services/pagination';
import type {
  CatalogueOption,
  ModuleTypeOption,
} from '@/types/maintenance-resources';

function moduleTypeOptionLabel(moduleType: ModuleTypeOption): string {
  if (!moduleType.nom_module) return moduleType.mod_type_id;
  return `${moduleType.mod_type_id} - ${moduleType.nom_module}`;
}

function partOptionLabel(part: CatalogueOption): string {
  if (!part.nom_piece) return part.part_id;
  return `${part.part_id} - ${part.nom_piece}`;
}

export default function ModulePiecesPage() {
  const t = useTranslations('resourceCrud');
  const [moduleTypes, setModuleTypes] = useState<ModuleTypeOption[]>([]);
  const [parts, setParts] = useState<CatalogueOption[]>([]);

  useEffect(() => {
    void Promise.all([
      apiService.getModuleTypes({ page: 1, limit: 100 }),
      apiService.getCatalogues({ page: 1, limit: 100 }),
    ]).then(([moduleTypesResponse, partsResponse]) => {
      setModuleTypes(
        normalizeApiItems<ModuleTypeOption>(moduleTypesResponse.data),
      );
      setParts(normalizeApiItems<CatalogueOption>(partsResponse.data));
    });
  }, []);

  const fields = useMemo<CrudField[]>(
    () => [
      {
        key: 'mod_type_id',
        label: t('modulePieces.fields.moduleType'),
        type: 'select',
        required: true,
        options: moduleTypes.map((moduleType) => ({
          value: moduleType._id,
          label: moduleTypeOptionLabel(moduleType),
        })),
      },
      {
        key: 'part_id',
        label: t('modulePieces.fields.part'),
        type: 'select',
        required: true,
        options: parts.map((part) => ({
          value: part._id,
          label: partOptionLabel(part),
        })),
      },
      {
        key: 'quantite_standard',
        label: t('modulePieces.fields.quantity'),
        type: 'number',
        required: true,
      },
    ],
    [moduleTypes, parts, t],
  );

  return (
    <ResourceCrudPage
      title={t('modulePieces.title')}
      fields={fields}
      emptyForm={{ mod_type_id: '', part_id: '', quantite_standard: 1 }}
      load={(page, limit) => apiService.getModulePieces({ page, limit })}
      createItem={(data) => apiService.createModulePiece(data)}
      updateItem={(id, data) => apiService.updateModulePiece(id, data)}
      deleteItem={(id) => apiService.deleteModulePiece(id)}
      normalize={(form) => ({
        ...form,
        quantite_standard: Number(form.quantite_standard),
      })}
      labels={{
        add: t('common.add'),
        edit: t('common.edit'),
        delete: t('common.delete'),
        actions: t('common.actions'),
        cancel: t('common.cancel'),
        save: t('common.save'),
        loading: t('common.loading'),
        empty: t('modulePieces.empty'),
        confirmDelete: t('common.confirmDelete'),
        loadFailed: t('common.loadFailed'),
        saveFailed: t('common.saveFailed'),
        deleteFailed: t('common.deleteFailed'),
      }}
    />
  );
}
