"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PencilIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import DashboardLayout from "@/components/DashboardLayout";
import DynamicSearchControls from "@/components/DynamicSearchControls";
import { Modal } from "@/components/Modal";
import {
  ToastNotification,
  type ToastNotificationState,
} from "@/components/ToastNotification";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { displayText } from "@/services/displayValues";
import {
  ALL_FIELDS_TOKEN,
  getSearchableFields,
  matchesDynamicSearch,
} from "@/services/dynamicSearch";
import Pagination from "@/components/Pagination";

interface PanneItem {
  _id: string;
  panne_id: string;
  code_panne: string;
  description: string;
}

interface PanneRef {
  _id: string;
  panne_id?: string;
  code_panne?: string;
  description?: string;
}

interface PanneSolution {
  _id: string;
  solution_id: string;
  panne_id: string | PanneRef;
  cause_probable?: string;
  solution_recommandee?: string;
}

const CUSTOM_OPTION = "__custom__";

function getPanneLabel(panne: string | PanneRef): string {
  if (typeof panne === "string") return displayText(panne, "");
  const code = panne?.code_panne ? ` (${panne.code_panne})` : "";
  const label = displayText(panne?.panne_id ?? panne?.description, "");
  return `${label}${code}`.trim();
}

function getPanneRefId(ref: string | PanneRef): string {
  return typeof ref === "string" ? ref : ref?._id || "";
}

export default function PanneSolutionsPage() {
  const t = useTranslations("panneSolutions");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { user } = useAuth();
  const isOperator = user?.role === "operator";

  const [solutions, setSolutions] = useState<PanneSolution[]>([]);
  const [pannes, setPannes] = useState<PanneItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSearchField, setSelectedSearchField] =
    useState(ALL_FIELDS_TOKEN);
  const [showModal, setShowModal] = useState(false);
  const [editingSolution, setEditingSolution] = useState<PanneSolution | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] =
    useState<ToastNotificationState | null>(null);
  const [formData, setFormData] = useState({
    solution_id: "",
    panne_id: "",
    cause_probable: "",
    solution_recommandee: "",
    details: "",
  });
  const [customMode, setCustomMode] = useState({
    solution_id: false,
    cause_probable: false,
    solution_recommandee: false,
  });

  async function loadData() {
    try {
      const [solutionsRes, pannesRes] = await Promise.all([
        apiService.getPanneSolutions({ page, limit }),
        apiService.getPannes(),
      ]);

      const data = solutionsRes.data;

      setSolutions(data.items ?? []);
      setPage(data.page ?? 1);
      setLimit(data.limit ?? 10);
      setTotalPages(data.totalPages ?? 1);
      setTotalItems(data.totalItems ?? 0);
      setPannes(pannesRes.data.items || []);
    } catch (error) {
      console.error("Error loading panne solutions:", error);
    } finally {
      setLoading(false);
    }
  }

  async function refreshData() {
    await loadData();
    router.refresh();
    window.dispatchEvent(new Event("panne-solutions:changed"));
  }

  function showNotification(type: "success" | "error", message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  const searchableSolutions = useMemo(
    () =>
      solutions.map((solution) => ({
        ...solution,
        panne_label: getPanneLabel(solution.panne_id),
      })),
    [solutions],
  );

  const searchableFields = useMemo(
    () => getSearchableFields(searchableSolutions),
    [searchableSolutions],
  );

  const filteredSolutions = useMemo(
    () =>
      searchableSolutions.filter((solution) =>
        matchesDynamicSearch(solution, searchTerm, selectedSearchField),
      ),
    [searchableSolutions, searchTerm, selectedSearchField],
  );

  const solutionTemplatesByPanne = useMemo(() => {
    const map = new Map<string, PanneSolution>();
    solutions.forEach((solution) => {
      const panneRefId = getPanneRefId(solution.panne_id);
      if (panneRefId) map.set(panneRefId, solution);
    });
    return map;
  }, [solutions]);

  const causeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          solutions.map((item) => item.cause_probable || "").filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [solutions],
  );

  const recommendationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          solutions
            .map((item) => item.solution_recommandee || "")
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [solutions],
  );

  function applyTemplateFromPanneId(panneRefId: string) {
    const template = solutionTemplatesByPanne.get(panneRefId);
    const panne = pannes.find((item) => item._id === panneRefId);
    const generatedSolutionId = panne ? `${panne.panne_id}-SOL` : "";

    setFormData((prev) => ({
      ...prev,
      panne_id: panneRefId,
      solution_id: template?.solution_id || generatedSolutionId,
      cause_probable: template?.cause_probable || prev.cause_probable,
      solution_recommandee:
        template?.solution_recommandee || prev.solution_recommandee,
    }));
  }

  const solutionIdOptions = useMemo(() => {
    return pannes
      .map((panne) => {
        const template = solutionTemplatesByPanne.get(panne._id);
        const solutionId = template?.solution_id || `${panne.panne_id}-SOL`;
        return {
          panneRefId: panne._id,
          solutionId,
          label: `${solutionId} (${panne.panne_id})`,
        };
      })
      .sort((a, b) => a.solutionId.localeCompare(b.solutionId));
  }, [pannes, solutionTemplatesByPanne]);

  function resetForm() {
    setFormData({
      solution_id: "",
      panne_id: "",
      cause_probable: "",
      solution_recommandee: "",
      details: "",
    });
    setCustomMode({
      solution_id: false,
      cause_probable: false,
      solution_recommandee: false,
    });
    setEditingSolution(null);
  }

  function validateForm(): boolean {
    if (!formData.solution_id.trim()) {
      showNotification(
        "error",
        t("notifications.solutionReferenceRequired", {
          default: "Solution reference is required",
        }),
      );
      return false;
    }
    if (!formData.panne_id) {
      showNotification("error", t("notifications.panneRequired"));
      return false;
    }
    return true;
  }

  function openCreateModal() {
    resetForm();
    setShowModal(true);
  }

  function openEditModal(solution: PanneSolution) {
    setEditingSolution(solution);
    setFormData({
      solution_id: solution.solution_id ?? "",
      panne_id: getPanneRefId(solution.panne_id),
      cause_probable: solution.cause_probable ?? "",
      solution_recommandee: solution.solution_recommandee ?? "",
      details: "",
    });
    setCustomMode({
      solution_id: false,
      cause_probable: false,
      solution_recommandee: false,
    });
    setShowModal(true);
  }

  async function handleDelete(id: string) {
    if (!confirm(t("notifications.confirmDelete"))) return;

    try {
      await apiService.deletePanneSolution(id);
      await refreshData();
      showNotification("success", t("notifications.deleted"));
    } catch (error) {
      console.error("Error deleting panne solution:", error);
      showNotification("error", t("notifications.deleteFailed"));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);

    try {
      const recommendationWithDetails = formData.details.trim()
        ? `${formData.solution_recommandee.trim()}\nDetails: ${formData.details.trim()}`
        : formData.solution_recommandee.trim();

      const payload: Record<string, unknown> = {
        solution_id: formData.solution_id.trim(),
        panne_id: formData.panne_id,
      };

      if (formData.cause_probable.trim())
        payload.cause_probable = formData.cause_probable.trim();
      if (recommendationWithDetails.trim())
        payload.solution_recommandee = recommendationWithDetails;

      if (editingSolution) {
        await apiService.updatePanneSolution(editingSolution._id, payload);
        showNotification("success", t("notifications.updated"));
      } else {
        await apiService.createPanneSolution(payload);
        showNotification("success", t("notifications.created"));
      }

      setShowModal(false);
      resetForm();
      await refreshData();
    } catch (error) {
      console.error("Error saving panne solution:", error);
      showNotification("error", t("notifications.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    loadData();
    // loadData intentionally reads the current pagination state; wrapping it here would change the page's existing refresh behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit]);

  useEffect(() => {
    const handleChanged = () => {
      loadData();
    };

    window.addEventListener("panne-solutions:changed", handleChanged);
    window.addEventListener("focus", handleChanged);

    return () => {
      window.removeEventListener("panne-solutions:changed", handleChanged);
      window.removeEventListener("focus", handleChanged);
    };
    // keep the existing event listener lifecycle stable; loadData reads current state when the event fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <DashboardLayout title={t("title")}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  let submitLabel = tCommon("actions.create");
  if (submitting) {
    submitLabel = tCommon("saving");
  } else if (editingSolution) {
    submitLabel = tCommon("actions.update");
  }

  return (
    <DashboardLayout title={t("title")}>
      <ToastNotification
        notification={notification}
        onClose={() => setNotification(null)}
        closeLabel={tCommon("close")}
      />

      <div className="bento-grid">
        <div className="col-span-full mb-6 bento-item">
          <div className="panel">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">
                  {t("heading")}
                </h1>
                <p className="text-slate-600 mt-1">{t("description")}</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-end">
                  <div className="text-3xl font-bold text-blue-600">
                    {totalItems}
                  </div>
                  <div className="text-sm text-slate-500">
                    {t("totalSolutions")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="btn-primary flex items-center space-x-2"
                >
                  <PlusIcon className="w-4 h-4" />
                  <span>{t("actions.add")}</span>
                </button>
              </div>
            </div>

            <DynamicSearchControls
              selectedField={selectedSearchField}
              onSelectedFieldChange={setSelectedSearchField}
              searchableFields={searchableFields}
              allFieldsLabel={tCommon("table.allFields", {
                default: "All fields",
              })}
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              searchPlaceholder={t("searchPlaceholder")}
            />
          </div>
        </div>

        <div className="col-span-full bento-item panel">
          <div className="card-title">{t("allSolutions")}</div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    {t("table.solutionReference", {
                      default: "Solution Reference",
                    })}
                  </th>
                  <th>{t("table.panne")}</th>
                  <th>{t("table.cause")}</th>
                  <th>{t("table.solution")}</th>
                  <th>{tCommon("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSolutions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-gray-500">
                      {searchTerm ? t("empty.search") : t("empty.default")}
                    </td>
                  </tr>
                ) : (
                  filteredSolutions.map((solution) => (
                    <tr key={solution._id}>
                      <td className="font-medium">{solution.solution_id}</td>
                      <td>
                        {getPanneLabel(solution.panne_id) ||
                          tCommon("notAvailable")}
                      </td>
                      <td>
                        {solution.cause_probable || tCommon("notAvailable")}
                      </td>
                      <td>
                        {solution.solution_recommandee ||
                          tCommon("notAvailable")}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(solution)}
                            aria-label={`${t("actions.edit")} ${solution.solution_id}`}
                            title={t("actions.edit")}
                            className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <PencilIcon className="h-4 w-4 shrink-0" />
                            <span>{t("actions.edit")}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(solution._id)}
                            aria-label={`${t("actions.delete")} ${solution.solution_id}`}
                            title={t("actions.delete")}
                            className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <TrashIcon className="h-4 w-4 shrink-0" />
                            <span>{t("actions.delete")}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              limit={limit}
              onPageChange={(newPage) => setPage(newPage)}
            />
          </div>
        </div>
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingSolution ? t("modal.edit") : t("modal.add")}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {t("form.solutionReference", { default: "Solution Reference" })}
              </label>
              {isOperator ? (
                <select
                  value={formData.solution_id}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_OPTION) {
                      setCustomMode((prev) => ({ ...prev, solution_id: true }));
                      setFormData((prev) => ({ ...prev, solution_id: "" }));
                      return;
                    }
                    setCustomMode((prev) => ({ ...prev, solution_id: false }));
                    const selected = solutionIdOptions.find(
                      (item) => item.solutionId === e.target.value,
                    );
                    if (selected) {
                      applyTemplateFromPanneId(selected.panneRefId);
                    } else {
                      setFormData((prev) => ({
                        ...prev,
                        solution_id: e.target.value,
                      }));
                    }
                  }}
                  className="input-field"
                  title={t("form.solutionReference", {
                    default: "Solution Reference",
                  })}
                  required
                >
                  <option value="">
                    {t("form.solutionReference", {
                      default: "Solution Reference",
                    })}
                  </option>
                  <option value={CUSTOM_OPTION}>Custom value...</option>
                  {solutionIdOptions.map((option) => (
                    <option
                      key={`${option.panneRefId}-solution`}
                      value={option.solutionId}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={formData.solution_id}
                  onChange={(e) =>
                    setFormData({ ...formData, solution_id: e.target.value })
                  }
                  className="input-field"
                  title={t("form.solutionReference", {
                    default: "Solution Reference",
                  })}
                  required
                />
              )}
              {isOperator && customMode.solution_id && (
                <input
                  type="text"
                  value={formData.solution_id}
                  onChange={(e) =>
                    setFormData({ ...formData, solution_id: e.target.value })
                  }
                  className="input-field mt-2"
                  title={t("form.solutionReference", {
                    default: "Solution Reference",
                  })}
                  placeholder="Custom solution reference"
                  required
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {t("form.panne")}
              </label>
              <select
                value={formData.panne_id}
                onChange={(e) => {
                  if (isOperator) {
                    applyTemplateFromPanneId(e.target.value);
                    return;
                  }
                  setFormData({ ...formData, panne_id: e.target.value });
                }}
                className="input-field"
                title={t("form.panne")}
                required
              >
                <option value="">{t("form.selectPanne")}</option>
                {pannes.map((panne) => (
                  <option key={panne._id} value={panne._id}>
                    {panne.panne_id} ({panne.code_panne})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              {t("form.cause")}
            </label>
            {isOperator ? (
              <select
                value={formData.cause_probable}
                onChange={(e) => {
                  if (e.target.value === CUSTOM_OPTION) {
                    setCustomMode((prev) => ({
                      ...prev,
                      cause_probable: true,
                    }));
                    setFormData((prev) => ({ ...prev, cause_probable: "" }));
                    return;
                  }
                  setCustomMode((prev) => ({ ...prev, cause_probable: false }));
                  setFormData({ ...formData, cause_probable: e.target.value });
                }}
                className="input-field"
                title={t("form.cause")}
              >
                <option value="">{t("form.cause")}</option>
                <option value={CUSTOM_OPTION}>Custom value...</option>
                {causeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <textarea
                value={formData.cause_probable}
                onChange={(e) =>
                  setFormData({ ...formData, cause_probable: e.target.value })
                }
                className="input-field"
                title={t("form.cause")}
                rows={3}
              />
            )}
            {isOperator && customMode.cause_probable && (
              <textarea
                value={formData.cause_probable}
                onChange={(e) =>
                  setFormData({ ...formData, cause_probable: e.target.value })
                }
                className="input-field mt-2"
                title={t("form.cause")}
                rows={3}
                placeholder="Custom probable cause"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              {t("form.solution")}
            </label>
            {isOperator ? (
              <select
                value={formData.solution_recommandee}
                onChange={(e) => {
                  if (e.target.value === CUSTOM_OPTION) {
                    setCustomMode((prev) => ({
                      ...prev,
                      solution_recommandee: true,
                    }));
                    setFormData((prev) => ({
                      ...prev,
                      solution_recommandee: "",
                    }));
                    return;
                  }
                  setCustomMode((prev) => ({
                    ...prev,
                    solution_recommandee: false,
                  }));
                  setFormData({
                    ...formData,
                    solution_recommandee: e.target.value,
                  });
                }}
                className="input-field"
                title={t("form.solution")}
              >
                <option value="">{t("form.solution")}</option>
                <option value={CUSTOM_OPTION}>Custom value...</option>
                {recommendationOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <textarea
                value={formData.solution_recommandee}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    solution_recommandee: e.target.value,
                  })
                }
                className="input-field"
                title={t("form.solution")}
                rows={3}
              />
            )}
            {isOperator && customMode.solution_recommandee && (
              <textarea
                value={formData.solution_recommandee}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    solution_recommandee: e.target.value,
                  })
                }
                className="input-field mt-2"
                title={t("form.solution")}
                rows={3}
                placeholder="Custom recommendation"
              />
            )}
          </div>

          <div>
            <label
              htmlFor="panne-solution-details"
              className="block text-sm font-medium text-gray-dark mb-1"
            >
              Additional details (optional)
            </label>
            <textarea
              id="panne-solution-details"
              value={formData.details}
              onChange={(e) =>
                setFormData({ ...formData, details: e.target.value })
              }
              className="input-field"
              rows={3}
              title="Additional details"
              placeholder="Add any extra context you want to keep with this record"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
              className="btn-secondary"
            >
              {tCommon("cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitLabel}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
