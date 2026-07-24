'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ResourceCrudPage, { CrudField } from '@/components/ResourceCrudPage';
import { apiService } from '@/services/api';
import { normalizeApiItems } from '@/services/pagination';
import type { CapteurOption } from '@/types/maintenance-resources';

export default function MesuresPage() {
  const t = useTranslations('resourceCrud');
  const [capteurs, setCapteurs] = useState<CapteurOption[]>([]);
  useEffect(() => { void apiService.getCapteurs({ page: 1, limit: 100 }).then((r) => setCapteurs(normalizeApiItems<CapteurOption>(r.data))); }, []);
  const fields = useMemo<CrudField[]>(() => [
    { key: 'mesure_id', label: t('measurements.fields.reference', { default: 'Measurement Reference' }), required: true },
    { key: 'capteur_id', label: t('measurements.fields.sensor'), type: 'select', required: true, options: capteurs.map((c) => ({ value: c._id, label: `${c.capteur_id}${c.code_capteur ? ` — ${c.code_capteur}` : ''}` })) },
    { key: 'valeur', label: t('measurements.fields.value'), type: 'number', required: true },
    { key: 'timestamp', label: t('measurements.fields.timestamp'), type: 'datetime-local', required: true, render: (v) => new Date(String(v)).toLocaleString() },
    { key: 'status', label: t('measurements.fields.status'), type: 'select', required: true, options: ['normal', 'warning', 'critical'].map((value) => ({ value, label: t(`measurements.status.${value}`) })) },
  ], [capteurs, t]);
  return <ResourceCrudPage title={t('measurements.title')} fields={fields} emptyForm={{ mesure_id: '', capteur_id: '', valeur: 0, timestamp: new Date().toISOString().slice(0, 16), status: 'normal' }} load={(page, limit) => apiService.getMesures({ page, limit })} createItem={(d) => apiService.createMesure(d)} updateItem={(id, d) => apiService.updateMesure(id, d)} deleteItem={(id) => apiService.deleteMesure(id)} normalize={(form) => ({ ...form, valeur: Number(form.valeur), timestamp: new Date(String(form.timestamp)).toISOString() })} labels={{ add: t('common.add'), edit: t('common.edit'), delete: t('common.delete'), actions: t('common.actions'), cancel: t('common.cancel'), save: t('common.save'), loading: t('common.loading'), empty: t('measurements.empty'), confirmDelete: t('common.confirmDelete'), loadFailed: t('common.loadFailed'), saveFailed: t('common.saveFailed'), deleteFailed: t('common.deleteFailed') }} />;
}
