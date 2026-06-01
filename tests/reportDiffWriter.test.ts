import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeReportDiff } from "../src/reportDiffWriter.js";
import type { ReportDiffData } from "../src/reportDiff.js";

function makeMinimalDiffData(): ReportDiffData {
  return {
    generatedAt: "2026-05-21T10:00:00.000Z",
    baselineReport: {
      path: "reports/old.json",
      generatedAt: "2026-05-20T10:00:00.000Z",
      profileIds: ["p1", "p2"],
    },
    currentReport: {
      path: "reports/new.json",
      generatedAt: "2026-05-21T10:00:00.000Z",
      profileIds: ["p1", "p2"],
    },
    summary: {
      settings: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 1 },
      browserScan: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 1 },
      probe: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 1 },
    },
    profiles: [
      {
        profileId: "p1",
        presence: "both",
        fields: [
          {
            field: "ua",
            sources: {
              settings: { status: "unchanged", baselineValue: "old-ua", currentValue: "old-ua" },
              browserScan: { status: "changed", baselineValue: "bs-old", currentValue: "bs-new" },
              probe: { status: "unchanged", baselineValue: "probe-old", currentValue: "probe-old" },
            },
            highlight: "strong",
          },
        ],
        summary: {
          settings: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
          browserScan: { unchanged: 0, changed: 1, added: 0, removed: 0, both_missing: 0 },
          probe: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
        },
      },
    ],
    extraDiffs: [
      { path: "profiles.p1.browserScan.componentSnapshot.hardware.webGPU.wgslLanguageFeatures[2]", status: "changed", baselineValue: "feature-a", currentValue: "feature-b" },
    ],
  };
}

describe("writeReportDiff", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(process.env.TEMP || "/tmp", `diff-writer-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    // cleanup handled by test isolation
  });

  it("writes HTML and JSON to diff-reports subdirectory", async () => {
    const data = makeMinimalDiffData();
    const { htmlPath, jsonPath } = await writeReportDiff(data, tmpDir);

    expect(htmlPath).toContain("diff-reports");
    expect(htmlPath).toContain(".html");
    expect(jsonPath).toContain("diff-reports");
    expect(jsonPath).toContain(".json");
  });

  it("HTML title contains expected Chinese text", async () => {
    const data = makeMinimalDiffData();
    const { htmlPath } = await writeReportDiff(data, tmpDir);
    const html = await readFile(htmlPath, "utf8");

    expect(html).toContain("AdsPower 指纹报告差异对比");
    expect(html).toContain("旧报告");
    expect(html).toContain("新报告");
  });

  it("HTML contains all status words", async () => {
    // Build a minimal diff that includes each status at least once
    const data: ReportDiffData = {
      generatedAt: "2026-05-21T10:00:00.000Z",
      baselineReport: { path: "reports/old.json", generatedAt: "2026-05-20T10:00:00.000Z", profileIds: ["p1"] },
      currentReport: { path: "reports/new.json", generatedAt: "2026-05-21T10:00:00.000Z", profileIds: ["p1"] },
      summary: {
        settings: { unchanged: 1, changed: 1, added: 1, removed: 1, both_missing: 1 },
        browserScan: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 0 },
        probe: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 0 },
      },
      profiles: [{
        profileId: "p1",
        presence: "both",
        fields: [{
          field: "ua",
          sources: {
            settings: { status: "both_missing", baselineValue: undefined, currentValue: undefined },
            browserScan: { status: "unchanged", baselineValue: "x", currentValue: "x" },
            probe: { status: "changed", baselineValue: "a", currentValue: "b" },
          },
          highlight: "strong",
        }],
        summary: {
          settings: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 1 },
          browserScan: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 0 },
          probe: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 0 },
        },
      }],
      extraDiffs: [],
    };
    const { htmlPath } = await writeReportDiff(data, tmpDir);
    const html = await readFile(htmlPath, "utf8");

    expect(html).toContain("无变化");
    expect(html).toContain("有变化");
    expect(html).toContain("新增");
    expect(html).toContain("丢失");
    expect(html).toContain("均未获取");
  });

  it("changed values are rendered inline without details", async () => {
    const data = makeMinimalDiffData();
    const { htmlPath } = await writeReportDiff(data, tmpDir);
    const html = await readFile(htmlPath, "utf8");

    // changed source values are directly visible
    expect(html).toContain("bs-old");
    expect(html).toContain("bs-new");
    // no <details> / <summary> elements
    expect(html).not.toContain("<details>");
    expect(html).not.toContain("<summary>");
    // unchanged source values are NOT visible
    expect(html).not.toContain("old-ua");
    expect(html).not.toContain("probe-old");
  });

  it("HTML contains representative main fields", async () => {
    const data = makeMinimalDiffData();
    const { htmlPath } = await writeReportDiff(data, tmpDir);
    const html = await readFile(htmlPath, "utf8");

    expect(html).toContain("User Agent");
    expect(html).toContain("ua");
  });

  it("HTML does not expose deep extra diff paths in main area", async () => {
    const data = makeMinimalDiffData();
    const { htmlPath } = await writeReportDiff(data, tmpDir);
    const html = await readFile(htmlPath, "utf8");

    expect(html).not.toContain("componentSnapshot");
    expect(html).not.toContain("webGPU");
  });

  it("HTML escapes XSS", async () => {
    const data: ReportDiffData = {
      ...makeMinimalDiffData(),
      profiles: [
        {
          profileId: '<script>alert("xss")</script>',
          presence: "both",
          fields: [
            {
              field: "ua",
              sources: {
                settings: { status: "added", baselineValue: undefined, currentValue: '<script>alert("xss")</script>' },
                browserScan: { status: "both_missing", baselineValue: undefined, currentValue: undefined },
                probe: { status: "both_missing", baselineValue: undefined, currentValue: undefined },
              },
              highlight: "strong",
            },
          ],
          summary: {
            settings: { unchanged: 0, changed: 0, added: 1, removed: 0, both_missing: 0 },
            browserScan: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 1 },
            probe: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 1 },
          },
        },
      ],
    };
    const { htmlPath } = await writeReportDiff(data, tmpDir);
    const html = await readFile(htmlPath, "utf8");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("JSON output contains required top-level keys", async () => {
    const data = makeMinimalDiffData();
    const { jsonPath } = await writeReportDiff(data, tmpDir);
    const json = JSON.parse(await readFile(jsonPath, "utf8"));

    expect(json).toHaveProperty("baselineReport");
    expect(json).toHaveProperty("currentReport");
    expect(json).toHaveProperty("profiles");
    expect(json).toHaveProperty("summary");
    expect(json).toHaveProperty("extraDiffs");
  });

  it("JSON extraDiffs excludes unchanged entries", async () => {
    const data = makeMinimalDiffData();
    const { jsonPath } = await writeReportDiff(data, tmpDir);
    const json = JSON.parse(await readFile(jsonPath, "utf8"));

    expect(json.extraDiffs.length).toBeGreaterThan(0);
    for (const d of json.extraDiffs) {
      expect(d.status).not.toBe("unchanged");
    }
  });

  it("JSON main field values are preserved", async () => {
    const data = makeMinimalDiffData();
    const { jsonPath } = await writeReportDiff(data, tmpDir);
    const json = JSON.parse(await readFile(jsonPath, "utf8"));

    const p1 = json.profiles[0];
    expect(p1.fields[0].sources.browserScan.baselineValue).toBe("bs-old");
    expect(p1.fields[0].sources.browserScan.currentValue).toBe("bs-new");
  });

  it("unchanged field is not rendered in HTML row or details", async () => {
    const data: ReportDiffData = {
      generatedAt: "2026-05-21T10:00:00.000Z",
      baselineReport: { path: "reports/old.json", generatedAt: "2026-05-20T10:00:00.000Z", profileIds: ["p1"] },
      currentReport: { path: "reports/new.json", generatedAt: "2026-05-21T10:00:00.000Z", profileIds: ["p1"] },
      summary: {
        settings: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
        browserScan: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
        probe: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
      },
      profiles: [{
        profileId: "p1",
        presence: "both",
        fields: [{
          field: "ua",
          sources: {
            settings: { status: "unchanged", baselineValue: "old-ua", currentValue: "old-ua" },
            browserScan: { status: "unchanged", baselineValue: "bs-same", currentValue: "bs-same" },
            probe: { status: "unchanged", baselineValue: "probe-same", currentValue: "probe-same" },
          },
          highlight: "none",
        }],
        summary: {
          settings: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
          browserScan: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
          probe: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
        },
      }],
      extraDiffs: [],
    };
    const { htmlPath, jsonPath } = await writeReportDiff(data, tmpDir);
    const html = await readFile(htmlPath, "utf8");
    const json = JSON.parse(await readFile(jsonPath, "utf8"));

    // HTML must not contain the unchanged field value strings
    expect(html).not.toContain("old-ua");
    expect(html).not.toContain("bs-same");
    expect(html).not.toContain("probe-same");
    // HTML must not contain the field row label
    expect(html).not.toContain("User Agent");
    expect(html).not.toContain("ua");
    // HTML should show empty-diff message
    expect(html).toContain("主指纹项无变化");
    // JSON must still contain the full field data
    expect(json.profiles[0].fields[0].sources.settings.baselineValue).toBe("old-ua");
    expect(json.profiles[0].fields[0].sources.browserScan.baselineValue).toBe("bs-same");
    expect(json.profiles[0].fields[0].sources.probe.baselineValue).toBe("probe-same");
  });

  it("changed field shows details with changed source values only", async () => {
    const data: ReportDiffData = {
      generatedAt: "2026-05-21T10:00:00.000Z",
      baselineReport: { path: "reports/old.json", generatedAt: "2026-05-20T10:00:00.000Z", profileIds: ["p1"] },
      currentReport: { path: "reports/new.json", generatedAt: "2026-05-21T10:00:00.000Z", profileIds: ["p1"] },
      summary: {
        settings: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
        browserScan: { unchanged: 0, changed: 1, added: 0, removed: 0, both_missing: 0 },
        probe: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
      },
      profiles: [{
        profileId: "p1",
        presence: "both",
        fields: [{
          field: "ua",
          sources: {
            settings: { status: "unchanged", baselineValue: "setting-same", currentValue: "setting-same" },
            browserScan: { status: "changed", baselineValue: "bs-old", currentValue: "bs-new" },
            probe: { status: "unchanged", baselineValue: "probe-same", currentValue: "probe-same" },
          },
          highlight: "strong",
        }],
        summary: {
          settings: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
          browserScan: { unchanged: 0, changed: 1, added: 0, removed: 0, both_missing: 0 },
          probe: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
        },
      }],
      extraDiffs: [],
    };
    const { htmlPath, jsonPath } = await writeReportDiff(data, tmpDir);
    const html = await readFile(htmlPath, "utf8");
    const json = JSON.parse(await readFile(jsonPath, "utf8"));

    // HTML contains field row
    expect(html).toContain("User Agent");
    expect(html).toContain("ua");
    // HTML contains inline changed source values
    expect(html).toContain("bs-old");
    expect(html).toContain("bs-new");
    // no <details> / <summary> elements
    expect(html).not.toContain("<details>");
    expect(html).not.toContain("<summary>");
    // unchanged source values are NOT visible
    expect(html).not.toContain("setting-same");
    expect(html).not.toContain("probe-same");
    // JSON unchanged field values still preserved
    expect(json.profiles[0].fields[0].sources.settings.baselineValue).toBe("setting-same");
    expect(json.profiles[0].fields[0].sources.probe.baselineValue).toBe("probe-same");
  });

  it("added and removed fields are rendered", async () => {
    const data: ReportDiffData = {
      generatedAt: "2026-05-21T10:00:00.000Z",
      baselineReport: { path: "reports/old.json", generatedAt: "2026-05-20T10:00:00.000Z", profileIds: ["p1"] },
      currentReport: { path: "reports/new.json", generatedAt: "2026-05-21T10:00:00.000Z", profileIds: ["p1"] },
      summary: {
        settings: { unchanged: 0, changed: 0, added: 1, removed: 1, both_missing: 0 },
        browserScan: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 0 },
        probe: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 0 },
      },
      profiles: [{
        profileId: "p1",
        presence: "both",
        fields: [
          {
            field: "ua",
            sources: {
              settings: { status: "added", baselineValue: undefined, currentValue: "new-ua-value" },
              browserScan: { status: "unchanged", baselineValue: "x", currentValue: "x" },
              probe: { status: "unchanged", baselineValue: "x", currentValue: "x" },
            },
            highlight: "strong",
          },
          {
            field: "timezone",
            sources: {
              settings: { status: "removed", baselineValue: "old-timezone", currentValue: undefined },
              browserScan: { status: "unchanged", baselineValue: "x", currentValue: "x" },
              probe: { status: "unchanged", baselineValue: "x", currentValue: "x" },
            },
            highlight: "strong",
          },
        ],
        summary: {
          settings: { unchanged: 0, changed: 0, added: 1, removed: 1, both_missing: 0 },
          browserScan: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
          probe: { unchanged: 1, changed: 0, added: 0, removed: 0, both_missing: 0 },
        },
      }],
      extraDiffs: [],
    };
    const { htmlPath, jsonPath } = await writeReportDiff(data, tmpDir);
    const html = await readFile(htmlPath, "utf8");
    const json = JSON.parse(await readFile(jsonPath, "utf8"));

    // added field row visible with new value
    expect(html).toContain("User Agent");
    expect(html).toContain("new-ua-value");
    // removed field row visible with old value
    expect(html).toContain("时区");
    expect(html).toContain("old-timezone");
    // JSON preserves full data
    expect(json.profiles[0].fields[0].sources.settings.baselineValue).toBeUndefined();
    expect(json.profiles[0].fields[0].sources.settings.currentValue).toBe("new-ua-value");
    expect(json.profiles[0].fields[1].sources.settings.baselineValue).toBe("old-timezone");
    expect(json.profiles[0].fields[1].sources.settings.currentValue).toBeUndefined();
  });
});