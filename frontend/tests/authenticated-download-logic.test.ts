import test from "node:test";
import assert from "node:assert/strict";
import { downloadAuthenticatedDocument } from "../src/services/authenticatedDownload.ts";
import api from "../src/services/api.ts";

test("downloadAuthenticatedDocument downloads file", async () => {
  const anchor = {
    href: "",
    download: "",
    style: {},
    clicked: false,
    click() { anchor.clicked = true; },
    remove() {},
    setAttribute() {},
  };
  const mockDocument = {
    createElement: () => anchor,
    body: { appendChild: () => {}, removeChild: () => {} },
  };

  const originalURL = globalThis.URL;
  const originalWindow = globalThis.window;

  const originalApiGet = api.get;

  try {
    (globalThis as Record<string, unknown>).URL = {
      createObjectURL: () => "blob:mock-url",
      revokeObjectURL: () => {},
    };
    (globalThis as Record<string, unknown>).window = { document: mockDocument };

    api.get = (async () => ({
      data: new Blob(["test content"], { type: "application/pdf" }),
      headers: { "content-type": "application/pdf" },
    })) as unknown as typeof api.get;

    await assert.doesNotReject(
      downloadAuthenticatedDocument("doc123", "report.pdf"),
    );
    assert.equal(anchor.download, "report.pdf");
    assert.ok(anchor.clicked);
  } finally {
    (globalThis as Record<string, unknown>).URL = originalURL;
    (globalThis as Record<string, unknown>).window = originalWindow;
    api.get = originalApiGet;
  }
});
