import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const ADMIN_PAGE = "src/app/[locale]/knowledge-base/page.tsx";
const BROWSER = "src/components/knowledge-base/KnowledgeBaseBrowser.tsx";
const SUGGESTIONS = "src/components/knowledge-base/KnowledgeSuggestions.tsx";

test("apiService exposes the full Knowledge Base CRUD, lifecycle, and suggestion endpoints", () => {
  const source = readSource("src/services/api.ts");

  assert.match(
    source,
    /getKnowledgeArticles:\s*\(params\?:\s*AnyObject\)\s*=>\s*api\.get\('\/knowledge-base\/articles',\s*\{\s*params\s*\}\)/,
    "apiService.getKnowledgeArticles must GET /knowledge-base/articles",
  );
  assert.match(
    source,
    /getKnowledgeArticleSuggestions:\s*\(params\?:\s*AnyObject\)\s*=>\s*api\.get\('\/knowledge-base\/articles\/suggestions'/,
    "apiService.getKnowledgeArticleSuggestions must GET /knowledge-base/articles/suggestions",
  );
  assert.match(
    source,
    /createKnowledgeArticle:\s*\(data:\s*AnyObject\)\s*=>\s*api\.post\('\/knowledge-base\/articles',\s*data\)/,
    "apiService.createKnowledgeArticle must POST /knowledge-base/articles",
  );
  assert.match(
    source,
    /publishKnowledgeArticle:\s*\([^)]*\)\s*=>\s*api\.patch\(`\/knowledge-base\/articles\/\$\{id\}\/publish`/,
    "apiService.publishKnowledgeArticle must PATCH /knowledge-base/articles/:id/publish",
  );
  assert.match(
    source,
    /archiveKnowledgeArticle:\s*\([^)]*\)\s*=>\s*api\.patch\(`\/knowledge-base\/articles\/\$\{id\}\/archive`/,
    "apiService.archiveKnowledgeArticle must PATCH /knowledge-base/articles/:id/archive",
  );
  assert.match(
    source,
    /reviseKnowledgeArticle:\s*\(id:\s*string,\s*data:\s*AnyObject\)\s*=>\s*api\.post\(`\/knowledge-base\/articles\/\$\{id\}\/revise`,\s*data\)/,
    "apiService.reviseKnowledgeArticle must POST /knowledge-base/articles/:id/revise",
  );
  assert.match(
    source,
    /getKnowledgeArticleVersions:\s*\(id:\s*string\)\s*=>\s*api\.get\(`\/knowledge-base\/articles\/\$\{id\}\/versions`\)/,
    "apiService.getKnowledgeArticleVersions must GET /knowledge-base/articles/:id/versions",
  );
  assert.match(
    source,
    /deleteKnowledgeArticle:\s*\(id:\s*string\)\s*=>\s*api\.delete\(`\/knowledge-base\/articles\/\$\{id\}`\)/,
    "apiService.deleteKnowledgeArticle must DELETE /knowledge-base/articles/:id",
  );
});

test("Admin Knowledge Base page only offers the transitions valid for each article's current status", () => {
  const source = readSource(ADMIN_PAGE);

  assert.match(
    source,
    /function getAvailableActions\(\s*status: KnowledgeArticleStatus,\s*\)/,
    "the admin page must compute available actions from the article's current status",
  );

  const bodyMatch = source.match(
    /function getAvailableActions\([\s\S]*?\n\}/,
  );
  assert.ok(bodyMatch, "getAvailableActions body must be defined");
  const body = bodyMatch![0];
  assert.match(body, /status === "draft"/, "Draft articles must be handled explicitly");
  assert.match(body, /status === "published"/, "Published articles must be handled explicitly");
  assert.match(body, /"publish"/, "Draft must be able to publish");
  assert.match(body, /"revise"/, "Published must be revisable rather than directly editable");
  assert.match(body, /"archive"/, "Articles must be able to archive");
});

test("Admin Knowledge Base page only allows deleting an untouched Draft with no version links", () => {
  const source = readSource(ADMIN_PAGE);

  assert.match(
    source,
    /function canDelete\(article: KnowledgeArticle\): boolean \{/,
    "the admin page must define an explicit canDelete predicate",
  );
  assert.match(
    source,
    /status === "draft" &&\s*historyLength <= 1 &&\s*!article\.supersedes_article_id &&\s*!article\.superseded_by_article_id/,
    "canDelete must require Draft status, minimal lifecycle history, and no supersession links",
  );
  assert.match(
    source,
    /\{deletable && \(/,
    "the Delete button must only render when canDelete() is true",
  );
});

test("Admin Knowledge Base page sends the currently-loaded version on publish, archive, update, and revise for optimistic concurrency", () => {
  const source = readSource(ADMIN_PAGE);

  assert.match(
    source,
    /apiService\.publishKnowledgeArticle\(article\._id,\s*\{\s*expected_version:\s*article\.version\s*\}\)/,
    "publishing must send expected_version",
  );
  assert.match(
    source,
    /apiService\.archiveKnowledgeArticle\(article\._id,\s*\{\s*expected_version:\s*article\.version\s*\}\)/,
    "archiving must send expected_version",
  );
  assert.match(
    source,
    /expected_version:\s*selectedArticle\.version,/,
    "update/revise must send expected_version from the currently loaded article",
  );
});

test("Admin Knowledge Base page shows translated confirmations before publish, archive, and delete", () => {
  const source = readSource(ADMIN_PAGE);

  assert.match(
    source,
    /confirm\(t\("notifications\.confirmPublish"\)\)/,
    "must show a translated confirmation before publishing",
  );
  assert.match(
    source,
    /confirm\(t\("notifications\.confirmArchive"\)\)/,
    "must show a translated confirmation before archiving",
  );
  assert.match(
    source,
    /confirm\(t\("notifications\.confirmDelete"\)\)/,
    "must show a translated confirmation before deleting",
  );
});

test("Admin Knowledge Base page offers a version history view backed by getKnowledgeArticleVersions", () => {
  const source = readSource(ADMIN_PAGE);

  assert.match(
    source,
    /apiService\.getKnowledgeArticleVersions\(article\._id\)/,
    "must fetch version history via apiService.getKnowledgeArticleVersions",
  );
  assert.match(
    source,
    /historyVersions\.map/,
    "must render every entry returned by the version history endpoint",
  );
});

test("Admin Knowledge Base page supports linking articles to machine, machine type, and maintenance plan", () => {
  const source = readSource(ADMIN_PAGE);

  assert.match(source, /machine_type_id/, "must support linking to a machine type");
  assert.match(source, /machine_id/, "must support linking to a machine");
  assert.match(source, /maintenance_plan_id/, "must support linking to a maintenance plan");
  assert.match(source, /fault_codes_text/, "must support entering fault codes");
  assert.match(source, /error_codes_text/, "must support entering error codes");
});

test("KnowledgeBaseBrowser is read-only: it never imports a mutating apiService method", () => {
  const source = readSource(BROWSER);

  assert.match(
    source,
    /apiService\.getKnowledgeArticles\(/,
    "the reader browser must fetch articles via apiService.getKnowledgeArticles",
  );
  assert.doesNotMatch(
    source,
    /createKnowledgeArticle|updateKnowledgeArticle|publishKnowledgeArticle|archiveKnowledgeArticle|reviseKnowledgeArticle|deleteKnowledgeArticle/,
    "the reader browser must never call an authoring/lifecycle endpoint",
  );
});

test("Operator and Technician Knowledge Base pages both render the shared read-only browser under their own role guard", () => {
  const operatorPage = readSource("src/app/[locale]/operator/knowledge-base/page.tsx");
  const technicianPage = readSource("src/app/[locale]/technician/knowledge-base/page.tsx");

  assert.match(operatorPage, /requiredRole="operator"/, "the operator page must require the operator role");
  assert.match(operatorPage, /<KnowledgeBaseBrowser/, "the operator page must render the shared browser");
  assert.match(technicianPage, /requiredRole="technician"/, "the technician page must require the technician role");
  assert.match(technicianPage, /<KnowledgeBaseBrowser/, "the technician page must render the shared browser");
});

test("KnowledgeSuggestions fetches suggestions from the dedicated endpoint and stays silent with no matches", () => {
  const source = readSource(SUGGESTIONS);

  assert.match(
    source,
    /apiService\s*\n?\s*\.getKnowledgeArticleSuggestions\(/,
    "must fetch suggestions via apiService.getKnowledgeArticleSuggestions",
  );
  assert.match(
    source,
    /if \(articles\.length === 0\) return null;/,
    "must render nothing when there are no suggestions",
  );
});

test("Corrective (report-problem), preventive, and technician work-order pages surface KnowledgeSuggestions", () => {
  const reportProblem = readSource("src/app/[locale]/operator/report-problem/page.tsx");
  const preventive = readSource("src/app/[locale]/operator/preventive/page.tsx");
  const technicianDetail = readSource("src/components/technician/TechnicianWorkOrderDetail.tsx");

  assert.match(
    reportProblem,
    /<KnowledgeSuggestions\s+machineId=\{selectedMachine \|\| undefined\}\s+faultCode=\{selectedFault\?\.code_panne\}\s*\/>/,
    "the report-problem page must surface suggestions scoped to the selected machine and fault code",
  );
  assert.match(
    preventive,
    /<KnowledgeSuggestions machineId=\{selectedMachine\} \/>/,
    "the preventive page must surface suggestions scoped to the selected machine",
  );
  assert.match(
    technicianDetail,
    /<KnowledgeSuggestions[\s\S]*?machineId=\{machine\?\._id\}[\s\S]*?faultCode=\{wo\.code_panne\}/,
    "the technician work-order detail page must surface suggestions scoped to its machine and fault code",
  );
});

test("all supported locales define the knowledgeBase translation namespace with matching keys", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
    return Object.entries(obj).flatMap(([key, value]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return flatten(value as Record<string, unknown>, nextPrefix);
      }
      return [nextPrefix];
    });
  }

  const keysByLocale: Record<string, Set<string>> = {};
  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    assert.ok(messages.knowledgeBase, `${locale}.json must have a knowledgeBase namespace`);
    assert.ok(
      typeof messages.sidebar?.navigation?.knowledgeBase === "string" &&
        messages.sidebar.navigation.knowledgeBase.length > 0,
      `${locale}.json sidebar.navigation.knowledgeBase must be a non-empty string`,
    );
    keysByLocale[locale] = new Set(flatten(messages.knowledgeBase));
  }

  const englishKeys = keysByLocale.en;
  for (const locale of locales) {
    const missing = [...englishKeys].filter((key) => !keysByLocale[locale].has(key));
    assert.deepEqual(missing, [], `${locale}.json is missing knowledgeBase keys: ${missing.join(", ")}`);
  }
});
