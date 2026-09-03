import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildVisibleWorkOrderTranslationReferences,
  dynamicTranslationKey,
  mergeTranslationResults,
  requestDynamicTranslations,
  translatedTextFor,
  type DynamicTranslationResult,
} from "../src/services/dynamicTranslations.ts";
import { translateEnumValue } from "../src/services/enumTranslations.ts";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("visible work-order translation references are deduplicated and send no source text", () => {
  assert.deepEqual(
    buildVisibleWorkOrderTranslationReferences([
      {
        _id: "wo-1",
        description: "Inspect pump",
        reschedule_reason: "  ",
        lifecycle_history: [{ reason: "" }, { reason: "Delayed" }],
      },
      {
        _id: "wo-1",
        description: "Duplicate should be ignored",
      },
      {
        _id: "wo-2",
        description: " ",
        reschedule_reason: "Waiting",
        lifecycle_history: [],
      },
      {
        _id: "wo-3",
      },
      {
        description: "Missing id",
      },
    ]),
    [
      {
        entityType: "workOrder",
        entityId: "wo-1",
        fields: ["description", "lifecycle_history.reason"],
      },
      {
        entityType: "workOrder",
        entityId: "wo-2",
        fields: ["reschedule_reason"],
      },
    ],
  );
});

test("translation map supports show-original and translated display modes", () => {
  const result: DynamicTranslationResult = {
    entityType: "workOrder",
    entityId: "wo-1",
    field: "description",
    originalText: "Inspect pump",
    translatedText: "Inspecter la pompe",
    targetLocale: "fr",
    status: "translated",
    automaticallyTranslated: true,
    safetyNotice: true,
  };
  const map = mergeTranslationResults({}, [result]);

  assert.equal(
    map[dynamicTranslationKey("workOrder", "wo-1", "description")],
    result,
  );
  assert.equal(
    translatedTextFor({
      translations: map,
      entityType: "workOrder",
      entityId: "wo-1",
      field: "description",
      originalText: "Inspect pump",
      showOriginal: false,
    }),
    "Inspecter la pompe",
  );
  assert.equal(
    translatedTextFor({
      translations: map,
      entityType: "workOrder",
      entityId: "wo-1",
      field: "description",
      originalText: "Inspect pump",
      showOriginal: true,
    }),
    "Inspect pump",
  );
  assert.equal(
    translatedTextFor({
      translations: {},
      entityType: "workOrder",
      entityId: "wo-2",
      field: "description",
      showOriginal: false,
    }),
    "",
  );
  assert.equal(
    translatedTextFor({
      translations: mergeTranslationResults({}, [
        { ...result, translatedText: "" },
      ]),
      entityType: "workOrder",
      entityId: "wo-1",
      field: "description",
      originalText: "Inspect pump",
      showOriginal: false,
    }),
    "Inspect pump",
  );
});

test("requestDynamicTranslations forwards payload and abort signal through the API client", async () => {
  const controller = new AbortController();
  const expected = { items: [] };
  const apiClient = {
    batchDynamicTranslations: async (
      input: unknown,
      options: { signal?: AbortSignal },
    ) => {
      assert.deepEqual(input, {
        targetLocale: "fr",
        sourceLocale: "en",
        items: [
          {
            entityType: "workOrder",
            entityId: "wo-1",
            fields: ["description"],
          },
        ],
      });
      assert.equal(options.signal, controller.signal);
      return { data: expected };
    },
  };

  const response = await requestDynamicTranslations(
    {
      targetLocale: "fr",
      sourceLocale: "en",
      items: [
        {
          entityType: "workOrder",
          entityId: "wo-1",
          fields: ["description"],
        },
      ],
    },
    controller.signal,
    apiClient,
  );

  assert.equal(response, expected);
});

test("hook cancels stale locale/page requests and resets display mode on locale change", () => {
  const source = readSource("src/hooks/useDynamicContentTranslations.ts");

  assert.match(source, /requestedKeys\.current\.clear\(\)/);
  assert.match(source, /setTranslations\(\{\}\)/);
  assert.match(source, /setShowOriginal\(false\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /requestSignature/);
});

test("work-order interfaces expose show-original controls and safety labels", () => {
  const files = [
    "src/app/[locale]/work-orders/page.tsx",
    "src/components/technician/TechnicianWorkspace.tsx",
    "src/components/technician/TechnicianWorkOrderDetail.tsx",
  ];

  for (const file of files) {
    const source = readSource(file);
    assert.match(source, /dynamicTranslations\.hasTranslationLocale/);
    assert.match(source, /dynamicTranslations\.showOriginal/);
    assert.match(source, /dynamicTranslations\.setShowOriginal/);
    assert.match(source, /dynamicTranslations\.isAutomaticallyTranslated/);
  }
});

test("unknown enum values fall back to the original value safely", () => {
  const tEnums = Object.assign((key: string) => `translated:${key}`, {
    has: () => false,
  });

  assert.equal(
    translateEnumValue(tEnums, "workOrderStatuses", "future_status"),
    "future_status",
  );
});

test("notification templates are rendered through next-intl params while free-form messages remain separate", () => {
  const source = readSource("src/components/NotificationBell.tsx");

  assert.match(source, /translationKey\?: string/);
  assert.match(
    source,
    /translationParams\?: Record<string, string \| number \| boolean \| null>/,
  );
  assert.match(
    source,
    /notificationTranslationParams\(item\.translationParams\)/,
  );
  assert.match(source, /typeof value === "boolean" \? String\(value\) : value/);
  assert.match(source, /return item\.title/);
  assert.match(source, /item\.message \?/);
});
