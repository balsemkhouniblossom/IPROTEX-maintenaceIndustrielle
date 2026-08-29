"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AdditionalDetailsField,
  CrudDataTablePanel,
  CrudLoadingState,
  CrudPageScaffold,
  FormFieldShell,
  InlineSelectInput,
  InlineTextArea,
  InlineTextInput,
  ModalFormActions,
  RowActions,
  SelectField,
} from "@/components/CrudPageControls";
import { Modal } from "@/components/Modal";
import type { ToastNotificationState } from "@/components/ToastNotification";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { displayText } from "@/services/displayValues";
import {
  ALL_FIELDS_TOKEN,
  getSearchableFields,
  matchesDynamicSearch,
} from "@/services/dynamicSearch";

interface Panne {
  _id: string;
  panne_id: string;
  code_panne: string;
  description: string;
  gravite?: string;
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

type FailureRow = Panne & {
  solutions: PanneSolution[];
  solution_cause: string;
  solution_recommendation: string;
};

type PanneFormData = {
  panne_id: string;
  code_panne: string;
  description: string;
  gravite: string;
  details: string;
};

type SolutionFormData = {
  solution_id: string;
  panne_id: string;
  cause_probable: string;
  solution_recommandee: string;
  details: string;
};

const FAILURE_SEARCH_FIELDS = [
  "panne_id",
  "code_panne",
  "description",
  "gravite",
  "solution_cause",
  "solution_recommendation",
] as const;

function getPanneSubmitLabel(
  submitting: boolean,
  editing: boolean,
  savingLabel: string,
  updateLabel: string,
  createLabel: string,
): string {
  if (submitting) return savingLabel;
  return editing ? updateLabel : createLabel;
}

function getPanneLabel(panne: string | PanneRef): string {
  if (typeof panne === "string") return displayText(panne, "");
  const code = panne?.code_panne ? ` (${panne.code_panne})` : "";
  const label = displayText(panne?.panne_id ?? panne?.description, "");
  return `${label}${code}`.trim();
}

function getPanneRefId(ref: string | PanneRef): string {
  return typeof ref === "string" ? ref : ref?._id || "";
}

function groupSolutionsByPanne(
  solutions: PanneSolution[],
): Map<string, PanneSolution[]> {
  const map = new Map<string, PanneSolution[]>();

  solutions.forEach((solution) => {
    const panneRefId = getPanneRefId(solution.panne_id);
    if (!panneRefId) return;

    const grouped = map.get(panneRefId) ?? [];
    grouped.push(solution);
    map.set(panneRefId, grouped);
  });

  return map;
}

function matchesFailureSearch(
  panne: FailureRow,
  searchTerm: string,
  selectedSearchField: string,
): boolean {
  if (selectedSearchField !== ALL_FIELDS_TOKEN) {
    return matchesDynamicSearch(panne, searchTerm, selectedSearchField, 3);
  }

  return FAILURE_SEARCH_FIELDS.some((field) =>
    matchesDynamicSearch(panne, searchTerm, field, 3),
  );
}

function getDefaultSolutionId(panne: Panne, solutionCount: number): string {
  if (solutionCount > 0) {
    return `${panne.panne_id}-SOL-${solutionCount + 1}`;
  }

  return `${panne.panne_id}-SOL`;
}

function getToggleLabel(
  expanded: boolean,
  solutionCount: number,
  collapseLabel: string,
  solutionsLabel: string,
): string {
  if (expanded) return collapseLabel;
  return `${solutionCount} ${solutionsLabel}`;
}

function getVisibleSolutions(
  solutions: PanneSolution[],
  expanded: boolean,
): PanneSolution[] {
  if (expanded) return solutions;
  return solutions.slice(0, 1);
}

function getSolutionPanneDisplayValue(
  solutionPanne: Panne | null,
  fallbackPanneId: string,
): string {
  if (solutionPanne) {
    return `${solutionPanne.panne_id} (${solutionPanne.code_panne})`;
  }

  return getPanneLabel(fallbackPanneId);
}

function getPanneEmptyMessage(
  searchTerm: string,
  searchEmptyLabel: string,
  defaultEmptyLabel: string,
): string {
  if (searchTerm) return searchEmptyLabel;
  return defaultEmptyLabel;
}

function getModalTitle(
  editing: boolean,
  editLabel: string,
  addLabel: string,
): string {
  if (editing) return editLabel;
  return addLabel;
}

function getSolutionIdOptions(solutionPanne: Panne | null) {
  if (!solutionPanne) return [];

  return [
    {
      key: `${solutionPanne._id}-solution`,
      value: `${solutionPanne.panne_id}-SOL`,
      label: `${solutionPanne.panne_id}-SOL`,
    },
  ];
}

const CUSTOM_OPTION = "__custom__";

export default function PannesPage() {
  const t = useTranslations("pannes");
  const tSolutions = useTranslations("panneSolutions");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { user } = useAuth();
  const isOperator = user?.role === "operator";

  const [pannes, setPannes] = useState<Panne[]>([]);
  const [solutions, setSolutions] = useState<PanneSolution[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSearchField, setSelectedSearchField] =
    useState(ALL_FIELDS_TOKEN);
  const [showPanneModal, setShowPanneModal] = useState(false);
  const [showSolutionModal, setShowSolutionModal] = useState(false);
  const [editingPanne, setEditingPanne] = useState<Panne | null>(null);
  const [editingSolution, setEditingSolution] = useState<PanneSolution | null>(
    null,
  );
  const [solutionPanne, setSolutionPanne] = useState<Panne | null>(null);
  const [submittingPanne, setSubmittingPanne] = useState(false);
  const [submittingSolution, setSubmittingSolution] = useState(false);
  const [expandedSolutionRows, setExpandedSolutionRows] = useState<Set<string>>(
    () => new Set(),
  );
  const [notification, setNotification] =
    useState<ToastNotificationState | null>(null);
  const [formData, setFormData] = useState<PanneFormData>({
    panne_id: "",
    code_panne: "",
    description: "",
    gravite: "",
    details: "",
  });
  const [solutionFormData, setSolutionFormData] = useState<SolutionFormData>({
    solution_id: "",
    panne_id: "",
    cause_probable: "",
    solution_recommandee: "",
    details: "",
  });
  const [customMode, setCustomMode] = useState({
    panne_id: false,
    code_panne: false,
    description: false,
    gravite: false,
  });
  const [solutionCustomMode, setSolutionCustomMode] = useState({
    solution_id: false,
    cause_probable: false,
    solution_recommandee: false,
  });

  async function loadData(pageNumber = page) {
    try {
      const [pannesRes, solutionsList] = await Promise.all([
        apiService.getPannes({
          page: pageNumber,
          limit,
        }),
        apiService.fetchAllFromPaginatedEndpoint<PanneSolution>(
          apiService.getPanneSolutions,
        ),
      ]);

      const data = pannesRes.data;

      setPannes(data?.items || []);
      setSolutions(solutionsList);
      setPage(data?.page || 1);
      setTotalPages(data?.totalPages || 1);
      setTotalItems(data?.totalItems || 0);
    } catch (error) {
      console.error("Error loading failures:", error);
      setPannes([]);
      setSolutions([]);
    } finally {
      setLoading(false);
    }
  }

  function handlePageChange(newPage: number) {
    void loadData(newPage);
  }

  async function refreshFailures() {
    await loadData(page);
    router.refresh();
    window.dispatchEvent(new Event("pannes:changed"));
    window.dispatchEvent(new Event("panne-solutions:changed"));
  }

  function showNotification(type: "success" | "error", message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  function commonMessage(key: string, fallback: string): string {
    return tCommon.has(key) ? tCommon(key) : fallback;
  }

  const solutionsByPanne = useMemo(
    () => groupSolutionsByPanne(solutions),
    [solutions],
  );

  const failureRows = useMemo<FailureRow[]>(
    () =>
      pannes.map((panne) => {
        const rowSolutions = solutionsByPanne.get(panne._id) ?? [];
        const primarySolution = rowSolutions[0];

        return {
          ...panne,
          solutions: rowSolutions,
          solution_cause: primarySolution?.cause_probable ?? "",
          solution_recommendation:
            primarySolution?.solution_recommandee ?? "",
        };
      }),
    [pannes, solutionsByPanne],
  );

  const searchableFields = useMemo(
    () =>
      getSearchableFields(failureRows, {
        include: [...FAILURE_SEARCH_FIELDS],
        maxFields: FAILURE_SEARCH_FIELDS.length,
      }),
    [failureRows],
  );

  const filteredFailures = useMemo(
    () =>
      failureRows.filter((panne) =>
        matchesFailureSearch(panne, searchTerm, selectedSearchField),
      ),
    [failureRows, searchTerm, selectedSearchField],
  );

  const panneTemplates = useMemo(() => {
    const byId = new Map<string, Panne>();
    pannes.forEach((panne) => {
      if (panne?.panne_id) byId.set(panne.panne_id, panne);
    });
    return Array.from(byId.values()).sort((a, b) =>
      a.panne_id.localeCompare(b.panne_id),
    );
  }, [pannes]);

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

  const gravityOptions = ["Trouble (Probleme)", "Warning (Avertissement)"];

  function applyPanneTemplate(selectedPanneId: string) {
    const template = panneTemplates.find(
      (item) => item.panne_id === selectedPanneId,
    );
    if (!template) {
      setFormData((prev) => ({ ...prev, panne_id: selectedPanneId }));
      return;
    }

    setFormData({
      panne_id: template.panne_id ?? "",
      code_panne: template.code_panne ?? "",
      description: template.description ?? "",
      gravite: template.gravite ?? "",
      details: "",
    });
  }

  function resetForm() {
    setFormData({
      panne_id: "",
      code_panne: "",
      description: "",
      gravite: "",
      details: "",
    });
    setCustomMode({
      panne_id: false,
      code_panne: false,
      description: false,
      gravite: false,
    });
    setEditingPanne(null);
  }

  function resetSolutionForm() {
    setSolutionFormData({
      solution_id: "",
      panne_id: "",
      cause_probable: "",
      solution_recommandee: "",
      details: "",
    });
    setSolutionCustomMode({
      solution_id: false,
      cause_probable: false,
      solution_recommandee: false,
    });
    setEditingSolution(null);
    setSolutionPanne(null);
  }

  function validateForm(): boolean {
    if (!formData.panne_id.trim()) {
      showNotification(
        "error",
        t("notifications.faultReferenceRequired", {
          default: "Fault reference is required",
        }),
      );
      return false;
    }
    if (!formData.code_panne.trim()) {
      showNotification("error", t("notifications.codeRequired"));
      return false;
    }
    if (!formData.description.trim()) {
      showNotification("error", t("notifications.descriptionRequired"));
      return false;
    }
    return true;
  }

  function validateSolutionForm(): boolean {
    if (!solutionFormData.solution_id.trim()) {
      showNotification(
        "error",
        tSolutions("notifications.solutionReferenceRequired", {
          default: "Solution reference is required",
        }),
      );
      return false;
    }
    if (!solutionFormData.panne_id) {
      showNotification(
        "error",
        tSolutions("notifications.panneRequired"),
      );
      return false;
    }
    return true;
  }

  function openCreateModal() {
    resetForm();
    setShowPanneModal(true);
  }

  function openEditModal(panne: Panne) {
    setEditingPanne(panne);
    setFormData({
      panne_id: panne.panne_id ?? "",
      code_panne: panne.code_panne ?? "",
      description: panne.description ?? "",
      gravite: panne.gravite ?? "",
      details: "",
    });
    setCustomMode({
      panne_id: false,
      code_panne: false,
      description: false,
      gravite: false,
    });
    setShowPanneModal(true);
  }

  function openCreateSolutionModal(panne: Panne, solutionCount = 0) {
    resetSolutionForm();
    setSolutionPanne(panne);
    setSolutionFormData({
      solution_id: getDefaultSolutionId(panne, solutionCount),
      panne_id: panne._id,
      cause_probable: "",
      solution_recommandee: "",
      details: "",
    });
    setShowSolutionModal(true);
  }

  function openEditSolutionModal(solution: PanneSolution, panne: Panne) {
    setEditingSolution(solution);
    setSolutionPanne(panne);
    setSolutionFormData({
      solution_id: solution.solution_id ?? "",
      panne_id: getPanneRefId(solution.panne_id),
      cause_probable: solution.cause_probable ?? "",
      solution_recommandee: solution.solution_recommandee ?? "",
      details: "",
    });
    setSolutionCustomMode({
      solution_id: false,
      cause_probable: false,
      solution_recommandee: false,
    });
    setShowSolutionModal(true);
  }

  async function handleDelete(id: string) {
    if (!confirm(t("notifications.confirmDelete"))) return;

    try {
      await apiService.deletePanne(id);
      await refreshFailures();
      showNotification("success", t("notifications.deleted"));
    } catch (error) {
      console.error("Error deleting panne:", error);
      showNotification("error", t("notifications.deleteFailed"));
    }
  }

  async function handleDeleteSolution(id: string) {
    if (!confirm(tSolutions("notifications.confirmDelete"))) return;

    try {
      await apiService.deletePanneSolution(id);
      await refreshFailures();
      showNotification("success", tSolutions("notifications.deleted"));
    } catch (error) {
      console.error("Error deleting panne solution:", error);
      showNotification("error", tSolutions("notifications.deleteFailed"));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmittingPanne(true);

    try {
      const descriptionWithDetails = formData.details.trim()
        ? `${formData.description.trim()}\nDetails: ${formData.details.trim()}`
        : formData.description.trim();

      const payload: Record<string, unknown> = {
        panne_id: formData.panne_id.trim(),
        code_panne: formData.code_panne.trim(),
        description: descriptionWithDetails,
      };

      if (formData.gravite.trim()) payload.gravite = formData.gravite.trim();

      if (editingPanne) {
        await apiService.updatePanne(editingPanne._id, payload);
        showNotification("success", t("notifications.updated"));
      } else {
        await apiService.createPanne(payload);
        showNotification("success", t("notifications.created"));
      }

      setShowPanneModal(false);
      resetForm();
      await refreshFailures();
    } catch (error) {
      console.error("Error saving panne:", error);
      showNotification("error", t("notifications.saveFailed"));
    } finally {
      setSubmittingPanne(false);
    }
  }

  async function handleSolutionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateSolutionForm()) return;

    setSubmittingSolution(true);

    try {
      const recommendationWithDetails = solutionFormData.details.trim()
        ? `${solutionFormData.solution_recommandee.trim()}\nDetails: ${solutionFormData.details.trim()}`
        : solutionFormData.solution_recommandee.trim();

      const payload: Record<string, unknown> = {
        solution_id: solutionFormData.solution_id.trim(),
        panne_id: solutionFormData.panne_id,
      };

      if (solutionFormData.cause_probable.trim()) {
        payload.cause_probable = solutionFormData.cause_probable.trim();
      }
      if (recommendationWithDetails.trim()) {
        payload.solution_recommandee = recommendationWithDetails;
      }

      if (editingSolution) {
        await apiService.updatePanneSolution(editingSolution._id, payload);
        showNotification("success", tSolutions("notifications.updated"));
      } else {
        await apiService.createPanneSolution(payload);
        showNotification("success", tSolutions("notifications.created"));
      }

      setShowSolutionModal(false);
      resetSolutionForm();
      await refreshFailures();
    } catch (error) {
      console.error("Error saving panne solution:", error);
      showNotification("error", tSolutions("notifications.saveFailed"));
    } finally {
      setSubmittingSolution(false);
    }
  }

  function toggleSolutionDetails(panneId: string) {
    setExpandedSolutionRows((current) => {
      const next = new Set(current);
      if (next.has(panneId)) next.delete(panneId);
      else next.add(panneId);
      return next;
    });
  }

  function renderSolutionField(
    panne: FailureRow,
    field: "cause_probable" | "solution_recommandee",
  ) {
    const primarySolution = panne.solutions[0];
    const primaryText = primarySolution?.[field] || tCommon("notAvailable");
    const hasMultipleSolutions = panne.solutions.length > 1;
    const expanded = expandedSolutionRows.has(panne._id);
    const toggleLabel = getToggleLabel(
      expanded,
      panne.solutions.length,
      commonMessage("collapse", "Collapse"),
      tSolutions("title"),
    );

    return (
      <div className="min-w-56 max-w-md space-y-2">
        <p className="whitespace-pre-wrap text-sm">{primaryText}</p>
        {hasMultipleSolutions && (
          <button
            type="button"
            className="text-xs font-semibold text-blue-700 hover:text-blue-900"
            onClick={() => toggleSolutionDetails(panne._id)}
          >
            {toggleLabel}
          </button>
        )}
        {hasMultipleSolutions && expanded && (
          <div className="space-y-2 border-s-2 border-blue-100 ps-3">
            {panne.solutions.slice(1).map((solution) => (
              <p
                key={`${solution._id}-${field}`}
                className="whitespace-pre-wrap text-xs"
              >
                <span className="font-semibold">{solution.solution_id}: </span>
                {solution[field] || tCommon("notAvailable")}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderSolutionActions(panne: FailureRow) {
    if (panne.solutions.length === 0) {
      return (
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
          onClick={() => openCreateSolutionModal(panne)}
        >
          {tSolutions("actions.add")}
        </button>
      );
    }

    const expanded = expandedSolutionRows.has(panne._id);
    const visibleSolutions = getVisibleSolutions(panne.solutions, expanded);
    const toggleLabel = getToggleLabel(
      expanded,
      panne.solutions.length,
      commonMessage("collapse", "Collapse"),
      tSolutions("title"),
    );

    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
            onClick={() =>
              openCreateSolutionModal(panne, panne.solutions.length)
            }
          >
            {tSolutions("actions.add")}
          </button>
          {panne.solutions.length > 1 && (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              onClick={() => toggleSolutionDetails(panne._id)}
            >
              {toggleLabel}
            </button>
          )}
        </div>
        {visibleSolutions.map((solution) => (
            <RowActions
              key={solution._id}
              editLabel={tSolutions("actions.edit")}
              deleteLabel={tSolutions("actions.delete")}
              itemLabel={solution.solution_id}
              onEdit={() => openEditSolutionModal(solution, panne)}
              onDelete={() => handleDeleteSolution(solution._id)}
            />
        ))}
      </div>
    );
  }

  useEffect(() => {
    void loadData(1);
    // Initial load only; loadData is reused by pagination and refresh handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleChanged = () => {
      void loadData();
    };

    window.addEventListener("pannes:changed", handleChanged);
    window.addEventListener("panne-solutions:changed", handleChanged);
    window.addEventListener("focus", handleChanged);

    return () => {
      window.removeEventListener("pannes:changed", handleChanged);
      window.removeEventListener("panne-solutions:changed", handleChanged);
      window.removeEventListener("focus", handleChanged);
    };
    // keep the existing event listener lifecycle stable; loadData reads current state when the event fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <CrudLoadingState title={t("title")} />;
  }

  let solutionSubmitLabel = tCommon("actions.create");
  if (submittingSolution) {
    solutionSubmitLabel = tCommon("saving");
  } else if (editingSolution) {
    solutionSubmitLabel = tCommon("actions.update");
  }
  const panneEmptyMessage = getPanneEmptyMessage(
    searchTerm,
    t("empty.search"),
    t("empty.default"),
  );
  const panneModalTitle = getModalTitle(
    Boolean(editingPanne),
    t("modal.edit"),
    t("modal.add"),
  );
  const solutionModalTitle = getModalTitle(
    Boolean(editingSolution),
    tSolutions("modal.edit"),
    tSolutions("modal.add"),
  );
  const solutionPanneDisplayValue = getSolutionPanneDisplayValue(
    solutionPanne,
    solutionFormData.panne_id,
  );
  const solutionIdOptions = getSolutionIdOptions(solutionPanne);

  return (
    <CrudPageScaffold
      title={t("title")}
      heading={t("heading", { default: "Failures Management" })}
      description={t("description")}
      totalItems={totalItems}
      totalLabel={t("totalPannes")}
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
      notification={notification}
      onNotificationClose={() => setNotification(null)}
      closeLabel={tCommon("close")}
    >
      <CrudDataTablePanel
        title={t("allPannes")}
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        limit={limit}
        onPageChange={handlePageChange}
        items={filteredFailures}
        getRowKey={(panne) => panne._id}
        emptyMessage={panneEmptyMessage}
        actionsHeader={tCommon("table.actions")}
        columns={[
          {
            id: "fault-reference",
            header: t("table.faultReference", {
              default: "Fault Reference",
            }),
            className: "font-medium",
            render: (panne) => panne.panne_id,
          },
          {
            id: "code",
            header: t("table.code"),
            render: (panne) => panne.code_panne,
          },
          {
            id: "description",
            header: t("table.description"),
            render: (panne) => (
              <p className="max-w-md whitespace-pre-wrap text-sm">
                {panne.description}
              </p>
            ),
          },
          {
            id: "severity",
            header: t("table.severity"),
            render: (panne) => panne.gravite || tCommon("notAvailable"),
          },
          {
            id: "cause",
            header: tSolutions("table.cause"),
            render: (panne) => renderSolutionField(panne, "cause_probable"),
          },
          {
            id: "solution",
            header: tSolutions("table.solution"),
            render: (panne) =>
              renderSolutionField(panne, "solution_recommandee"),
          },
          {
            id: "solution-actions",
            header: tSolutions("title"),
            render: renderSolutionActions,
          },
        ]}
        renderActions={(panne) => (
          <RowActions
            editLabel={t("actions.edit")}
            deleteLabel={t("actions.delete")}
            itemLabel={panne.panne_id}
            onEdit={() => openEditModal(panne)}
            onDelete={() => handleDelete(panne._id)}
          />
        )}
      />

      <Modal
        isOpen={showPanneModal}
        onClose={() => {
          setShowPanneModal(false);
          resetForm();
        }}
        title={panneModalTitle}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormFieldShell
              label={t("form.faultReference", { default: "Fault Reference" })}
            >
              {isOperator ? (
                <InlineSelectInput
                  value={formData.panne_id}
                  onChange={(selectedValue) => {
                    if (selectedValue === CUSTOM_OPTION) {
                      setCustomMode((prev) => ({ ...prev, panne_id: true }));
                      setFormData((prev) => ({ ...prev, panne_id: "" }));
                      return;
                    }
                    setCustomMode((prev) => ({ ...prev, panne_id: false }));
                    applyPanneTemplate(selectedValue);
                  }}
                  title={t("form.faultReference", {
                    default: "Fault Reference",
                  })}
                  placeholder={t("form.faultReference", {
                    default: "Fault Reference",
                  })}
                  customOptionValue={CUSTOM_OPTION}
                  customOptionLabel="Custom value..."
                  options={panneTemplates.map((panne) => ({
                    key: panne._id,
                    value: panne.panne_id,
                    label: panne.panne_id,
                  }))}
                  required
                />
              ) : (
                <InlineTextInput
                  value={formData.panne_id}
                  onChange={(panne_id) =>
                    setFormData({ ...formData, panne_id })
                  }
                  title={t("form.faultReference", {
                    default: "Fault Reference",
                  })}
                  required
                />
              )}
              {isOperator && customMode.panne_id && (
                <InlineTextInput
                  value={formData.panne_id}
                  onChange={(panne_id) =>
                    setFormData({ ...formData, panne_id })
                  }
                  className="input-field mt-2"
                  title={t("form.faultReference", {
                    default: "Fault Reference",
                  })}
                  placeholder="Custom fault reference"
                  required
                />
              )}
            </FormFieldShell>
            <FormFieldShell label={t("form.code")}>
              {isOperator ? (
                <InlineSelectInput
                  value={formData.code_panne}
                  onChange={(value) => {
                    if (value === CUSTOM_OPTION) {
                      setCustomMode((prev) => ({ ...prev, code_panne: true }));
                      setFormData((prev) => ({ ...prev, code_panne: "" }));
                      return;
                    }
                    setCustomMode((prev) => ({ ...prev, code_panne: false }));
                    const template = panneTemplates.find(
                      (item) => item.code_panne === value,
                    );
                    if (template) applyPanneTemplate(template.panne_id);
                  }}
                  title={t("form.code")}
                  placeholder={t("form.code")}
                  customOptionValue={CUSTOM_OPTION}
                  customOptionLabel="Custom value..."
                  options={panneTemplates.map((panne) => ({
                    key: `${panne._id}-code`,
                    value: panne.code_panne,
                    label: panne.code_panne,
                  }))}
                  required
                />
              ) : (
                <InlineTextInput
                  value={formData.code_panne}
                  onChange={(code_panne) =>
                    setFormData({ ...formData, code_panne })
                  }
                  title={t("form.code")}
                  required
                />
              )}
              {isOperator && customMode.code_panne && (
                <InlineTextInput
                  value={formData.code_panne}
                  onChange={(code_panne) =>
                    setFormData({ ...formData, code_panne })
                  }
                  className="input-field mt-2"
                  title={t("form.code")}
                  placeholder="Custom code"
                  required
                />
              )}
            </FormFieldShell>
          </div>

          <FormFieldShell label={t("form.description")}>
            {isOperator ? (
              <InlineSelectInput
                value={formData.description}
                onChange={(value) => {
                  if (value === CUSTOM_OPTION) {
                    setCustomMode((prev) => ({ ...prev, description: true }));
                    setFormData((prev) => ({ ...prev, description: "" }));
                    return;
                  }
                  setCustomMode((prev) => ({ ...prev, description: false }));
                  const template = panneTemplates.find(
                    (item) => item.description === value,
                  );
                  if (template) applyPanneTemplate(template.panne_id);
                }}
                title={t("form.description")}
                placeholder={t("form.description")}
                customOptionValue={CUSTOM_OPTION}
                customOptionLabel="Custom value..."
                options={panneTemplates.map((panne) => ({
                  key: `${panne._id}-description`,
                  value: panne.description,
                  label: panne.description,
                }))}
                required
              />
            ) : (
              <InlineTextArea
                value={formData.description}
                onChange={(description) =>
                  setFormData({ ...formData, description })
                }
                title={t("form.description")}
                rows={3}
                required
              />
            )}
            {isOperator && customMode.description && (
              <InlineTextArea
                value={formData.description}
                onChange={(description) =>
                  setFormData({ ...formData, description })
                }
                className="input-field mt-2"
                title={t("form.description")}
                rows={3}
                placeholder="Custom description"
                required
              />
            )}
          </FormFieldShell>

          <SelectField
            label={t("form.severity")}
            value={formData.gravite}
            onChange={(value) => {
              if (value === CUSTOM_OPTION) {
                setCustomMode((prev) => ({ ...prev, gravite: true }));
                setFormData((prev) => ({ ...prev, gravite: "" }));
                return;
              }
              setCustomMode((prev) => ({ ...prev, gravite: false }));
              setFormData({ ...formData, gravite: value });
            }}
            title={t("form.severity")}
          >
            <option value="">{t("form.severity")}</option>
            <option value={CUSTOM_OPTION}>Custom value...</option>
            {gravityOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
          {customMode.gravite && (
            <InlineTextInput
              value={formData.gravite}
              onChange={(gravite) => setFormData({ ...formData, gravite })}
              className="input-field mt-2"
              title={t("form.severity")}
              placeholder="Custom severity"
            />
          )}

          <AdditionalDetailsField
            id="panne-details"
            label="Additional details (optional)"
            value={formData.details}
            onChange={(details) => setFormData({ ...formData, details })}
            title="Additional details"
            placeholder="Add any extra context you want to keep with this record"
          />

          <ModalFormActions
            cancelLabel={tCommon("cancel")}
            submitLabel={getPanneSubmitLabel(
              submittingPanne,
              Boolean(editingPanne),
              tCommon("saving"),
              tCommon("actions.update"),
              tCommon("actions.create"),
            )}
            submitting={submittingPanne}
            onCancel={() => {
              setShowPanneModal(false);
              resetForm();
            }}
            withTopBorder
          />
        </form>
      </Modal>

      <Modal
        isOpen={showSolutionModal}
        onClose={() => {
          setShowSolutionModal(false);
          resetSolutionForm();
        }}
        title={solutionModalTitle}
        size="lg"
      >
        <form onSubmit={handleSolutionSubmit} className="space-y-4">
          {solutionPanne && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              <div className="font-semibold">
                {solutionPanne.panne_id} ({solutionPanne.code_panne})
              </div>
              <div className="mt-1 whitespace-pre-wrap">
                {solutionPanne.description}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormFieldShell
              label={tSolutions("form.solutionReference", {
                default: "Solution Reference",
              })}
            >
              {isOperator ? (
                <InlineSelectInput
                  value={solutionFormData.solution_id}
                  onChange={(value) => {
                    if (value === CUSTOM_OPTION) {
                      setSolutionCustomMode((prev) => ({
                        ...prev,
                        solution_id: true,
                      }));
                      setSolutionFormData((prev) => ({
                        ...prev,
                        solution_id: "",
                      }));
                      return;
                    }
                    setSolutionCustomMode((prev) => ({
                      ...prev,
                      solution_id: false,
                    }));
                    setSolutionFormData((prev) => ({
                      ...prev,
                      solution_id: value,
                    }));
                  }}
                  title={tSolutions("form.solutionReference", {
                    default: "Solution Reference",
                  })}
                  placeholder={tSolutions("form.solutionReference", {
                    default: "Solution Reference",
                  })}
                  customOptionValue={CUSTOM_OPTION}
                  customOptionLabel="Custom value..."
                  options={solutionIdOptions}
                  required
                />
              ) : (
                <InlineTextInput
                  value={solutionFormData.solution_id}
                  onChange={(solution_id) =>
                    setSolutionFormData({ ...solutionFormData, solution_id })
                  }
                  title={tSolutions("form.solutionReference", {
                    default: "Solution Reference",
                  })}
                  required
                />
              )}
              {isOperator && solutionCustomMode.solution_id && (
                <InlineTextInput
                  value={solutionFormData.solution_id}
                  onChange={(solution_id) =>
                    setSolutionFormData({ ...solutionFormData, solution_id })
                  }
                  className="input-field mt-2"
                  title={tSolutions("form.solutionReference", {
                    default: "Solution Reference",
                  })}
                  placeholder="Custom solution reference"
                  required
                />
              )}
            </FormFieldShell>

            <FormFieldShell label={tSolutions("form.panne")}>
              <input
                type="text"
                value={solutionPanneDisplayValue}
                readOnly
                title={tSolutions("form.panne")}
                className="input-field bg-gray-100"
              />
            </FormFieldShell>
          </div>

          <FormFieldShell label={tSolutions("form.cause")}>
            {isOperator ? (
              <InlineSelectInput
                value={solutionFormData.cause_probable}
                onChange={(value) => {
                  if (value === CUSTOM_OPTION) {
                    setSolutionCustomMode((prev) => ({
                      ...prev,
                      cause_probable: true,
                    }));
                    setSolutionFormData((prev) => ({
                      ...prev,
                      cause_probable: "",
                    }));
                    return;
                  }
                  setSolutionCustomMode((prev) => ({
                    ...prev,
                    cause_probable: false,
                  }));
                  setSolutionFormData({
                    ...solutionFormData,
                    cause_probable: value,
                  });
                }}
                title={tSolutions("form.cause")}
                placeholder={tSolutions("form.cause")}
                customOptionValue={CUSTOM_OPTION}
                customOptionLabel="Custom value..."
                options={causeOptions.map((option) => ({
                  key: option,
                  value: option,
                  label: option,
                }))}
              />
            ) : (
              <InlineTextArea
                value={solutionFormData.cause_probable}
                onChange={(cause_probable) =>
                  setSolutionFormData({ ...solutionFormData, cause_probable })
                }
                title={tSolutions("form.cause")}
                rows={3}
              />
            )}
            {isOperator && solutionCustomMode.cause_probable && (
              <InlineTextArea
                value={solutionFormData.cause_probable}
                onChange={(cause_probable) =>
                  setSolutionFormData({ ...solutionFormData, cause_probable })
                }
                className="input-field mt-2"
                title={tSolutions("form.cause")}
                rows={3}
                placeholder="Custom probable cause"
              />
            )}
          </FormFieldShell>

          <FormFieldShell label={tSolutions("form.solution")}>
            {isOperator ? (
              <InlineSelectInput
                value={solutionFormData.solution_recommandee}
                onChange={(value) => {
                  if (value === CUSTOM_OPTION) {
                    setSolutionCustomMode((prev) => ({
                      ...prev,
                      solution_recommandee: true,
                    }));
                    setSolutionFormData((prev) => ({
                      ...prev,
                      solution_recommandee: "",
                    }));
                    return;
                  }
                  setSolutionCustomMode((prev) => ({
                    ...prev,
                    solution_recommandee: false,
                  }));
                  setSolutionFormData({
                    ...solutionFormData,
                    solution_recommandee: value,
                  });
                }}
                title={tSolutions("form.solution")}
                placeholder={tSolutions("form.solution")}
                customOptionValue={CUSTOM_OPTION}
                customOptionLabel="Custom value..."
                options={recommendationOptions.map((option) => ({
                  key: option,
                  value: option,
                  label: option,
                }))}
              />
            ) : (
              <InlineTextArea
                value={solutionFormData.solution_recommandee}
                onChange={(solution_recommandee) =>
                  setSolutionFormData({
                    ...solutionFormData,
                    solution_recommandee,
                  })
                }
                title={tSolutions("form.solution")}
                rows={3}
              />
            )}
            {isOperator && solutionCustomMode.solution_recommandee && (
              <InlineTextArea
                value={solutionFormData.solution_recommandee}
                onChange={(solution_recommandee) =>
                  setSolutionFormData({
                    ...solutionFormData,
                    solution_recommandee,
                  })
                }
                className="input-field mt-2"
                title={tSolutions("form.solution")}
                rows={3}
                placeholder="Custom recommendation"
              />
            )}
          </FormFieldShell>

          <AdditionalDetailsField
            id="panne-solution-details"
            label="Additional details (optional)"
            value={solutionFormData.details}
            onChange={(details) =>
              setSolutionFormData({ ...solutionFormData, details })
            }
            title="Additional details"
            placeholder="Add any extra context you want to keep with this record"
          />

          <ModalFormActions
            cancelLabel={tCommon("cancel")}
            submitLabel={solutionSubmitLabel}
            submitting={submittingSolution}
            onCancel={() => {
              setShowSolutionModal(false);
              resetSolutionForm();
            }}
            withTopBorder
          />
        </form>
      </Modal>
    </CrudPageScaffold>
  );
}
