import { useEffect, useState } from "react";

export type NotificationState = { type: "success" | "error"; message: string } | null;

const AUTO_DISMISS_MS = 5000;

/** A toast that clears itself after five seconds; every new notification restarts the timer, and unmounting clears any pending timeout. */
export function useAutoDismissNotification() {
  const [notification, setNotification] = useState<NotificationState>(null);

  useEffect(() => {
    if (!notification) return;

    const timeout = setTimeout(() => {
      setNotification(null);
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timeout);
  }, [notification]);

  function notify(type: "success" | "error", message: string): void {
    setNotification({ type, message });
  }

  return { notification, notify };
}
