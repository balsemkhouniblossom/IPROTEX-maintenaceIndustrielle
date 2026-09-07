"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useTranslations } from "next-intl";
import { apiService } from "@/services/api";
import {
  BellAlertIcon,
  CheckIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

interface NotificationItem {
  _id: string;
  notification_id: string;
  type: string;
  title: string;
  message?: string;
  translationKey?: string;
  translationParams?: Record<string, string | number | boolean | null>;
  is_read: boolean;
  createdAt: string;
}

function notificationTranslationParams(
  params?: Record<string, string | number | boolean | null>,
): Record<string, string | number> {
  if (!params) return {};
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [
        key,
        typeof value === "boolean" ? String(value) : value,
      ]),
  ) as Record<string, string | number>;
}

function notificationTarget(item: NotificationItem, locale: string): string | null {
  const params = item.translationParams || {};
  const value = (...keys: string[]) => keys.map((key) => params[key]).find((entry) => typeof entry === "string" && entry.trim()) as string | undefined;
  const reportId = value("reportId", "report_id");
  const workOrderId = value("workOrderId", "work_order_id", "otId", "ot_id");
  const machineId = value("machineId", "machine_id");
  const encoded = (id: string) => encodeURIComponent(id);
  const kind = `${item.type} ${item.translationKey || ""}`.toLowerCase();
  if (reportId) {
    const workOrderQuery = workOrderId ? `&workOrderId=${encoded(workOrderId)}` : "";
    return `/${locale}/operator/my-reports?reportId=${encoded(reportId)}${workOrderQuery}`;
  }
  if (workOrderId && /preventive|inspection|task/.test(kind)) return `/${locale}/operator/preventive?workOrder=${encoded(workOrderId)}`;
  if (workOrderId) return `/${locale}/operator/my-reports?workOrderId=${encoded(workOrderId)}`;
  if (machineId) return `/${locale}/operator/machines/${encoded(machineId)}`;
  return null;
}

export default function OperatorNotificationsPage() {
  const tCommon = useTranslations("common");
  const tNotification = useTranslations("notificationCenter");
  const router = useRouter();
  const params = useParams();
  const locale = Array.isArray(params?.locale)
    ? params.locale[0]
    : params?.locale || "en";

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const response = await apiService.getNotifications({
        page: 1,
        limit: 50,
      });
      setItems((response.data?.items || []) as NotificationItem[]);
    } catch (error) {
      console.error("Failed to load notifications", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNotifications();
  }, []);

  const unreadCount = useMemo(
    () => items.filter((item) => !item.is_read).length,
    [items],
  );

  const renderTitle = (item: NotificationItem): string => {
    const key = item.translationKey
      ? `templates.${item.translationKey.replace(/^templates\./, "")}`
      : "";
    if (key && tNotification.has(key)) {
      return tNotification(key, notificationTranslationParams(item.translationParams));
    }
    return item.title;
  };

  async function handleMarkAsRead(id: string) {
    try {
      await apiService.markNotificationRead(id);
      setItems((prev) =>
        prev.map((item) =>
          item._id === id ? { ...item, is_read: true } : item,
        ),
      );
    } catch (error) {
      console.error("Failed to mark notification as read", error);
    }
  }

  async function handleMarkAllRead() {
    try {
      setActionLoading(true);
      await apiService.markAllNotificationsRead();
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
    } catch (error) {
      console.error("Failed to mark all notifications as read", error);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleClear(id: string) {
    try {
      await apiService.clearNotification(id);
      setItems((prev) => prev.filter((item) => item._id !== id));
    } catch (error) {
      console.error("Failed to clear notification", error);
    }
  }

  async function handleClearAll() {
    try {
      setActionLoading(true);
      await apiService.clearAllNotifications();
      setItems([]);
    } catch (error) {
      console.error("Failed to clear all notifications", error);
    } finally {
      setActionLoading(false);
    }
  }

  const formatDate = (value: string) => {
    try {
      return new Date(value).toLocaleString(locale, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return value;
    }
  };

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={tNotification("title")}>
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-text-primary">
                  {tNotification("title")}
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  {unreadCount} {tNotification("unread")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  disabled={actionLoading || unreadCount === 0}
                  className="inline-flex items-center gap-2 rounded-2xl border border-cyan-700/40 bg-cyan-900/10 px-4 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-900/20 disabled:opacity-50"
                >
                  <CheckIcon className="h-4 w-4" />
                  {tNotification("markAllRead")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleClearAll()}
                  disabled={actionLoading || items.length === 0}
                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-500/20 disabled:opacity-50"
                >
                  <TrashIcon className="h-4 w-4" />
                  {tNotification("clearAll")}
                </button>
              </div>
            </div>

            {loading && (
              <div className="rounded-3xl border border-border bg-(--surface-secondary) px-4 py-12 text-center text-sm text-text-secondary">
                {tCommon("loading")}
              </div>
            )}
            {!loading && loadError && (
              <div className="rounded-3xl border border-red-200 bg-red-50 px-4 py-12 text-center text-sm text-red-800">
                <div>{tCommon("loadFailed", { defaultValue: "Unable to load notifications." })}</div>
                <button type="button" onClick={() => void loadNotifications()} className="mt-3 rounded-xl border border-red-300 bg-white px-4 py-2 font-semibold text-red-800">
                  {tCommon("retry", { defaultValue: "Retry" })}
                </button>
              </div>
            )}
            {!loading && !loadError && items.length === 0 && (
              <div className="rounded-3xl border border-border bg-(--surface-secondary) px-4 py-12 text-center text-sm text-text-secondary">
                {tNotification("empty")}
              </div>
            )}
            {!loading && !loadError && items.length > 0 && (
              <div className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item._id}
                    className={`rounded-3xl border px-5 py-4 text-sm transition ${
                      item.is_read
                        ? "border-border bg-(--surface-secondary)"
                        : "border-cyan-700/40 bg-cyan-900/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                            item.is_read
                              ? "border-border bg-(--surface-secondary) text-text-muted"
                              : "border-cyan-700/40 bg-cyan-900/15 text-cyan-700"
                          }`}
                        >
                          <BellAlertIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          {notificationTarget(item, String(locale)) ? (
                            <button
                              type="button"
                              onClick={() => router.push(notificationTarget(item, String(locale)) as string)}
                              className="text-start font-medium text-text-primary underline-offset-2 hover:underline"
                              aria-label={renderTitle(item)}
                            >
                              {renderTitle(item)}
                            </button>
                          ) : (
                            <div className="font-medium text-text-primary">{renderTitle(item)}</div>
                          )}
                          {item.message ? (
                            <div className="mt-1 text-xs text-text-secondary">
                              {item.message}
                            </div>
                          ) : null}
                          <div className="mt-2 text-[10px] text-text-muted">
                            {formatDate(item.createdAt)}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {!item.is_read ? (
                          <button
                            type="button"
                            onClick={() => void handleMarkAsRead(item._id)}
                            className="inline-flex items-center gap-1 rounded-xl border border-cyan-700/30 bg-cyan-900/10 px-3 py-1.5 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-900/20"
                          >
                            <CheckIcon className="h-3 w-3" />
                            {tNotification("markRead")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleClear(item._id)}
                          className="inline-flex items-center gap-1 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-500/20"
                        >
                          <TrashIcon className="h-3 w-3" />
                          {tNotification("clear")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
