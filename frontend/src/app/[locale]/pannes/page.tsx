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

const CUSTOM_OPTION = "__custom__";

export default function PannesPage() {
  const t = useTranslations("pannes");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { user } = useAuth();
  const isOperator = user?.role === "operator";

  const [pannes, setPannes] = useState<Panne[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSearchField, setSelectedSearchField] =
    useState(ALL_FIELDS_TOKEN);
  const [showModal, setShowModal] = useState(false);
  const [editingPanne, setEditingPanne] = useState<Panne | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] =
    useState<ToastNotificationState | null>(null);
  const [formData, setFormData] = useState({
    panne_id: "",
    code_panne: "",
    description: "",
    gravite: "",
    details: "",
  });
  const [customMode, setCustomMode] = useState({
    panne_id: false,
    code_panne: false,
    description: false,
    gravite: false,
  });

  async function loadData(pageNumber = 1) {
    try {
      const response = await apiService.getPannes({
        page: pageNumber,
        limit,
      });

      const data = response.data;

      setPannes(data?.items || []);
      setPage(data?.page || 1);
      setTotalPages(data?.totalPages || 1);
      setTotalItems(data?.totalItems || 0);
    } catch (error) {
      console.error("Error loading pannes:", error);
      setPannes([]);
    } finally {
      setLoading(false);
    }
  }
  function handlePageChange(newPage: number) {
    loadData(newPage);
  }
  async function refreshPannes() {
    await loadData(page);
    router.refresh();
    window.dispatchEvent(new Event("pannes:changed"));
  }

  function showNotification(type: "success" | "error", message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  const searchableFields = useMemo(() => getSearchableFields(pannes), [pannes]);

  const filteredPannes = useMemo(
    () =>
      pannes.filter((panne) =>
        matchesDynamicSearch(panne, searchTerm, selectedSearchField),
      ),
    [pannes, searchTerm, selectedSearchField],
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

  function openCreateModal() {
    resetForm();
    setShowModal(true);
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
    setShowModal(true);
  }

  async function handleDelete(id: string) {
    if (!confirm(t("notifications.confirmDelete"))) return;

    try {
      await apiService.deletePanne(id);
      await refreshPannes();
      showNotification("success", t("notifications.deleted"));
    } catch (error) {
      console.error("Error deleting panne:", error);
      showNotification("error", t("notifications.deleteFailed"));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);

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

      setShowModal(false);
      resetForm();
      await refreshPannes();
    } catch (error) {
      console.error("Error saving panne:", error);
      showNotification("error", t("notifications.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    loadData(1);
    // Initial load only; loadData is reused by pagination and refresh handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleChanged = () => {
      loadData();
    };

    window.addEventListener("pannes:changed", handleChanged);
    window.addEventListener("focus", handleChanged);

    return () => {
      window.removeEventListener("pannes:changed", handleChanged);
      window.removeEventListener("focus", handleChanged);
    };
    // keep the existing event listener lifecycle stable; loadData reads current state when the event fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <CrudLoadingState title={t("title")} />;
  }

  return (
    <CrudPageScaffold
      title={t("title")}
      heading={t("heading")}
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
        items={filteredPannes}
        getRowKey={(panne) => panne._id}
        emptyMessage={searchTerm ? t("empty.search") : t("empty.default")}
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
            render: (panne) => panne.description,
          },
          {
            id: "severity",
            header: t("table.severity"),
            render: (panne) => panne.gravite || tCommon("notAvailable"),
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
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingPanne ? t("modal.edit") : t("modal.add")}
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
              submitting,
              Boolean(editingPanne),
              tCommon("saving"),
              tCommon("actions.update"),
              tCommon("actions.create"),
            )}
            submitting={submitting}
            onCancel={() => {
              setShowModal(false);
              resetForm();
            }}
            withTopBorder
          />
        </form>
      </Modal>
    </CrudPageScaffold>
  );
}
