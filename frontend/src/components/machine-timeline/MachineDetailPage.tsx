'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  BookOpenIcon,
  ChartBarIcon,
  ClipboardDocumentListIcon,
  CpuChipIcon,
  DocumentTextIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import DashboardLayout from '@/components/DashboardLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { Modal } from '@/components/Modal';
import DocumentAttachmentViewer from '@/components/DocumentAttachmentViewer';
import LiveStatusBadge from '@/components/device-monitoring/LiveStatusBadge';
import MachineHealthBadge from '@/components/predictive-maintenance/MachineHealthBadge';
import { useAuth } from '@/contexts/AuthContext';
import { useLiveMonitoring } from '@/hooks/useLiveMonitoring';
import { usePredictiveHealth } from '@/hooks/usePredictiveHealth';
import { apiService } from '@/services/api';
import MachineHeader from './MachineHeader';
import MachineStatsCards from './MachineStatsCards';
import MachineTimelineFeed from './MachineTimelineFeed';
import type { MachineTimelineSummary } from './types';

type MachineTab = 'overview' | 'components' | 'maintenance' | 'monitoring' | 'documents' | 'history';
type WorkOrderRecord = Record<string, unknown>;
type TechnicianMachineContext = {
  machine: {
    _id: string;
    machine_id: string;
    serial_no?: string;
    reference?: string;
    type_id?: string | { _id: string; name: string };
    fabricant?: string;
    model?: string;
    location?: string;
    status: string;
    installation_date?: string;
    createdAt?: string;
  };
  summary: {
    stats: MachineTimelineSummary['stats'];
  };
  components: Array<{
    _id: string;
    module_id: string;
    localisation?: string;
    type?: { name?: string };
    parent_module_id?: string | null;
    sensors: Array<{
      _id: string;
      capteur_id: string;
      code_capteur: string;
      type_capteur: string;
      unite_mesure?: string;
      is_active: boolean;
      last_seen_at?: string;
      latestMeasurement?: {
        valeur: number;
        timestamp: string;
        status: string;
      } | null;
    }>;
  }>;
  openWork: WorkOrderRecord[];
  upcomingPreventive: WorkOrderRecord[];
  recentMaintenance: WorkOrderRecord[];
  documents: WorkOrderRecord[];
};

type WorkspaceProps = Readonly<{
  machineId: string;
  summary: MachineTimelineSummary | null;
  context: TechnicianMachineContext | null;
  activeTab: MachineTab;
  setActiveTab: (tab: MachineTab) => void;
  locale: string;
  statusByMachine: Record<string, unknown>;
  subscribeToMachine: (machineId: string) => void;
  healthByMachine: Record<string, unknown>;
  setPreviewDocument: (document: WorkOrderRecord | null) => void;
}>;

export default function MachineDetailPage({ machineId }: Readonly<{ machineId: string }>) {
  const t = useTranslations('machineTimeline');
  const locale = useLocale();
  const { user, isLoading: authLoading } = useAuth();
  const { statusByMachine, subscribeToMachine } = useLiveMonitoring();
  const { healthByMachine } = usePredictiveHealth();
  const [summary, setSummary] = useState<MachineTimelineSummary | null>(null);
  const [context, setContext] = useState<TechnicianMachineContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<MachineTab>('overview');
  const [previewDocument, setPreviewDocument] = useState<WorkOrderRecord | null>(null);

  function buildTechnicianSummary(data: TechnicianMachineContext): MachineTimelineSummary {
    const type =
      data.machine.type_id && typeof data.machine.type_id === 'object'
        ? { id: data.machine.type_id._id, name: data.machine.type_id.name }
        : null;
    const installationTime = data.machine.installation_date
      ? new Date(data.machine.installation_date).getTime()
      : null;

    return {
      machine: {
        id: data.machine._id,
        machineId: data.machine.machine_id,
        serialNo: data.machine.serial_no ?? '',
        reference: data.machine.reference,
        type,
        fabricant: data.machine.fabricant,
        model: data.machine.model,
        location: data.machine.location,
        status: data.machine.status,
        installationDate: data.machine.installation_date,
        createdAt: data.machine.createdAt,
        ageDays:
          installationTime && Number.isFinite(installationTime)
            ? Math.max(0, Math.floor((Date.now() - installationTime) / 86400000))
            : null,
      },
      stats: data.summary.stats,
    };
  }

  const loadSummary = useCallback(
    async (signal?: AbortSignal) => {
      if (authLoading || !user?.role || user.role === 'technician') return;
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
    [authLoading, machineId, t, user?.role],
  );

  const loadTechnicianContext = useCallback(async () => {
    if (authLoading || user?.role !== 'technician') return;
    try {
      setLoading(true);
      setError('');
      const response = await apiService.getTechnicianMachineContext(machineId);
      const data = response.data as TechnicianMachineContext;
      setContext(data);
      setSummary(buildTechnicianSummary(data));
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || t('errors.loadSummary'));
      setContext(null);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [authLoading, machineId, t, user?.role]);

  useEffect(() => {
    if (authLoading || user?.role === 'technician') return;
    const controller = new AbortController();
    void loadSummary(controller.signal);
    return () => controller.abort();
  }, [authLoading, loadSummary, user?.role]);

  useEffect(() => {
    void loadTechnicianContext();
  }, [loadTechnicianContext]);

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
          {user?.role === 'technician' ? (
            <TechnicianMachineWorkspace
              machineId={machineId}
              summary={summary}
              context={context}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              locale={locale}
              statusByMachine={statusByMachine}
              subscribeToMachine={subscribeToMachine}
              healthByMachine={healthByMachine}
              setPreviewDocument={setPreviewDocument}
            />
          ) : (
            <>
              <MachineStatsCards stats={summary?.stats} loading={loading} />
              <MachineTimelineFeed machineId={machineId} />
            </>
          )}
          <Modal
            isOpen={Boolean(previewDocument)}
            onClose={() => setPreviewDocument(null)}
            title={String(previewDocument?.file_name ?? t('actions.openDocument', { default: 'Open document' }))}
            size="xl"
          >
            {previewDocument ? (
              <DocumentAttachmentViewer document={previewDocument} title={previewDocument.file_name ? String(previewDocument.file_name) : undefined} />
            ) : null}
          </Modal>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function TabOverview({ summary, context, locale, healthByMachine, machineId }: Readonly<{
  summary: MachineTimelineSummary | null;
  context: TechnicianMachineContext | null;
  locale: string;
  healthByMachine: Record<string, unknown>;
  machineId: string;
}>) {
  const t = useTranslations('machineTimeline.technician');
  const tRoot = useTranslations('machineTimeline');
  const machine = summary?.machine;
  const health = healthByMachine[machineId];
  const attention = context?.openWork[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="panel">
        <h2 className="mb-4 text-lg font-semibold">{t('overview.machineStatus')}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">{t('overview.status')}</dt><dd className="font-semibold">{machine?.status ? tRoot.has(`status.${machine.status}`) ? tRoot(`status.${machine.status}`) : machine.status : tRoot('header.none')}</dd></div>
          <div><dt className="text-slate-500">{t('overview.health')}</dt><dd><MachineHealthBadge status={health} /></dd></div>
          <div><dt className="text-slate-500">{t('overview.openWorkOrders')}</dt><dd className="font-semibold">{summary?.stats.openWorkOrders ?? 0}</dd></div>
          <div><dt className="text-slate-500">{t('overview.lastMaintenance')}</dt><dd className="font-semibold">{summary?.stats.lastMaintenanceAt ? new Date(summary.stats.lastMaintenanceAt).toLocaleDateString(locale) : tRoot('header.none')}</dd></div>
          <div><dt className="text-slate-500">{t('overview.nextMaintenance')}</dt><dd className="font-semibold">{summary?.stats.nextMaintenanceAt ? new Date(summary.stats.nextMaintenanceAt).toLocaleDateString(locale) : tRoot('header.none')}</dd></div>
        </dl>
      </section>
      <section className="panel border border-amber-100 bg-amber-50">
        <h2 className="mb-4 text-lg font-semibold text-amber-950">{t('overview.currentAttention')}</h2>
        {attention ? (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-amber-950">{String(attention.description ?? attention.ot_id ?? '')}</p>
            <p className="text-amber-800">{t('overview.possibleComponent')}: {String((attention.module_id as Record<string, unknown>)?.module_id ?? tRoot('header.none'))}</p>
            <Link href={`/${locale}/technician/work-orders/${String(attention._id)}`} className="inline-flex rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white">
              {t('maintenance.openWorkOrder')}
            </Link>
          </div>
        ) : (
          <p className="text-sm text-amber-800">{t('overview.noAttention')}</p>
        )}
      </section>
    </div>
  );
}

function TabMaintenance({ context, locale }: Readonly<{ context: TechnicianMachineContext | null; locale: string }>) {
  const t = useTranslations('machineTimeline.technician');
  const tRoot = useTranslations('machineTimeline');
  return (
    <section className="panel space-y-6">
      <MachineSection title={t('maintenance.openWork')}>
        {context?.openWork.length ? context.openWork.map((workOrder) => (
          <div key={String(workOrder._id)} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-semibold">{String(workOrder.ot_id)}</p><p className="text-slate-500">{String(workOrder.type_maintenance)} / {String(workOrder.status)}</p></div>
              <Link href={`/${locale}/technician/work-orders/${String(workOrder._id)}`} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white">{t('maintenance.openWorkOrder')}</Link>
            </div>
          </div>
        )) : <p className="text-sm text-slate-500">{t('maintenance.noOpenWork')}</p>}
      </MachineSection>
      <MachineSection title={t('maintenance.upcomingPreventive')}>
        {context?.upcomingPreventive.length ? context.upcomingPreventive.map((plan) => (
          <div key={String(plan._id)} className="rounded-lg border p-3 text-sm"><p className="font-semibold">{String(plan.instruction ?? plan.maintenance_code ?? plan.plan_id)}</p><p className="text-slate-500">{String(plan.type_maintenance)}</p></div>
        )) : <p className="text-sm text-slate-500">{t('maintenance.noUpcoming')}</p>}
      </MachineSection>
      <MachineSection title={t('maintenance.recentMaintenance')}>
        {context?.recentMaintenance.length ? context.recentMaintenance.map((report) => (
          <div key={String(report._id)} className="rounded-lg border p-3 text-sm"><p className="font-semibold">{String(report.report_id)}</p><p className="text-slate-500">{report.date_fin ? new Date(String(report.date_fin)).toLocaleDateString(locale) : tRoot('header.none')}</p></div>
        )) : <p className="text-sm text-slate-500">{t('maintenance.noRecent')}</p>}
      </MachineSection>
    </section>
  );
}

function TechnicianMachineWorkspace({
  machineId,
  summary,
  context,
  activeTab,
  setActiveTab,
  locale,
  statusByMachine,
  subscribeToMachine,
  healthByMachine,
  setPreviewDocument,
}: WorkspaceProps) {
  const t = useTranslations('machineTimeline.technician');
  const tRoot = useTranslations('machineTimeline');
  const tabs: Array<{ key: MachineTab; label: string; Icon: typeof CpuChipIcon }> = [
    { key: 'overview', label: t('tabs.overview'), Icon: CpuChipIcon },
    { key: 'components', label: t('tabs.components'), Icon: CpuChipIcon },
    { key: 'maintenance', label: t('tabs.maintenance'), Icon: WrenchScrewdriverIcon },
    { key: 'monitoring', label: t('tabs.monitoring'), Icon: ChartBarIcon },
    { key: 'documents', label: t('tabs.documents'), Icon: DocumentTextIcon },
    { key: 'history', label: t('tabs.history'), Icon: ClipboardDocumentListIcon },
  ];

  return (
    <div className="space-y-5">
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${activeTab === key ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <TabOverview summary={summary} context={context} locale={locale} healthByMachine={healthByMachine} machineId={machineId} />
      ) : null}

      {activeTab === 'components' ? (
        <section className="panel">
          <h2 className="mb-4 text-lg font-semibold">{t('components.title')}</h2>
          {context?.components.length ? (
            <div className="space-y-3">
              {context.components.map((component) => (
                <div key={component._id} className="rounded-lg border border-slate-200 p-4">
                  <h3 className="font-semibold">{component.module_id}</h3>
                  <p className="text-sm text-slate-500">{t('components.type')}: {component.type?.name || tRoot('header.none')}</p>
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold uppercase text-slate-500">{t('components.sensors')}</p>
                    {component.sensors.length ? component.sensors.map((sensor) => (
                      <div key={sensor._id} className="flex justify-between gap-4 rounded-lg bg-slate-50 p-2 text-sm">
                        <span>{sensor.type_capteur || sensor.code_capteur}</span>
                        <span className={sensor.is_active ? 'text-emerald-700' : 'text-slate-500'}>{sensor.is_active ? t('monitoring.active') : t('monitoring.inactive')}</span>
                      </div>
                    )) : <p className="text-sm text-slate-500">{t('components.noSensors')}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('components.empty')}</p>
          )}
        </section>
      ) : null}

      {activeTab === 'maintenance' ? (
        <TabMaintenance context={context} locale={locale} />
      ) : null}

      {activeTab === 'monitoring' ? (
        <section className="panel">
          <h2 className="mb-4 text-lg font-semibold">{t('monitoring.title')}</h2>
          <div className="mb-4"><LiveStatusBadge machineId={machineId} status={statusByMachine[machineId]} onSubscribe={subscribeToMachine} /></div>
          {context?.components.some((component) => component.sensors.length) ? (
            <div className="grid gap-3 md:grid-cols-2">
              {context.components.flatMap((component) => component.sensors).map((sensor) => (
                <div key={sensor._id} className="rounded-lg border p-4 text-sm">
                  <div className="flex justify-between gap-4"><h3 className="font-semibold">{sensor.type_capteur}</h3><span className={sensor.is_active ? 'text-emerald-700' : 'text-slate-500'}>{sensor.is_active ? t('monitoring.active') : t('monitoring.inactive')}</span></div>
                  {sensor.latestMeasurement ? (
                    <dl className="mt-3 space-y-2">
                      <div className="flex justify-between"><dt className="text-slate-500">{t('monitoring.latestValue')}</dt><dd className="font-semibold">{sensor.latestMeasurement.valeur} {sensor.unite_mesure || ''}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">{t('monitoring.lastMeasurement')}</dt><dd>{new Date(sensor.latestMeasurement.timestamp).toLocaleString(locale)}</dd></div>
                    </dl>
                  ) : <p className="mt-3 text-slate-500">{t('monitoring.noMeasurements')}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('monitoring.noSensors')}</p>
          )}
        </section>
      ) : null}

      {activeTab === 'documents' ? (
        <section className="panel">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><BookOpenIcon className="h-5 w-5 text-blue-700" />{t('documents.title')}</h2>
          {context?.documents.length ? (
            <div className="flex flex-wrap gap-2">
              {context.documents.map((document) => (
                <button key={String(document._id)} type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold text-blue-700" onClick={() => setPreviewDocument(document)}>
                  {String(document.file_name)}
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-slate-500">{t('documents.empty')}</p>}
        </section>
      ) : null}

      {activeTab === 'history' ? <MachineTimelineFeed machineId={machineId} /> : null}
    </div>
  );
}

function MachineSection({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div>
      <h3 className="mb-3 border-b pb-2 text-sm font-bold uppercase text-slate-600">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
