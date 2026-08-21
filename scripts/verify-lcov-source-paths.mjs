#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const reportPaths = process.argv.slice(2);

if (reportPaths.length === 0) {
  throw new Error(
    "Usage: node scripts/verify-lcov-source-paths.mjs <lcov.info> [...]",
  );
}

function toFilesystemPath(sourceFile) {
  if (sourceFile.startsWith("file://")) {
    return fileURLToPath(sourceFile);
  }

  return sourceFile;
}

let hasFailure = false;

for (const reportPath of reportPaths) {
  if (!existsSync(reportPath)) {
    console.error(`Coverage report is missing: ${reportPath}`);
    hasFailure = true;
    continue;
  }

  const report = readFileSync(reportPath, "utf8");
  const sourceFiles = report
    .split(/\r?\n/)
    .filter((line) => line.startsWith("SF:"))
    .map((line) => toFilesystemPath(line.slice(3)));
  const lineRecords = report
    .split(/\r?\n/)
    .filter((line) => line.startsWith("DA:") || line.startsWith("LF:"));
  const missingSourceFiles = sourceFiles.filter(
    (sourceFile) => !existsSync(sourceFile),
  );

  if (sourceFiles.length === 0) {
    console.error(`Coverage report has no SF records: ${reportPath}`);
    hasFailure = true;
  }

  if (lineRecords.length === 0) {
    console.error(`Coverage report has no line coverage records: ${reportPath}`);
    hasFailure = true;
  }

  if (missingSourceFiles.length > 0) {
    console.error(
      `Coverage report references files SonarCloud cannot resolve: ${reportPath}`,
    );
    for (const sourceFile of missingSourceFiles.slice(0, 10)) {
      console.error(`  ${sourceFile}`);
    }
    hasFailure = true;
  }

  if (sourceFiles.length > 0 && missingSourceFiles.length === 0) {
    console.log(
      `Coverage report OK: ${reportPath} (${sourceFiles.length} source file entries)`,
    );
    for (const sourceFile of sourceFiles.slice(0, 3)) {
      console.log(`  SF:${sourceFile}`);
    }
  }
}

if (hasFailure) {
  process.exit(1);
}
