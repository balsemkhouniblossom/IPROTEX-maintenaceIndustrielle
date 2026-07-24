"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

interface AvatarSpeechBubbleProps {
  eyebrow: string;
  tone: "urgent" | "attention" | "active" | "neutral";
  title: string;
  message: string;
  closeLabel: string;
  action?: ReactNode;
  onClose: () => void;
}

export function AvatarSpeechBubble({ eyebrow, tone, title, message, closeLabel, action, onClose }: AvatarSpeechBubbleProps) {
  return (
    <div className="avatar-assistant-copy relative min-w-0 flex-1 py-0.5 pe-10 sm:flex sm:items-center sm:justify-between sm:gap-5 sm:pe-11" data-tone={tone}>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute -top-1 end-0 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-text-muted transition hover:border-border hover:bg-(--surface-elevated) hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600"
      >
        <XMarkIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-400">
          <span className="avatar-assistant-status-dot h-1.5 w-1.5 rounded-full bg-cyan-500 shadow-[0_0_0_4px_rgba(6,182,212,0.12)]" aria-hidden="true" />
          {eyebrow}
        </div>
        <h2 className="text-lg font-semibold leading-6 tracking-[-0.015em] text-text-primary sm:text-xl">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-text-secondary sm:leading-6">{message}</p>
      </div>
      {action ? <div className="mt-3 shrink-0 sm:mt-0">{action}</div> : null}
    </div>
  );
}
