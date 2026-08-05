import { useTranslations } from "next-intl";
import { Modal } from "@/components/Modal";
import DocumentAttachmentViewer from "@/components/DocumentAttachmentViewer";
import { DocumentEntity } from "../types.ts";

export function ManualPreviewModal({
  document,
  onClose,
  t,
}: {
  document: DocumentEntity | null;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Modal
      isOpen={Boolean(document)}
      onClose={onClose}
      title={document?.file_name || t("openManual")}
      size="xl"
    >
      {document ? (
        <div className="operator-dashboard-theme">
          <DocumentAttachmentViewer document={document} title={document.file_name} />
        </div>
      ) : null}
    </Modal>
  );
}
