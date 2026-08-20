import { readFileSync, writeFileSync } from "node:fs";

const [reportPath, sourceRoot] = process.argv.slice(2);

if (!reportPath || !sourceRoot) {
  throw new Error(
    "Usage: node scripts/prefix-lcov-source-paths.mjs <lcov.info> <source-root>",
  );
}

const normalizedSourceRoot = sourceRoot.replaceAll("\\", "/").replace(/\/+$/, "");
const report = readFileSync(reportPath, "utf8");

const normalizedReport = report.replace(/^SF:(.+)$/gm, (_line, rawPath) => {
  const normalizedPath = String(rawPath).replaceAll("\\", "/");

  if (
    normalizedPath.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedPath) ||
    normalizedPath.startsWith(`${normalizedSourceRoot}/`)
  ) {
    return `SF:${normalizedPath}`;
  }

  return `SF:${normalizedSourceRoot}/${normalizedPath.replace(/^\.?\//, "")}`;
});

writeFileSync(reportPath, normalizedReport);
