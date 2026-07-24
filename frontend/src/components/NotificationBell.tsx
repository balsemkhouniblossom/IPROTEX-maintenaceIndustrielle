"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BellAlertIcon } from "@heroicons/react/24/outline";
import { apiService } from "@/services/api";

interface NotificationItem {
  _id: string;
  notification_id: string;
  type: string;
  title: string;
  message?: string;
  is_read: boolean;
  createdAt: string;
}

const POLL_INTERVAL_MS = 30000;

export default function NotificationBell() {
  const t = useTranslations("notificationCenter");
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const response = await apiService.getUnreadNotificationCount();
      setUnreadCount((response.data?.count as number) ?? 0);
    } catch (error) {
      console.error("Failed to load unread notification count", error);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiService.getNotifications({ page: 1, limit: 10 });
      setItems((response.data?.items || []) as NotificationItem[]);
    } catch (error) {
      console.error("Failed to load notifications", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUnreadCount();
    const interval = window.setInterval(() => {
      void refreshUnreadCount();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (open) {
      void loadNotifications();
    }
  }, [open, loadNotifications]);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleMarkAsRead(id: string) {
    try {
      await apiService.markNotificationRead(id);
      setItems((prev) =>
        prev.map((item) => (item._id === id ? { ...item, is_read: true } : item)),
      );
      void refreshUnreadCount();
    } catch (error) {
      console.error("Failed to mark notification as read", error);
    }
  }

  async function handleMarkAllRead() {
    try {
      await apiService.markAllNotificationsRead();
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error("Failed to mark all notifications as read", error);
    }
  }

  async function handleClear(id: string) {
    try {
      await apiService.clearNotification(id);
      setItems((prev) => prev.filter((item) => item._id !== id));
      void refreshUnreadCount();
    } catch (error) {
      console.error("Failed to clear notification", error);
    }
  }

  async function handleClearAll() {
    try {
      await apiService.clearAllNotifications();
      setItems([]);
      setUnreadCount(0);
    } catch (error) {
      console.error("Failed to clear all notifications", error);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-(--surface-elevated) text-cyan-800 dark:text-cyan-600 backdrop-blur-xl shadow-(--shadow) transition hover:-translate-y-0.5 hover:border-cyan-700/55"
        aria-label={t("title")}
      >
        <BellAlertIcon className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-140 mt-2 w-80 rounded-3xl border border-border bg-(--surface-elevated) p-4 shadow-(--shadow-lg) backdrop-blur-xl md:w-96">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-text-primary">{t("title")}</div>
              <div className="text-xs text-text-secondary">
                {unreadCount} {t("unread")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="text-xs font-semibold text-cyan-700 hover:underline dark:text-cyan-400"
              >
                {t("markAllRead")}
              </button>
              <button
                type="button"
                onClick={() => void handleClearAll()}
                className="text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400"
              >
                {t("clearAll")}
              </button>
            </div>
          </div>

          <div className="max-h-96 space-y-2 overflow-y-auto">
            {loading ? (
              <div className="rounded-2xl border border-border bg-(--surface-secondary) px-4 py-4 text-center text-sm text-text-secondary">
                {t("loading")}
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-border bg-(--surface-secondary) px-4 py-4 text-center text-sm text-text-secondary">
                {t("empty")}
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item._id}
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    item.is_read
                      ? "border-border bg-(--surface-secondary)"
                      : "border-cyan-700/40 bg-cyan-900/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-text-primary">{item.title}</span>
                    <span className="shrink-0 text-[10px] text-text-secondary">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {item.message ? (
                    <div className="mt-1 text-xs text-text-secondary">{item.message}</div>
                  ) : null}
                  <div className="mt-2 flex items-center gap-3">
                    {!item.is_read ? (
                      <button
                        type="button"
                        onClick={() => void handleMarkAsRead(item._id)}
                        className="text-xs font-semibold text-cyan-700 hover:underline dark:text-cyan-400"
                      >
                        {t("markRead")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleClear(item._id)}
                      className="text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400"
                    >
                      {t("clear")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
