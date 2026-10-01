"use client";

import { useCallback, useEffect, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { apiService } from "@/services/api";
import { extractApiErrorMessage } from "@/services/apiErrors";
import { fetchAllPaginated } from "@/services/pagination";
import {
  PlanFormModal,
  PlanFormData,
} from "../../maintenance-plans/components/PlanFormModal";
import { MaintenancePlan, ModuleEntity } from "../../maintenance-plans/types";
import {
  cleanInstruction,
  cleanResponsable,
} from "../../maintenance-plans/utils";

const INITIAL_FORM: PlanFormData = {
  plan_id: "",
  machineId: "",
  module_id: "",
  type_maintenance: "preventive",
  frequence: "1",
  unite_frequence: "semaine",
  maintenance_code: "",
  frequence_label: "",
  instruction: "",
  responsable: "",
  huile_graisse: "",
  documentation: "",
};

export default function OperatorMaintenancePlansPage() {
  const t = useTranslations("maintenancePlans");
  const tCommon = useTranslations("common");
  const [modules, setModules] = useState<ModuleEntity[]>([]);
  const [maintenancePlanTemplates, setMaintenancePlanTemplates] = useState<
    MaintenancePlan[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<PlanFormData>(INITIAL_FORM);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadModules = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [moduleItems, planItems] = await Promise.all([
        fetchAllPaginated<ModuleEntity>((params) =>
          apiService.getOperatorModules(params),
        ),
        fetchAllPaginated<MaintenancePlan>((params) =>
          apiService.getOperatorMaintenancePlans(params),
        ),
      ]);
      setModules(moduleItems);
      setMaintenancePlanTemplates(planItems);
    } catch (error) {
      console.error("Failed to load operator maintenance modules", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  function resetForm() {
    setFormData({ ...INITIAL_FORM });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!formData.machineId || !formData.module_id) return;

    setSubmitting(true);
    try {
      const selectedCodes = formData.maintenance_code
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean);
      const selectedTemplates = selectedCodes
        .map((maintenanceCode) => {
          const candidates = maintenancePlanTemplates.filter(
            (plan) => plan.maintenance_code === maintenanceCode,
          );
          return candidates.find((plan) => {
            const planModule =
              typeof plan.module_id === "string" ? undefined : plan.module_id;
            return planModule?._id === formData.module_id;
          });
        })
        .filter((plan): plan is MaintenancePlan => Boolean(plan));
      const primaryTemplate = selectedTemplates[0];
      const combinedInstruction = selectedCodes
        .map((maintenanceCode) => {
          const template = selectedTemplates.find(
            (plan) => plan.maintenance_code === maintenanceCode,
          );
          const instruction = cleanInstruction(
            template?.instruction || formData.instruction,
          );
          const instructionLines = instruction
            ?.split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          return instructionLines?.length
            ? instructionLines
                .map((line) => `${maintenanceCode}: ${line}`)
                .join("\n")
            : maintenanceCode;
        })
        .join("\n\n");
      const combineTemplateValues = (
        selector: (template: MaintenancePlan) => string | undefined,
      ) =>
        Array.from(
          new Set(
            selectedTemplates
              .map(selector)
              .map((value) => value?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
        ).join(", ");

      await apiService.createOperatorMaintenancePlan({
        plan_id: `OP-PM-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        module_id: formData.module_id,
        type_maintenance: "preventive",
        frequence: Number(primaryTemplate?.frequence ?? formData.frequence),
        unite_frequence:
          primaryTemplate?.unite_frequence || formData.unite_frequence.trim(),
        maintenance_code: selectedCodes.join(", ") || undefined,
        frequence_label:
          primaryTemplate?.frequence_label ||
          formData.frequence_label.trim() ||
          undefined,
        instruction:
          combinedInstruction ||
          cleanInstruction(formData.instruction) ||
          undefined,
        responsable:
          cleanResponsable(combineTemplateValues((plan) => plan.responsable)) ||
          cleanResponsable(formData.responsable) ||
          undefined,
        huile_graisse:
          combineTemplateValues((plan) => plan.huile_graisse) ||
          formData.huile_graisse.trim() ||
          undefined,
        documentation:
          combineTemplateValues((plan) => plan.documentation) ||
          formData.documentation.trim() ||
          undefined,
      });
      setNotification({
        type: "success",
        message: t("notifications.createSuccess"),
      });
      setShowModal(false);
      resetForm();
    } catch (error) {
      setNotification({
        type: "error",
        message: extractApiErrorMessage(error, t("notifications.saveFailed")),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("title")}>
        <div className="operator-dashboard-theme mx-auto w-full max-w-4xl space-y-6">
          {notification ? (
            <output
              className={`block rounded-xl border p-4 text-sm ${notification.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
            >
              {notification.message}
            </output>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  {t("addPlan")}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  {t("workspaceSubtitle")}
                </p>
              </div>
              <button
                type="button"
                disabled={loading || modules.length === 0}
                onClick={() => setShowModal(true)}
                className="btn-primary inline-flex shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlusIcon className="h-5 w-5" />
                {t("addPlan")}
              </button>
            </div>

            {loading ? (
              <p className="mt-6 text-sm text-slate-500">
                {tCommon("loading")}
              </p>
            ) : null}
            {loadError ? (
              <div
                role="alert"
                className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
              >
                {t("moduleLoadFailed")}{" "}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => void loadModules()}
                >
                  {tCommon("retry")}
                </button>
              </div>
            ) : null}
            {!loading && !loadError && modules.length === 0 ? (
              <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                {t("empty.default")}
              </p>
            ) : null}
          </section>
        </div>

        <PlanFormModal
          isOpen={showModal}
          editingPlan={null}
          formData={formData}
          setFormData={setFormData}
          submitting={submitting}
          modules={modules}
          planIdOptions={[]}
          hidePlanCode
          maintenanceCodeOptions={["W1", "W2", "W3", "W4", "W5", "W6"]}
          maintenancePlanTemplates={maintenancePlanTemplates}
          allowMultipleMaintenanceCodes
          frequenceLabelOptions={[
            "Monthly",
            "Quarterly",
            "Semi-annual",
            "Annual",
          ]}
          maintenanceTypeOptions={["preventive"]}
          onClose={() => setShowModal(false)}
          onSubmit={handleSubmit}
          t={t}
          tCommon={tCommon}
        />
      </DashboardLayout>
    </ProtectedRoute>
  );
}
