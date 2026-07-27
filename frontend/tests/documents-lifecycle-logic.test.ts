import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PAGE_PATH = "src/app/[locale]/documents/page.tsx";

function readPage(): string {
  return fs.readFileSync(path.join(process.cwd(), PAGE_PATH), "utf8");
}

test("apiService exposes version history, publish/archive transitions, and a replace endpoint for documents", () => {
  const relativePath = "src/services/api.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /getDocumentVersions:\s*\(id:\s*string\)\s*=>\s*api\.get\(`\/documents\/\$\{id\}\/versions`\)/,
    "apiService.getDocumentVersions must GET /documents/:id/versions",
  );
  assert.match(
    source,
    /publishDocument:\s*\([^)]*\)\s*=>\s*api\.patch\(`\/documents\/\$\{id\}\/publish`/,
    "apiService.publishDocument must PATCH /documents/:id/publish",
  );
  assert.match(
    source,
    /archiveDocument:\s*\([^)]*\)\s*=>\s*api\.patch\(`\/documents\/\$\{id\}\/archive`/,
    "apiService.archiveDocument must PATCH /documents/:id/archive",
  );
  assert.match(
    source,
    /replaceDocument:\s*\(id:\s*string,\s*formData:\s*FormData\)\s*=>\s*api\.post\(`\/documents\/\$\{id\}\/replace`/,
    "apiService.replaceDocument must POST /documents/:id/replace",
  );
});

test("Documents page only offers the transitions valid for each document's current status", () => {
  const source = readPage();

  assert.match(
    source,
    /function getAvailableActions\(status: DocumentStatus\)/,
    `${PAGE_PATH} must compute available actions from the document's current status`,
  );

  const tableMatch = source.match(
    /function getAvailableActions\(status: DocumentStatus\)[\s\S]*?\n\}/,
  );
  assert.ok(tableMatch, "getAvailableActions body must be defined");
  const body = tableMatch![1] ?? tableMatch![0];
  assert.match(body, /status === "draft"/, "Draft documents must be handled explicitly");
  assert.match(body, /status === "published"/, "Published documents must be handled explicitly");
  assert.match(body, /"publish"/, "Draft must be able to publish");
  assert.match(body, /"archive"/, "Documents must be able to archive");
  assert.match(body, /"replace"/, "Documents must be able to be replaced");
});

test("Documents page only allows deleting an untouched Draft with no version history", () => {
  const source = readPage();

  assert.match(
    source,
    /function canDelete\(doc: DocumentType\): boolean \{/,
    `${PAGE_PATH} must define an explicit canDelete predicate`,
  );
  assert.match(
    source,
    /status === "draft" &&\s*historyLength <= 1 &&\s*!doc\.supersedes_document_id &&\s*!doc\.superseded_by_document_id/,
    `${PAGE_PATH} must require Draft status, minimal lifecycle history, and no supersession links before allowing deletion`,
  );
  assert.match(
    source,
    /\{deletable && \(/,
    `${PAGE_PATH} must only render the Delete button when canDelete() is true`,
  );
});

test("Documents page renders a status badge per document", () => {
  const source = readPage();

  assert.match(
    source,
    /STATUS_BADGE_CLASSES: Record<DocumentStatus, string>/,
    `${PAGE_PATH} must define a badge class per document status`,
  );
  assert.match(
    source,
    /STATUS_BADGE_CLASSES\[status\]/,
    `${PAGE_PATH} must render the badge using the document's current status`,
  );
});

test("Documents page sends the currently-loaded version on publish, archive, and replace for optimistic concurrency", () => {
  const source = readPage();

  assert.match(
    source,
    /apiService\.publishDocument\(doc\._id,\s*\{\s*expected_version:\s*doc\.version\s*\}\)/,
    `${PAGE_PATH} must send expected_version when publishing`,
  );
  assert.match(
    source,
    /apiService\.archiveDocument\(doc\._id,\s*\{\s*expected_version:\s*doc\.version\s*\}\)/,
    `${PAGE_PATH} must send expected_version when archiving`,
  );
  assert.match(
    source,
    /formData\.append\("expected_version",\s*String\(replaceTarget\.version\)\)/,
    `${PAGE_PATH} must send expected_version when replacing`,
  );
});

test("Documents page shows translated confirmations before publish, archive, replace, and delete", () => {
  const source = readPage();

  assert.match(
    source,
    /confirm\(t\("notifications\.confirmPublish"\)\)/,
    `${PAGE_PATH} must show a translated confirmation before publishing`,
  );
  assert.match(
    source,
    /confirm\(t\("notifications\.confirmArchive"\)\)/,
    `${PAGE_PATH} must show a translated confirmation before archiving`,
  );
  assert.match(
    source,
    /confirm\(\s*t\("notifications\.confirmReplace",\s*\{\s*fileName:\s*replaceTarget\.file_name\s*\}\),?\s*\)/,
    `${PAGE_PATH} must show a translated confirmation naming the file before replacing`,
  );
  assert.match(
    source,
    /confirm\(t\("notifications\.confirmDelete"\)\)/,
    `${PAGE_PATH} must show a translated confirmation before deleting`,
  );
});

test("Documents page offers a version history view backed by getDocumentVersions", () => {
  const source = readPage();

  assert.match(
    source,
    /apiService\.getDocumentVersions\(doc\._id\)/,
    `${PAGE_PATH} must fetch version history via apiService.getDocumentVersions`,
  );
  assert.match(
    source,
    /historyVersions\.map/,
    `${PAGE_PATH} must render every entry returned by the version history endpoint`,
  );
});

test("Documents page restricts the file picker to PDF and Office document extensions", () => {
  const source = readPage();

  assert.match(
    source,
    /ACCEPTED_DOCUMENT_EXTENSIONS\s*=\s*\n?\s*"\.pdf,\.doc,\.docx,\.xls,\.xlsx,\.ppt,\.pptx"/,
    `${PAGE_PATH} must restrict uploads/replacements to PDF and Office document extensions`,
  );
});

test("all supported locales contain the new document lifecycle translation keys", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];
  const requiredStatusKeys = ["draft", "published", "archived", "superseded"];
  const requiredActionKeys = ["publish", "archive", "replace", "history"];
  const requiredNotificationKeys = [
    "confirmPublish",
    "publishSuccess",
    "publishFailed",
    "confirmArchive",
    "archiveSuccess",
    "archiveFailed",
    "confirmReplace",
    "replaceSuccess",
    "replaceFailed",
    "historyLoadFailed",
  ];

  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    const documents = messages.documents;
    assert.ok(documents, `${locale}.json must have a documents namespace`);

    for (const key of requiredStatusKeys) {
      assert.ok(
        typeof documents.status?.[key] === "string" && documents.status[key].length > 0,
        `${locale}.json documents.status.${key} must be a non-empty string`,
      );
    }
    for (const key of requiredActionKeys) {
      assert.ok(
        typeof documents.actions?.[key] === "string" && documents.actions[key].length > 0,
        `${locale}.json documents.actions.${key} must be a non-empty string`,
      );
    }
    for (const key of requiredNotificationKeys) {
      assert.ok(
        typeof documents.notifications?.[key] === "string" &&
          documents.notifications[key].length > 0,
        `${locale}.json documents.notifications.${key} must be a non-empty string`,
      );
    }
    assert.match(
      documents.notifications.confirmReplace,
      /\{fileName\}/,
      `${locale}.json documents.notifications.confirmReplace must interpolate {fileName}`,
    );
  }
});
