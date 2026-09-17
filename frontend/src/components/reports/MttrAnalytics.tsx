'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

import { Modal } from '@/components/Modal';
import { apiService } from '@/services/api';
import { extractApiErrorMessage } from '@/services/apiErrors';
import type { MttrAnalyticsData, MttrMonth } from '@/types/mttr';

const LineChartCard = dynamic(
  () => import('@/components/charts/LineChartCard').then((mod) => mod.LineChartCard),
  { ssr: false, loading: () => <div className="panel h-[220px] animate-pulse" /> },
);

const MONTH_KEYS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

const EXCLUSION_REASONS = [
  'missingStartEnd',
  'endBeforeStart',
  'nonCorrective',
  'cancelledIncomplete',
  'missingUnresolvableWorkOrder',
] as const;

function formatDuration(minutes: number, t: (key: string) => string): string {
  if (!Number.isFinite(minutes)) return '—';
  if (minutes === 0) return '0';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}${t('durationUnits.hours')} ${m}${t('durationUnits.minutes')}`;
  if (h > 0) return `${h}${t('durationUnits.hours')}`;
  return `${m}${t('durationUnits.minutes')}`;
}

function monthName(monthIndex: number, t: (key: string) => string): string {
  const key = MONTH_KEYS[monthIndex];
  if (!key) return String(monthIndex + 1);
  return t(`mttr.months.${key}`);
}

function formatDateTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

export interface MttrAnalyticsProps {
  locale: string;
  machines: Array<{ _id: string; machine_id: string; reference?: string }>;
  technicians: Array<{ _id: string; name: string }>;
}

export function MttrAnalytics({ locale, machines, technicians }: MttrAnalyticsProps) {
  const t = useTranslations('mttr');
  const currentYear = new Date().getFullYear();

  const [year, setYear] = useState<number>(currentYear);
  const [machineId, setMachineId] = useState<string>('');
  const [technicianId, setTechnicianId] = useState<string>('');

  const [data, setData] = useState<MttrAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<MttrMonth | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);

  const loadData = useCallback(async () => {
    const seq = ++requestSeq.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await apiService.getMttrAnalytics(
        { year, machineId: machineId || undefined, technicianId: technicianId || undefined },
        { signal: controller.signal },
      );
      if (seq !== requestSeq.current) return;
      setData(response.data as MttrAnalyticsData);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if ((err as { name?: string })?.name === 'CanceledError' || (err as { name?: string })?.name === 'AbortError') {
        return;
      }
      setError(
        (err as { response?: { status?: number } })?.response?.status === 403
          ? t('errorMachineAccess')
          : extractApiErrorMessage(err, t('error')),
      );
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [year, machineId, technicianId, t]);

  useEffect(() => {
    void loadData();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadData]);

  useEffect(() => {
    setSelectedMonth(null);
  }, [year, machineId, technicianId]);

  const trendData = useMemo(() => {
    if (!data) return [];
    return data.months
      .filter((m) => m.mttrMinutes !== null && m.mttrMinutes !== undefined)
      .map((m) => ({
        label: monthName(m.monthIndex, t),
        value: m.mttrMinutes!,
      }));
  }, [data, t]);

  const handleRetry = useCallback(() => {
    void loadData();
  }, [loadData]);

  const openMonthDetails = useCallback((month: MttrMonth) => {
    setSelectedMonth(month);
  }, []);

  const closeMonthDetails = useCallback(() => {
    setSelectedMonth(null);
  }, []);

  const summary = data?.summary ?? null;

  return (
    <section className="mt-8">
      <div className="panel mb-6">
        <h2 className="text-xl font-bold">{t('header')}</h2>
        <p className="text-gray-500 text-sm">{t('description')}</p>
      </div>

      {/* Filters */}
      <div className="panel mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="mttr-year" className="block text-xs font-medium mb-1">
              {t('filters.year')}
            </label>
            <select
              id="mttr-year"
              className="input-field"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {Array.from({ length: 6 }, (_, i) => {
                const y = currentYear - i;
                return (
                  <option key={y} value={y}>
                    {y}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label htmlFor="mttr-machine" className="block text-xs font-medium mb-1">
              {t('filters.machine')}
            </label>
            <select
              id="mttr-machine"
              className="input-field"
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
            >
              <option value="">{t('filters.allMachines')}</option>
              {machines.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.reference ? `${m.machine_id} (${m.reference})` : m.machine_id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="mttr-technician" className="block text-xs font-medium mb-1">
              {t('filters.technician')}
            </label>
            <select
              id="mttr-technician"
              className="input-field"
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
            >
              <option value="">{t('filters.allTechnicians')}</option>
              {technicians.map((tech) => (
                <option key={tech._id} value={tech._id}>
                  {tech.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="panel mb-6 p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <ExclamationTriangleIcon className="h-8 w-8 text-red-500" aria-hidden="true" />
            <p className="text-sm text-text-secondary">{error}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <ArrowPathIcon className="h-4 w-4" />
              {t('retry')}
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="panel h-28 animate-pulse" aria-label={t('loading')} />
          ))}
        </div>
      )}

      {!loading && !error && !data && (
        <div className="panel mb-6 p-6 text-center text-sm text-text-secondary">
          {t('noData.message')}
        </div>
      )}

      {/* KPI Summary */}
      {data && summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="panel p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('summary.mttr')}</p>
            {summary.mttrMinutes !== null && summary.mttrMinutes !== undefined ? (
              <p className="text-2xl font-bold mt-1">{formatDuration(summary.mttrMinutes, t)}</p>
            ) : (
              <p className="text-2xl font-bold mt-1 text-gray-400">—</p>
            )}
          </div>
          <div className="panel p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('summary.completedRepairs')}</p>
            <p className="text-2xl font-bold mt-1">{summary.completedRepairs}</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('summary.totalRepairTime')}</p>
            {summary.totalRepairMinutes !== null &&
            summary.totalRepairMinutes !== undefined ? (
              <p className="text-2xl font-bold mt-1">{formatDuration(summary.totalRepairMinutes, t)}</p>
            ) : (
              <p className="text-2xl font-bold mt-1 text-gray-400">—</p>
            )}
          </div>
        </div>
      )}

      {/* No data state */}
      {data && !loading && data.months.every((m) => m.completedRepairs === 0) && (
        <div className="panel mb-6 p-6">
          <p className="text-sm text-text-secondary">{t('noData.message')}</p>
        </div>
      )}

      {data && data.excluded.total > 0 && (
        <div className="panel mb-6 p-4">
          <p className="text-sm font-medium text-text-secondary">
            {t('exclusionNote')}: {data.excluded.total}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-text-secondary">
            {EXCLUSION_REASONS.map((reason) => {
              const count = data.excluded.byReason[reason];
              return count > 0 ? (
                <li key={reason}>
                  {t(`excludedReasons.${reason}`)}: {count}
                </li>
              ) : null;
            })}
          </ul>
        </div>
      )}

      {/* Trend chart */}
      {data && (
        <div className="mb-6">
          <LineChartCard
            title={t('trend.title')}
            data={trendData}
            emptyLabel={t('trend.noData')}
            valueFormatter={(value) => `${formatDuration(value, t)}`}
          />
        </div>
      )}

      {/* Monthly table */}
      {data && (
        <div className="panel overflow-x-auto">
          <h3 className="card-title mb-3">{t('table.month')}</h3>
          <table className="table">
            <thead>
              <tr>
                <th>{t('table.month')}</th>
                <th>{t('table.completedRepairs')}</th>
                <th>{t('table.totalRepairTime')}</th>
                <th>{t('table.mttr')}</th>
                <th>{t('table.action')}</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((month) => {
                const hasRepairs = month.completedRepairs > 0;
                return (
                  <tr key={month.monthIndex}>
                    <td>{monthName(month.monthIndex, t)}</td>
                    <td>{month.completedRepairs}</td>
                    <td>
                      {hasRepairs
                        ? formatDuration(month.totalRepairMinutes, t)
                        : '—'}
                    </td>
                    <td>
                      {hasRepairs && month.mttrMinutes !== null && month.mttrMinutes !== undefined
                        ? formatDuration(month.mttrMinutes, t)
                        : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => openMonthDetails(month)}
                        className="btn-secondary text-xs"
                      >
                        {t('table.viewDetails')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Details modal */}
      <Modal
        isOpen={selectedMonth !== null}
        onClose={closeMonthDetails}
        title={selectedMonth ? t('details.title', {
          monthName: monthName(selectedMonth.monthIndex, t),
          year: String(year),
        }) : ''}
        size="lg"
      >
        {selectedMonth && (
          <div>
          <p className="text-sm text-gray-500">
            {t('details.formula')}: {selectedMonth.completedRepairs > 0
              ? `${formatDuration(selectedMonth.totalRepairMinutes, t)} / ${selectedMonth.completedRepairs} = ${formatDuration(selectedMonth.mttrMinutes ?? 0, t)}`
              : '—'}
          </p>
            {selectedMonth.repairs.length === 0 ? (
              <p className="text-sm text-gray-500">{t('details.noRepairs')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('details.workOrder')}</th>
                      <th>{t('details.machine')}</th>
                      <th>{t('details.technician')}</th>
                      <th>{t('details.repairStart')}</th>
                      <th>{t('details.repairEnd')}</th>
                      <th>{t('details.repairDuration')}</th>
                      <th>{t('details.action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedMonth.repairs.map((repair) => (
                      <tr key={repair.reportRecordId}>
                        <td>
                          <a
                            href={`/${locale}/work-orders/${repair.workOrderRecordId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {repair.workOrderId}
                          </a>
                        </td>
                        <td>
                          {repair.machine.reference ? `${repair.machine.code} (${repair.machine.reference})` : repair.machine.code}
                        </td>
                        <td>{repair.technician.name}</td>
                        <td>{formatDateTime(repair.startDate, locale)}</td>
                        <td>{formatDateTime(repair.endDate, locale)}</td>
                        <td>{formatDuration(repair.durationMinutes, t)}</td>
                        <td>
                          <a
                            href={`/${locale}/intervention-reports/${repair.reportRecordId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {t('details.action')}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
