"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpenIcon, MagnifyingGlassIcon, TagIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/Modal";
import { apiService } from "@/services/api";

type KnowledgeArticleCategory =
  | "troubleshooting"
  | "procedure"
  | "fault_code"
  | "lubrication"
  | "safety";

export interface KnowledgeArticleSummary {
  _id: string;
  title: string;
  category: KnowledgeArticleCategory;
  summary?: string;
  content: string;
  tags?: string[];
  fault_codes?: string[];
  error_codes?: string[];
}

const CATEGORIES: KnowledgeArticleCategory[] = [
  "troubleshooting",
  "procedure",
  "fault_code",
  "lubrication",
  "safety",
];

/**
 * Read-only Knowledge Base browser shared by Operator and Technician pages.
 * Only ever calls the reader endpoint (which the backend already scopes to
 * Published articles for non-Admin roles) — never the Admin authoring
 * endpoints, so there is nothing here for a non-Admin to accidentally
 * trigger beyond browsing.
 */
export default function KnowledgeBaseBrowser({
  machineId,
}: Readonly<{
  machineId?: string;
}>) {
  const t = useTranslations("knowledgeBase");
  const tCommon = useTranslations("common");

  const [articles, setArticles] = useState<KnowledgeArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<KnowledgeArticleSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadArticles() {
      try {
        setLoading(true);
        setLoadError(false);
        const response = await apiService.getKnowledgeArticles({
          limit: 100,
          machineId: machineId || undefined,
          category: selectedCategory || undefined,
          search: search.trim() || undefined,
        });
        if (cancelled) return;
        setArticles(Array.isArray(response.data?.items) ? response.data.items : []);
      } catch (error) {
        console.error("Failed to load knowledge base articles", error);
        if (!cancelled) {
          setArticles([]);
          setLoadError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timeout = window.setTimeout(() => void loadArticles(), 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [machineId, selectedCategory, search]);

  const visibleArticles = useMemo(() => articles, [articles]);
  const emptyMessage = search.trim() || selectedCategory
    ? t("empty.search")
    : t("empty.published");

  return (
    <div className="operator-dashboard-theme bento-grid">
      <section className="col-span-full panel">
        <div className="card-title mb-2">{t("title")}</div>
        <p className="text-sm text-slate-600 mb-4">{t("readerIntro")}</p>

        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              className="input-field pl-9"
              placeholder={t("searchPlaceholder")}
              title={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="knowledge-base-search-input"
            />
          </div>
          <select
            className="input-field md:w-64"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            title={t("form.category")}
            data-testid="knowledge-base-category-select"
          >
            <option value="">{t("filterAllCategories")}</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`categories.${category}`, { default: category })}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="col-span-full">
        {loading ? (
          <div className="panel text-sm text-slate-500">{tCommon("loading")}</div>
        ) : null}
        {!loading && loadError ? (
          <div className="panel text-center py-8 text-red-700">{t("notifications.loadFailed")}</div>
        ) : null}
        {!loading && !loadError && visibleArticles.length === 0 ? (
          <div className="panel text-center py-8 text-gray-500">{emptyMessage}</div>
        ) : null}
        {!loading && !loadError && visibleArticles.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleArticles.map((article) => (
              <button
                key={article._id}
                type="button"
                onClick={() => setSelectedArticle(article)}
                className="panel text-left hover:-translate-y-1 hover:shadow-lg transition"
                data-testid={`knowledge-base-article-${article._id}`}
              >
                <div className="flex items-start justify-between">
                  <BookOpenIcon className="w-7 h-7 text-blue-600" />
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    {t(`categories.${article.category}`, { default: article.category })}
                  </span>
                </div>
                <h3 className="font-bold mt-2 text-slate-900">{article.title}</h3>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                  {article.summary || tCommon("notAvailable")}
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(article.tags || []).slice(0, 4).map((tag) => (
                    <span
                      key={`${article._id}-${tag}`}
                      className="text-xs bg-gray-100 px-2 py-1 rounded flex items-center gap-1"
                    >
                      <TagIcon className="w-3 h-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <Modal
        isOpen={Boolean(selectedArticle)}
        onClose={() => setSelectedArticle(null)}
        title={selectedArticle?.title || t("viewer.title")}
        size="xl"
      >
        {selectedArticle ? (
          <div className="operator-dashboard-theme space-y-3 text-sm text-slate-700 whitespace-pre-wrap">
            {selectedArticle.summary ? (
              <p className="font-medium text-slate-800">{selectedArticle.summary}</p>
            ) : null}
            <p>{selectedArticle.content}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
