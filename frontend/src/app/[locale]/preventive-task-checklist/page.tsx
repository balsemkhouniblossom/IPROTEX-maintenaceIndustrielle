"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import DynamicSearchControls from "@/components/DynamicSearchControls";
import { Modal } from "@/components/Modal";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { apiService } from "@/services/api";
import { displayText } from "@/services/displayValues";
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from "@/services/dynamicSearch";
import { CheckIcon, EyeIcon, CheckCircleIcon, ExclamationTriangleIcon, PencilIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import Pagination from "@/components/Pagination";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { fetchAllPaginated } from "@/services/pagination";
import { frequencyLabel, frequencyTranslationKey } from "@/app/[locale]/maintenance-plans/utils";

type EntityRef = string | { _id?: string };

interface Module {
  _id: string;
  module_id?: string;
  machine_id?: EntityRef;
}

interface Machine {
  _id: string;
  machine_id: string;
  model?: string;
  type_id?: EntityRef;
}

interface PreventiveTask {
  id: string;
  planId: string;
  plan_id: string;
  moduleId: string;
  instruction: string;
  responsable?: string;
  completed: boolean;
  completedAt?: string;
  notes?: string;
  source: "plan" | "manual";
  frequency?: string;
}

interface PreventiveTaskForm {
  plan_id: string;
  moduleId: string;
  instruction: string;
  responsable: string;
  completed: boolean;
  notes: string;
}

type PreventiveTaskFilter = "all" | "pending" | "completed";
type NotificationType = "success" | "error" | "info";

function refId(value: EntityRef | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id ?? "";
}

export default function PreventiveTaskChecklistPage() {
  const t = useTranslations("preventiveTaskChecklist");
  const tCommon = useTranslations("common");
  const tPlans = useTranslations("maintenancePlans");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const relatedWorkOrderId = searchParams.get("workOrderId");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [modules, setModules] = useState<Module[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [tasks, setTasks] = useState<PreventiveTask[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<PreventiveTaskFilter>("all");
  const [machineFilter, setMachineFilter] = useState("");
  const [planFilter, setPlanFilter] = useState(searchParams.get("planId") ?? "");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [selectedTask, setSelectedTask] = useState<PreventiveTask | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [notification, setNotification] = useState<{ type: NotificationType; message: string } | null>(null);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PreventiveTask | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<PreventiveTaskForm>({
    plan_id: "",
    moduleId: "",
    instruction: "",
    responsable: "",
    completed: false,
    notes: "",
  });
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  const loadData = useCallback(async () => {
      try {
        setLoading(true);
        setLoadError(false);
        const [tasksRes, modulesRes, machinesRes] = await Promise.all([
          fetchAllPaginated<Record<string, any>>((params) => apiService.getPreventiveTasks(params), 1000),
          fetchAllPaginated<Module>((params) => apiService.getModules(params)),
          fetchAllPaginated<Machine>((params) => apiService.getMachines(params)),
        ]);

        const modulesData: Module[] = modulesRes;
        const machinesData: Machine[] = machinesRes;

        setModules(modulesData);
        setMachines(machinesData);

        const persistedTasks = tasksRes.map((task: Record<string, any>): PreventiveTask => ({
          id: String(task._id),
          planId: refId(task.plan_id),
          plan_id: String(task.plan_code ?? task.task_id),
          moduleId: refId(task.module_id),
          instruction: String(task.instruction),
          responsable: task.responsable,
          completed: task.status === "completed",
          completedAt: task.completed_at,
          notes: task.notes,
          source: task.source === "plan" ? "plan" : "manual",
          frequency: typeof task.plan_id === "object" && task.plan_id
            ? (frequencyTranslationKey(task.plan_id.frequence, task.plan_id.unite_frequence)
              ? tPlans(`frequencyLabels.${frequencyTranslationKey(task.plan_id.frequence, task.plan_id.unite_frequence)}`, { count: task.plan_id.frequence })
              : frequencyLabel(task.plan_id.frequence, task.plan_id.unite_frequence, task.plan_id.frequence_label))
            : undefined,
        }));
        setTasks(persistedTasks);
      } catch (error) {
        console.error("Failed to load preventive tasks", error);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
  }, [tPlans]);
  useEffect(() => { void loadData(); }, [loadData]);

  const syncFromPlans = async () => {
    setSyncing(true);
    try {
      await apiService.syncPreventiveTasks();
      await loadData();
    } catch {
      setNotification({ type: "error", message: t("notifications.loadFailed") });
    } finally {
      setSyncing(false);
    }
  };
  useEffect(() => {
    setPage(1);
  }, [searchTerm, selectedSearchField, selectedFilter, machineFilter, planFilter, tasks.length]);

  // Get module name
  const getModuleName = (moduleId: string): string => {
    const module = modules.find((m) => m._id === moduleId);
    return module?.module_id ?? "—";
  };

  // Get machine name
  const getMachineName = (moduleId: string): string => {
    const module = modules.find((m) => m._id === moduleId);
    if (!module) return "—";
    const machine = machines.find((m) => m._id === refId(module.machine_id));
    return machine ? machine.machine_id : "—";
  };

  const searchableTasks = useMemo(
    () =>
      tasks.map((task) => {
        const module = modules.find((m) => m._id === task.moduleId);
        const machine = module
          ? machines.find((m) => m._id === refId(module.machine_id))
          : undefined;

        return {
          ...task,
          machine_label: machine?.machine_id ?? "—",
          module_label: module?.module_id ?? "—",
        };
      }),
    [tasks, modules, machines],
  );

  const searchableFields = useMemo(() => getSearchableFields(searchableTasks), [searchableTasks]);

  // Filter tasks based on search and selected filter
  const filteredTasks = useMemo(() => {
    return searchableTasks.filter((task) => {
      const matchesSearch = matchesDynamicSearch(task, searchTerm, selectedSearchField);

      const matchesFilter =
        selectedFilter === "all" ||
        (selectedFilter === "pending" && !task.completed) ||
        (selectedFilter === "completed" && task.completed);

      const matchesMachine = !machineFilter || refId(modules.find((module) => module._id === task.moduleId)?.machine_id) === machineFilter;
      const matchesPlan = !planFilter || task.planId === planFilter;
      return matchesSearch && matchesFilter && matchesMachine && matchesPlan;
    });
  }, [searchableTasks, searchTerm, selectedSearchField, selectedFilter, machineFilter, planFilter, modules]);

  const totalItems = filteredTasks.length;

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(totalItems / limit));
  }, [totalItems, limit]);

  const safePage = Math.min(page, totalPages);

  const paginatedTasks = useMemo(() => {
    const start = (safePage - 1) * limit;
    const end = start + limit;
    return filteredTasks.slice(start, end);
  }, [filteredTasks, safePage, limit]);

  // Calculate statistics
  const stats = useMemo(() => ({
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
    pending: tasks.filter((t) => !t.completed).length,
  }), [tasks]);

  const completionRate = useMemo(() => {
    if (stats.total === 0) return 0;
    return Math.round((stats.completed / stats.total) * 100);
  }, [stats.completed, stats.total]);

  const closeModal = () => {
    setShowModal(false);
    setSelectedTask(null);
    setCompletionNotes("");
  };

  const resetForm = () => {
    setEditingTask(null);
    setFormData({
      plan_id: "",
      moduleId: "",
      instruction: "",
      responsable: "",
      completed: false,
      notes: "",
    });
  };

  const openAddForm = () => {
    resetForm();
    setIsFormModalOpen(true);
  };

  const openEditForm = (task: PreventiveTask) => {
    setEditingTask(task);
    setFormData({
      plan_id: task.plan_id,
      moduleId: task.moduleId,
      instruction: task.instruction,
      responsable: task.responsable ?? "",
      completed: task.completed,
      notes: task.notes ?? "",
    });
    setIsFormModalOpen(true);
  };

  const handleFormSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formData.instruction.trim()) {
      setNotification({
        type: "error",
        message: t("notifications.saveFailed"),
      });
      return;
    }

    setSubmitting(true);
    try {
      const taskId = editingTask?.id;
      const payload = {
        plan_code: formData.plan_id.trim() || undefined,
        module_id: formData.moduleId || undefined,
        instruction: formData.instruction.trim(),
        responsable: formData.responsable.trim() || undefined,
        status: formData.completed ? "completed" : "pending",
        notes: formData.notes.trim() || undefined,
      };
      if (taskId) {
        await apiService.updatePreventiveTask(taskId, payload);
      } else {
        await apiService.createPreventiveTask({ ...payload, task_id: `PT-MANUAL-${Date.now()}` });
      }
      await loadData();
      setNotification({
        type: "success",
        message: editingTask
          ? t("notifications.taskUpdated")
          : t("notifications.taskCreated"),
      });
      setIsFormModalOpen(false);
      resetForm();
    } catch {
      setNotification({ type: "error", message: t("notifications.saveFailed") });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle task completion toggle
  const toggleTaskCompletion = async (task: PreventiveTask) => {
    if (task.completed) {
      const updatedTasks = tasks.map((t) =>
        t.id === task.id
          ? { ...t, completed: false, completedAt: undefined, notes: undefined }
          : t,
      );
      await apiService.updatePreventiveTask(task.id, { status: "pending", notes: "" });
      setTasks(updatedTasks);
      setNotification({
        type: "success",
        message: t("notifications.taskUpdated"),
      });
      return;
    }

    setSelectedTask(task);
    setCompletionNotes(task.notes ?? "");
    setShowModal(true);
  };

  const openTaskDetails = (task: PreventiveTask) => {
    setSelectedTask(task);
    setCompletionNotes(task.notes ?? "");
    setShowModal(true);
  };

  // Handle marking task as complete with notes
  const markTaskComplete = async () => {
    if (!selectedTask) return;

    const updatedTasks = tasks.map((t) =>
      t.id === selectedTask.id
        ? {
          ...t,
          completed: true,
          completedAt: new Date().toISOString(),
          notes: completionNotes,
        }
        : t,
    );

    await apiService.updatePreventiveTask(selectedTask.id, { status: "completed", notes: completionNotes });
    setTasks(updatedTasks);
    setNotification({
      type: "success",
      message: t("notifications.taskMarkedComplete"),
    });
    closeModal();
  };

  const deleteTask = async (task: PreventiveTask) => {
    if (!window.confirm(t("notifications.confirmDelete"))) return;
    try {
      await apiService.deletePreventiveTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setNotification({ type: "success", message: t("notifications.taskDeleted") });
    } catch {
      setNotification({ type: "error", message: t("notifications.deleteFailed") });
    }
  };

  if (loading) {
    return (
      <ProtectedRoute allowedRoles={["admin", "technician"]}>
        <DashboardLayout title={t("title")}>
          <div className="panel flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900 mx-auto mb-4"></div>
              <p>{t("loadingTasks")}</p>
            </div>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  if (loadError) {
    return (
      <ProtectedRoute allowedRoles={["admin", "technician"]}>
        <DashboardLayout title={t("title")}>
          <div className="panel" role="alert">
            <h1 className="text-lg font-semibold">{t("loadErrorTitle")}</h1>
            <p className="mt-1 text-sm text-slate-600">{t("loadErrorDescription")}</p>
            <button type="button" className="btn-secondary mt-3" onClick={() => void loadData()}>{tCommon("retry")}</button>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  let notificationClass = "bg-blue-100 text-blue-800 border border-blue-200";
  if (notification?.type === "success") {
    notificationClass = "bg-green-100 text-green-800 border border-green-200";
  } else if (notification?.type === "error") {
    notificationClass = "bg-red-100 text-red-800 border border-red-200";
  }

  let submitLabel = tCommon("actions.create", { default: "Create" });
  if (submitting) {
    submitLabel = tCommon("actions.saving");
  } else if (editingTask) {
    submitLabel = tCommon("edit");
  }

  return (
    <ProtectedRoute allowedRoles={["admin", "technician"]}>
      <DashboardLayout title={t("title")}>
        {notification && (
          <div
            className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${notificationClass}`}
          >
            {notification.type === "success" ? (
              <CheckCircleIcon className="w-5 h-5" />
            ) : (
              <ExclamationTriangleIcon className="w-5 h-5" />
            )}
            <span>{notification.message}</span>
            <button type="button"
              onClick={() => setNotification(null)}
              className="ml-2 text-gray-500 hover:text-gray-700"
            >
              x
            </button>
          </div>
        )}

        <div className="bento-grid">
          {relatedWorkOrderId && <Link className="col-span-full text-blue-700 underline" href={`/${locale}/work-orders/${encodeURIComponent(relatedWorkOrderId)}`}>{t("backToWorkOrder")}</Link>}
          {/* Header */}
          <div className="col-span-full bento-item">
            <div className="panel">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h1 className="card-title mb-2">{t("workspaceTitle")}</h1>
                  <p className="text-sm text-slate-600">{t("workspaceSubtitle")}</p>
                </div>
                <div className="text-end">
                  <div className="text-3xl font-bold text-blue-600">{stats.total}</div>
                  <div className="text-sm text-slate-500">{t("totalTasks")}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void syncFromPlans()} disabled={syncing} className="btn-secondary">{t("syncFromPlans")}</button>
                  <details className="relative">
                    <summary className="btn-secondary cursor-pointer">{t("manualTasks")}</summary>
                    <button type="button" onClick={openAddForm} className="btn-secondary mt-2 flex items-center gap-2"><PlusIcon className="w-4 h-4" />{t("actions.addTask")}</button>
                  </details>
                </div>
              </div>
            </div>
          </div>

          {/* Statistics */}
          <div className="col-span-full grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="panel bento-item">
              <div className="text-sm text-slate-600">{t("totalTasks")}</div>
              <div className="text-3xl font-bold text-slate-900">{stats.total}</div>
            </div>
            <div className="panel bento-item">
              <div className="text-sm text-slate-600">{t("completedTasks")}</div>
              <div className="text-3xl font-bold text-emerald-600">{stats.completed}</div>
            </div>
            <div className="panel bento-item">
              <div className="text-sm text-slate-600">{t("pendingTasks")}</div>
              <div className="text-3xl font-bold text-amber-600">{stats.pending}</div>
            </div>
            <div className="panel bento-item">
              <div className="text-sm text-slate-600">{t("completionRate")}</div>
              <div className="text-3xl font-bold text-blue-600">{completionRate}%</div>
            </div>
            <p className="col-span-full text-xs text-slate-600">{t("summaryScope")}</p>
          </div>

          {/* Filters and Search */}
          <div className="col-span-full bento-item">
            <div className="panel">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium mb-2">{t("actions.filter")}</label>
                  <div className="flex gap-2 flex-wrap">
                    {(["all", "pending", "completed"] as const).map((filter) => (
                      <button type="button"
                        key={filter}
                        onClick={() => setSelectedFilter(filter)}
                        className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                          selectedFilter === filter
                            ? "bg-slate-900 text-white"
                            : "bg-slate-200 text-slate-900 hover:bg-slate-300"
                        }`}
                      >
                        {t(`filters.${filter}`)}
                      </button>
                    ))}
                  </div>
                </div>
              <div>
                  <label className="block text-sm font-medium mb-2">{tCommon("actions.search")}</label>
                  <DynamicSearchControls
                    selectedField={selectedSearchField}
                    onSelectedFieldChange={setSelectedSearchField}
                    searchableFields={searchableFields}
                    allFieldsLabel={tCommon("table.allFields", { default: "All fields" })}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    searchPlaceholder={t("placeholders.taskName")}
                  />
                </div>
                <div>
                  <label htmlFor="checklist-machine-filter" className="block text-sm font-medium mb-2">{t("table.machine")}</label>
                  <select id="checklist-machine-filter" className="input-field w-full" value={machineFilter} onChange={(event) => setMachineFilter(event.target.value)}>
                    <option value="">{t("allMachines")}</option>
                    {machines.map((machine) => <option key={machine._id} value={machine._id}>{machine.machine_id}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="checklist-plan-filter" className="block text-sm font-medium mb-2">{t("table.planCode")}</label>
                  <select id="checklist-plan-filter" className="input-field w-full" value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
                    <option value="">{t("allPlans")}</option>
                    {Array.from(new Map(tasks.filter((task) => task.planId).map((task) => [task.planId, task.plan_id])).entries()).map(([id, code]) => <option key={id} value={id}>{code}</option>)}
                  </select>
                </div>
              </div>
              {(searchTerm || machineFilter || planFilter || selectedFilter !== "all") && <button type="button" className="btn-secondary" onClick={() => { setSearchTerm(""); setMachineFilter(""); setPlanFilter(""); setSelectedFilter("all"); }}>{t("resetFilters")}</button>}
            </div>
          </div>

          {/* Tasks Table */}
          <div className="col-span-full bento-item panel">
            <div className="card-title mb-4">{t("heading")}</div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("table.planCode", { default: "Plan Code" })}</th>
                    <th>{t("table.machine")}</th>
                    <th>{t("table.module")}</th>
                    <th>{t("table.instruction")}</th>
                    <th>{t("table.frequency")}</th>
                    <th>{t("table.responsable")}</th>
                    <th>{t("table.status")}</th>
                    <th className="text-end">{tCommon("table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedTasks.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-gray-500">
                        <p>{t("empty.default")}</p>
                        {tasks.length === 0 && <p className="mt-1 text-sm">{t("emptyGuidance")}</p>}
                      </td>
                    </tr>
                  ) : (
                    paginatedTasks.map((task) => (
                      <tr key={task.id} className={task.completed ? "bg-emerald-50" : ""}>
                        <td>{displayText(task.plan_id, "—")}</td>
                        <td>{getMachineName(task.moduleId)}</td>
                        <td>{getModuleName(task.moduleId)}</td>
                        <td><span className="block max-w-[24rem] truncate" title={task.instruction}>{task.instruction}</span></td>
                        <td>{task.frequency || "—"}</td>
                        <td>{task.responsable || "—"}</td>
                        <td>
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                              task.completed
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {task.completed ? t("status.completed") : t("status.pending")}
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-wrap justify-end gap-2">
                            {task.source === "manual" && <button
                              type="button"
                              onClick={() => toggleTaskCompletion(task)}
                              aria-label={task.completed ? t("status.completed") : t("actions.complete")}
                              title={task.completed ? t("status.completed") : t("actions.complete")}
                              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                            >
                              <CheckIcon className="h-4 w-4 shrink-0" />
                              <span>{task.completed ? t("status.completed") : t("actions.complete")}</span>
                            </button>}
                            {task.source === "manual" && <button
                              type="button"
                              onClick={() => openEditForm(task)}
                              aria-label={tCommon("edit")}
                              title={tCommon("edit")}
                              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                            >
                              <PencilIcon className="h-4 w-4 shrink-0" />
                              <span>{tCommon("edit")}</span>
                            </button>}
                            <button
                              type="button"
                              onClick={() => openTaskDetails(task)}
                              aria-label={t("actions.view")}
                              title={t("actions.view")}
                              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                            >
                              <EyeIcon className="h-4 w-4 shrink-0" />
                              <span>{t("actions.view")}</span>
                            </button>
                            {task.source === "manual" && <button
                              type="button"
                              onClick={() => void deleteTask(task)}
                              aria-label={t("actions.delete")}
                              title={t("actions.delete")}
                              className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                            >
                              <TrashIcon className="h-4 w-4 shrink-0" />
                              <span>{t("actions.delete")}</span>
                            </button>}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {filteredTasks.length > 0 && (
                <div className="mt-4">
                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  totalItems={filteredTasks.length}
                  limit={limit}
                  onPageChange={setPage}
                  className="mt-2"
                />
                </div>
              )}
              </div>
            </div>
        </div>

        <Modal
          isOpen={isFormModalOpen}
          onClose={() => {
            setIsFormModalOpen(false);
            resetForm();
          }}
          title={
            editingTask
              ? t("modal.editTask")
              : t("modal.addTask")
          }
          size="lg"
        >
          <form onSubmit={handleFormSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("table.planCode", { default: "Plan Code" })}</label>
                <input
                  type="text"
                  value={formData.plan_id}
                  onChange={(e) => setFormData({ ...formData, plan_id: e.target.value })}
                  className="input-field"
                  placeholder={t("table.planCode", { default: "Plan Code" })}
                  title={t("table.planCode", { default: "Plan Code" })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("table.module")}</label>
                <select
                  value={formData.moduleId}
                  onChange={(e) => setFormData({ ...formData, moduleId: e.target.value })}
                  className="input-field"
                  title={t("table.module")}
                >
                  <option value="">—</option>
                  {modules.map((module) => (
                    <option key={module._id} value={module._id}>
                      {displayText(module.module_id, "—")}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("table.responsable")}</label>
                <input
                  type="text"
                  value={formData.responsable}
                  onChange={(e) => setFormData({ ...formData, responsable: e.target.value })}
                  className="input-field"
                  placeholder={t("table.responsable")}
                  title={t("table.responsable")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("table.status")}</label>
                <select
                  value={formData.completed ? "completed" : "pending"}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      completed: e.target.value === "completed",
                    })
                  }
                  className="input-field"
                  title={t("table.status")}
                >
                  <option value="pending">{t("status.pending")}</option>
                  <option value="completed">{t("status.completed")}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">{t("table.instruction")}</label>
              <textarea
                value={formData.instruction}
                onChange={(e) => setFormData({ ...formData, instruction: e.target.value })}
                className="input-field min-h-28"
                placeholder={t("placeholders.taskName")}
                title={t("table.instruction")}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">{t("form.notes")}</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="input-field min-h-24"
                placeholder={t("placeholders.notes")}
                title={t("form.notes")}
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setIsFormModalOpen(false);
                  resetForm();
                }}
                className="btn-secondary"
              >
                {tCommon("actions.cancel")}
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitLabel}
              </button>
            </div>
          </form>
        </Modal>

        {/* Task Details Modal */}
        <Modal
          isOpen={showModal && Boolean(selectedTask)}
          onClose={closeModal}
          title={t("modal.taskDetails")}
          size="lg"
        >
          {selectedTask && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!selectedTask.completed && selectedTask.source === "manual") {
                  markTaskComplete();
                }
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("table.planCode", { default: "Plan Code" })}</label>
                  <input type="text" value={selectedTask.plan_id} className="input-field" readOnly />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("table.machine")}</label>
                  <input type="text" value={getMachineName(selectedTask.moduleId)} className="input-field" readOnly />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("table.module")}</label>
                  <input type="text" value={getModuleName(selectedTask.moduleId)} className="input-field" readOnly />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("table.responsable")}</label>
                  <input type="text" value={selectedTask.responsable ?? ""} className="input-field" readOnly />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t("table.instruction")}</label>
                <textarea value={selectedTask.instruction} className="input-field min-h-24" readOnly />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t("form.notes")}</label>
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder={t("placeholders.notes")}
                  className="input-field min-h-24"
                  readOnly={selectedTask.source === "plan"}
                />
              </div>

              {selectedTask.completedAt && (
                <div>
                  <label className="block text-sm font-medium mb-1">{t("modal.completedAt")}</label>
                  <input
                    type="text"
                    value={new Date(selectedTask.completedAt).toLocaleString()}
                    className="input-field"
                    readOnly
                  />
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-4">
                {selectedTask.planId && <Link className="btn-secondary" href={`/${locale}/maintenance-plans?planId=${encodeURIComponent(selectedTask.planId)}`}>{t("viewPlan")}</Link>}
                {relatedWorkOrderId && <Link className="btn-secondary" href={`/${locale}/work-orders/${encodeURIComponent(relatedWorkOrderId)}`}>{t("backToWorkOrder")}</Link>}
                <button type="button" onClick={closeModal} className="btn-secondary">
                  {tCommon("actions.cancel")}
                </button>
                {!selectedTask.completed && selectedTask.source === "manual" && (
                  <button type="submit" className="btn-primary">
                    {t("actions.complete")}
                  </button>
                )}
              </div>
            </form>
          )}
        </Modal>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
