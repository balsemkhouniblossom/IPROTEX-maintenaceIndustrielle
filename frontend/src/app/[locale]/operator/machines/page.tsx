"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter, useParams } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";
import {
    CogIcon,
    MapPinIcon,
    CalendarIcon,
    WrenchScrewdriverIcon,
    ClockIcon,
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
                                    <h3 className="text-lg font-bold text-gray-900">
                                        {machine.machine_id}
                                    </h3>

                                  
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
                                    onClick={() =>
                                        router.push(`/${locale}/operator/manuals?machine=${machine._id}`)
                                    }
                                    className="flex-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg px-3 py-2 text-sm font-medium"
                                >
                                    {tOperator("openManual")}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
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
