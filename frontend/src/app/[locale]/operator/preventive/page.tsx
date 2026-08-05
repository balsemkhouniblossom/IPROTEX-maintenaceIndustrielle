"use client";

import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/Modal";
import KnowledgeSuggestions from "@/components/knowledge-base/KnowledgeSuggestions";
import { DocumentEntity, GeneratedReportRow, refId } from "./types";
import { useOperatorPreventiveBootstrap } from "./hooks/useOperatorPreventiveBootstrap";
import { useOperatorPreventiveState } from "./hooks/useOperatorPreventiveState";
import { usePreventiveChecklist } from "./hooks/usePreventiveChecklist";
import { usePreventivePlanWorkflow } from "./hooks/usePreventivePlanWorkflow";
import { usePreventiveSubmission } from "./hooks/usePreventiveSubmission";
import { useGeneratedReports } from "./hooks/useGeneratedReports";
import { useAutoDismissNotification } from "./hooks/useAutoDismissNotification";
import { ReportDetailsContent } from "./components/ReportDetailsContent";
import { ManualPreviewModal } from "./components/ManualPreviewModal";
import { PreventiveMachineSelector } from "./components/PreventiveMachineSelector";
import { PreventivePlanTabs } from "./components/PreventivePlanTabs";
import { PreventiveStepHeader } from "./components/PreventiveStepHeader";
import { PreventiveChecklist } from "./components/PreventiveChecklist";
import { PreventiveSubmissionActions } from "./components/PreventiveSubmissionActions";
import { PreventiveExecutionForm } from "./components/PreventiveExecutionForm";
import { PreventiveReportsSection } from "./components/PreventiveReportsSection";

function formatPlanStateLabel(state: string, t: ReturnType<typeof useTranslations>): string {
  const key =
    state === "not_scheduled"
      ? "notScheduled"
      : state === "due_today"
        ? "dueToday"
        : state === "due_soon"
          ? "dueSoon"
          : state === "waiting_validation"
            ? "waitingValidation"
            : state === "in_progress"
              ? "inProgress"
              : state;
  try {
    return t(`lifecycle.${key}`);
  } catch {
    return state;
  }
}

function formatDateLabel(value: string | null | undefined, t: ReturnType<typeof useTranslations>): string {
  if (!value) return t("lifecycle.noDueDate");
  return new Date(value).toLocaleDateString();
}

function formatReportDate(value: string | undefined, tCommon: ReturnType<typeof useTranslations>): string {
  if (!value) return tCommon("notAvailable");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? tCommon("notAvailable") : parsed.toLocaleString();
}

function formatReportStatus(status: string, t: ReturnType<typeof useTranslations>, tCommon: ReturnType<typeof useTranslations>): string {
  switch (status) {
    case "waiting_validation":
      return t("waitingValidation");
    case "validated":
    case "completed":
      return t("validated");
    case "returned":
      return t("returned");
    case "technician_required":
      return t("technicianRequired");
    default:
      return status || tCommon("notAvailable");
  }
}

function reportStatusClasses(status: string): string {
  switch (status) {
    case "validated":
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "returned":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "technician_required":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "waiting_validation":
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export default function OperatorPreventivePage() {
  const t = useTranslations("dashboard.operator");
  const tCommon = useTranslations("common");
  const tChecklist = useTranslations("preventiveTaskChecklist");
  const { user } = useAuth();

  const { notification, notify } = useAutoDismissNotification();

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [previewDocument, setPreviewDocument] = useState<DocumentEntity | null>(null);
  const [selectedGeneratedReport, setSelectedGeneratedReport] = useState<GeneratedReportRow | null>(null);

  const { machineTypes, machines, modules, plans, documents, lubrifiants, kpis, loading } =
    useOperatorPreventiveBootstrap();

  const { preventiveState, stateLoading, refreshPreventiveState, clearPreventiveState } =
    useOperatorPreventiveState(selectedMachine);

  const checklist = usePreventiveChecklist(selectedMachine, selectedCategory);

  const planWorkflow = usePreventivePlanWorkflow({
    selectedMachine,
    modules,
    plans,
    preventiveState,
    checklistItems: checklist.checklistItems,
    refreshPreventiveState,
    notify,
  });

  const { generatedReports, addGeneratedReport } = useGeneratedReports();

  const submission = usePreventiveSubmission({
    userId: user?._id,
    selectedMachine,
    selectedCategory,
    machines,
    checklistItems: checklist.checklistItems,
    selectedPlanIds: planWorkflow.selectedPlanIds,
    selectedPlanGroup: planWorkflow.selectedPlanGroup,
    groupedChecklistItems: planWorkflow.groupedChecklistItems,
    completedChecklistLabels: planWorkflow.completedChecklistLabels,
    selectedOccurrenceIdsByPlan: planWorkflow.selectedOccurrenceIdsByPlan,
    addGeneratedReport,
    refreshPreventiveState,
    resetAfterSubmission: planWorkflow.resetAfterSubmission,
    notify,
  });

  // machineTypes is already scoped server-side (getOperatorMachineTypes) to the
  // categories the operator can access, with no client-side re-filtering needed.
  const visibleMachineTypes = machineTypes;

  const machinesForCategory = useMemo(
    () => machines.filter((machine) => refId(machine.type_id) === selectedCategory),
    [machines, selectedCategory],
  );

  const manualDocument = useMemo(() => {
    const selectedCategoryMachineIds = new Set(
      machines.filter((machine) => refId(machine.type_id) === selectedCategory).map((machine) => machine._id),
    );

    return (
      documents.find((doc) => {
        const documentMachineId = refId(doc.machine_id);
        const type = (doc.type_document ?? "").toLowerCase();
        const name = (doc.file_name ?? "").toLowerCase();
        const isManualType =
          type.includes("manual") ||
          type.includes("procedure") ||
          type.includes("pdf") ||
          type.includes("excel") ||
          type.includes("xlsx") ||
          type.includes("xls") ||
          type.includes("spreadsheet") ||
          name.endsWith(".xlsx") ||
          name.endsWith(".xls");

        if (!isManualType) return false;
        if (selectedMachine) return documentMachineId === selectedMachine;
        if (selectedCategory) return selectedCategoryMachineIds.has(documentMachineId);
        return false;
      }) ?? null
    );
  }, [documents, machines, selectedCategory, selectedMachine]);

  const selectedMachineKpi = useMemo(
    () => kpis.find((item) => refId(item.machine_id) === selectedMachine) ?? null,
    [kpis, selectedMachine],
  );

  const preventiveGeneratedReports = generatedReports.filter((item) => item.type === "preventive");

  function handleSelectCategory(machineTypeId: string): void {
    setSelectedCategory(machineTypeId);
    setSelectedMachine("");
    submission.resetExecutionForm();
    planWorkflow.resetWorkflowState();
    clearPreventiveState();
  }

  function handleSelectMachine(machineId: string): void {
    submission.resetExecutionForm();
    planWorkflow.resetWorkflowState();
    setSelectedMachine(machineId);
  }

  function handleGoToNextPlanStep(): void {
    planWorkflow.goToNextPlanStep();
    submission.clearValidationReason();
  }

  async function handleToggleChecklistItem(item: Parameters<typeof checklist.toggleChecklistItem>[0]): Promise<void> {
    const result = await checklist.toggleChecklistItem(item);
    if (result.message) notify(result.ok ? "success" : "error", result.message);
  }

  async function handleSaveChecklistNotes(item: Parameters<typeof checklist.saveChecklistNotes>[0]): Promise<void> {
    const result = await checklist.saveChecklistNotes(item);
    if (result?.message) notify(result.ok ? "success" : "error", result.message);
  }

  async function handleCompleteSelectedTask(): Promise<void> {
    if (!planWorkflow.selectedChecklistItems.length) {
      submission.setValidationReason("no-tasks-selected");
      return;
    }
    const result = await checklist.completeChecklistItems(planWorkflow.selectedChecklistItems);
    if (result.message) notify(result.ok ? "success" : "error", result.message);
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole="operator">
        <DashboardLayout title={t("preventiveMaintenance")}>
          <div className="operator-dashboard-theme panel">{tCommon("loading")}</div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("preventiveMaintenance")}>
        <div className="operator-dashboard-theme bento-grid">
          {notification ? (
            <div
              className={`col-span-full panel border ${
                notification.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {notification.message}
            </div>
          ) : null}

          <div className="col-span-full panel">
            <div className="card-title mb-4">{t("preventiveMaintenance")}</div>

            <PreventiveMachineSelector
              visibleMachineTypes={visibleMachineTypes}
              selectedCategory={selectedCategory}
              onSelectCategory={handleSelectCategory}
              machinesForCategory={machinesForCategory}
              selectedMachine={selectedMachine}
              onSelectMachine={handleSelectMachine}
              t={t}
              tCommon={tCommon}
            />

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-700">{t("progress")}</div>
                  <div className="text-xs text-slate-500">
                    {planWorkflow.selectedPlanState
                      ? `${planWorkflow.currentCompletedChecklistLabels.length}/${planWorkflow.selectedChecklistItems.length || 1} ${t("completed")}`
                      : tCommon("table.noData")}
                  </div>
                </div>
                <div className="text-sm font-semibold text-slate-900">{planWorkflow.focusedProgress}%</div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${planWorkflow.focusedProgress}%` }}
                />
              </div>
            </div>
          </div>

          {selectedMachine ? (
            <div className="col-span-full">
              <KnowledgeSuggestions machineId={selectedMachine} />
            </div>
          ) : null}

          {selectedMachine ? (
            <div className="col-span-full panel">
              <PreventiveStepHeader
                selectedPlanState={planWorkflow.selectedPlanState}
                selectedPlanLabel={planWorkflow.selectedPlanLabel}
                selectedPlanStateLabel={
                  planWorkflow.selectedPlanState
                    ? formatPlanStateLabel(planWorkflow.selectedPlanState.currentState, t)
                    : tCommon("notAvailable")
                }
                manualDocument={manualDocument}
                onPreviewManual={setPreviewDocument}
                t={t}
                tCommon={tCommon}
                tChecklist={tChecklist}
              />

              <PreventivePlanTabs
                groups={planWorkflow.preventivePlanGroups}
                selectedPlanIdsSet={planWorkflow.selectedPlanIdsSet}
                onSelectGroup={planWorkflow.selectPlanGroup}
                formatPlanStateLabel={(state) => formatPlanStateLabel(state, t)}
              />

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-bold text-slate-900">
                        {planWorkflow.selectedPlanLabel || t("lifecycle.preventivePlan")}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {t("lifecycle.nextDue")}: {formatDateLabel(planWorkflow.selectedPlanState?.nextDueDate, t)}
                      </div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-700">
                      {planWorkflow.selectedPlanState
                        ? formatPlanStateLabel(planWorkflow.selectedPlanState.currentState, t)
                        : tCommon("notAvailable")}
                    </span>
                  </div>

                  <div className="mt-4 rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-slate-700">
                        {t("progress")}{" "}
                        {planWorkflow.totalPlanSteps > 1
                          ? `${planWorkflow.activePlanStepNumber}/${planWorkflow.totalPlanSteps}`
                          : ""}
                      </span>
                      <span className="font-semibold text-slate-900">{planWorkflow.focusedProgress}%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200">
                      <div
                        className="h-2 rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${planWorkflow.focusedProgress}%` }}
                      />
                    </div>
                  </div>

                  <PreventiveChecklist
                    checklistLoading={checklist.checklistLoading}
                    stateLoading={stateLoading}
                    checklistError={checklist.checklistError}
                    items={planWorkflow.selectedChecklistItems}
                    checklistNotesDraft={checklist.checklistNotesDraft}
                    checklistSavingId={checklist.checklistSavingId}
                    taskStarted={planWorkflow.taskStarted}
                    onToggleItem={(item) => void handleToggleChecklistItem(item)}
                    onNoteChange={checklist.updateNoteDraft}
                    onNoteBlur={(item) => void handleSaveChecklistNotes(item)}
                    tCommon={tCommon}
                    tChecklist={tChecklist}
                  />

                  <PreventiveSubmissionActions
                    selectedPlanState={planWorkflow.selectedPlanState}
                    actionSaving={planWorkflow.actionSaving}
                    taskStarted={planWorkflow.taskStarted}
                    isBulkCompleting={checklist.isBulkCompleting}
                    selectedTaskCompleted={planWorkflow.selectedTaskCompleted}
                    canGoToNextPlanStep={planWorkflow.canGoToNextPlanStep}
                    canSubmitFocusedTask={planWorkflow.canSubmitFocusedTask}
                    isLastPlanStep={planWorkflow.isLastPlanStep}
                    submitting={submission.submitting}
                    submitValidationReason={submission.submitValidationReason}
                    submitValidationMessage={submission.submitValidationMessage}
                    onStart={() => void planWorkflow.startSelectedTask()}
                    onComplete={() => void handleCompleteSelectedTask()}
                    onNext={handleGoToNextPlanStep}
                    onSubmit={() => void submission.submitPreventiveMaintenance()}
                    t={t}
                    tCommon={tCommon}
                  />
                </div>

                <PreventiveExecutionForm
                  condition={submission.condition}
                  onConditionChange={submission.setCondition}
                  customCondition={submission.customCondition}
                  onCustomConditionChange={submission.setCustomCondition}
                  comments={submission.comments}
                  onCommentsChange={submission.setComments}
                  lubrifiants={lubrifiants}
                  selectedLubrifiant={submission.selectedLubrifiant}
                  onSelectedLubrifiantChange={submission.setSelectedLubrifiant}
                  selectedLubrificationQtyMode={submission.selectedLubrificationQtyMode}
                  onSelectedLubrificationQtyModeChange={submission.setSelectedLubrificationQtyMode}
                  lubrificationQty={submission.lubrificationQty}
                  onLubrificationQtyChange={submission.setLubrificationQty}
                  onPhotoChange={submission.setPhoto}
                  selectedMachineKpi={selectedMachineKpi}
                  t={t}
                  tCommon={tCommon}
                />
              </div>
            </div>
          ) : null}

          <PreventiveReportsSection
            reports={preventiveGeneratedReports}
            onSelectReport={setSelectedGeneratedReport}
            formatReportDate={(value) => formatReportDate(value, tCommon)}
            formatReportStatus={(status) => formatReportStatus(status, t, tCommon)}
            reportStatusClasses={reportStatusClasses}
            t={t}
            tCommon={tCommon}
          />
        </div>

        <Modal
          isOpen={Boolean(selectedGeneratedReport)}
          onClose={() => setSelectedGeneratedReport(null)}
          title={t("smartCalendar.maintenanceDetails")}
          size="lg"
        >
          {selectedGeneratedReport ? (
            <ReportDetailsContent
              report={selectedGeneratedReport}
              onClose={() => setSelectedGeneratedReport(null)}
              formatReportDate={(value) => formatReportDate(value, tCommon)}
              formatReportStatus={(status) => formatReportStatus(status, t, tCommon)}
              reportStatusClasses={reportStatusClasses}
              t={t}
              tCommon={tCommon}
            />
          ) : null}
        </Modal>

        <ManualPreviewModal document={previewDocument} onClose={() => setPreviewDocument(null)} t={t} />
      </DashboardLayout>
    </ProtectedRoute>
  );
}
