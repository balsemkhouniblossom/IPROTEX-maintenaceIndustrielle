import api, { quiet } from "./api";

function safeDownloadName(fileName: string): string {
  return fileName.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "download";
}

/** Download a bearer-protected document without exposing its URL to an anchor. */
export async function downloadAuthenticatedDocument(
  documentId: string,
  originalFileName: string,
): Promise<void> {
  const response = await api.get(`/documents/${encodeURIComponent(documentId)}/file`,
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
  const objectUrl = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");

  try {
    anchor.href = objectUrl;
    anchor.download = safeDownloadName(originalFileName);
    anchor.style.display = "none";
    window.document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
