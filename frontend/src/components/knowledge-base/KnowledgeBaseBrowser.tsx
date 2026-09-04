"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpenIcon,
  MagnifyingGlassIcon,
  TagIcon,
} from "@heroicons/react/24/outline";
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
  machine_id?: string;
  machine_type_id?: string;
  status?: string;
}

const CATEGORIES: KnowledgeArticleCategory[] = [
  "troubleshooting",
  "procedure",
  "fault_code",
  "lubrication",
  "safety",
];

const TOPIC_KEYS = [
  "bearing",
  "lubrication",
  "vibration",
  "electrical",
  "hydraulic",
  "pneumatic",
  "cooling",
  "alignment",
  "calibration",
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
  const tTech = useTranslations("technician");
  const tCommon = useTranslations("common");

  const [articles, setArticles] = useState<KnowledgeArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedArticle, setSelectedArticle] =
    useState<KnowledgeArticleSummary | null>(null);

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
        setArticles(
          Array.isArray(response.data?.items) ? response.data.items : [],
        );
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

  const visibleArticles = useMemo(() => {
    if (!search.trim()) return articles;
    const query = search.trim().toLowerCase();
    return articles.filter((article) => {
      const haystack = [
        article.title,
        article.summary,
        article.content,
        ...(article.tags || []),
        ...(article.fault_codes || []),
        ...(article.error_codes || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [articles, search]);

  const emptyMessage = search.trim() || selectedCategory
    ? t("empty.search")
    : t("empty.published");

  return (
    <div className="operator-dashboard-theme bento-grid">
      <section className="col-span-full panel">
        <div className="card-title mb-2">{t("title")}</div>
        <p className="text-sm text-slate-600 mb-1">{t("readerIntro")}</p>
        <p className="text-xs text-slate-500 mb-4">
          {tTech("manuals.readOnlyHint")}
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="relative">
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
            className="input-field"
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

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wide text-slate-600">
            {tTech("knowledgeBase.topicHints")}
          </span>
          {TOPIC_KEYS.map((topic) => (
            <button
              key={topic}
              type="button"
              className="rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-slate-700 hover:border-blue-300"
              onClick={() => setSearch(topic)}
              data-testid={`knowledge-base-topic-${topic}`}
            >
              {topic}
            </button>
          ))}
        </div>
      </section>

      <section className="col-span-full">
        {loading ? (
          <div className="panel text-sm text-slate-500">{tCommon("loading")}</div>
        ) : null}
        {!loading && loadError ? (
          <div className="panel text-center py-8 text-red-700">
            {t("notifications.loadFailed")}
          </div>
        ) : null}
        {!loading && !loadError && visibleArticles.length === 0 ? (
          <div className="panel border-s-4 border-s-slate-300 text-center text-sm text-slate-500">
            {emptyMessage}
          </div>
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
                {(article.fault_codes || []).length > 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {tTech("knowledgeBase.faultCodesLabel")}:{" "}
                    <strong className="text-slate-700">
                      {article.fault_codes?.join(", ")}
                    </strong>
                  </p>
                ) : null}
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
            {(selectedArticle.fault_codes || []).length > 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                {tTech("knowledgeBase.faultCodesLabel")}:{" "}
                <strong>{selectedArticle.fault_codes?.join(", ")}</strong>
              </p>
            ) : null}
            {(selectedArticle.tags || []).length > 0 ? (
              <p className="text-xs text-slate-500">
                {tTech("knowledgeBase.topicsLabel")}:{" "}
                {selectedArticle.tags?.join(", ")}
              </p>
            ) : null}
            <p>{selectedArticle.content}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
