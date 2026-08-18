'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ResourceCrudPage, { CrudField } from '@/components/ResourceCrudPage';
import { apiService } from '@/services/api';
import { normalizeApiItems } from '@/services/pagination';
import type { CapteurOption } from '@/types/maintenance-resources';

function capteurOptionLabel(capteur: CapteurOption): string {
  if (!capteur.code_capteur) return capteur.capteur_id;
  return `${capteur.capteur_id} - ${capteur.code_capteur}`;
}

export default function MesuresPage() {
  const t = useTranslations('resourceCrud');
  const [capteurs, setCapteurs] = useState<CapteurOption[]>([]);

  useEffect(() => {
    void apiService
      .getCapteurs({ page: 1, limit: 100 })
      .then((response) =>
        setCapteurs(normalizeApiItems<CapteurOption>(response.data)),
      );
  }, []);

  const fields = useMemo<CrudField[]>(
    () => [
      {
        key: 'mesure_id',
        label: t('measurements.fields.reference', {
          default: 'Measurement Reference',
        }),
        required: true,
      },
      {
        key: 'capteur_id',
        label: t('measurements.fields.sensor'),
        type: 'select',
        required: true,
        options: capteurs.map((capteur) => ({
          value: capteur._id,
          label: capteurOptionLabel(capteur),
        })),
      },
      {
        key: 'valeur',
        label: t('measurements.fields.value'),
        type: 'number',
        required: true,
      },
      {
        key: 'timestamp',
        label: t('measurements.fields.timestamp'),
        type: 'datetime-local',
        required: true,
        render: (value) => new Date(String(value)).toLocaleString(),
      },
      {
        key: 'status',
        label: t('measurements.fields.status'),
        type: 'select',
        required: true,
        options: ['normal', 'warning', 'critical'].map((value) => ({
          value,
          label: t(`measurements.status.${value}`),
        })),
      },
    ],
    [capteurs, t],
  );

  return (
    <ResourceCrudPage
      title={t('measurements.title')}
      fields={fields}
      emptyForm={{
        mesure_id: '',
        capteur_id: '',
        valeur: 0,
        timestamp: new Date().toISOString().slice(0, 16),
        status: 'normal',
      }}
      load={(page, limit) => apiService.getMesures({ page, limit })}
      createItem={(data) => apiService.createMesure(data)}
      updateItem={(id, data) => apiService.updateMesure(id, data)}
      deleteItem={(id) => apiService.deleteMesure(id)}
      normalize={(form) => ({
        ...form,
        valeur: Number(form.valeur),
        timestamp: new Date(String(form.timestamp)).toISOString(),
      })}
      labels={{
        add: t('common.add'),
        edit: t('common.edit'),
        delete: t('common.delete'),
        actions: t('common.actions'),
        cancel: t('common.cancel'),
        save: t('common.save'),
        loading: t('common.loading'),
        empty: t('measurements.empty'),
        confirmDelete: t('common.confirmDelete'),
        loadFailed: t('common.loadFailed'),
        saveFailed: t('common.saveFailed'),
        deleteFailed: t('common.deleteFailed'),
      }}
    />
  );
}
