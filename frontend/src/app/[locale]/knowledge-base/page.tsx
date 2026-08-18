"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArchiveBoxIcon,
  BookOpenIcon,
  CheckIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import DashboardLayout from "@/components/DashboardLayout";
import { Modal } from "@/components/Modal";
import { apiService } from "@/services/api";
import { displayText } from "@/services/displayValues";
import { extractApiErrorMessage } from "@/services/apiErrors";
import { StatusBadge } from "@/components/StatusBadge";

type EntityRef = string | { _id: string; machine_id?: string; name?: string; plan_id?: string };

type KnowledgeArticleStatus = "draft" | "published" | "archived";
type KnowledgeArticleCategory =
  | "troubleshooting"
  | "procedure"
  | "fault_code"
  | "lubrication"
  | "safety";

interface KnowledgeArticleLifecycleEntry {
  action: string;
  from_status?: KnowledgeArticleStatus;
  to_status: KnowledgeArticleStatus;
  reason?: string;
  at?: string;
}

interface KnowledgeArticle {
  _id: string;
  article_id: string;
  title: string;
  category: KnowledgeArticleCategory;
  summary?: string;
  content: string;
  tags?: string[];
  machine_id?: EntityRef;
  machine_type_id?: EntityRef;
  maintenance_plan_id?: EntityRef;
  fault_codes?: string[];
  error_codes?: string[];
  status?: KnowledgeArticleStatus;
  version?: number;
  revision?: number;
  supersedes_article_id?: string;
  superseded_by_article_id?: string;
  lifecycle_history?: KnowledgeArticleLifecycleEntry[];
}

interface Machine {
  _id: string;
  machine_id: string;
}

interface MachineType {
  _id: string;
  name: string;
}

interface MaintenancePlan {
  _id: string;
  plan_id: string;
  maintenance_code?: string;
}

const STATUS_BADGE_CLASSES: Record<KnowledgeArticleStatus, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  published: "bg-green-100 text-green-800 border-green-200",
  archived: "bg-gray-200 text-gray-600 border-gray-300",
};

const CATEGORIES: KnowledgeArticleCategory[] = [
  "troubleshooting",
  "procedure",
  "fault_code",
  "lubrication",
  "safety",
];

// Mirrors the backend's own transition table exactly, so the UI never
// offers an action the server would reject.
function getAvailableActions(
  status: KnowledgeArticleStatus,
): Array<"publish" | "archive" | "revise" | "edit"> {
  if (status === "draft") return ["publish", "archive", "edit"];
  if (status === "published") return ["archive", "revise"];
  return [];
}

function canDelete(article: KnowledgeArticle): boolean {
  const status = article.status ?? "draft";
  const historyLength = article.lifecycle_history?.length ?? 0;
  return (
    status === "draft" &&
    historyLength <= 1 &&
    !article.supersedes_article_id &&
    !article.superseded_by_article_id
  );
}

function refId(value: EntityRef | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id || "";
}

function refLabel(value: EntityRef | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return displayText(value, "");
  return displayText(value.machine_id || value.name || value.plan_id, "");
}

function parseCsv(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function csvToText(values?: string[]): string {
  return values && values.length ? values.join(", ") : "";
}

interface ArticleFormState {
  article_id: string;
  title: string;
  category: KnowledgeArticleCategory;
  summary: string;
  content: string;
  tags_text: string;
  machine_id: string;
  machine_type_id: string;
  maintenance_plan_id: string;
  fault_codes_text: string;
  error_codes_text: string;
}

const EMPTY_FORM: ArticleFormState = {
  article_id: "",
  title: "",
  category: "troubleshooting",
  summary: "",
  content: "",
  tags_text: "",
  machine_id: "",
  machine_type_id: "",
  maintenance_plan_id: "",
  fault_codes_text: "",
  error_codes_text: "",
};

export default function KnowledgeBasePage() {
  const t = useTranslations("knowledgeBase");
  const tCommon = useTranslations("common");

  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineTypes, setMachineTypes] = useState<MachineType[]>([]);
  const [maintenancePlans, setMaintenancePlans] = useState<MaintenancePlan[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<KnowledgeArticle | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyArticle, setHistoryArticle] = useState<KnowledgeArticle | null>(null);
  const [historyVersions, setHistoryVersions] = useState<KnowledgeArticle[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [viewerOpen, setViewerOpen] = useState(false);

  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [form, setForm] = useState<ArticleFormState>(EMPTY_FORM);

  function showNotification(type: "success" | "error", message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  async function loadData() {
    try {
      setLoading(true);
      const [articlesRes, machinesRes, typesRes, plansRes] = await Promise.all([
        apiService.getKnowledgeArticles({ limit: 200 }),
        apiService.getMachines(),
        apiService.getMachineTypes(),
        apiService.getMaintenancePlans(),
      ]);

      setArticles(
        Array.isArray(articlesRes.data?.items) ? articlesRes.data.items : [],
      );
      setMachines(
        Array.isArray(machinesRes.data) ? machinesRes.data : machinesRes.data?.items || [],
      );
      setMachineTypes(
        Array.isArray(typesRes.data) ? typesRes.data : typesRes.data?.items || [],
      );
      setMaintenancePlans(
        Array.isArray(plansRes.data) ? plansRes.data : plansRes.data?.items || [],
      );
    } catch (error) {
      console.error("Error loading knowledge base articles:", error);
      showNotification("error", t("notifications.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // Initial load only; loadData is reused by mutations and intentionally not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredArticles = useMemo(() => {
    const term = search.trim().toLowerCase();
    return articles.filter((article) => {
      const matchesSearch =
        !term ||
        article.title.toLowerCase().includes(term) ||
        (article.summary || "").toLowerCase().includes(term) ||
        (article.tags || []).some((tag) => tag.toLowerCase().includes(term)) ||
        (article.fault_codes || []).some((code) => code.toLowerCase().includes(term));
      const matchesCategory = !selectedCategory || article.category === selectedCategory;
      const matchesStatus = !selectedStatus || (article.status ?? "draft") === selectedStatus;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [articles, search, selectedCategory, selectedStatus]);

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function formToPayload(state: ArticleFormState) {
    return {
      title: state.title.trim(),
      category: state.category,
      summary: state.summary.trim() || undefined,
      content: state.content.trim(),
      tags: parseCsv(state.tags_text),
      machine_id: state.machine_id || undefined,
      machine_type_id: state.machine_type_id || undefined,
      maintenance_plan_id: state.maintenance_plan_id || undefined,
      fault_codes: parseCsv(state.fault_codes_text),
      error_codes: parseCsv(state.error_codes_text),
    };
  }

  function validateForm(state: ArticleFormState, requireArticleId: boolean): boolean {
    if (requireArticleId && !state.article_id.trim()) {
      showNotification("error", t("notifications.articleIdRequired"));
      return false;
    }
    if (!state.title.trim()) {
      showNotification("error", t("notifications.titleRequired"));
      return false;
    }
    if (!state.content.trim()) {
      showNotification("error", t("notifications.contentRequired"));
      return false;
    }
    return true;
  }

  async function handleCreate() {
    if (!validateForm(form, true)) return;

    setSubmitting(true);
    try {
      await apiService.createKnowledgeArticle({
        article_id: form.article_id.trim(),
        ...formToPayload(form),
      });
      showNotification("success", t("notifications.created"));
      setCreateOpen(false);
      resetForm();
      await loadData();
    } catch (error) {
      console.error("Error creating knowledge article:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(article: KnowledgeArticle) {
    setSelectedArticle(article);
    setForm({
      article_id: article.article_id,
      title: article.title,
      category: article.category,
      summary: article.summary || "",
      content: article.content,
      tags_text: csvToText(article.tags),
      machine_id: refId(article.machine_id),
      machine_type_id: refId(article.machine_type_id),
      maintenance_plan_id: refId(article.maintenance_plan_id),
      fault_codes_text: csvToText(article.fault_codes),
      error_codes_text: csvToText(article.error_codes),
    });
    setEditOpen(true);
  }

  async function handleUpdate() {
    if (!selectedArticle) return;
    if (!validateForm(form, false)) return;

    setSubmitting(true);
    try {
      await apiService.updateKnowledgeArticle(selectedArticle._id, {
        ...formToPayload(form),
        expected_version: selectedArticle.version,
      });
      showNotification("success", t("notifications.updated"));
      setEditOpen(false);
      setSelectedArticle(null);
      await loadData();
    } catch (error) {
      console.error("Error updating knowledge article:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  function openRevise(article: KnowledgeArticle) {
    setSelectedArticle(article);
    setForm({
      article_id: article.article_id,
      title: article.title,
      category: article.category,
      summary: article.summary || "",
      content: article.content,
      tags_text: csvToText(article.tags),
      machine_id: refId(article.machine_id),
      machine_type_id: refId(article.machine_type_id),
      maintenance_plan_id: refId(article.maintenance_plan_id),
      fault_codes_text: csvToText(article.fault_codes),
      error_codes_text: csvToText(article.error_codes),
    });
    setReviseOpen(true);
  }

  async function handleReviseSubmit() {
    if (!selectedArticle) return;
    if (!validateForm(form, false)) return;

    setSubmitting(true);
    try {
      await apiService.reviseKnowledgeArticle(selectedArticle._id, {
        ...formToPayload(form),
        expected_version: selectedArticle.version,
      });
      showNotification("success", t("notifications.revised"));
      setReviseOpen(false);
      setSelectedArticle(null);
      await loadData();
    } catch (error) {
      console.error("Error revising knowledge article:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish(article: KnowledgeArticle) {
    if (!confirm(t("notifications.confirmPublish"))) return;
    try {
      await apiService.publishKnowledgeArticle(article._id, { expected_version: article.version });
      showNotification("success", t("notifications.publishSuccess"));
      await loadData();
    } catch (error) {
      console.error("Error publishing knowledge article:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.publishFailed")));
    }
  }

  async function handleArchive(article: KnowledgeArticle) {
    if (!confirm(t("notifications.confirmArchive"))) return;
    try {
      await apiService.archiveKnowledgeArticle(article._id, { expected_version: article.version });
      showNotification("success", t("notifications.archiveSuccess"));
      await loadData();
    } catch (error) {
      console.error("Error archiving knowledge article:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.archiveFailed")));
    }
  }

  async function handleDelete(article: KnowledgeArticle) {
    if (!confirm(t("notifications.confirmDelete"))) return;
    try {
      await apiService.deleteKnowledgeArticle(article._id);
      showNotification("success", t("notifications.deleted"));
      await loadData();
    } catch (error) {
      console.error("Error deleting knowledge article:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.deleteFailed")));
    }
  }

  async function openHistory(article: KnowledgeArticle) {
    setHistoryArticle(article);
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const response = await apiService.getKnowledgeArticleVersions(article._id);
      setHistoryVersions(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error("Error loading knowledge article version history:", error);
      showNotification("error", t("notifications.historyLoadFailed"));
    } finally {
      setHistoryLoading(false);
    }
  }

  function renderFormFields(state: ArticleFormState, onChange: (next: ArticleFormState) => void, disableArticleId: boolean) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.articleId")}</label>
            <input
              className="input-field"
              value={state.article_id}
              disabled={disableArticleId}
              onChange={(e) => onChange({ ...state, article_id: e.target.value })}
              placeholder={t("placeholders.articleId")}
              title={t("form.articleId")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.category")}</label>
            <select
              className="input-field"
              value={state.category}
              onChange={(e) => onChange({ ...state, category: e.target.value as KnowledgeArticleCategory })}
              title={t("form.category")}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(`categories.${category}`, { default: category })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.title")}</label>
          <input
            className="input-field"
            value={state.title}
            onChange={(e) => onChange({ ...state, title: e.target.value })}
            placeholder={t("placeholders.title")}
            title={t("form.title")}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.summary")}</label>
          <input
            className="input-field"
            value={state.summary}
            onChange={(e) => onChange({ ...state, summary: e.target.value })}
            placeholder={t("placeholders.summary")}
            title={t("form.summary")}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.content")}</label>
          <textarea
            className="input-field"
            rows={6}
            value={state.content}
            onChange={(e) => onChange({ ...state, content: e.target.value })}
            placeholder={t("placeholders.content")}
            title={t("form.content")}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.machineType")}</label>
            <select
              className="input-field"
              value={state.machine_type_id}
              onChange={(e) => onChange({ ...state, machine_type_id: e.target.value })}
              title={t("form.machineType")}
            >
              <option value="">{t("placeholders.none")}</option>
              {machineTypes.map((type) => (
                <option key={type._id} value={type._id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.machine")}</label>
            <select
              className="input-field"
              value={state.machine_id}
              onChange={(e) => onChange({ ...state, machine_id: e.target.value })}
              title={t("form.machine")}
            >
              <option value="">{t("placeholders.none")}</option>
              {machines.map((machine) => (
                <option key={machine._id} value={machine._id}>
                  {machine.machine_id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.maintenancePlan")}</label>
            <select
              className="input-field"
              value={state.maintenance_plan_id}
              onChange={(e) => onChange({ ...state, maintenance_plan_id: e.target.value })}
              title={t("form.maintenancePlan")}
            >
              <option value="">{t("placeholders.none")}</option>
              {maintenancePlans.map((plan) => (
                <option key={plan._id} value={plan._id}>
                  {plan.maintenance_code || plan.plan_id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.tags")}</label>
            <input
              className="input-field"
              value={state.tags_text}
              onChange={(e) => onChange({ ...state, tags_text: e.target.value })}
              placeholder={t("placeholders.tags")}
              title={t("form.tags")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.faultCodes")}</label>
            <input
              className="input-field"
              value={state.fault_codes_text}
              onChange={(e) => onChange({ ...state, fault_codes_text: e.target.value })}
              placeholder={t("placeholders.faultCodes")}
              title={t("form.faultCodes")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.errorCodes")}</label>
            <input
              className="input-field"
              value={state.error_codes_text}
              onChange={(e) => onChange({ ...state, error_codes_text: e.target.value })}
              placeholder={t("placeholders.errorCodes")}
              title={t("form.errorCodes")}
            />
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <DashboardLayout title={t("title")}>
        <div className="flex justify-center items-center h-100">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("title")}>
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${
            notification.type === "success"
              ? "bg-green-100 text-green-800 border border-green-200"
              : "bg-red-100 text-red-800 border border-red-200"
          }`}
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
            title={tCommon("close")}
          >
            x
          </button>
        </div>
      )}

      <div className="panel mb-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">{t("heading")}</h2>
            <p className="text-gray-500 text-sm">{t("description")}</p>
          </div>

          <button type="button"
            onClick={() => setCreateOpen(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"
          >
            <PlusIcon className="w-4 h-4" />
            {t("actions.add")}
          </button>
        </div>

        <div className="mt-4 flex gap-3">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              className="input-field pl-9"
              placeholder={t("searchPlaceholder")}
              title={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="input-field"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            title={t("form.category")}
          >
            <option value="">{t("filterAllCategories")}</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`categories.${category}`, { default: category })}
              </option>
            ))}
          </select>

          <select
            className="input-field"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            title={t("filterAllStatuses")}
          >
            <option value="">{t("filterAllStatuses")}</option>
            {(["draft", "published", "archived"] as KnowledgeArticleStatus[]).map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`, { default: status })}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredArticles.length === 0 ? (
          <div className="panel col-span-full text-center py-8 text-gray-500">
            {search ? t("empty.search") : t("empty.default")}
          </div>
        ) : (
          filteredArticles.map((article) => {
            const status = article.status ?? "draft";
            const availableActions = getAvailableActions(status);
            const deletable = canDelete(article);

            return (
              <div key={article._id} className="panel hover:shadow-lg transition">
                <div className="flex justify-between items-start">
                  <BookOpenIcon className="w-8 h-8 text-blue-600" />
                  <StatusBadge
                    label={t(`status.${status}`, { default: status })}
                    colorClassName={STATUS_BADGE_CLASSES[status]}
                  />
                </div>

                <h3 className="font-bold mt-2">{article.title}</h3>
                {article.revision ? (
                  <div className="text-xs text-gray-400">
                    {t("table.revision")} {article.revision}
                  </div>
                ) : null}

                <div className="text-sm text-gray-500 mt-1">
                  <div>
                    <span className="font-medium">{t("table.category")}: </span>
                    {t(`categories.${article.category}`, { default: article.category })}
                  </div>
                  {article.machine_id ? (
                    <div>
                      <span className="font-medium">{t("table.machine")}: </span>
                      {refLabel(article.machine_id) || tCommon("notAvailable")}
                    </div>
                  ) : null}
                  {article.fault_codes && article.fault_codes.length > 0 ? (
                    <div>
                      <span className="font-medium">{t("table.faultCodes")}: </span>
                      {article.fault_codes.join(", ")}
                    </div>
                  ) : null}
                </div>

                <p className="text-sm text-gray-600 mt-2">{article.summary || tCommon("notAvailable")}</p>

                <div className="flex flex-wrap gap-1 mt-2">
                  {(article.tags || []).map((tag) => (
                    <span
                      key={`${article._id}-${tag}`}
                      className="text-xs bg-gray-100 px-2 py-1 rounded flex items-center gap-1"
                    >
                      <TagIcon className="w-3 h-3" />
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                  <button type="button"
                    onClick={() => {
                      setSelectedArticle(article);
                      setViewerOpen(true);
                    }}
                    className="text-blue-600"
                    title={t("actions.view")}
                  >
                    <EyeIcon className="w-5 h-5" />
                  </button>
                  <button type="button"
                    onClick={() => openHistory(article)}
                    className="text-slate-600"
                    title={t("actions.history")}
                  >
                    <ClockIcon className="w-5 h-5" />
                  </button>
                  {availableActions.includes("edit") && (
                    <button type="button"
                      onClick={() => openEdit(article)}
                      className="text-amber-600"
                      title={t("actions.edit")}
                    >
                      <PencilIcon className="w-5 h-5" />
                    </button>
                  )}
                  {availableActions.includes("publish") && (
                    <button type="button"
                      onClick={() => handlePublish(article)}
                      className="text-green-600"
                      title={t("actions.publish")}
                    >
                      <CheckIcon className="w-5 h-5" />
                    </button>
                  )}
                  {availableActions.includes("revise") && (
                    <button type="button"
                      onClick={() => openRevise(article)}
                      className="text-indigo-600"
                      title={t("actions.revise")}
                    >
                      <DocumentDuplicateIcon className="w-5 h-5" />
                    </button>
                  )}
                  {availableActions.includes("archive") && (
                    <button type="button"
                      onClick={() => handleArchive(article)}
                      className="text-gray-600"
                      title={t("actions.archive")}
                    >
                      <ArchiveBoxIcon className="w-5 h-5" />
                    </button>
                  )}
                  {deletable && (
                    <button type="button"
                      onClick={() => handleDelete(article)}
                      className="text-red-600"
                      title={t("actions.delete")}
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <Modal
        isOpen={createOpen}
        onClose={() => {
          setCreateOpen(false);
          resetForm();
        }}
        title={t("modal.createTitle")}
        size="lg"
      >
        <div className="space-y-4">
          {renderFormFields(form, setForm, false)}
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              {tCommon("cancel")}
            </button>
            <button type="button" className="btn-primary" onClick={handleCreate} disabled={submitting}>
              {submitting ? tCommon("saving") : t("buttons.create")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={editOpen}
        onClose={() => {
          setEditOpen(false);
          setSelectedArticle(null);
        }}
        title={t("modal.editTitle")}
        size="lg"
      >
        <div className="space-y-4">
          {renderFormFields(form, setForm, true)}
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setEditOpen(false)}>
              {tCommon("cancel")}
            </button>
            <button type="button" className="btn-primary" onClick={handleUpdate} disabled={submitting}>
              {submitting ? tCommon("saving") : t("buttons.update")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={reviseOpen}
        onClose={() => {
          setReviseOpen(false);
          setSelectedArticle(null);
        }}
        title={t("modal.reviseTitle")}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t("modal.reviseHint")}</p>
          {renderFormFields(form, setForm, true)}
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setReviseOpen(false)}>
              {tCommon("cancel")}
            </button>
            <button type="button" className="btn-primary" onClick={handleReviseSubmit} disabled={submitting}>
              {submitting ? tCommon("saving") : t("buttons.revise")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t("modal.historyTitle")}
        size="lg"
      >
        {historyArticle && (
          <div className="mb-3 text-sm font-medium text-slate-800">{historyArticle.title}</div>
        )}
        {historyLoading ? (
          <div className="text-sm text-slate-500">{tCommon("loading")}</div>
        ) : historyVersions.length === 0 ? (
          <div className="text-sm text-slate-500">{t("history.empty")}</div>
        ) : (
          <div className="space-y-2">
            {historyVersions.map((version) => {
              const status = version.status ?? "draft";
              return (
                <div
                  key={version._id}
                  className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
                >
                  <div>
                    <div className="font-medium text-slate-800">
                      {t("table.revision")} {version.revision ?? 1}
                      {version._id === historyArticle?._id ? ` (${t("history.current")})` : ""}
                    </div>
                    <div className="text-xs text-slate-500">{version.title}</div>
                  </div>
                  <StatusBadge
                    label={t(`status.${status}`, { default: status })}
                    colorClassName={STATUS_BADGE_CLASSES[status]}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
        title={selectedArticle?.title || t("viewer.title")}
        size="xl"
      >
        {selectedArticle ? (
          <div className="space-y-3 text-sm text-slate-700 whitespace-pre-wrap">
            {selectedArticle.summary ? (
              <p className="font-medium text-slate-800">{selectedArticle.summary}</p>
            ) : null}
            <p>{selectedArticle.content}</p>
          </div>
        ) : (
          <div className="text-center text-gray-500">{tCommon("loading")}</div>
        )}
      </Modal>
    </DashboardLayout>
  );
}
