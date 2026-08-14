"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CloudArrowUpIcon,
  DocumentIcon,
  ExclamationTriangleIcon,
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
import DocumentAttachmentViewer from "@/components/DocumentAttachmentViewer";
import { apiService } from "@/services/api";
import { displayText } from "@/services/displayValues";
import { extractApiErrorDetails as extractApiErrorMessage } from "@/services/apiErrors";
import { StatusBadge } from "@/components/StatusBadge";

type MachineRef = string | { _id: string; machine_id?: string };

type DocumentStatus = "draft" | "published" | "archived" | "superseded";

interface DocumentLifecycleEntry {
  action: string;
  from_status?: DocumentStatus;
  to_status: DocumentStatus;
  reason?: string;
  at?: string;
}

interface DocumentType {
  _id: string;
  document_id: string;
  machine_id: MachineRef;
  type_document: string;
  file_path: string;
  file_name: string;
  description?: string;
  tags?: string[];
  uploaded_by?: string;
  date_ajout?: string;
  status?: DocumentStatus;
  version?: number;
  revision?: number;
  supersedes_document_id?: string;
  superseded_by_document_id?: string;
  lifecycle_history?: DocumentLifecycleEntry[];
}

interface Machine {
  _id: string;
  machine_id: string;
}

// Only PDF and Office documents pass server-side validation — restrict the
// picker to match, so a user never has to discover the rejection after
// the fact.
const ACCEPTED_DOCUMENT_EXTENSIONS =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

const STATUS_BADGE_CLASSES: Record<DocumentStatus, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  published: "bg-green-100 text-green-800 border-green-200",
  archived: "bg-gray-200 text-gray-600 border-gray-300",
  superseded: "bg-amber-100 text-amber-800 border-amber-200",
};

// Mirrors the backend's own transition table exactly, so the UI never
// offers an action the server would reject.
function getAvailableActions(status: DocumentStatus): Array<"publish" | "archive" | "replace"> {
  if (status === "draft") return ["publish", "archive", "replace"];
  if (status === "published") return ["archive", "replace"];
  return [];
}

function canDelete(doc: DocumentType): boolean {
  const status = doc.status ?? "draft";
  const historyLength = doc.lifecycle_history?.length ?? 0;
  return (
    status === "draft" &&
    historyLength <= 1 &&
    !doc.supersedes_document_id &&
    !doc.superseded_by_document_id
  );
}

function machineRefId(machine: MachineRef): string {
  return typeof machine === "string" ? machine : machine?._id || "";
}

function machineRefLabel(machine: MachineRef): string {
  if (typeof machine === "string") return displayText(machine, "");
  return displayText(machine?.machine_id, "");
}

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const tCommon = useTranslations("common");

  const [documents, setDocuments] = useState<DocumentType[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");

  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentType | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<DocumentType | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replaceReason, setReplaceReason] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDoc, setHistoryDoc] = useState<DocumentType | null>(null);
  const [historyVersions, setHistoryVersions] = useState<DocumentType[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState({
    machine_id: "",
    type_document: "",
    description: "",
    tags_text: "",
    uploaded_by: "",
  });

  const [editForm, setEditForm] = useState({
    machine_id: "",
    type_document: "",
    description: "",
    tags_text: "",
    uploaded_by: "",
  });

  function showNotification(type: "success" | "error", message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  function resetUploadForm() {
    setFile(null);
    setUploadForm({
      machine_id: "",
      type_document: "",
      description: "",
      tags_text: "",
      uploaded_by: "",
    });
  }

  function parseTags(tagsText: string): string[] {
    return tagsText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function tagsToText(tags?: string[]): string {
    if (!tags || tags.length === 0) return "";
    return tags.join(", ");
  }

  async function loadData() {
    try {
      setLoading(true);
      const [docsRes, machinesRes] = await Promise.all([
        apiService.getDocuments(),
        apiService.getMachines(),
      ]);

      setDocuments(
        Array.isArray(docsRes.data)
          ? docsRes.data
          : Array.isArray(docsRes.data?.data)
            ? docsRes.data.data
            : Array.isArray(docsRes.data?.documents)
              ? docsRes.data.documents
              : Array.isArray(docsRes.data?.items)
                ? docsRes.data.items
                : []
      );

      setMachines(
        Array.isArray(machinesRes.data)
          ? machinesRes.data
          : Array.isArray(machinesRes.data?.data)
            ? machinesRes.data.data
            : Array.isArray(machinesRes.data?.machines)
              ? machinesRes.data.machines
              : Array.isArray(machinesRes.data?.items)
                ? machinesRes.data.items
                : []
      );
    } catch (error) {
      console.error("Error loading documents:", error);
      showNotification("error", t("notifications.saveFailed"));
    } finally {
      setLoading(false);
    }
  }

  const filteredDocuments = useMemo(() => {
    const term = search.trim().toLowerCase();

    const docs = Array.isArray(documents) ? documents : [];

    return docs.filter((doc) => {
      const matchesSearch =
        !term ||
        (doc.document_id || "").toLowerCase().includes(term) ||
        (doc.file_name || "").toLowerCase().includes(term) ||
        (doc.type_document || "").toLowerCase().includes(term) ||
        (doc.description || "").toLowerCase().includes(term) ||
        (doc.uploaded_by || "").toLowerCase().includes(term) ||
        machineRefLabel(doc.machine_id).toLowerCase().includes(term) ||
        (doc.tags || []).some((tag) => tag.toLowerCase().includes(term));

      const matchesMachine = !selectedMachine || machineRefId(doc.machine_id) === selectedMachine;
      const matchesStatus = !selectedStatus || (doc.status ?? "draft") === selectedStatus;

      return matchesSearch && matchesMachine && matchesStatus;
    });
  }, [documents, search, selectedMachine, selectedStatus]);

  function validateUploadForm(): boolean {
    if (!file) {
      showNotification("error", t("notifications.fileRequired"));
      return false;
    }
    if (!uploadForm.machine_id) {
      showNotification("error", t("notifications.machineRequired"));
      return false;
    }
    if (!uploadForm.type_document.trim()) {
      showNotification("error", t("notifications.typeRequired"));
      return false;
    }
    return true;
  }

  function validateEditForm(): boolean {
    if (!editForm.machine_id) {
      showNotification("error", t("notifications.machineRequired"));
      return false;
    }
    if (!editForm.type_document.trim()) {
      showNotification("error", t("notifications.typeRequired"));
      return false;
    }
    return true;
  }

  async function handleUpload() {
    if (!validateUploadForm()) return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file as File);
      formData.append("document_id", crypto.randomUUID());
      formData.append("machine_id", uploadForm.machine_id);
      formData.append("type_document", uploadForm.type_document.trim());
      formData.append("description", uploadForm.description.trim());
      formData.append("tags", JSON.stringify(parseTags(uploadForm.tags_text)));
      formData.append("uploaded_by", uploadForm.uploaded_by.trim());

      await apiService.uploadDocument(formData);
      showNotification("success", t("notifications.created"));
      setUploadOpen(false);
      resetUploadForm();
      await loadData();
    } catch (error) {
      console.error("Error uploading document:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")).message);
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(doc: DocumentType) {
    setSelectedDoc(doc);
    setEditForm({
      machine_id: machineRefId(doc.machine_id),
      type_document: doc.type_document || "",
      description: doc.description || "",
      tags_text: tagsToText(doc.tags),
      uploaded_by: doc.uploaded_by || "",
    });
    setEditOpen(true);
  }

  async function handleUpdate() {
    if (!selectedDoc) return;
    if (!validateEditForm()) return;

    setSubmitting(true);
    try {
      const payload = {
        machine_id: editForm.machine_id,
        type_document: editForm.type_document.trim(),
        description: editForm.description.trim(),
        tags: parseTags(editForm.tags_text),
        uploaded_by: editForm.uploaded_by.trim(),
        expected_version: selectedDoc.version,
      };

      await apiService.updateDocument(selectedDoc._id, payload);
      showNotification("success", t("notifications.updated"));
      setEditOpen(false);
      setSelectedDoc(null);
      await loadData();
    } catch (error) {
      console.error("Error updating document:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(doc: DocumentType) {
    if (!confirm(t("notifications.confirmDelete"))) return;

    try {
      await apiService.deleteDocument(doc._id);
      showNotification("success", t("notifications.deleted"));
      await loadData();
    } catch (error) {
      console.error("Error deleting document:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.deleteFailed")).message);
    }
  }

  async function handlePublish(doc: DocumentType) {
    if (!confirm(t("notifications.confirmPublish"))) return;

    try {
      await apiService.publishDocument(doc._id, { expected_version: doc.version });
      showNotification("success", t("notifications.publishSuccess"));
      await loadData();
    } catch (error) {
      console.error("Error publishing document:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.publishFailed")).message);
    }
  }

  async function handleArchive(doc: DocumentType) {
    if (!confirm(t("notifications.confirmArchive"))) return;

    try {
      await apiService.archiveDocument(doc._id, { expected_version: doc.version });
      showNotification("success", t("notifications.archiveSuccess"));
      await loadData();
    } catch (error) {
      console.error("Error archiving document:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.archiveFailed")).message);
    }
  }

  function openReplace(doc: DocumentType) {
    setReplaceTarget(doc);
    setReplaceFile(null);
    setReplaceReason("");
    setReplaceOpen(true);
  }

  async function handleReplaceSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!replaceTarget) return;
    if (!replaceFile) {
      showNotification("error", t("notifications.fileRequired"));
      return;
    }

    const confirmed = confirm(
      t("notifications.confirmReplace", { fileName: replaceTarget.file_name }),
    );
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", replaceFile);
      formData.append("reason", replaceReason.trim());
      if (replaceTarget.version !== undefined) {
        formData.append("expected_version", String(replaceTarget.version));
      }

      await apiService.replaceDocument(replaceTarget._id, formData);
      showNotification("success", t("notifications.replaceSuccess"));
      setReplaceOpen(false);
      setReplaceTarget(null);
      await loadData();
    } catch (error) {
      console.error("Error replacing document:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.replaceFailed")).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function openHistory(doc: DocumentType) {
    setHistoryDoc(doc);
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const response = await apiService.getDocumentVersions(doc._id);
      setHistoryVersions(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error("Error loading document version history:", error);
      showNotification("error", t("notifications.historyLoadFailed"));
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // Initial load only; loadData is reused by mutations and intentionally not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${notification.type === "success"
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
            onClick={() => setUploadOpen(true)}
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
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
            title={t("form.machine")}
          >
            <option value="">{t("filterAllMachines")}</option>
            {machines.map((machine) => (
              <option key={machine._id} value={machine._id}>
                {machine.machine_id}
              </option>
            ))}
          </select>

          <select
            className="input-field"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            title={t("table.status", { default: "Status" })}
          >
            <option value="">{t("filterAllStatuses", { default: "All statuses" })}</option>
            {(["draft", "published", "archived", "superseded"] as DocumentStatus[]).map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`, { default: status })}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredDocuments.length === 0 ? (
          <div className="panel col-span-full text-center py-8 text-gray-500">
            {search ? t("empty.search") : t("empty.default")}
          </div>
        ) : (
          filteredDocuments.map((doc) => {
            const status = doc.status ?? "draft";
            const availableActions = getAvailableActions(status);
            const deletable = canDelete(doc);

            return (
              <div key={doc._id} className="panel hover:shadow-lg transition">
                <div className="flex justify-between items-start">
                  <DocumentIcon className="w-8 h-8 text-blue-600" />
                  <StatusBadge
                    label={t(`status.${status}`, { default: status })}
                    colorClassName={STATUS_BADGE_CLASSES[status]}
                  />
                </div>

                <h3 className="font-bold mt-2 break-all">{doc.file_name}</h3>
                {doc.revision ? (
                  <div className="text-xs text-gray-400">
                    {t("table.revision", { default: "Revision" })} {doc.revision}
                  </div>
                ) : null}

                <div className="text-sm text-gray-500 mt-1">
                  <div>
                    <span className="font-medium">{t("table.type")}: </span>
                    {doc.type_document}
                  </div>
                  <div>
                    <span className="font-medium">{t("table.machine")}: </span>
                    {machineRefLabel(doc.machine_id) || tCommon("notAvailable")}
                  </div>
                  <div>
                    <span className="font-medium">{t("table.uploadedBy")}: </span>
                    {doc.uploaded_by || tCommon("notAvailable")}
                  </div>
                  <div>
                    <span className="font-medium">{t("table.dateAdded")}: </span>
                    {doc.date_ajout ? new Date(doc.date_ajout).toLocaleString() : tCommon("notAvailable")}
                  </div>
                </div>

                <p className="text-sm text-gray-600 mt-2">{doc.description || tCommon("notAvailable")}</p>

                <div className="flex flex-wrap gap-1 mt-2">
                  {(doc.tags || []).map((tag) => (
                    <span
                      key={`${doc._id}-${tag}`}
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
                      setSelectedDoc(doc);
                      setViewerOpen(true);
                    }}
                    className="text-blue-600"
                    title={t("actions.view")}
                  >
                    <EyeIcon className="w-5 h-5" />
                  </button>
                  <button type="button"
                    onClick={() => openHistory(doc)}
                    className="text-slate-600"
                    title={t("actions.history", { default: "Version history" })}
                  >
                    <ClockIcon className="w-5 h-5" />
                  </button>
                  {availableActions.includes("publish") && (
                    <button type="button"
                      onClick={() => handlePublish(doc)}
                      className="text-green-600"
                      title={t("actions.publish", { default: "Publish" })}
                    >
                      <CheckIcon className="w-5 h-5" />
                    </button>
                  )}
                  {availableActions.includes("replace") && (
                    <button type="button"
                      onClick={() => openReplace(doc)}
                      className="text-indigo-600"
                      title={t("actions.replace", { default: "Replace" })}
                    >
                      <ArrowPathIcon className="w-5 h-5" />
                    </button>
                  )}
                  {availableActions.includes("archive") && (
                    <button type="button"
                      onClick={() => handleArchive(doc)}
                      className="text-gray-600"
                      title={t("actions.archive", { default: "Archive" })}
                    >
                      <ArchiveBoxIcon className="w-5 h-5" />
                    </button>
                  )}
                  <button type="button"
                    onClick={() => openEdit(doc)}
                    className="text-amber-600"
                    title={t("actions.edit")}
                  >
                    <PencilIcon className="w-5 h-5" />
                  </button>
                  {deletable && (
                    <button type="button"
                      onClick={() => handleDelete(doc)}
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
        isOpen={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          resetUploadForm();
        }}
        title={t("modal.uploadTitle")}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.file")}</label>
            <input
              type="file"
              accept={ACCEPTED_DOCUMENT_EXTENSIONS}
              title={t("form.file")}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.machine")}</label>
              <select
                className="input-field"
                value={uploadForm.machine_id}
                onChange={(e) => setUploadForm({ ...uploadForm, machine_id: e.target.value })}
                title={t("form.machine")}
              >
                <option value="">{t("placeholders.selectMachine")}</option>
                {machines.map((machine) => (
                  <option key={machine._id} value={machine._id}>
                    {machine.machine_id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.type")}</label>
              <input
                className="input-field"
                value={uploadForm.type_document}
                onChange={(e) => setUploadForm({ ...uploadForm, type_document: e.target.value })}
                placeholder={t("placeholders.type")}
                title={t("form.type")}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.description")}</label>
            <textarea
              className="input-field"
              value={uploadForm.description}
              onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
              placeholder={t("placeholders.description")}
              title={t("form.description")}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.tags")}</label>
              <input
                className="input-field"
                value={uploadForm.tags_text}
                onChange={(e) => setUploadForm({ ...uploadForm, tags_text: e.target.value })}
                placeholder={t("placeholders.tags")}
                title={t("form.tags")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.uploadedBy")}</label>
              <input
                className="input-field"
                value={uploadForm.uploaded_by}
                onChange={(e) => setUploadForm({ ...uploadForm, uploaded_by: e.target.value })}
                placeholder={t("placeholders.uploadedBy")}
                title={t("form.uploadedBy")}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setUploadOpen(false)}>
              {tCommon("cancel")}
            </button>
            <button type="button" className="btn-primary" onClick={handleUpload} disabled={submitting}>
              <CloudArrowUpIcon className="w-4 h-4 inline-block mr-2" />
              {submitting ? tCommon("saving") : t("buttons.upload")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={editOpen}
        onClose={() => {
          setEditOpen(false);
          setSelectedDoc(null);
        }}
        title={t("modal.editTitle")}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.machine")}</label>
              <select
                className="input-field"
                value={editForm.machine_id}
                onChange={(e) => setEditForm({ ...editForm, machine_id: e.target.value })}
                title={t("form.machine")}
              >
                <option value="">{t("placeholders.selectMachine")}</option>
                {machines.map((machine) => (
                  <option key={machine._id} value={machine._id}>
                    {machine.machine_id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.type")}</label>
              <input
                className="input-field"
                value={editForm.type_document}
                onChange={(e) => setEditForm({ ...editForm, type_document: e.target.value })}
                placeholder={t("placeholders.type")}
                title={t("form.type")}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.description")}</label>
            <textarea
              className="input-field"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              placeholder={t("placeholders.description")}
              title={t("form.description")}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.tags")}</label>
              <input
                className="input-field"
                value={editForm.tags_text}
                onChange={(e) => setEditForm({ ...editForm, tags_text: e.target.value })}
                placeholder={t("placeholders.tags")}
                title={t("form.tags")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.uploadedBy")}</label>
              <input
                className="input-field"
                value={editForm.uploaded_by}
                onChange={(e) => setEditForm({ ...editForm, uploaded_by: e.target.value })}
                placeholder={t("placeholders.uploadedBy")}
                title={t("form.uploadedBy")}
              />
            </div>
          </div>

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
        isOpen={replaceOpen}
        onClose={() => {
          setReplaceOpen(false);
          setReplaceTarget(null);
        }}
        title={t("modal.replaceTitle", { default: "Replace Document" })}
        size="lg"
      >
        <form onSubmit={handleReplaceSubmit} className="space-y-4">
          {replaceTarget && (
            <div className="text-sm text-slate-600">
              <div className="font-medium text-slate-800">{replaceTarget.file_name}</div>
              <div>
                {t("table.revision", { default: "Revision" })} {replaceTarget.revision ?? 1}
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.file")}</label>
            <input
              type="file"
              accept={ACCEPTED_DOCUMENT_EXTENSIONS}
              title={t("form.file")}
              onChange={(e) => setReplaceFile(e.target.files?.[0] || null)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.reason", { default: "Reason" })}</label>
            <textarea
              className="input-field"
              value={replaceReason}
              onChange={(e) => setReplaceReason(e.target.value)}
              placeholder={t("placeholders.reason", { default: "Explain this replacement" })}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setReplaceOpen(false)}>
              {tCommon("cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? tCommon("saving") : t("buttons.replace", { default: "Replace" })}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t("modal.historyTitle", { default: "Version History" })}
        size="lg"
      >
        {historyDoc && (
          <div className="mb-3 text-sm font-medium text-slate-800">{historyDoc.file_name}</div>
        )}
        {historyLoading ? (
          <div className="text-sm text-slate-500">{tCommon("loading")}</div>
        ) : historyVersions.length === 0 ? (
          <div className="text-sm text-slate-500">
            {t("history.empty", { default: "No version history available." })}
          </div>
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
                      {t("table.revision", { default: "Revision" })} {version.revision ?? 1}
                      {version._id === historyDoc?._id
                        ? ` (${t("history.current", { default: "current" })})`
                        : ""}
                    </div>
                    <div className="text-xs text-slate-500">{version.file_name}</div>
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
        title={selectedDoc?.file_name || t("viewer.title")}
        size="xl"
      >
        {selectedDoc ? (
          <DocumentAttachmentViewer document={selectedDoc} title={selectedDoc.file_name} />
        ) : (
          <div className="text-center text-gray-500">{tCommon("loading")}</div>
        )}
      </Modal>
    </DashboardLayout>
  );
}
