'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

import DashboardLayout from '@/components/DashboardLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import Pagination from '@/components/Pagination';
import type { ChartDatum } from '@/components/charts/BarChartCard';
import { StatusBadge } from '@/components/StatusBadge';
import { VirtualizedDataTable, DataTableColumn } from '@/components/VirtualizedDataTable';
import { SavedViewsBar, SavedView } from '@/components/SavedViewsBar';
import { apiService } from '@/services/api';
import { extractApiErrorMessage } from '@/services/apiErrors';
import { useServerTable, ServerTableQuery } from '@/hooks/useServerTable';

// recharts is a heavy dependency (it pulls in d3 internals) that isn't
// needed for this page's initial paint (builder form, table skeleton) —
// deferring it keeps that first paint lighter and only pays the cost once
// the summary charts are actually about to render.
const BarChartCard = dynamic(
  () => import('@/components/charts/BarChartCard').then((mod) => mod.BarChartCard),
  { ssr: false, loading: () => <div className="panel h-[220px] animate-pulse" /> },
);

type ReportType =
  | 'machine_history'
  | 'preventive_compliance'
  | 'corrective_downtime'
  | 'mttr_mtbf_trends'
  | 'stock_movements'
  | 'maintenance_costs'
  | 'technician_workload'
  | 'fault_frequency'
  | 'audit_history'
  | 'predictive_risk';

type ReportFormat = 'pdf' | 'excel' | 'csv';
type ReportStatus = 'pending' | 'processing' | 'completed' | 'failed';
type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

interface GeneratedReport {
  _id: string;
  report_id: string;
  type: ReportType;
  format: ReportFormat;
  status: ReportStatus;
  requested_by?: string;
  requester_role?: string;
  row_count?: number;
  file_size_bytes?: number;
  error_message?: string;
  expires_at?: string;
  createdAt?: string;
  generated_at?: string;
}

interface ScheduledReport {
  _id: string;
  schedule_id: string;
  type: ReportType;
  format: ReportFormat;
  frequency: ScheduleFrequency;
  active: boolean;
  next_run_at?: string;
  last_run_at?: string;
  parameters?: { machineId?: string; relativeRangeDays?: number };
}

interface Machine {
  _id: string;
  machine_id: string;
  reference?: string;
}

interface ReportsFilters {
  scope: 'mine' | 'all';
  type: string;
  status: string;
  [key: string]: string;
}

type SavedReportsQuery = {
  scope?: 'mine' | 'all';
  type?: string;
  status?: string;
  sort?: string;
};

const ALL_REPORT_TYPES: ReportType[] = [
  'machine_history',
  'preventive_compliance',
  'corrective_downtime',
  'mttr_mtbf_trends',
  'stock_movements',
  'maintenance_costs',
  'technician_workload',
  'fault_frequency',
  'audit_history',
  'predictive_risk',
];

// Mirrors the backend's REPORT_TYPE_ROLES machine-scoping split exactly —
// see backend/src/reports/report-access.ts — so the machine picker only
// ever appears for report types the provider actually reads a machineId
// for, and is required (not just optional) only for machine_history.
const MACHINE_SCOPED_TYPES = new Set<ReportType>([
  'machine_history',
  'preventive_compliance',
  'corrective_downtime',
  'mttr_mtbf_trends',
  'fault_frequency',
  'predictive_risk',
]);
const MACHINE_REQUIRED_TYPES = new Set<ReportType>(['machine_history']);

const FORMAT_EXTENSIONS: Record<ReportFormat, string> = {
  pdf: 'pdf',
  excel: 'xlsx',
  csv: 'csv',
};

const STATUS_BADGE_CLASSES: Record<ReportStatus, string> = {
  pending: 'bg-slate-100 text-slate-700 border-slate-200',
  processing: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
};

const POLL_INTERVAL_MS = 3000;

function machineLabel(machine: Machine): string {
  return machine.reference ? `${machine.machine_id} (${machine.reference})` : machine.machine_id;
}

function extractMachineList(data: unknown): Machine[] {
  if (Array.isArray(data)) return data as Machine[];
  if (!data || typeof data !== 'object') return [];

  const payload = data as { data?: unknown; machines?: unknown; items?: unknown };
  if (Array.isArray(payload.data)) return payload.data as Machine[];
  if (Array.isArray(payload.machines)) return payload.machines as Machine[];
  if (Array.isArray(payload.items)) return payload.items as Machine[];

  return [];
}

export default function ReportsPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <ReportsPageContent />
    </ProtectedRoute>
  );
}

function ReportsPageContent() {
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');

  const [machines, setMachines] = useState<Machine[]>([]);
  const [availableTypes, setAvailableTypes] = useState<ReportType[]>(ALL_REPORT_TYPES);

  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);

  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [builderType, setBuilderType] = useState<ReportType>('machine_history');
  const [builderFormat, setBuilderFormat] = useState<ReportFormat>('pdf');
  const [builderMachineId, setBuilderMachineId] = useState('');
  const [builderDateFrom, setBuilderDateFrom] = useState('');
  const [builderDateTo, setBuilderDateTo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [scheduleType, setScheduleType] = useState<ReportType>('machine_history');
  const [scheduleFormat, setScheduleFormat] = useState<ReportFormat>('pdf');
  const [scheduleFrequency, setScheduleFrequency] = useState<ScheduleFrequency>('weekly');
  const [scheduleMachineId, setScheduleMachineId] = useState('');
  const [scheduleRangeDays, setScheduleRangeDays] = useState('30');
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    window.setTimeout(() => setNotification(null), 5000);
  }

  const loadMachines = useCallback(async () => {
    try {
      const response = await apiService.getMachines({ limit: 500 });
      setMachines(extractMachineList(response.data));
    } catch {
      // Non-fatal — the machine picker just stays empty; the rest of the
      // page (types without a machine scope) remains fully usable.
    }
  }, []);

  const loadTypes = useCallback(async () => {
    try {
      const response = await apiService.getReportTypes();
      const types = Array.isArray(response.data) ? (response.data as ReportType[]) : ALL_REPORT_TYPES;
      setAvailableTypes(types);
      setBuilderType((current) => (types.length > 0 && !types.includes(current) ? types[0] : current));
      setScheduleType((current) => (types.length > 0 && !types.includes(current) ? types[0] : current));
    } catch {
      setAvailableTypes(ALL_REPORT_TYPES);
    }
  }, []);

  const reportsFetcher = useCallback(
    async (query: ServerTableQuery<ReportsFilters>, signal: AbortSignal) => {
      const params = {
        page: query.page,
        limit: query.limit,
        sort: query.sort,
        type: query.filters.type || undefined,
        status: query.filters.status || undefined,
      };
      const response =
        query.filters.scope === 'mine'
          ? await apiService.getReports(params, { signal })
          : await apiService.getAllReports(params, { signal });
      return {
        items: response.data.items ?? [],
        page: response.data.page ?? query.page,
        limit: response.data.limit ?? query.limit,
        totalItems: response.data.totalItems ?? 0,
        totalPages: response.data.totalPages ?? 1,
      };
    },
    [],
  );

  const reportsTable = useServerTable<GeneratedReport, ReportsFilters>({
    fetcher: reportsFetcher,
    initialFilters: { scope: 'all', type: '', status: '' },
    pageSize: 20,
  });

  const loadSchedules = useCallback(async () => {
    try {
      const response = await apiService.getReportSchedules();
      setSchedules(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, t('notifications.scheduleLoadFailed')));
    } finally {
      setSchedulesLoading(false);
    }
  }, [t]);

  const loadSavedViews = useCallback(async () => {
    try {
      const response = await apiService.getSavedViews('reports');
      setSavedViews(Array.isArray(response.data) ? response.data : []);
    } catch {
      // Non-fatal — the saved-views bar just stays empty.
    }
  }, []);

  useEffect(() => {
    void loadMachines();
    void loadTypes();
    void loadSchedules();
    void loadSavedViews();
  }, [loadMachines, loadTypes, loadSchedules, loadSavedViews]);

  // Report generation is async on the backend (pending -> processing ->
  // completed/failed) — poll while anything on the *current page* is
  // still in flight, and stop as soon as nothing is, instead of polling
  // forever. Now that the list is genuinely paginated, this only ever
  // reflects the page currently on screen, same as the rest of the table.
  useEffect(() => {
    const hasInFlight = reportsTable.items.some((r) => r.status === 'pending' || r.status === 'processing');
    if (!hasInFlight) return;
    const interval = window.setInterval(() => {
      void reportsTable.reload();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
    // reportsTable is intentionally decomposed here so polling follows the current page rows and stable reload callback only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsTable.items, reportsTable.reload]);

  const showMachineField = MACHINE_SCOPED_TYPES.has(builderType);
  const machineRequired = MACHINE_REQUIRED_TYPES.has(builderType);
  const showScheduleMachineField = MACHINE_SCOPED_TYPES.has(scheduleType);
  const scheduleMachineRequired = MACHINE_REQUIRED_TYPES.has(scheduleType);

  async function handleSubmitReport() {
    if (machineRequired && !builderMachineId) {
      showNotification('error', t('notifications.machineRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const parameters: Record<string, unknown> = {};
      if (builderMachineId) parameters.machineId = builderMachineId;
      if (builderDateFrom) parameters.dateFrom = new Date(builderDateFrom).toISOString();
      if (builderDateTo) parameters.dateTo = new Date(builderDateTo).toISOString();

      await apiService.requestReport({ type: builderType, format: builderFormat, parameters });
      showNotification('success', t('notifications.requested'));
      await reportsTable.reload();
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, t('notifications.requestFailed')));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload(report: GeneratedReport) {
    try {
      const response = await apiService.downloadReportFile(report._id);
      const blobUrl = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${report.report_id}.${FORMAT_EXTENSIONS[report.format]}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, t('notifications.downloadFailed')));
    }
  }

  async function handleDeleteReport(report: GeneratedReport) {
    if (!confirm(t('notifications.confirmDelete'))) return;
    try {
      await apiService.deleteReport(report._id);
      await reportsTable.reload();
      showNotification('success', t('notifications.deleted'));
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, t('notifications.deleteFailed')));
    }
  }

  async function handleCreateSchedule() {
    if (scheduleMachineRequired && !scheduleMachineId) {
      showNotification('error', t('notifications.machineRequired'));
      return;
    }
    setScheduleSubmitting(true);
    try {
      const parameters: Record<string, unknown> = {};
      if (scheduleMachineId) parameters.machineId = scheduleMachineId;
      const rangeDays = Number(scheduleRangeDays);
      if (Number.isFinite(rangeDays) && rangeDays > 0) parameters.relativeRangeDays = rangeDays;

      await apiService.createReportSchedule({
        type: scheduleType,
        format: scheduleFormat,
        frequency: scheduleFrequency,
        parameters,
      });
      showNotification('success', t('notifications.scheduleCreated'));
      await loadSchedules();
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, t('notifications.scheduleCreateFailed')));
    } finally {
      setScheduleSubmitting(false);
    }
  }

  async function handleToggleSchedule(schedule: ScheduledReport) {
    try {
      const updated = await apiService.updateReportSchedule(schedule._id, { active: !schedule.active });
      setSchedules((prev) => prev.map((s) => (s._id === schedule._id ? updated.data : s)));
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, t('notifications.scheduleUpdateFailed')));
    }
  }

  async function handleDeleteSchedule(schedule: ScheduledReport) {
    if (!confirm(t('notifications.confirmScheduleDelete'))) return;
    try {
      await apiService.deleteReportSchedule(schedule._id);
      setSchedules((prev) => prev.filter((s) => s._id !== schedule._id));
      showNotification('success', t('notifications.scheduleDeleted'));
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, t('notifications.scheduleDeleteFailed')));
    }
  }

  function applySavedView(view: SavedView) {
    const query = view.query as SavedReportsQuery;
    setActiveSavedViewId(view._id);
    reportsTable.setFilters({
      scope: query.scope ?? 'all',
      type: query.type ?? '',
      status: query.status ?? '',
    });
    reportsTable.setSort(query.sort);
    reportsTable.setPage(1);
  }

  async function saveCurrentView(name: string) {
    try {
      const query: SavedReportsQuery = {
        scope: reportsTable.filters.scope,
        type: reportsTable.filters.type || undefined,
        status: reportsTable.filters.status || undefined,
        sort: reportsTable.sort,
      };
      const response = await apiService.createSavedView({ pageKey: 'reports', name, query });
      setSavedViews((prev) => [response.data, ...prev]);
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tCommon('savedViews.save')));
    }
  }

  async function deleteSavedView(view: SavedView) {
    try {
      await apiService.deleteSavedView(view._id);
      setSavedViews((prev) => prev.filter((v) => v._id !== view._id));
      if (activeSavedViewId === view._id) setActiveSavedViewId(null);
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tCommon('savedViews.delete')));
    }
  }

  // Summarizes only the currently visible page — the list is now
  // genuinely server-paginated (rather than silently capped at a fixed
  // sample), so a fleet-wide summary would require its own aggregate
  // endpoint rather than reusing paginated rows the page already fetched.
  const reportsByType: ChartDatum[] = useMemo(() => {
    const counts = new Map<ReportType, number>();
    for (const report of reportsTable.items) counts.set(report.type, (counts.get(report.type) ?? 0) + 1);
    return [...counts.entries()]
      .map(([type, value]) => ({ label: t(`types.${type}`), value }))
      .sort((a, b) => b.value - a.value);
  }, [reportsTable.items, t]);

  const reportsByStatus: ChartDatum[] = useMemo(() => {
    const counts = new Map<ReportStatus, number>();
    for (const report of reportsTable.items) counts.set(report.status, (counts.get(report.status) ?? 0) + 1);
    return (['pending', 'processing', 'completed', 'failed'] as ReportStatus[])
      .filter((status) => counts.has(status))
      .map((status) => ({ label: t(`status.${status}`), value: counts.get(status) ?? 0 }));
  }, [reportsTable.items, t]);

  // Sortable columns are restricted to REPORTS_SORT_ALLOWED_FIELDS on the
  // backend (backend/src/reports/reports.service.ts) — type/status/createdAt.
  const reportColumns: DataTableColumn<GeneratedReport>[] = useMemo(
    () => [
      { key: 'type', header: t('history.table.type'), sortable: true, width: '10rem', render: (report) => t(`types.${report.type}`) },
      { key: 'format', header: t('history.table.format'), width: '6rem', render: (report) => t(`formats.${report.format}`) },
      {
        key: 'status',
        header: t('history.table.status'),
        sortable: true,
        width: '8rem',
        render: (report) => (
          <StatusBadge
            label={t(`status.${report.status}`)}
            colorClassName={STATUS_BADGE_CLASSES[report.status]}
            title={report.status === 'failed' ? report.error_message : undefined}
          />
        ),
      },
      { key: 'row_count', header: t('history.table.rows'), width: '5rem', render: (report) => report.row_count ?? '-' },
      {
        key: 'createdAt',
        header: t('history.table.requested'),
        sortable: true,
        width: '10rem',
        render: (report) => (report.createdAt ? new Date(report.createdAt).toLocaleString() : '-'),
      },
      {
        key: 'actions',
        header: t('history.table.actions'),
        align: 'end',
        width: '6rem',
        render: (report) => (
          <div className="flex justify-end gap-2">
            {report.status === 'completed' && (
              <button type="button"
                onClick={() => void handleDownload(report)}
                title={t('history.download')}
                aria-label={`${t('history.download')} ${report.report_id}`}
              >
                <ArrowDownTrayIcon className="w-4 h-4 text-blue-600" />
              </button>
            )}
            <button type="button"
              onClick={() => void handleDeleteReport(report)}
              title={tCommon('delete')}
              aria-label={`${tCommon('delete')} ${report.report_id}`}
            >
              <TrashIcon className="w-4 h-4 text-red-500" />
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tCommon],
  );

  function renderScheduleRows() {
    if (schedulesLoading) {
      return (
        <tr>
          <td colSpan={6} className="text-center py-6 text-gray-500">
            {tCommon('loading')}
          </td>
        </tr>
      );
    }

    if (schedules.length === 0) {
      return (
        <tr>
          <td colSpan={6} className="text-center py-6 text-gray-500">
            {t('schedules.empty')}
          </td>
        </tr>
      );
    }

    return schedules.map((schedule) => (
      <tr key={schedule._id}>
        <td>{t(`types.${schedule.type}`)}</td>
        <td>{t(`formats.${schedule.format}`)}</td>
        <td>{t(`frequencies.${schedule.frequency}`)}</td>
        <td>{schedule.next_run_at ? new Date(schedule.next_run_at).toLocaleString() : '-'}</td>
        <td>
          <button
            type="button"
            onClick={() => void handleToggleSchedule(schedule)}
            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
              schedule.active
                ? 'bg-green-100 text-green-800 border-green-200'
                : 'bg-slate-100 text-slate-700 border-slate-200'
            }`}
          >
            {schedule.active ? t('schedules.activeLabel') : t('schedules.pausedLabel')}
          </button>
        </td>
        <td>
          <button
            type="button"
            onClick={() => void handleDeleteSchedule(schedule)}
            title={tCommon('delete')}
            aria-label={`${tCommon('delete')} ${schedule.schedule_id}`}
          >
            <TrashIcon className="w-4 h-4 text-red-500" />
          </button>
        </td>
      </tr>
    ));
  }

  return (
    <DashboardLayout title={t('pageTitle')}>
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${
            notification.type === 'success'
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
            aria-label={tCommon('dismiss')}
            style={{ minWidth: 24, minHeight: 24 }}
            className="ml-2 flex items-center justify-center text-gray-500 hover:text-gray-700"
            title={tCommon('close')}
          >
            x
          </button>
        </div>
      )}

      <div className="panel mb-4">
        <h2 className="text-xl font-bold">{t('heading')}</h2>
        <p className="text-gray-500 text-sm">{t('description')}</p>
      </div>

      {/* Report builder */}
      <div className="panel mb-4">
        <h3 className="card-title mb-3">{t('builder.title')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="builder-type">
              {t('builder.type')}
            </label>
            <select
              id="builder-type"
              className="input-field"
              value={builderType}
              onChange={(e) => setBuilderType(e.target.value as ReportType)}
            >
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="builder-format">
              {t('builder.format')}
            </label>
            <select
              id="builder-format"
              className="input-field"
              value={builderFormat}
              onChange={(e) => setBuilderFormat(e.target.value as ReportFormat)}
            >
              <option value="pdf">{t('formats.pdf')}</option>
              <option value="excel">{t('formats.excel')}</option>
              <option value="csv">{t('formats.csv')}</option>
            </select>
          </div>

          {showMachineField && (
            <div>
              <label className="block text-xs font-medium mb-1" htmlFor="builder-machine">
                {t('builder.machine')}
                {machineRequired ? ' *' : ''}
              </label>
              <select
                id="builder-machine"
                className="input-field"
                value={builderMachineId}
                onChange={(e) => setBuilderMachineId(e.target.value)}
              >
                <option value="">{t('builder.allAccessibleMachines')}</option>
                {machines.map((machine) => (
                  <option key={machine._id} value={machine._id}>
                    {machineLabel(machine)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="builder-date-from">
              {t('builder.dateFrom')}
            </label>
            <input
              id="builder-date-from"
              type="date"
              className="input-field"
              value={builderDateFrom}
              onChange={(e) => setBuilderDateFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="builder-date-to">
              {t('builder.dateTo')}
            </label>
            <input
              id="builder-date-to"
              type="date"
              className="input-field"
              value={builderDateTo}
              onChange={(e) => setBuilderDateTo(e.target.value)}
            />
          </div>
        </div>

        <button type="button"
          onClick={() => void handleSubmitReport()}
          disabled={submitting}
          className="btn-primary flex items-center gap-2 mt-4"
        >
          <PlusIcon className="w-4 h-4" />
          {submitting ? t('builder.generating') : t('builder.generate')}
        </button>
      </div>

      {/* Reusable summary charts, computed from the currently visible reports list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <BarChartCard title={t('charts.byType')} data={reportsByType} emptyLabel={t('empty.default')} />
        <BarChartCard
          title={t('charts.byStatus')}
          data={reportsByStatus}
          color="var(--secondary)"
          emptyLabel={t('empty.default')}
        />
      </div>

      {/* Generated reports history */}
      <div className="panel mb-4">
        <div className="flex flex-wrap justify-between items-center mb-3 gap-3">
          <h3 className="card-title">{t('history.title')}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input-field"
              value={reportsTable.filters.scope}
              onChange={(e) => { reportsTable.setFilters({ ...reportsTable.filters, scope: e.target.value as 'mine' | 'all' }); reportsTable.setPage(1); }}
              title={t('history.scope')}
              aria-label={t('history.scope')}
            >
              <option value="all">{t('history.scopeAll')}</option>
              <option value="mine">{t('history.scopeMine')}</option>
            </select>
            <select
              className="input-field"
              value={reportsTable.filters.status}
              onChange={(e) => { reportsTable.setFilters({ ...reportsTable.filters, status: e.target.value }); reportsTable.setPage(1); }}
              aria-label={t('history.table.status')}
            >
              <option value="">{t('history.table.status')}</option>
              <option value="pending">{t('status.pending')}</option>
              <option value="processing">{t('status.processing')}</option>
              <option value="completed">{t('status.completed')}</option>
              <option value="failed">{t('status.failed')}</option>
            </select>
            <select
              className="input-field"
              value={reportsTable.filters.type}
              onChange={(e) => { reportsTable.setFilters({ ...reportsTable.filters, type: e.target.value }); reportsTable.setPage(1); }}
              aria-label={t('builder.type')}
            >
              <option value="">{t('builder.type')}</option>
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
            <button type="button"
              onClick={() => void reportsTable.reload()}
              className="btn-secondary flex items-center gap-2"
              title={t('history.refresh')}
              aria-label={t('history.refresh')}
            >
              <ArrowPathIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mb-4">
          <SavedViewsBar
            views={savedViews}
            activeViewId={activeSavedViewId}
            onApply={applySavedView}
            onSaveCurrent={(name) => void saveCurrentView(name)}
            onDelete={(view) => void deleteSavedView(view)}
            saveLabel={tCommon('savedViews.save')}
            namePlaceholder={tCommon('savedViews.namePlaceholder')}
            emptyLabel={tCommon('savedViews.empty')}
            deleteLabel={tCommon('savedViews.delete')}
          />
        </div>

        <VirtualizedDataTable
          columns={reportColumns}
          rows={reportsTable.items}
          rowKey={(report) => report._id}
          loading={reportsTable.loading}
          error={reportsTable.error}
          onRetry={reportsTable.reload}
          emptyMessage={t('empty.default')}
          loadingLabel={tCommon('loading')}
          errorRetryLabel={tCommon('retry')}
          sortField={reportsTable.sortField}
          sortDirection={reportsTable.sortDirection}
          onSortChange={reportsTable.toggleSort}
          ariaLabel={t('history.title')}
        />

        <div className="mt-4">
          <Pagination
            page={reportsTable.page}
            totalPages={reportsTable.totalPages}
            totalItems={reportsTable.totalItems}
            limit={reportsTable.limit}
            onPageChange={reportsTable.setPage}
          />
        </div>
      </div>

      {/* Scheduled reports */}
      <div className="panel">
        <h3 className="card-title mb-3">{t('schedules.title')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="schedule-type">
              {t('builder.type')}
            </label>
            <select
              id="schedule-type"
              className="input-field"
              value={scheduleType}
              onChange={(e) => setScheduleType(e.target.value as ReportType)}
            >
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="schedule-format">
              {t('builder.format')}
            </label>
            <select
              id="schedule-format"
              className="input-field"
              value={scheduleFormat}
              onChange={(e) => setScheduleFormat(e.target.value as ReportFormat)}
            >
              <option value="pdf">{t('formats.pdf')}</option>
              <option value="excel">{t('formats.excel')}</option>
              <option value="csv">{t('formats.csv')}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="schedule-frequency">
              {t('schedules.frequency')}
            </label>
            <select
              id="schedule-frequency"
              className="input-field"
              value={scheduleFrequency}
              onChange={(e) => setScheduleFrequency(e.target.value as ScheduleFrequency)}
            >
              <option value="daily">{t('frequencies.daily')}</option>
              <option value="weekly">{t('frequencies.weekly')}</option>
              <option value="monthly">{t('frequencies.monthly')}</option>
            </select>
          </div>

          {showScheduleMachineField && (
            <div>
              <label className="block text-xs font-medium mb-1" htmlFor="schedule-machine">
                {t('builder.machine')}
                {scheduleMachineRequired ? ' *' : ''}
              </label>
              <select
                id="schedule-machine"
                className="input-field"
                value={scheduleMachineId}
                onChange={(e) => setScheduleMachineId(e.target.value)}
              >
                <option value="">{t('builder.allAccessibleMachines')}</option>
                {machines.map((machine) => (
                  <option key={machine._id} value={machine._id}>
                    {machineLabel(machine)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="schedule-range-days">
              {t('schedules.rangeDays')}
            </label>
            <input
              id="schedule-range-days"
              type="number"
              min={1}
              className="input-field"
              value={scheduleRangeDays}
              onChange={(e) => setScheduleRangeDays(e.target.value)}
            />
          </div>
        </div>

        <button type="button"
          onClick={() => void handleCreateSchedule()}
          disabled={scheduleSubmitting}
          className="btn-primary flex items-center gap-2 mt-4"
        >
          <ClockIcon className="w-4 h-4" />
          {scheduleSubmitting ? t('schedules.creating') : t('schedules.create')}
        </button>

        <div className="overflow-x-auto mt-4">
          <table className="table">
            <thead>
              <tr>
                <th>{t('history.table.type')}</th>
                <th>{t('history.table.format')}</th>
                <th>{t('schedules.frequency')}</th>
                <th>{t('schedules.nextRun')}</th>
                <th>{t('schedules.active')}</th>
                <th>{t('history.table.actions')}</th>
              </tr>
            </thead>
            <tbody>{renderScheduleRows()}</tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
