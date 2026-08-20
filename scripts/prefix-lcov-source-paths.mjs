import { readFileSync, writeFileSync } from "node:fs";

const [reportPath, sourceRoot] = process.argv.slice(2);

if (!reportPath || !sourceRoot) {
  throw new Error(
    "Usage: node scripts/prefix-lcov-source-paths.mjs <lcov.info> <source-root>",
  );
}

function trimTrailingSlashes(value) {
  let endIndex = value.length;
  while (endIndex > 0 && value[endIndex - 1] === "/") {
    endIndex -= 1;
  }
  return value.slice(0, endIndex);
}

function stripRelativePrefix(value) {
  if (value.startsWith("./")) return value.slice(2);
  if (value.startsWith("/")) return value.slice(1);
  return value;
}

function hasWindowsDrivePrefix(value) {
  const driveLetter = value.codePointAt(0);
  if (driveLetter === undefined) return false;

  const isUppercaseDrive = driveLetter >= 65 && driveLetter <= 90;
  const isLowercaseDrive = driveLetter >= 97 && driveLetter <= 122;

  return (
    value.length > 2 &&
    (isUppercaseDrive || isLowercaseDrive) &&
    value[1] === ":" &&
    value[2] === "/"
  );
}

const normalizedSourceRoot = trimTrailingSlashes(
  sourceRoot.replaceAll("\\", "/"),
);
const report = readFileSync(reportPath, "utf8");

function normalizeSourceFileLine(line) {
  if (!line.startsWith("SF:")) return line;

  const normalizedPath = line.slice(3).replaceAll("\\", "/");

  if (
    normalizedPath.startsWith("/") ||
    hasWindowsDrivePrefix(normalizedPath) ||
    normalizedPath.startsWith(`${normalizedSourceRoot}/`)
  ) {
    return `SF:${normalizedPath}`;
  }

  return `SF:${normalizedSourceRoot}/${stripRelativePrefix(normalizedPath)}`;
}

const normalizedReport = report
  .split("\n")
  .map((line) => normalizeSourceFileLine(line))
  .join("\n");

writeFileSync(reportPath, normalizedReport);
