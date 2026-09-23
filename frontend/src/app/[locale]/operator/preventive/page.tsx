"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale, useTranslations } from "next-intl";
import KnowledgeSuggestions from "@/components/knowledge-base/KnowledgeSuggestions";
import { useOperatorPreventiveTasks } from "./hooks/useOperatorPreventiveTasks";
import { usePreventiveInspection } from "./hooks/usePreventiveInspection";
import { TaskCard } from "./components/TaskCard";
import { InspectionView } from "./components/InspectionView";
import { InspectionReview } from "./components/InspectionReview";
import { InspectionSuccess } from "./components/InspectionSuccess";

type Tab = "today" | "upcoming" | "completed";
type Step = "list" | "checklist" | "review" | "success";

function PreventiveTasksFlow() {
  const t = useTranslations("dashboard.operator.preventiveTasksFlow");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [step, setStep] = useState<Step>("list");
  const [selectedTask, setSelectedTask] = useState<{
    planId: string;
    machineId: string;
    planName: string;
    machineName: string;
    machineCode: string;
    workOrderId: string | null;
    readOnly: boolean;
  } | null>(null);
  const [observation, setObservation] = useState("");
  const [correctiveWo, setCorrectiveWo] = useState<string | null>(null);
  const [completedReportId, setCompletedReportId] = useState<string | null>(null);

  const { tasks, groupedTasks, loading, error, refresh } = useOperatorPreventiveTasks(user?._id);
  const inspection = usePreventiveInspection(
    selectedTask?.planId || null,
    selectedTask?.machineId || null,
    selectedTask?.workOrderId || null,
    selectedTask?.readOnly || false,
  );
  const resetInspection = inspection.reset;

  const initialWorkOrderId =
    searchParams.get("occurrenceId") ||
    searchParams.get("workOrder") ||
    searchParams.get("workOrderId");

  useEffect(() => {
    if (loading || !initialWorkOrderId) return;
    const match = tasks.find((task) => task.workOrderId === initialWorkOrderId);
    if (!match || selectedTask?.workOrderId === match.workOrderId) return;

    resetInspection();
    setObservation("");
    setCorrectiveWo(null);
    setCompletedReportId(null);
    setSelectedTask({
      planId: match.planId,
      machineId: match.machineId,
      planName: match.planName,
      machineName: match.machineName,
      machineCode: match.machineCode,
      workOrderId: match.workOrderId,
      readOnly: match.tab === "completed",
    });
    setStep("checklist");
  }, [
    initialWorkOrderId,
    resetInspection,
    loading,
    selectedTask?.workOrderId,
    tasks,
  ]);

  function handleOpenTask(task: typeof groupedTasks.today[0]) {
    if (selectedTask?.workOrderId !== task.workOrderId) {
      inspection.reset();
      setObservation("");
      setCorrectiveWo(null);
    }
    setSelectedTask({
      planId: task.planId,
      machineId: task.machineId,
      planName: task.planName,
      machineName: task.machineName,
      machineCode: task.machineCode,
      workOrderId: task.workOrderId,
      readOnly: task.tab === "completed",
    });
    setStep("checklist");
  }

  function handleProblemDetected(itemId: string, instruction: string) {
    const confirmed = window.confirm(
      `${t("problemDetectedTitle")}\n\n${t("problemDetectedMessage")} "${instruction}"\n\n${t("continueChecklistQuestion")}`,
    );
    if (confirmed) {
      window.open(
        `/${locale}/operator/corrective?machine=${selectedTask?.machineId}`,
        "_blank",
        "noopener,noreferrer",
      );
    }
  }

  async function handleReviewSubmit() {
    const result = await inspection.submit(observation);
    if (result) {
      setCorrectiveWo(result.workOrderOtId);
      setCompletedReportId(result.reportId);
      setStep("success");
      await refresh();
    }
  }

  const tabCounts = {
    today: groupedTasks.today.length,
    upcoming: groupedTasks.upcoming.length,
    completed: groupedTasks.completed.length,
  };

  const currentTasks = groupedTasks[activeTab];
  const isTodayTab = activeTab === "today";
  const isUpcomingTab = activeTab === "upcoming";
  const isCompletedTab = activeTab === "completed";
  const emptyMessageKeyByTab = { today: "noToday", upcoming: "noUpcoming", completed: "noCompleted" } as const;
  const activeTabChecks: Record<Tab, boolean> = { today: isTodayTab, upcoming: isUpcomingTab, completed: isCompletedTab };
  const selectedTab = (Object.keys(activeTabChecks) as Tab[]).find((tab) => activeTabChecks[tab]) || activeTab;
  const emptyMessageKey = emptyMessageKeyByTab[selectedTab];

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("title")}>
        <div className="operator-dashboard-theme mx-auto w-full max-w-7xl">
          {step === "success" && selectedTask && inspection.checklistItems.length > 0 && (
            <InspectionSuccess
              planName={selectedTask.planName}
              machineName={selectedTask.machineName}
              machineCode={selectedTask.machineCode}
              completedAt={new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date())}
              okCount={inspection.okCount}
              problemCount={inspection.problemCount}
              workOrderOtId={correctiveWo || inspection.workOrderId || ""}
              onViewResults={() => {
                if (completedReportId) {
                  router.push(`/${locale}/operator/my-reports?reportId=${encodeURIComponent(completedReportId)}&workOrderId=${encodeURIComponent(inspection.workOrderId || "")}`);
                }
              }}
              onBack={() => {
                setStep("list");
                setSelectedTask(null);
                setObservation("");
                setCorrectiveWo(null);
                setCompletedReportId(null);
                inspection.reset();
              }}
            />
          )}

          {step === "review" && selectedTask && (
            <InspectionReview
              planName={selectedTask.planName}
              machineName={selectedTask.machineName}
              machineCode={selectedTask.machineCode}
              okCount={inspection.okCount}
              problemCount={inspection.problemCount}
              problems={inspection.problems}
              observation={observation}
              correctiveWo={correctiveWo}
              onBack={() => setStep("checklist")}
              onSubmit={handleReviewSubmit}
              submitting={inspection.submitting}
            />
          )}

          {step === "checklist" && selectedTask && (
            <div className="space-y-6">
              <div className="mb-4 flex items-center justify-between">
                <button
                  type="button"
                onClick={() => {
                  setStep("list");
                }}
                  className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                  <span aria-hidden="true">{isRtl ? "→" : "←"}</span> {t("backToTasks")}
                </button>
                <KnowledgeSuggestions machineId={selectedTask.machineId} />
              </div>

              {inspection.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{inspection.error}</div>
              )}

              <InspectionView
                planName={selectedTask.planName}
                machineName={selectedTask.machineName}
                machineCode={selectedTask.machineCode}
                items={inspection.checklistItems.map((item) => ({ _id: item._id, instruction: item.instruction }))}
                itemResults={inspection.itemResults}
                loading={inspection.loading}
                onToggle={inspection.toggleItem}
                onProblemClick={handleProblemDetected}
                onSubmit={(obs) => {
                  setObservation(obs || "");
                  if (!selectedTask.readOnly && inspection.allAnswered) {
                    setStep("review");
                  }
                }}
                onBack={() => {
                  setStep("list");
                }}
                submitting={inspection.submitting}
                observation={observation}
                onObservationChange={setObservation}
                allAnswered={inspection.allAnswered}
                okCount={inspection.okCount}
                problemCount={inspection.problemCount}
                readOnly={selectedTask.readOnly}
              />
            </div>
          )}

          {step === "list" && (
            <div className="space-y-6">
              <p className="max-w-3xl text-sm leading-6 text-slate-500">{t("description")}</p>

              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
              )}

              <div
                role="tablist"
                aria-label={t("title")}
                className="flex max-w-full gap-1 overflow-x-auto border-b border-slate-200 sm:gap-2"
              >
                {(["today", "upcoming", "completed"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                    className={`relative shrink-0 px-3 py-3 text-sm font-semibold transition sm:px-4 ${
                      activeTab === tab
                        ? "text-slate-900"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {t(tab)}
                    {tabCounts[tab] > 0 && (
                      <span className={`ms-2 rounded-full px-2 py-0.5 text-xs ${
                        activeTab === tab ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                      }`}>
                        {tabCounts[tab]}
                      </span>
                    )}
                    {activeTab === tab && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
                    )}
                  </button>
                ))}
              </div>

              {loading && (
                <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
                  <div className="text-sm text-slate-500">{t("loading")}</div>
                </div>
              )}
              {!loading && currentTasks.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-12 text-center">
                  <div className="text-sm text-slate-500">
                    {t(emptyMessageKey)}
                  </div>
                </div>
              )}
              {!loading && currentTasks.length > 0 && (
                <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
                  {currentTasks.map((task) => (
                    <TaskCard
                      key={task.workOrderId || `${task.planId}:${task.machineId}`}
                      planName={task.planName}
                      machineName={task.machineName}
                      machineCode={task.machineCode}
                      checkCount={task.checkCount}
                      completedCount={task.completedCount}
                      dueDate={task.dueDate}
                      tab={task.tab}
                      onOpen={() => handleOpenTask(task)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export default function OperatorPreventivePage() {
  return (
    <Suspense fallback={<div className="operator-dashboard-theme min-h-screen bg-white" />}>
      <PreventiveTasksFlow />
    </Suspense>
  );
}
