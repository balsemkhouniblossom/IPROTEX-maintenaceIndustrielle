function quiet<T extends object>(config: T): T & { suppressErrorLog: true } {
  return { ...config, suppressErrorLog: true };
}

export function safeDownloadName(fileName: string): string {
  return fileName.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "download";
}

export interface DownloadDeps {
  get: (
    url: string,
    config: { responseType: "blob"; timeout: number },
  ) => Promise<{ data: Blob; headers: Record<string, string> }>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  document: {
    createElement: (
      tagName: string,
    ) => {
      click(): void;
      remove(): void;
      style: { display: string };
      href: string;
      download: string;
      setAttribute(name: string, value: string): void;
    };
    body: {
      appendChild(node: { remove(): void }): void;
      removeChild(node: { remove(): void }): void;
    };
  };
}

let _productionDeps: DownloadDeps | undefined;
async function getProductionDeps(): Promise<DownloadDeps> {
  if (_productionDeps) return _productionDeps;
  const api = (await import("./api")).default;
  _productionDeps = {
    get: api.get as unknown as DownloadDeps["get"],
    createObjectURL: (blob: Blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url: string) => URL.revokeObjectURL(url),
    document: window.document as unknown as DownloadDeps["document"],
  };
  return _productionDeps!;
}

export async function downloadAuthenticatedDocument(
  documentId: string,
  originalFileName: string,
  deps?: DownloadDeps,
): Promise<void> {
  const d = deps ?? await getProductionDeps();
  const response = await d.get(`/documents/${encodeURIComponent(documentId)}/file`,
    quiet({ responseType: "blob", timeout: 60000 }),
  );
  const responseBlob = response.data as Blob;
  const contentType =
    String(response.headers["content-type"] || responseBlob.type).trim() ||
    "application/octet-stream";
  const blob =
    responseBlob.type === contentType
      ? responseBlob
      : new Blob([responseBlob], { type: contentType });
  const objectUrl = d.createObjectURL(blob);
  const anchor = d.document.createElement("a");

  try {
    anchor.href = objectUrl;
    anchor.download = safeDownloadName(originalFileName);
    anchor.style.display = "none";
    d.document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    d.revokeObjectURL(objectUrl);
  }
}
