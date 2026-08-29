"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildVisibleWorkOrderTranslationReferences,
  DynamicTranslationMap,
  mergeTranslationResults,
  requestDynamicTranslations,
  translatedTextFor,
} from "@/services/dynamicTranslations";

export function useWorkOrderDynamicTranslations(
  workOrders: Array<{
    _id?: string;
    description?: string;
    reschedule_reason?: string;
    lifecycle_history?: Array<{ reason?: string }>;
  }>,
  locale: string,
) {
  const [translations, setTranslations] = useState<DynamicTranslationMap>({});
  const [showOriginal, setShowOriginal] = useState(false);
  const requestedKeys = useRef(new Set<string>());

  const references = useMemo(
    () => buildVisibleWorkOrderTranslationReferences(workOrders),
    [workOrders],
  );
  const requestSignature = useMemo(
    () =>
      references
        .map(
          (reference) =>
            `${reference.entityType}:${reference.entityId}:${reference.fields.join(",")}`,
        )
        .join("|"),
    [references],
  );

  useEffect(() => {
    requestedKeys.current.clear();
    setTranslations({});
    setShowOriginal(false);
  }, [locale]);

  useEffect(() => {
    if (locale === "en" || references.length === 0) return;
    const missing = references.filter((reference) => {
      const key = `${locale}:${reference.entityType}:${reference.entityId}:${reference.fields.join(",")}`;
      if (requestedKeys.current.has(key)) return false;
      requestedKeys.current.add(key);
      return true;
    });
    if (!missing.length) return;

    const controller = new AbortController();
    void requestDynamicTranslations(
      { targetLocale: locale, sourceLocale: "en", items: missing },
      controller.signal,
    )
      .then((response) => {
        setTranslations((current) =>
          mergeTranslationResults(current, response.items),
        );
      })
      .catch((error) => {
        if ((error as { name?: string })?.name === "CanceledError") return;
        if ((error as { name?: string })?.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [locale, references, requestSignature]);

  return {
    showOriginal,
    setShowOriginal,
    hasTranslationLocale: locale !== "en",
    textFor(entityId: string, field: string, originalText?: string): string {
      return translatedTextFor({
        translations,
        entityType: "workOrder",
        entityId,
        field,
        originalText,
        showOriginal,
      });
    },
    isAutomaticallyTranslated(entityId: string, field: string): boolean {
      return Boolean(
        translations[`workOrder:${entityId}:${field}`]
          ?.automaticallyTranslated && !showOriginal,
      );
    },
  };
}
