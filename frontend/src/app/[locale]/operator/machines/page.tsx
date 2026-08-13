"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter, useParams } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import DocumentAttachmentViewer from "@/components/DocumentAttachmentViewer";
import { Modal } from "@/components/Modal";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";
import { sortMachineDocumentsForMachine } from "@/services/machineManuals";
import {
    CogIcon,
    MapPinIcon,
    CalendarIcon,
    WrenchScrewdriverIcon,
    ClockIcon,
    DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import LiveStatusBadge from "@/components/device-monitoring/LiveStatusBadge";
import MachineHealthBadge from "@/components/predictive-maintenance/MachineHealthBadge";
import { useLiveMonitoring } from "@/hooks/useLiveMonitoring";
import { usePredictiveHealth } from "@/hooks/usePredictiveHealth";

interface Machine {
    _id: string;
    machine_id: string;
    serial_no: string;
    type_id: string;
    status: string;
    installation_date: string;
    fabricant: string;
    model: string;
    location: string;
    poids_kg: number;
}

interface MachineType {
    _id: string;
    name: string;
}

interface DocumentEntity {
    _id: string;
    machine_id: string | { _id?: string; id?: string };
    type_document?: string;
    file_name: string;
    file_path: string;
    file_url?: string;
    preview_path?: string;
    description?: string;
    tags?: string[];
    status?: string;
    date_ajout?: string;
}

const normalizeMachineTypeId = (machine: { type_id?: unknown }) =>
    typeof machine.type_id === "object" && machine.type_id !== null && "_id" in machine.type_id
        ? String((machine.type_id as { _id?: unknown })._id ?? "")
        : String(machine.type_id ?? "");

function OperatorMachinesPageContent() {
    const router = useRouter();
    const params = useParams<{ locale?: string }>();
    const searchParams = useSearchParams();
    const tMachines = useTranslations("operatorMachines");
    const tOperator = useTranslations("dashboard.operator");
    const tCommon = useTranslations("common");
    const { statusByMachine, subscribeToMachine } = useLiveMonitoring();
    const { healthByMachine } = usePredictiveHealth();

    const [machines, setMachines] = useState<Machine[]>([]);
    const [category, setCategory] = useState<MachineType | null>(null);
    const [loading, setLoading] = useState(true);
    const [manualsByMachine, setManualsByMachine] = useState<Record<string, DocumentEntity[]>>({});
    const [loadingManualMachineId, setLoadingManualMachineId] = useState<string | null>(null);
    const [previewManual, setPreviewManual] = useState<DocumentEntity | null>(null);
    const [, setPreviewManualQueue] = useState<DocumentEntity[]>([]);
    const [notification, setNotification] = useState<{ type: "error"; message: string } | null>(null);
    const locale = params?.locale ?? "en";

    const typeId = searchParams.get("type");

    const loadData = useCallback(async () => {
        try {
            setLoading(true);

            const [machinesRes, typesRes] = await Promise.all([
                fetchAllPaginated<any>((pagination) => apiService.getMyMachines(pagination)),
                fetchAllPaginated<MachineType>((pagination) => apiService.getOperatorMachineTypes(pagination)),
            ]);

            const machineItems = machinesRes;
            const typeItems = typesRes;

            const normalizedMachines = machineItems.map((m: any) => ({
                ...m,
                type_id: normalizeMachineTypeId(m),
            }));

            const filteredMachines = typeId
                ? normalizedMachines.filter(
                    (m: any) => String(m.type_id ?? "") === String(typeId ?? "")
                )
                : normalizedMachines;

            const selectedCategory = typeItems.find(
                (t: MachineType) => String(t._id) === String(typeId)
            );

            setCategory(selectedCategory || null);
            setMachines(filteredMachines);
        } catch (error) {
            console.error("Error loading machines:", error);
        } finally {
            setLoading(false);
        }
    }, [typeId]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    function showError(message: string) {
        setNotification({ type: "error", message });
        window.setTimeout(() => setNotification(null), 5000);
    }

    function isNotFoundError(error: unknown): boolean {
        return (
            typeof error === "object" &&
            error !== null &&
            "response" in error &&
            typeof error.response === "object" &&
            error.response !== null &&
            "status" in error.response &&
            error.response.status === 404
        );
    }

    function openManualQueue(manuals: DocumentEntity[]) {
        setPreviewManualQueue(manuals);
        setPreviewManual(manuals[0] ?? null);
    }

    function handleManualLoadError() {
        setPreviewManualQueue((queue) => {
            const currentIndex = previewManual ? queue.findIndex((doc) => doc._id === previewManual._id) : -1;
            const next = queue[currentIndex + 1];
            if (next) {
                setPreviewManual(next);
            } else {
                setPreviewManual(null);
                showError("No available document for this machine.");
            }
            return queue;
        });
    }

    async function handleOpenManual(machine: Machine) {
        const cachedManuals = manualsByMachine[machine._id];
        if (cachedManuals) {
            if (cachedManuals[0]) {
                openManualQueue(cachedManuals);
            } else {
                showError("No available document for this machine.");
            }
            return;
        }

        setLoadingManualMachineId(machine._id);
        try {
            const response = await apiService.getDocumentsByMachine(machine._id);
            const manuals = sortMachineDocumentsForMachine(machine._id, Array.isArray(response.data) ? response.data : []);
            setManualsByMachine((current) => ({ ...current, [machine._id]: manuals }));
            if (manuals[0]) {
                openManualQueue(manuals);
            } else {
                showError("No available document for this machine.");
            }
        } catch (error) {
            if (isNotFoundError(error)) {
                showError("No available document for this machine.");
            } else {
                console.error("Error opening machine manual:", error);
                showError(tOperator("manualOpenFailed", { default: "Could not open the machine manual" }));
            }
        } finally {
            setLoadingManualMachineId(null);
        }
    }

    if (loading) {
        return (
            <DashboardLayout title={tMachines("pageTitle")}>
                <div className="operator-dashboard-theme flex justify-center items-center h-100">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600"></div>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <ProtectedRoute>
            <DashboardLayout
                title={category?.name || tMachines("pageTitle")}
            >
                {notification ? (
                    <div className="fixed top-4 right-4 z-50 rounded-lg border border-red-200 bg-red-100 p-4 text-red-800 shadow-lg">
                        {notification.message}
                    </div>
                ) : null}
                <div className="operator-dashboard-theme bento-grid">

                    {/* Header */}
                    <div className="col-span-full panel">
                        <h2 className="text-2xl font-bold">
                            {category?.name || tMachines("allMachines")}
                        </h2>

                        <p className="text-gray-500 mt-2">
                            {category
                                ? tMachines("categoryDescription")
                                : tMachines("allMachinesDescription")}
                        </p>

                        <div className="mt-3 text-blue-600 font-medium">
                            {tMachines("machineCount", { count: machines.length })}
                        </div>
                    </div>

                    
                    {/* No Machines */}
                    {machines.length === 0 && (
                        <div className="col-span-full panel">
                            <div className="text-center py-10">
                                {tMachines("noMachinesFound")}
                            </div>
                        </div>
                    )}

                    {machines.map((machine) => (
                        <div
                            key={machine._id}
                            className="panel hover:shadow-xl transition-all duration-200 border border-gray-100 rounded-xl"
                        >
                            {/* HEADER */}
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <button
                                        type="button"
                                        onClick={() => handleOpenManual(machine)}
                                        disabled={loadingManualMachineId === machine._id}
                                        className="inline-flex max-w-full items-center gap-1.5 text-left text-lg font-bold text-blue-700 hover:text-blue-900 disabled:cursor-wait disabled:text-slate-400"
                                        aria-label={tOperator("openManual")}
                                        title={tOperator("openManual")}
                                    >
                                        <DocumentTextIcon className="h-4 w-4 shrink-0" />
                                        <span className="truncate">{machine.machine_id}</span>
                                    </button>

                                  
                                </div>

                                <div className="flex flex-col items-end gap-2">
                                    <CogIcon className="w-7 h-7 text-blue-600" />

                                    <span
                                        className={`text-xs px-3 py-1 rounded-full font-medium ${machine.status === "operational"
                                            ? "bg-green-100 text-green-700"
                                            : machine.status === "maintenance"
                                                ? "bg-yellow-100 text-yellow-700"
                                                : "bg-red-100 text-red-700"
                                            }`}
                                    >
                                        {tMachines(`status.${machine.status}`)}
                                    </span>
                                </div>
                            </div>

                            <div className="mb-3">
                                <LiveStatusBadge
                                    machineId={machine._id}
                                    status={statusByMachine[machine._id]}
                                    onSubscribe={subscribeToMachine}
                                />
                            </div>
                            <div className="mb-3">
                                <MachineHealthBadge status={healthByMachine[machine._id]} />
                            </div>

                            {/* INFO GRID (clean structured layout) */}
                            <div className="grid grid-cols-2 gap-y-3 text-sm text-gray-700">
                                
                                <div>
                                    <p className="text-xs text-gray-400">{tMachines("manufacturer")}</p>
                                    <p className="font-medium">{machine.fabricant}</p>
                                </div>

                                <div className="flex items-center gap-2 col-span-2">
                                    <MapPinIcon className="w-4 h-4 text-gray-400" />
                                    <span>{machine.location || tCommon("notAvailable")}</span>
                                </div>

                                <div className="flex items-center gap-2 col-span-2">
                                    <CalendarIcon className="w-4 h-4 text-gray-400" />
                                    <span>
                                        {machine.installation_date
                                            ? new Date(machine.installation_date).getFullYear()
                                            : tCommon("notAvailable")}
                                    </span>
                                </div>
                            </div>

                            {/* FOOTER ACTIONS */}
                            <div className="mt-5 grid gap-2 md:grid-cols-4">
                                <button
                                    onClick={() => router.push(`/${locale}/machines/${machine._id}`)}
                                    className="flex-1 bg-slate-700 hover:bg-slate-800 text-white rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <ClockIcon className="w-4 h-4" />
                                    {tMachines("timeline", { default: "Timeline" })}
                                </button>

                                <button
                                    onClick={() =>
                                        router.push(
                                            `/${locale}/operator/corrective?machine=${machine._id}&intent=report-issue`
                                        )
                                    }
                                    className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-2 text-sm font-medium"
                                >
                                    {tMachines("reportIssue")}
                                </button>

                                <button
                                    onClick={() =>
                                        router.push(`/${locale}/operator/corrective?machine=${machine._id}&view=history#machine-history`)
                                    }
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <WrenchScrewdriverIcon className="w-4 h-4" />
                                    {tMachines("details")}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleOpenManual(machine)}
                                    disabled={loadingManualMachineId === machine._id}
                                    className="flex-1 bg-slate-900 hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-500 text-white rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <DocumentTextIcon className="w-4 h-4" />
                                    {tOperator("openManual")}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                <Modal
                    isOpen={Boolean(previewManual)}
                    onClose={() => {
                        setPreviewManual(null);
                        setPreviewManualQueue([]);
                    }}
                    title={previewManual?.file_name || tOperator("openManual")}
                    size="xl"
                >
                    {previewManual ? (
                        <div className="operator-dashboard-theme">
                            <DocumentAttachmentViewer
                                document={previewManual}
                                title={previewManual.file_name}
                                onError={handleManualLoadError}
                            />
                        </div>
                    ) : null}
                </Modal>
            </DashboardLayout>
        </ProtectedRoute>
    );
}

export default function OperatorMachinesPage() {
    return (
        <Suspense fallback={<div className="operator-dashboard-theme min-h-screen bg-white" />}>
            <OperatorMachinesPageContent />
        </Suspense>
    );
}
