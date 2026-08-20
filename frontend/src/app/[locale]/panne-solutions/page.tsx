"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AdditionalDetailsField,
  CrudDataTablePanel,
  CrudListHeader,
  CrudLoadingState,
  FormFieldShell,
  InlineTextArea,
  InlineTextInput,
  ModalFormActions,
  RowActions,
  SelectField,
} from "@/components/CrudPageControls";
import DashboardLayout from "@/components/DashboardLayout";
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
    return <CrudLoadingState title={t("title")} />;
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
        <CrudListHeader
          heading={t("heading")}
          description={t("description")}
          totalItems={totalItems}
          totalLabel={t("totalSolutions")}
          addLabel={t("actions.add")}
          onAdd={openCreateModal}
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

        <CrudDataTablePanel
          title={t("allSolutions")}
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          limit={limit}
          onPageChange={setPage}
          paginationClassName="mt-0"
          items={filteredSolutions}
          getRowKey={(solution) => solution._id}
          emptyMessage={searchTerm ? t("empty.search") : t("empty.default")}
          actionsHeader={tCommon("table.actions")}
          columns={[
            {
              header: t("table.solutionReference", {
                default: "Solution Reference",
              }),
              className: "font-medium",
              render: (solution) => solution.solution_id,
            },
            {
              header: t("table.panne"),
              render: (solution) =>
                getPanneLabel(solution.panne_id) || tCommon("notAvailable"),
            },
            {
              header: t("table.cause"),
              render: (solution) =>
                solution.cause_probable || tCommon("notAvailable"),
            },
            {
              header: t("table.solution"),
              render: (solution) =>
                solution.solution_recommandee || tCommon("notAvailable"),
            },
          ]}
          renderActions={(solution) => (
            <RowActions
              editLabel={t("actions.edit")}
              deleteLabel={t("actions.delete")}
              itemLabel={solution.solution_id}
              onEdit={() => openEditModal(solution)}
              onDelete={() => handleDelete(solution._id)}
            />
          )}
        />
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
            <FormFieldShell
              label={t("form.solutionReference", {
                default: "Solution Reference",
              })}
            >
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
                <InlineTextInput
                  value={formData.solution_id}
                  onChange={(solution_id) =>
                    setFormData({ ...formData, solution_id })
                  }
                  title={t("form.solutionReference", {
                    default: "Solution Reference",
                  })}
                  required
                />
              )}
              {isOperator && customMode.solution_id && (
                <InlineTextInput
                  value={formData.solution_id}
                  onChange={(solution_id) =>
                    setFormData({ ...formData, solution_id })
                  }
                  className="input-field mt-2"
                  title={t("form.solutionReference", {
                    default: "Solution Reference",
                  })}
                  placeholder="Custom solution reference"
                  required
                />
              )}
            </FormFieldShell>
            <SelectField
              label={t("form.panne")}
              value={formData.panne_id}
              onChange={(value) => {
                if (isOperator) {
                  applyTemplateFromPanneId(value);
                  return;
                }
                setFormData({ ...formData, panne_id: value });
              }}
              title={t("form.panne")}
              required
            >
              <option value="">{t("form.selectPanne")}</option>
              {pannes.map((panne) => (
                <option key={panne._id} value={panne._id}>
                  {panne.panne_id} ({panne.code_panne})
                </option>
              ))}
            </SelectField>
          </div>

          <FormFieldShell label={t("form.cause")}>
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
              <InlineTextArea
                value={formData.cause_probable}
                onChange={(cause_probable) =>
                  setFormData({ ...formData, cause_probable })
                }
                title={t("form.cause")}
                rows={3}
              />
            )}
            {isOperator && customMode.cause_probable && (
              <InlineTextArea
                value={formData.cause_probable}
                onChange={(cause_probable) =>
                  setFormData({ ...formData, cause_probable })
                }
                className="input-field mt-2"
                title={t("form.cause")}
                rows={3}
                placeholder="Custom probable cause"
              />
            )}
          </FormFieldShell>

          <FormFieldShell label={t("form.solution")}>
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
              <InlineTextArea
                value={formData.solution_recommandee}
                onChange={(solution_recommandee) =>
                  setFormData({
                    ...formData,
                    solution_recommandee,
                  })
                }
                title={t("form.solution")}
                rows={3}
              />
            )}
            {isOperator && customMode.solution_recommandee && (
              <InlineTextArea
                value={formData.solution_recommandee}
                onChange={(solution_recommandee) =>
                  setFormData({
                    ...formData,
                    solution_recommandee,
                  })
                }
                className="input-field mt-2"
                title={t("form.solution")}
                rows={3}
                placeholder="Custom recommendation"
              />
            )}
          </FormFieldShell>

          <AdditionalDetailsField
            id="panne-solution-details"
            label="Additional details (optional)"
            value={formData.details}
            onChange={(details) => setFormData({ ...formData, details })}
            title="Additional details"
            placeholder="Add any extra context you want to keep with this record"
          />

          <ModalFormActions
            cancelLabel={tCommon("cancel")}
            submitLabel={submitLabel}
            submitting={submitting}
            onCancel={() => {
              setShowModal(false);
              resetForm();
            }}
            withTopBorder
          />
        </form>
      </Modal>
    </DashboardLayout>
  );
}
