"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircleIcon,
  CloudArrowUpIcon,
  DocumentIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  PlusIcon,
  TagIcon,
  TrashIcon

} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import DashboardLayout from "@/components/DashboardLayout";
import { Modal } from "@/components/Modal";
import DocumentAttachmentViewer from "@/components/DocumentAttachmentViewer";
import { apiService } from "@/services/api";
import { displayText } from "@/services/displayValues";

type MachineRef = string | { _id: string; machine_id?: string };

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
}

interface Machine {
  _id: string;
  machine_id: string;
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

  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentType | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
      console.log("Documents API response:", docsRes);
      console.log("Documents API response.data:", docsRes.data);

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

      return matchesSearch && matchesMachine;
    });
  }, [documents, search, selectedMachine]);

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
      showNotification("error", t("notifications.saveFailed"));
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
      };

      await apiService.updateDocument(selectedDoc._id, payload);
      showNotification("success", t("notifications.updated"));
      setEditOpen(false);
      setSelectedDoc(null);
      await loadData();
    } catch (error) {
      console.error("Error updating document:", error);
      showNotification("error", t("notifications.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm(t("notifications.confirmDelete"))) return;

    try {
      await apiService.deleteDocument(docId);
      showNotification("success", t("notifications.deleted"));
      await loadData();
    } catch (error) {
      console.error("Error deleting document:", error);
      showNotification("error", t("notifications.deleteFailed"));
    }
  }

  useEffect(() => {
    loadData();
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
          <button
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

          <button
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
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredDocuments.length === 0 ? (
          <div className="panel col-span-full text-center py-8 text-gray-500">
            {search ? t("empty.search") : t("empty.default")}
          </div>
        ) : (
          filteredDocuments.map((doc) => (
            <div key={doc._id} className="panel hover:shadow-lg transition">
              <div className="flex justify-between items-start">
                <DocumentIcon className="w-8 h-8 text-blue-600" />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSelectedDoc(doc);
                      setViewerOpen(true);
                    }}
                    className="text-blue-600"
                    title={t("actions.view")}
                  >
                    <EyeIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => openEdit(doc)}
                    className="text-amber-600"
                    title={t("actions.edit")}
                  >
                    <PencilIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleDelete(doc._id)}
                    className="text-red-600"
                    title={t("actions.delete")}
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <h3 className="font-bold mt-2 break-all">{doc.file_name}</h3>

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
            </div>
          ))
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
              accept="application/pdf"
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
            <button className="btn-secondary" onClick={() => setUploadOpen(false)}>
              {tCommon("cancel")}
            </button>
            <button className="btn-primary" onClick={handleUpload} disabled={submitting}>
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
            <button className="btn-secondary" onClick={() => setEditOpen(false)}>
              {tCommon("cancel")}
            </button>
            <button className="btn-primary" onClick={handleUpdate} disabled={submitting}>
              {submitting ? tCommon("saving") : t("buttons.update")}
            </button>
          </div>
        </div>
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
