'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import DashboardLayout from '@/components/DashboardLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { apiService } from '@/services/api';
import { extractApiErrorMessage } from '@/services/apiErrors';
import {
  averageSavedValues,
  parseManualDefectCount,
  parseManualMttrMinutes,
  sumSavedDefectValues,
} from '@/services/productQualityMttr';

type MonthValue = {
  month: number;
  mttrValue: number | null;
  unit: 'MINUTES';
  defectCount: number | null;
  defectSource: 'OFFICIAL_IMPORT' | 'MANUAL' | null;
  defectReadOnly: boolean;
  defectCodes: string[];
};
type ProcessRow = { machineTypeId: string; name: string; months: MonthValue[] };
type ManualMttrResponse = {
  year: number;
  timeZone: string;
  availableYears: number[];
  processes: ProcessRow[];
};

const cellKey = (machineTypeId: string, month: number) => `${machineTypeId}:${month}`;
const formatInput = (value: number | null) => (value === null ? '' : String(value));

function ProductMttrContent() {
  const t = useTranslations('productQualityMttr');
  const locale = useLocale();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const [data, setData] = useState<ManualMttrResponse | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [draftDefectValues, setDraftDefectValues] = useState<Record<string, string>>({});
  const [savedDefectValues, setSavedDefectValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const applyResponse = useCallback((next: ManualMttrResponse) => {
    const mttr: Record<string, string> = {};
    const defects: Record<string, string> = {};
    next.processes.forEach((process) =>
      process.months.forEach((month) => {
        const key = cellKey(process.machineTypeId, month.month);
        mttr[key] = formatInput(month.mttrValue);
        defects[key] = formatInput(month.defectCount);
      }),
    );
    setData(next);
    setSavedValues(mttr);
    setDraftValues(mttr);
    setSavedDefectValues(defects);
    setDraftDefectValues(defects);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await apiService.getManualProductQualityMttr(year, signal);
      if (!signal?.aborted) applyResponse(response.data as ManualMttrResponse);
    } catch (cause) {
      if (!signal?.aborted) setError(extractApiErrorMessage(cause, t('loadFailed')));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [applyResponse, t, year]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const changedEntries = useMemo(
    () =>
      data?.processes.flatMap((process) =>
        process.months
          .filter((month) => {
            const key = cellKey(process.machineTypeId, month.month);
            return draftValues[key] !== savedValues[key];
          })
          .map((month) => ({
            machineTypeId: process.machineTypeId,
            month: month.month,
            mttrValue: parseManualMttrMinutes(
              draftValues[cellKey(process.machineTypeId, month.month)] ?? '',
            ),
          })),
      ) ?? [],
    [data, draftValues, savedValues],
  );
  const changedDefectEntries = useMemo(
    () =>
      data?.processes.flatMap((process) =>
        process.months
          .filter((month) => {
            const key = cellKey(process.machineTypeId, month.month);
            return !month.defectReadOnly && draftDefectValues[key] !== savedDefectValues[key];
          })
          .map((month) => ({
            machineTypeId: process.machineTypeId,
            month: month.month,
            defectCount: parseManualDefectCount(
              draftDefectValues[cellKey(process.machineTypeId, month.month)] ?? '',
            ),
          })),
      ) ?? [],
    [data, draftDefectValues, savedDefectValues],
  );
  const isDirty = changedEntries.length > 0 || changedDefectEntries.length > 0;
  const hasInvalidValue =
    changedEntries.some((entry) => entry.mttrValue === undefined) ||
    changedDefectEntries.some((entry) => entry.defectCount === undefined);

  const save = async () => {
    if (saving || !isDirty) return;
    if (hasInvalidValue) {
      setError(t('manualFormatError'));
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await apiService.saveManualProductQualityMttr({
        year,
        entries: changedEntries.map((entry) => ({
          ...entry,
          mttrValue: entry.mttrValue as number | null,
        })),
        defectEntries: changedDefectEntries.map((entry) => ({
          ...entry,
          defectCount: entry.defectCount as number | null,
        })),
      });
      applyResponse(response.data as ManualMttrResponse);
      setSuccess(t('manualSavedSuccessfully'));
    } catch (cause) {
      setError(extractApiErrorMessage(cause, t('saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const requestYear = (nextYear: number) => {
    if (nextYear === year) return;
    if (isDirty) setPendingYear(nextYear);
    else setYear(nextYear);
  };
  const discardAndChangeYear = () => {
    if (pendingYear === null) return;
    setDraftValues(savedValues);
    setDraftDefectValues(savedDefectValues);
    setYear(pendingYear);
    setPendingYear(null);
  };
  const yearOptions = [
    ...new Set([
      ...(data?.availableYears ?? []),
      ...Array.from({ length: 12 }, (_, index) => currentYear - 1 + index),
      year,
    ]),
  ].sort((a, b) => b - a);
  const monthNames = Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(year, index, 1)),
    ),
  );
  const savedMttr = (process: ProcessRow, month: number) =>
    parseManualMttrMinutes(savedValues[cellKey(process.machineTypeId, month)] ?? '') ?? null;
  const savedDefect = (process: ProcessRow, month: number) =>
    parseManualDefectCount(savedDefectValues[cellKey(process.machineTypeId, month)] ?? '') ?? null;
  const processAverages = new Map(
    (data?.processes ?? []).map((process) => [
      process.machineTypeId,
      averageSavedValues(process.months.map((month) => savedMttr(process, month.month))),
    ]),
  );
  const monthlyAverages = Array.from({ length: 12 }, (_, index) =>
    averageSavedValues((data?.processes ?? []).map((process) => savedMttr(process, index + 1))),
  );
  const overallAverage = averageSavedValues(
    (data?.processes ?? []).flatMap((process) =>
      process.months.map((month) => savedMttr(process, month.month)),
    ),
  );
  const processDefectTotals = new Map(
    (data?.processes ?? []).map((process) => [
      process.machineTypeId,
      sumSavedDefectValues(process.months.map((month) => savedDefect(process, month.month))),
    ]),
  );
  const monthlyDefectTotals = Array.from({ length: 12 }, (_, index) =>
    sumSavedDefectValues((data?.processes ?? []).map((process) => savedDefect(process, index + 1))),
  );
  const finalDefectTotal = sumSavedDefectValues(monthlyDefectTotals);
  const formatAverage = (value: number | null) =>
    value === null
      ? '—'
      : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} min`;

  return (
    <DashboardLayout title={t('title')}>
      <main className="mx-auto w-full max-w-[1700px] space-y-6 p-4 md:p-6 lg:p-8" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h1 className="text-2xl font-bold">{t('title')}</h1><p className="mt-1 text-sm text-slate-600">{t('manualDescription')}</p></div>
          <label className="text-sm font-medium">{t('year')}<select value={year} onChange={(event) => requestYear(Number(event.target.value))} className="ms-2 h-10 rounded-lg border border-slate-300 bg-white px-3">{yearOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        </header>
        {pendingYear !== null && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>{t('discardYearQuestion')}</span><span className="flex gap-2"><button type="button" onClick={() => setPendingYear(null)} className="rounded-lg border bg-white px-3 py-2 font-semibold">{t('stay')}</button><button type="button" onClick={discardAndChangeYear} className="rounded-lg bg-amber-700 px-3 py-2 font-semibold text-white">{t('discardChanges')}</button></span></div>}
        {success && <output className="block rounded-xl bg-emerald-50 p-3 text-emerald-800">{success}</output>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}

        <section className="rounded-2xl border bg-white shadow-sm">
          {loading ? <output className="block p-10 text-center">{t('loading')}</output> : <div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-sm"><caption className="px-4 py-3 text-start font-semibold">{t('monthlyMinutesHeading')}</caption><thead className="bg-slate-50"><tr><th className="sticky start-0 z-10 bg-slate-50 px-4 py-3 text-start">{t('process')}</th>{monthNames.map((month, index) => <th key={`month-${index + 1}`} className="px-2 py-3 text-center">{month}</th>)}<th className="px-3 py-3 text-end">{t('processAverage')}</th></tr></thead><tbody className="divide-y">{data?.processes.map((process) => <tr key={process.machineTypeId}><th className="sticky start-0 bg-white px-4 py-3 text-start font-semibold">{process.name}</th>{process.months.map((month) => { const key = cellKey(process.machineTypeId, month.month); const dirty = draftValues[key] !== savedValues[key]; return <td key={month.month} className="px-2 py-2"><input type="number" min="0" step="0.01" value={draftValues[key] ?? ''} onChange={(event) => setDraftValues((current) => ({ ...current, [key]: event.target.value }))} placeholder="—" aria-label={t('manualCellLabel', { process: process.name, month: monthNames[month.month - 1] })} className={`h-9 w-20 rounded-lg border px-2 text-center tabular-nums ${dirty ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`} /></td>; })}<td className="px-3 py-2 text-end font-semibold">{formatAverage(processAverages.get(process.machineTypeId) ?? null)}</td></tr>)}<tr className="bg-slate-50 font-semibold"><th className="sticky start-0 bg-slate-50 px-4 py-3 text-start">{t('monthlyAverage')}</th>{monthlyAverages.map((average, index) => <td key={`month-average-${index + 1}`} className="px-2 py-3 text-center">{formatAverage(average)}</td>)}<td className="px-3 py-3 text-end">{formatAverage(overallAverage)}</td></tr></tbody></table>{data?.processes.length === 0 && <p className="p-8 text-center text-slate-600">{t('noProcesses')}</p>}</div>}
          <p className="border-t p-4 text-sm font-semibold">{t('overallAverage')}: {formatAverage(overallAverage)}</p>
        </section>

        {!loading && (data?.processes.length ?? 0) > 0 && <section className="rounded-2xl border bg-white shadow-sm"><div className="p-5"><h2 className="text-lg font-semibold">{t('monthlyDefectTitle')}</h2><p className="mt-1 text-sm text-slate-600">{t('monthlyDefectHelp')}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-sm"><thead className="bg-slate-50"><tr><th className="sticky start-0 bg-slate-50 px-4 py-3 text-start">{t('process')}</th>{monthNames.map((month, index) => <th key={`defect-month-${index + 1}`} className="px-2 py-3 text-center">{month}</th>)}<th className="px-3 py-3 text-end">{t('total')}</th></tr></thead><tbody className="divide-y">{data?.processes.map((process) => <tr key={process.machineTypeId}><th className="sticky start-0 bg-white px-4 py-3 text-start font-semibold">{process.name}</th>{process.months.map((month) => { const key = cellKey(process.machineTypeId, month.month); const dirty = draftDefectValues[key] !== savedDefectValues[key]; return <td key={month.month} className="px-2 py-2 text-center">{month.defectReadOnly ? <div title={month.defectCodes.join(', ')}><span className="block font-semibold tabular-nums">{savedDefectValues[key]}</span><span className="mt-1 block whitespace-nowrap text-[10px] font-semibold uppercase text-blue-700">{t('officialImport')}</span></div> : <input type="number" min="0" step="1" value={draftDefectValues[key] ?? ''} onChange={(event) => setDraftDefectValues((current) => ({ ...current, [key]: event.target.value }))} placeholder="—" aria-label={t('defectCellLabel', { process: process.name, month: monthNames[month.month - 1] })} className={`h-9 w-20 rounded-lg border px-2 text-center tabular-nums ${dirty ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`} />}</td>; })}<td className="px-3 py-2 text-end font-semibold">{processDefectTotals.get(process.machineTypeId) ?? 0}</td></tr>)}<tr className="bg-slate-50 font-semibold"><th className="sticky start-0 bg-slate-50 px-4 py-3 text-start">{t('monthlyTotal')}</th>{monthlyDefectTotals.map((total, index) => <td key={`defect-total-${index + 1}`} className="px-2 py-3 text-center">{total}</td>)}<td className="px-3 py-3 text-end">{finalDefectTotal}</td></tr></tbody></table></div><p className="border-t p-4 font-semibold">{t('finalTotalDefects')}: {finalDefectTotal}</p></section>}

        <div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div>{isDirty && <output className="text-sm font-medium text-amber-700">{t('unsavedChanges')}</output>}</div><button type="button" onClick={() => void save()} disabled={saving || loading || !isDirty} className="rounded-xl bg-blue-700 px-5 py-2.5 font-semibold text-white disabled:opacity-50">{saving ? t('saving') : t('saveChanges')}</button></div>
      </main>
    </DashboardLayout>
  );
}

export default function ProductQualityMttrPage() {
  return <ProtectedRoute requiredRole="admin"><ProductMttrContent /></ProtectedRoute>;
}
