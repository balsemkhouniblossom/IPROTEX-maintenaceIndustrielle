'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import DashboardLayout from '@/components/DashboardLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { apiService } from '@/services/api';
import MachineHeader from './MachineHeader';
import MachineStatsCards from './MachineStatsCards';
import MachineTimelineFeed from './MachineTimelineFeed';
import type { MachineTimelineSummary } from './types';

export default function MachineDetailPage({ machineId }: Readonly<{ machineId: string }>) {
  const t = useTranslations('machineTimeline');
  const [summary, setSummary] = useState<MachineTimelineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSummary = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoading(true);
        setError('');
        const response = await apiService.getMachineTimelineSummary(machineId, { signal });
        setSummary(response.data as MachineTimelineSummary);
      } catch (err: unknown) {
        const name = (err as { name?: string; code?: string })?.name;
        const code = (err as { name?: string; code?: string })?.code;
        if (name === 'CanceledError' || name === 'AbortError' || code === 'ERR_CANCELED') return;
        const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setError(message || t('errors.loadSummary'));
      } finally {
        setLoading(false);
      }
    },
    [machineId, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadSummary(controller.signal);
    return () => controller.abort();
  }, [loadSummary]);

  const pageTitle = summary?.machine.machineId
    ? `${t('pageTitle')} / ${summary.machine.machineId}`
    : t('pageTitle');

  return (
    <ProtectedRoute allowedRoles={['admin', 'technician', 'operator']}>
      <DashboardLayout title={pageTitle}>
        <div className="mx-auto max-w-7xl space-y-5">
          {error && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              <span>{error}</span>
              <button type="button" className="underline" onClick={() => void loadSummary()}>
                {t('actions.retry')}
              </button>
            </div>
          )}
          <MachineHeader machineId={machineId} machine={summary?.machine} stats={summary?.stats} loading={loading} />
          <MachineStatsCards stats={summary?.stats} loading={loading} />
          <MachineTimelineFeed machineId={machineId} />
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
