"use client";

import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

export type ToastNotificationState = {
  type: "success" | "error";
  message: string;
};

type ToastNotificationProps = {
  readonly notification: ToastNotificationState | null;
  readonly onClose: () => void;
  readonly closeLabel?: string;
};

export function ToastNotification(props: Readonly<ToastNotificationProps>) {
  const { notification, onClose, closeLabel = "Close" } = props;

  if (!notification) return null;

  const colorClassName =
    notification.type === "success"
      ? "bg-green-100 text-green-800 border border-green-200"
      : "bg-red-100 text-red-800 border border-red-200";

  return (
    <div
      className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${colorClassName}`}
    >
      {notification.type === "success" ? (
        <CheckCircleIcon className="w-5 h-5" />
      ) : (
        <ExclamationTriangleIcon className="w-5 h-5" />
      )}
      <span>{notification.message}</span>
      <button
        type="button"
        onClick={onClose}
        className="ml-2 text-gray-500 hover:text-gray-700"
        title={closeLabel}
      >
        x
      </button>
    </div>
  );
}
