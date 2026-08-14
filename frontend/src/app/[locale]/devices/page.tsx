"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircleIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import DashboardLayout from "@/components/DashboardLayout";
import { Modal } from "@/components/Modal";
import { apiService } from "@/services/api";
import { extractApiErrorMessage } from "@/services/apiErrors";

type DeviceType = "openplc" | "simulator" | "gateway";

interface Device {
  _id: string;
  device_id: string;
  machine_id: string | { _id: string; machine_id?: string };
  label?: string;
  device_type: DeviceType;
  is_active: boolean;
  heartbeat_interval_seconds: number;
  last_seen_at?: string;
  last_known_status?: "unknown" | "online" | "offline";
}

interface Machine {
  _id: string;
  machine_id: string;
}

const DEVICE_TYPES: DeviceType[] = ["openplc", "simulator", "gateway"];

function machineRefId(value: Device["machine_id"]): string {
  return typeof value === "string" ? value : value?._id ?? "";
}

export default function DevicesPage() {
  const t = useTranslations("deviceMonitoring");
  const tCommon = useTranslations("common");

  const [devices, setDevices] = useState<Device[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [form, setForm] = useState({
    device_id: "",
    machine_id: "",
    label: "",
    device_type: "simulator" as DeviceType,
    heartbeat_interval_seconds: 30,
  });

  const [revealedKey, setRevealedKey] = useState<{ deviceId: string; apiKey: string } | null>(null);

  function showNotification(type: "success" | "error", message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [devicesRes, machinesRes] = await Promise.all([
        apiService.getDevices(),
        apiService.getMachines(),
      ]);
      setDevices(Array.isArray(devicesRes.data) ? devicesRes.data : []);
      setMachines(
        Array.isArray(machinesRes.data) ? machinesRes.data : machinesRes.data?.items || [],
      );
    } catch (error) {
      console.error("Error loading devices:", error);
      showNotification("error", t("notifications.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const machineLabelById = useMemo(() => {
    const map = new Map<string, string>();
    machines.forEach((machine) => map.set(machine._id, machine.machine_id));
    return map;
  }, [machines]);

  function resetForm() {
    setForm({
      device_id: "",
      machine_id: "",
      label: "",
      device_type: "simulator",
      heartbeat_interval_seconds: 30,
    });
  }

  async function handleRegister() {
    if (!form.device_id.trim() || !form.machine_id) {
      showNotification("error", t("notifications.registerValidation"));
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiService.registerDevice({
        device_id: form.device_id.trim(),
        machine_id: form.machine_id,
        label: form.label.trim() || undefined,
        device_type: form.device_type,
        heartbeat_interval_seconds: form.heartbeat_interval_seconds,
      });
      showNotification("success", t("notifications.registered"));
      setRegisterOpen(false);
      resetForm();
      setRevealedKey({ deviceId: response.data.device.device_id, apiKey: response.data.apiKey });
      await loadData();
    } catch (error) {
      console.error("Error registering device:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(device: Device) {
    try {
      await apiService.updateDevice(device._id, { is_active: !device.is_active });
      showNotification("success", device.is_active ? t("notifications.deactivated") : t("notifications.activated"));
      await loadData();
    } catch (error) {
      console.error("Error updating device:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")));
    }
  }

  async function handleRotateKey(device: Device) {
    if (!confirm(t("notifications.confirmRotate"))) return;
    try {
      const response = await apiService.rotateDeviceKey(device._id);
      setRevealedKey({ deviceId: device.device_id, apiKey: response.data.apiKey });
      showNotification("success", t("notifications.rotated"));
    } catch (error) {
      console.error("Error rotating device key:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")));
    }
  }

  async function handleDelete(device: Device) {
    if (!confirm(t("notifications.confirmDelete"))) return;
    try {
      await apiService.deleteDevice(device._id);
      showNotification("success", t("notifications.deleted"));
      await loadData();
    } catch (error) {
      console.error("Error deleting device:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.deleteFailed")));
    }
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
            aria-label={tCommon("close")}
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
            onClick={() => setRegisterOpen(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"
          >
            <PlusIcon className="w-4 h-4" />
            {t("actions.register")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {devices.length === 0 ? (
          <div className="panel col-span-full text-center py-8 text-gray-500">{t("empty")}</div>
        ) : (
          devices.map((device) => (
            <div key={device._id} className="panel hover:shadow-lg transition">
              <div className="flex justify-between items-start">
                <CpuChipIcon className="w-8 h-8 text-blue-600" />
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                    device.is_active
                      ? "bg-green-100 text-green-800 border-green-200"
                      : "bg-gray-200 text-gray-600 border-gray-300"
                  }`}
                >
                  {device.is_active ? t("status.active") : t("status.inactive")}
                </span>
              </div>
              <h3 className="font-bold mt-2">{device.label || device.device_id}</h3>
              <div className="text-sm text-gray-500 mt-1">
                <div>
                  <span className="font-medium">{t("form.deviceId")}: </span>
                  {device.device_id}
                </div>
                <div>
                  <span className="font-medium">{t("form.deviceType")}: </span>
                  {t(`deviceTypes.${device.device_type}`, { default: device.device_type })}
                </div>
                <div>
                  <span className="font-medium">{t("form.machine")}: </span>
                  {machineLabelById.get(machineRefId(device.machine_id)) || tCommon("notAvailable")}
                </div>
                <div>
                  <span className="font-medium">{t("lastSignal")}: </span>
                  {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : t("never")}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                <button type="button"
                  onClick={() => handleToggleActive(device)}
                  className={device.is_active ? "text-gray-600" : "text-green-600"}
                  title={device.is_active ? t("actions.deactivate") : t("actions.activate")}
                  aria-label={device.is_active ? t("actions.deactivate") : t("actions.activate")}
                >
                  {device.is_active ? <ExclamationTriangleIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}
                </button>
                <button type="button"
                  onClick={() => handleRotateKey(device)}
                  className="text-indigo-600"
                  title={t("actions.rotateKey")}
                  aria-label={t("actions.rotateKey")}
                >
                  <KeyIcon className="w-5 h-5" />
                </button>
                <button type="button"
                  onClick={() => handleDelete(device)}
                  className="text-red-600"
                  title={t("actions.delete")}
                  aria-label={t("actions.delete")}
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        isOpen={registerOpen}
        onClose={() => {
          setRegisterOpen(false);
          resetForm();
        }}
        title={t("modal.registerTitle")}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.deviceId")}</label>
              <input
                className="input-field"
                value={form.device_id}
                onChange={(e) => setForm({ ...form, device_id: e.target.value })}
                placeholder={t("placeholders.deviceId")}
                title={t("form.deviceId")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.deviceType")}</label>
              <select
                className="input-field"
                value={form.device_type}
                onChange={(e) => setForm({ ...form, device_type: e.target.value as DeviceType })}
                title={t("form.deviceType")}
              >
                {DEVICE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`deviceTypes.${type}`, { default: type })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.machine")}</label>
              <select
                className="input-field"
                value={form.machine_id}
                onChange={(e) => setForm({ ...form, machine_id: e.target.value })}
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
              <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.heartbeatInterval")}</label>
              <input
                type="number"
                min={5}
                className="input-field"
                value={form.heartbeat_interval_seconds}
                onChange={(e) =>
                  setForm({ ...form, heartbeat_interval_seconds: Number(e.target.value) || 30 })
                }
                title={t("form.heartbeatInterval")}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">{t("form.label")}</label>
            <input
              className="input-field"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder={t("placeholders.label")}
              title={t("form.label")}
            />
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setRegisterOpen(false)}>
              {tCommon("cancel")}
            </button>
            <button type="button" className="btn-primary" onClick={handleRegister} disabled={submitting}>
              {submitting ? tCommon("saving") : t("buttons.register")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(revealedKey)}
        onClose={() => setRevealedKey(null)}
        title={t("modal.apiKeyTitle")}
        size="lg"
      >
        {revealedKey ? (
          <div className="space-y-4">
            <p className="text-sm text-amber-700 flex items-center gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
              {t("modal.apiKeyWarning")}
            </p>
            <div className="text-sm text-gray-600">
              <span className="font-medium">{t("form.deviceId")}: </span>
              {revealedKey.deviceId}
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm break-all select-all">
              {revealedKey.apiKey}
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={() => setRevealedKey(null)}>
                {t("buttons.doneCopying")}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </DashboardLayout>
  );
}
