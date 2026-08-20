"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PlusIcon } from "@heroicons/react/24/outline";
import { ModalFormActions, RowActions } from "@/components/CrudPageControls";
import DashboardLayout from "@/components/DashboardLayout";
import DynamicSearchControls from "@/components/DynamicSearchControls";
import { Modal } from "@/components/Modal";
import {
  ToastNotification,
  type ToastNotificationState,
} from "@/components/ToastNotification";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  ALL_FIELDS_TOKEN,
  getSearchableFields,
  matchesDynamicSearch,
} from "@/services/dynamicSearch";
import Pagination from "@/components/Pagination";

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
    return (
      <DashboardLayout title={t("title")}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
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
                    {t("totalPannes")}
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
          <div className="card-title">{t("allPannes")}</div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    {t("table.faultReference", { default: "Fault Reference" })}
                  </th>
                  <th>{t("table.code")}</th>
                  <th>{t("table.description")}</th>
                  <th>{t("table.severity")}</th>
                  <th>{tCommon("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPannes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-gray-500">
                      {searchTerm ? t("empty.search") : t("empty.default")}
                    </td>
                  </tr>
                ) : (
                  filteredPannes.map((panne) => (
                    <tr key={panne._id}>
                      <td className="font-medium">{panne.panne_id}</td>
                      <td>{panne.code_panne}</td>
                      <td>{panne.description}</td>
                      <td>{panne.gravite || tCommon("notAvailable")}</td>
                      <td>
                        <RowActions
                          editLabel={t("actions.edit")}
                          deleteLabel={t("actions.delete")}
                          itemLabel={panne.panne_id}
                          onEdit={() => openEditModal(panne)}
                          onDelete={() => handleDelete(panne._id)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="mt-4">
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={totalItems}
                limit={limit}
                onPageChange={handlePageChange}
              />
            </div>
          </div>
        </div>
      </div>

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
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {t("form.faultReference", { default: "Fault Reference" })}
              </label>
              {isOperator ? (
                <select
                  value={formData.panne_id}
                  onChange={(e) => {
                    const selectedValue = e.target.value;
                    if (selectedValue === CUSTOM_OPTION) {
                      setCustomMode((prev) => ({ ...prev, panne_id: true }));
                      setFormData((prev) => ({ ...prev, panne_id: "" }));
                      return;
                    }
                    setCustomMode((prev) => ({ ...prev, panne_id: false }));
                    applyPanneTemplate(selectedValue);
                  }}
                  className="input-field"
                  title={t("form.faultReference", {
                    default: "Fault Reference",
                  })}
                  required
                >
                  <option value="">
                    {t("form.faultReference", { default: "Fault Reference" })}
                  </option>
                  <option value={CUSTOM_OPTION}>Custom value...</option>
                  {panneTemplates.map((panne) => (
                    <option key={panne._id} value={panne.panne_id}>
                      {panne.panne_id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={formData.panne_id}
                  onChange={(e) =>
                    setFormData({ ...formData, panne_id: e.target.value })
                  }
                  className="input-field"
                  title={t("form.faultReference", {
                    default: "Fault Reference",
                  })}
                  required
                />
              )}
              {isOperator && customMode.panne_id && (
                <input
                  type="text"
                  value={formData.panne_id}
                  onChange={(e) =>
                    setFormData({ ...formData, panne_id: e.target.value })
                  }
                  className="input-field mt-2"
                  title={t("form.faultReference", {
                    default: "Fault Reference",
                  })}
                  placeholder="Custom fault reference"
                  required
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {t("form.code")}
              </label>
              {isOperator ? (
                <select
                  value={formData.code_panne}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_OPTION) {
                      setCustomMode((prev) => ({ ...prev, code_panne: true }));
                      setFormData((prev) => ({ ...prev, code_panne: "" }));
                      return;
                    }
                    setCustomMode((prev) => ({ ...prev, code_panne: false }));
                    const template = panneTemplates.find(
                      (item) => item.code_panne === e.target.value,
                    );
                    if (template) applyPanneTemplate(template.panne_id);
                  }}
                  className="input-field"
                  title={t("form.code")}
                  required
                >
                  <option value="">{t("form.code")}</option>
                  <option value={CUSTOM_OPTION}>Custom value...</option>
                  {panneTemplates.map((panne) => (
                    <option key={`${panne._id}-code`} value={panne.code_panne}>
                      {panne.code_panne}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={formData.code_panne}
                  onChange={(e) =>
                    setFormData({ ...formData, code_panne: e.target.value })
                  }
                  className="input-field"
                  title={t("form.code")}
                  required
                />
              )}
              {isOperator && customMode.code_panne && (
                <input
                  type="text"
                  value={formData.code_panne}
                  onChange={(e) =>
                    setFormData({ ...formData, code_panne: e.target.value })
                  }
                  className="input-field mt-2"
                  title={t("form.code")}
                  placeholder="Custom code"
                  required
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              {t("form.description")}
            </label>
            {isOperator ? (
              <select
                value={formData.description}
                onChange={(e) => {
                  if (e.target.value === CUSTOM_OPTION) {
                    setCustomMode((prev) => ({ ...prev, description: true }));
                    setFormData((prev) => ({ ...prev, description: "" }));
                    return;
                  }
                  setCustomMode((prev) => ({ ...prev, description: false }));
                  const template = panneTemplates.find(
                    (item) => item.description === e.target.value,
                  );
                  if (template) applyPanneTemplate(template.panne_id);
                }}
                className="input-field"
                title={t("form.description")}
                required
              >
                <option value="">{t("form.description")}</option>
                <option value={CUSTOM_OPTION}>Custom value...</option>
                {panneTemplates.map((panne) => (
                  <option
                    key={`${panne._id}-description`}
                    value={panne.description}
                  >
                    {panne.description}
                  </option>
                ))}
              </select>
            ) : (
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="input-field"
                title={t("form.description")}
                rows={3}
                required
              />
            )}
            {isOperator && customMode.description && (
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="input-field mt-2"
                title={t("form.description")}
                rows={3}
                placeholder="Custom description"
                required
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              {t("form.severity")}
            </label>
            <select
              value={formData.gravite}
              onChange={(e) => {
                if (e.target.value === CUSTOM_OPTION) {
                  setCustomMode((prev) => ({ ...prev, gravite: true }));
                  setFormData((prev) => ({ ...prev, gravite: "" }));
                  return;
                }
                setCustomMode((prev) => ({ ...prev, gravite: false }));
                setFormData({ ...formData, gravite: e.target.value });
              }}
              className="input-field"
              title={t("form.severity")}
            >
              <option value="">{t("form.severity")}</option>
              <option value={CUSTOM_OPTION}>Custom value...</option>
              {gravityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {customMode.gravite && (
              <input
                type="text"
                value={formData.gravite}
                onChange={(e) =>
                  setFormData({ ...formData, gravite: e.target.value })
                }
                className="input-field mt-2"
                title={t("form.severity")}
                placeholder="Custom severity"
              />
            )}
          </div>

          <div>
            <label
              htmlFor="panne-details"
              className="block text-sm font-medium text-gray-dark mb-1"
            >
              Additional details (optional)
            </label>
            <textarea
              id="panne-details"
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
    </DashboardLayout>
  );
}
