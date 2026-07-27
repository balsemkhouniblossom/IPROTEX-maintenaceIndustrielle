"use client";

import { useEffect, useState } from "react";
import { LightBulbIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/Modal";
import { apiService } from "@/services/api";

interface SuggestedArticle {
  _id: string;
  title: string;
  summary?: string;
  content: string;
}

/**
 * Surfaces Published Knowledge Base articles related to whichever of
 * machine/fault code/maintenance plan is already known at this point in the
 * corrective or preventive workflow. Purely additive and read-only: it never
 * changes what the surrounding form submits, so it can be dropped into any
 * page without touching that page's own submission logic.
 */
export default function KnowledgeSuggestions({
  machineId,
  faultCode,
  maintenancePlanId,
}: {
  machineId?: string;
  faultCode?: string;
  maintenancePlanId?: string;
}) {
  const t = useTranslations("knowledgeBase");
  const [articles, setArticles] = useState<SuggestedArticle[]>([]);
  const [openArticle, setOpenArticle] = useState<SuggestedArticle | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!machineId && !faultCode && !maintenancePlanId) {
      setArticles([]);
      return;
    }

    apiService
      .getKnowledgeArticleSuggestions({
        machineId: machineId || undefined,
        faultCode: faultCode || undefined,
        maintenancePlanId: maintenancePlanId || undefined,
        limit: 5,
      })
      .then((response) => {
        if (cancelled) return;
        setArticles(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error("Failed to load knowledge base suggestions", error);
        if (!cancelled) setArticles([]);
      });

    return () => {
      cancelled = true;
    };
  }, [machineId, faultCode, maintenancePlanId]);

  if (articles.length === 0) return null;

  return (
    <div className="panel border border-blue-100 bg-blue-50" data-testid="knowledge-suggestions-panel">
      <div className="card-title mb-2 flex items-center gap-2 text-blue-900">
        <LightBulbIcon className="w-5 h-5" />
        {t("suggestions.title")}
      </div>
      <div className="space-y-2">
        {articles.map((article) => (
          <button
            key={article._id}
            type="button"
            onClick={() => setOpenArticle(article)}
            className="block w-full text-left rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100"
            data-testid={`knowledge-suggestion-${article._id}`}
          >
            {article.title}
          </button>
        ))}
      </div>

      <Modal
        isOpen={Boolean(openArticle)}
        onClose={() => setOpenArticle(null)}
        title={openArticle?.title || t("viewer.title")}
        size="lg"
      >
        {openArticle ? (
          <div className="space-y-3 text-sm text-slate-700 whitespace-pre-wrap">
            {openArticle.summary ? (
              <p className="font-medium text-slate-800">{openArticle.summary}</p>
            ) : null}
            <p>{openArticle.content}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
