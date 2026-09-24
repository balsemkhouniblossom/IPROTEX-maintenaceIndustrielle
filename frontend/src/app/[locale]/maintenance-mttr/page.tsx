'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import DashboardLayout from '@/components/DashboardLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { apiService } from '@/services/api';
import { extractApiErrorMessage } from '@/services/apiErrors';

type RecordItem = { id: string; machineId: string; machineCode: string; machineReference: string | null; startedAt: string; endedAt: string; durationMinutes: number; source: string; description: string };
type MonthItem = { month: number; interventionCount: number; totalMinutes: number; mttrMinutes: number | null; records: RecordItem[] };
type ProcessItem = { machineTypeId: string; name: string; months: MonthItem[] };
type MachineItem = { id: string; code: string; reference: string | null; machineTypeId: string };
type ResponseData = { year: number; unit: 'MINUTES'; processes: ProcessItem[]; machines: MachineItem[]; summary: { interventionCount: number; totalMinutes: number; mttrMinutes: number | null } };
type FormState = { id?: string; machineId: string; startedAt: string; endedAt: string; description: string };

const emptyForm: FormState = { machineId: '', startedAt: '', endedAt: '', description: '' };
const localInput = (value: string) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

function MachineMaintenanceMttrContent() {
  const t = useTranslations('machineMaintenanceMttr');
  const locale = useLocale();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selected, setSelected] = useState<{ process: ProcessItem; month: MonthItem } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const response = await apiService.getMachineMaintenanceMttr(year, signal);
      if (!signal?.aborted) setData(response.data as ResponseData);
    } catch (cause) {
      if (!signal?.aborted) setError(extractApiErrorMessage(cause, t('loadFailed')));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [t, year]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const monthNames = useMemo(() => Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, index, 1)))), [locale, year]);
  const formatMinutes = (value: number | null) => value === null ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} min`;
  const processAverages = useMemo(() => new Map((data?.processes ?? []).map((process) => {
    const records = process.months.flatMap((month) => month.records);
    return [process.machineTypeId, records.length ? records.reduce((sum, record) => sum + record.durationMinutes, 0) / records.length : null];
  })), [data]);
  const monthlyAverages = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const records = (data?.processes ?? []).flatMap((process) => process.months[index]?.records ?? []);
    return {
      month: index + 1,
      value: records.length
        ? records.reduce((sum, record) => sum + record.durationMinutes, 0) / records.length
        : null,
    };
  }), [data]);

  const openAdd = () => { setForm(emptyForm); setSelected(null); setShowForm(true); };
  const openEdit = (record: RecordItem) => { setForm({ id: record.id, machineId: record.machineId, startedAt: localInput(record.startedAt), endedAt: localInput(record.endedAt), description: record.description }); setShowForm(true); };
  const save = async () => {
    if (!form.machineId || !form.startedAt || !form.endedAt || new Date(form.endedAt) <= new Date(form.startedAt)) { setError(t('invalidTimes')); return; }
    setSaving(true); setError(''); setSuccess('');
    const payload = { machineId: form.machineId, startedAt: new Date(form.startedAt).toISOString(), endedAt: new Date(form.endedAt).toISOString(), description: form.description || undefined };
    try {
      if (form.id) await apiService.updateMachineMaintenanceMttr(form.id, payload);
      else await apiService.createMachineMaintenanceMttr(payload);
      setForm(emptyForm); setSelected(null); setShowForm(false); setSuccess(t('saved')); await load();
    } catch (cause) { setError(extractApiErrorMessage(cause, t('saveFailed'))); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    setError('');
    try { await apiService.deleteMachineMaintenanceMttr(id); setSelected(null); setSuccess(t('deleted')); await load(); }
    catch (cause) { setError(extractApiErrorMessage(cause, t('deleteFailed'))); }
  };

  return <DashboardLayout title={t('title')}><main className="mx-auto w-full max-w-[1700px] space-y-6 p-4 text-slate-900 dark:text-slate-100 md:p-6 lg:p-8" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-bold">{t('title')}</h1><p className="text-sm text-slate-600 dark:text-slate-300">{t('description')}</p></div><div className="flex gap-3"><label className="text-sm font-medium">{t('year')} <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">{Array.from({ length: 8 }, (_, index) => currentYear - 4 + index).map((item) => <option key={item}>{item}</option>)}</select></label><button type="button" onClick={openAdd} className="rounded-xl bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800">{t('add')}</button></div></header>
    {success && <output className="block rounded-xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{success}</output>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800 dark:bg-red-950/50 dark:text-red-200">{error}</p>}
    <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><p className="text-sm text-slate-500 dark:text-slate-400">{t('overallMttr')}</p><strong className="text-2xl">{formatMinutes(data?.summary.mttrMinutes ?? null)}</strong></div><div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><p className="text-sm text-slate-500 dark:text-slate-400">{t('interventions')}</p><strong className="text-2xl">{data?.summary.interventionCount ?? 0}</strong></div><div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><p className="text-sm text-slate-500 dark:text-slate-400">{t('totalTime')}</p><strong className="text-2xl">{formatMinutes(data?.summary.totalMinutes ?? null)}</strong></div></section>
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">{loading ? <p className="p-10 text-center">{t('loading')}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-sm"><caption className="p-4 text-start font-semibold">{t('monthlyHeading')}</caption><thead className="bg-slate-50 dark:bg-slate-800"><tr><th className="sticky start-0 bg-slate-50 px-4 py-3 text-start dark:bg-slate-800">{t('process')}</th>{monthNames.map((name) => <th key={name} className="px-2 py-3">{name}</th>)}<th className="px-3 py-3">{t('average')}</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{data?.processes.map((process) => <tr key={process.machineTypeId}><th className="sticky start-0 bg-white px-4 py-3 text-start dark:bg-slate-900">{process.name}</th>{process.months.map((month) => <td key={month.month} className="px-2 py-2 text-center"><button type="button" onClick={() => { setSelected({ process, month }); setShowForm(false); }} className="min-w-20 rounded-lg border border-slate-200 px-2 py-2 hover:bg-blue-50 dark:border-slate-700 dark:hover:bg-slate-800"><span className="block font-semibold">{formatMinutes(month.mttrMinutes)}</span><span className="text-xs text-slate-500 dark:text-slate-400">{month.interventionCount} {t('records')}</span></button></td>)}<td className="px-3 text-center font-semibold">{formatMinutes(processAverages.get(process.machineTypeId) ?? null)}</td></tr>)}<tr className="bg-slate-50 font-semibold dark:bg-slate-800"><th className="sticky start-0 bg-slate-50 px-4 py-3 text-start dark:bg-slate-800">{t('monthlyAverage')}</th>{monthlyAverages.map(({ month, value }) => <td key={month} className="px-2 py-3 text-center">{formatMinutes(value)}</td>)}<td className="px-3 text-center">{formatMinutes(data?.summary.mttrMinutes ?? null)}</td></tr></tbody></table></div>}</section>
    {showForm && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><h2 className="text-lg font-semibold">{form.id ? t('edit') : t('add')}</h2><div className="mt-4 grid gap-4 md:grid-cols-2"><label>{t('machine')}<select value={form.machineId} onChange={(e) => setForm((current) => ({ ...current, machineId: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"><option value="">{t('selectMachine')}</option>{data?.machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.code}{machine.reference ? ` — ${machine.reference}` : ''}</option>)}</select></label><label>{t('descriptionLabel')}<input value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></label><label>{t('start')}<input type="datetime-local" value={form.startedAt} onChange={(e) => setForm((current) => ({ ...current, startedAt: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></label><label>{t('end')}<input type="datetime-local" min={form.startedAt || undefined} value={form.endedAt} onChange={(e) => setForm((current) => ({ ...current, endedAt: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></label></div><div className="mt-4 flex gap-2"><button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? t('saving') : t('save')}</button><button type="button" onClick={() => { setForm(emptyForm); setShowForm(false); }} className="rounded-lg border border-slate-300 px-4 py-2 dark:border-slate-600 dark:bg-slate-800">{t('cancel')}</button></div></section>}
    {selected && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><div className="flex justify-between"><div><h2 className="text-lg font-semibold">{t('history')}</h2><p className="text-sm text-slate-500 dark:text-slate-400">{selected.process.name} — {monthNames[selected.month.month - 1]}</p></div><button type="button" onClick={() => setSelected(null)}>{t('close')}</button></div>{selected.month.records.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>{t('machine')}</th><th>{t('start')}</th><th>{t('end')}</th><th>{t('duration')}</th><th>{t('source')}</th><th>{t('actions')}</th></tr></thead><tbody>{selected.month.records.map((record) => <tr key={record.id}><td>{record.machineCode}</td><td>{new Date(record.startedAt).toLocaleString(locale)}</td><td>{new Date(record.endedAt).toLocaleString(locale)}</td><td>{formatMinutes(record.durationMinutes)}</td><td>{t(record.source === 'OPERATOR_REPORT' ? 'operatorReport' : 'adminManual')}</td><td><button type="button" onClick={() => openEdit(record)} className="me-2 text-blue-700 dark:text-blue-300">{t('edit')}</button><button type="button" onClick={() => void remove(record.id)} className="text-red-700 dark:text-red-300">{t('delete')}</button></td></tr>)}</tbody></table></div> : <p className="mt-4 text-slate-500 dark:text-slate-400">{t('noRecords')}</p>}</section>}
  </main></DashboardLayout>;
}

export default function MachineMaintenanceMttrPage() { return <ProtectedRoute requiredRole="admin"><MachineMaintenanceMttrContent /></ProtectedRoute>; }
