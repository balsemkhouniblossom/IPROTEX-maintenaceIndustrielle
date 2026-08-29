"use client";

import { useState } from "react";
import { SparklesIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import AiAssistantPanel from "@/components/ai-assistant/AiAssistantPanel";

export default function GlobalAiAssistantLauncher() {
  const t = useTranslations("aiAssistant");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="fixed bottom-4 end-4 z-1000 inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-purple-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-900/20 transition hover:bg-purple-800 focus:outline-none focus:ring-2 focus:ring-purple-300"
        aria-expanded={open}
        aria-controls="global-ai-assistant-panel"
        aria-label={open ? t("globalClose") : t("globalOpen")}
        data-testid="global-ai-assistant-launcher"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <XMarkIcon className="h-5 w-5 shrink-0" /> : <SparklesIcon className="h-5 w-5 shrink-0" />}
        <span className="hidden sm:inline">{open ? t("globalCloseShort") : t("globalOpenShort")}</span>
      </button>

      {open ? (
        <aside
          id="global-ai-assistant-panel"
          className="fixed bottom-20 end-4 z-1000 w-[min(28rem,calc(100vw-2rem))] max-h-[calc(100vh-7rem)] overflow-y-auto rounded-xl shadow-2xl"
          aria-label={t("globalPanelLabel")}
          data-testid="global-ai-assistant-panel"
        >
          <AiAssistantPanel />
        </aside>
      ) : null}
    </>
  );
}
