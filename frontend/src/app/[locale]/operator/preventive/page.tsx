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

  const initialPlanId = searchParams.get("plan");
  const initialMachineId = searchParams.get("machine");

  useEffect(() => {
    if (loading) return;
    const initialWorkOrderId = searchParams.get("workOrder") || searchParams.get("workOrderId");
    if (!initialWorkOrderId) return;
    const match = tasks.find((t) =>
      initialWorkOrderId
        ? t.workOrderId === initialWorkOrderId
        : t.planId === initialPlanId && t.machineId === initialMachineId,
    );
    if (match) {
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
    }
  }, [loading, initialPlanId, initialMachineId, tasks]);

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
  const emptyMessageKeyByTab = { today: "noToday", upcoming: "noUpcoming", completed: "noCompleted" } as const;
  const emptyMessageKey = emptyMessageKeyByTab[activeTab];

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("title")}>
        <div className="operator-dashboard-theme mx-auto max-w-4xl">
          {step === "success" && selectedTask && inspection.checklistItems.length > 0 && (
            <InspectionSuccess
              planName={selectedTask.planName}
              machineName={selectedTask.machineName}
              machineCode={selectedTask.machineCode}
              completedAt={new Date().toLocaleString()}
              okCount={inspection.okCount}
              problemCount={inspection.problemCount}
              workOrderOtId={correctiveWo || inspection.workOrderId || ""}
              reportId={completedReportId || ""}
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
                  ← {t("backToTasks")}
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
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
                <p className="mt-1 text-sm text-slate-500">{t("description")}</p>
              </div>

              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
              )}

              <div className="flex gap-2 border-b border-slate-200">
                {(["today", "upcoming", "completed"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`relative px-4 py-3 text-sm font-semibold transition ${
                      activeTab === tab
                        ? "text-slate-900"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {t(tab)}
                    {tabCounts[tab] > 0 && (
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
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

              {loading ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
                  <div className="text-sm text-slate-500">{t("loading")}</div>
                </div>
              ) : currentTasks.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-12 text-center">
                  <div className="text-sm text-slate-500">
                    {t(emptyMessageKey)}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {currentTasks.map((task) => (
                    <TaskCard
                      key={task.workOrderId || `${task.planId}:${task.machineId}`}
                      planName={task.planName}
                      planCode={task.planCode}
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
