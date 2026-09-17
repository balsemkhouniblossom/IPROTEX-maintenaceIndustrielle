import test from "node:test";
import assert from "node:assert/strict";

// Test safeDownloadName logic from authenticatedDownload.ts
const safeDownloadName = (fileName: string): string => {
  return fileName.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "download";
};

test("safeDownloadName preserves valid filenames", () => {
  assert.equal(safeDownloadName("report.pdf"), "report.pdf");
  assert.equal(safeDownloadName("my report.pdf"), "my report.pdf");
});

test("safeDownloadName replaces backslashes and slashes", () => {
  assert.equal(safeDownloadName("my\\file.txt"), "my_file.txt");
  assert.equal(safeDownloadName("a/b/c.doc"), "a_b_c.doc");
});

test("safeDownloadName trims whitespace", () => {
  assert.equal(safeDownloadName("  spaced  "), "spaced");
  assert.equal(safeDownloadName("  a  "), "a");
});

test("safeDownloadName returns default for empty or invalid", () => {
  assert.equal(safeDownloadName(""), "download");
  assert.equal(safeDownloadName("   "), "download");
  assert.equal(safeDownloadName("\x00\x01"), "__");
});
