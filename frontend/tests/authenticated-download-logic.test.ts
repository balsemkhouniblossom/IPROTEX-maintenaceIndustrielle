import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadAuthenticatedDocument,
  safeDownloadName,
  type DownloadDeps,
} from "../src/services/authenticatedDownload.ts";

function makeDeps(overrides?: Partial<DownloadDeps>): DownloadDeps {
  const anchor = {
    click: () => {},
    remove: () => {},
    style: { display: "" },
    href: "",
    download: "",
    setAttribute: () => {},
  };
  const document = {
    createElement: () => anchor,
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
  };
  return {
    get: async () => ({
      data: new Blob(["test content"], { type: "application/pdf" }),
      headers: { "content-type": "application/pdf" },
    }),
    createObjectURL: () => "blob:mock-url",
    revokeObjectURL: () => {},
    document,
    ...overrides,
  };
}

test("safeDownloadName sanitizes invalid characters", () => {
  assert.equal(safeDownloadName("report.pdf"), "report.pdf");
  assert.equal(safeDownloadName("my\\file.txt"), "my_file.txt");
  assert.equal(safeDownloadName("a/b/c.doc"), "a_b_c.doc");
  assert.equal(safeDownloadName(""), "download");
  assert.equal(safeDownloadName("   "), "download");
  assert.equal(safeDownloadName("\x00\x01"), "__");
});

test("safeDownloadName trims and defaults empty to download", () => {
  assert.equal(safeDownloadName("  spaced  "), "spaced");
  assert.equal(safeDownloadName("  a  "), "a");
});

test("downloadAuthenticatedDocument downloads file", async () => {
  let revokedUrl = "";
  let clicked = false;
  let appended = false;
  let removed = false;

  const deps: DownloadDeps = {
    ...makeDeps(),
    createObjectURL: (blob: Blob) => {
      assert.ok(blob instanceof Blob);
      return "blob:mock-url";
    },
    revokeObjectURL: (url: string) => { revokedUrl = url; },
    document: {
      createElement: () => ({
        click: () => { clicked = true; },
        remove: () => { removed = true; },
        style: { display: "" },
        href: "",
        download: "",
        setAttribute: () => {},
      }),
      body: {
        appendChild: () => { appended = true; },
        removeChild: () => {},
      },
    },
  };

  await downloadAuthenticatedDocument("doc123", "report.pdf", deps);
  assert.equal(clicked, true);
  assert.equal(appended, true);
  assert.equal(revokedUrl, "blob:mock-url");
  assert.equal(removed, true);
});

test("downloadAuthenticatedDocument uses safeDownloadName for filename", async () => {
  let capturedAnchor: { download: string } | undefined;
  const deps: DownloadDeps = {
    ...makeDeps(),
    document: {
      createElement: (() => {
        const anchor = {
          click: () => {},
          remove: () => {},
          style: { display: "" },
          href: "",
          download: "",
          setAttribute: () => {},
        };
        capturedAnchor = anchor;
        return anchor;
      }),
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
    },
  };

  await downloadAuthenticatedDocument("doc123", "my\\report.pdf", deps);
  assert.equal(capturedAnchor?.download, "my_report.pdf");
});

test("downloadAuthenticatedDocument handles non-blob content type", async () => {
  let receivedBlobType = "";
  const deps: DownloadDeps = {
    ...makeDeps(),
    get: async () => ({
      data: new Blob(["raw"], { type: "" }),
      headers: { "content-type": "text/plain" },
    }),
    createObjectURL: (blob: Blob) => { receivedBlobType = blob.type; return "blob:mock"; },
    revokeObjectURL: () => {},
    document: {
      createElement: () => ({
        click: () => {},
        remove: () => {},
        style: { display: "" },
        href: "",
        download: "",
        setAttribute: () => {},
      }),
      body: { appendChild: () => {}, removeChild: () => {} },
    },
  };

  await downloadAuthenticatedDocument("doc123", "file.txt", deps);
  assert.equal(receivedBlobType, "text/plain");
});

test("downloadAuthenticatedDocument throws on API failure", async () => {
  const deps: DownloadDeps = {
    ...makeDeps(),
    get: async () => { throw new Error("Network error"); },
  };

  await assert.rejects(
    downloadAuthenticatedDocument("doc123", "report.pdf", deps),
    /Network error/,
  );
});

test("downloadAuthenticatedDocument always revokes object URL and removes anchor", async () => {
  let revoked = false;
  let removed = false;
  const deps: DownloadDeps = {
    ...makeDeps(),
    get: async () => ({
      data: new Blob(["test"], { type: "application/pdf" }),
      headers: { "content-type": "application/pdf" },
    }),
    revokeObjectURL: () => { revoked = true; },
    document: {
      createElement: () => ({
        click: () => {},
        remove: () => { removed = true; },
        style: { display: "" },
        href: "",
        download: "",
        setAttribute: () => {},
      }),
      body: { appendChild: () => {}, removeChild: () => {} },
    },
  };

  try {
    await downloadAuthenticatedDocument("doc123", "report.pdf", deps);
  } catch {
    // ignore
  }
  assert.equal(revoked, true);
  assert.equal(removed, true);
});
