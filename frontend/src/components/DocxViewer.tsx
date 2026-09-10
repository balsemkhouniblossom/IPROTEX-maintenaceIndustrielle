"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

type Props = Readonly<{
  file: Blob;
  onCorrupt: () => void;
  onRendererError: () => void;
}>;

export default function DocxViewer({
  file,
  onCorrupt,
  onRendererError,
}: Props) {
  const t = useTranslations("documents.viewer");
  const bodyRef = useRef<HTMLDivElement>(null);
  const stylesRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let active = true;
    const body = bodyRef.current;
    const styles = stylesRef.current;
    if (!body || !styles) return;
    setRendered(false);
    body.replaceChildren();
    styles.replaceChildren();
    let rendererLoaded = false;

    import("docx-preview")
      .then(({ renderAsync }) => {
        rendererLoaded = true;
        return renderAsync(file, body, styles, {
          breakPages: true,
          ignoreFonts: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderComments: false,
          renderChanges: false,
          renderAltChunks: false,
          useBase64URL: true,
        });
      })
      .then(() => {
        if (!active) {
          body.replaceChildren();
          styles.replaceChildren();
          return;
        }
        sanitizeRenderedDocx(body);
        setRendered(true);
      })
      .catch(() => {
        if (!active) return;
        if (rendererLoaded) onCorrupt();
        else onRendererError();
      });

    return () => {
      active = false;
      body.replaceChildren();
      styles.replaceChildren();
    };
  }, [file, onCorrupt, onRendererError]);

  return (
    <div className="relative max-h-[72vh] min-h-[40vh] overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-2 sm:p-4">
      {!rendered ? (
        <output className="pointer-events-none absolute inset-x-0 top-4 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="me-2 h-4 w-4 animate-spin" />
          {t("rendering")}
        </output>
      ) : null}
      <div ref={stylesRef} />
      <div
        ref={bodyRef}
        className="relative [&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:p-0 sm:[&_.docx-wrapper]:p-4"
        aria-label={t("docxDocument")}
      />
    </div>
  );
}

export function sanitizeRenderedDocx(container: HTMLElement): void {
  container
    .querySelectorAll("script, iframe, object, embed")
    .forEach((element) => element.remove());
  container.querySelectorAll<HTMLElement>("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on"))
        element.removeAttribute(attribute.name);
    }
    if (
      element instanceof HTMLAnchorElement &&
      !isSafeLink(element.getAttribute("href"))
    ) {
      element.removeAttribute("href");
    }
  });
}

function isSafeLink(href: string | null): boolean {
  if (!href || href.startsWith("#")) return true;
  try {
    const protocol = new URL(href, window.location.origin).protocol;
    return ["http:", "https:", "mailto:", "tel:"].includes(protocol);
  } catch {
    return false;
  }
}
