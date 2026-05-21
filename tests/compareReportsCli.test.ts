import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveReportJsonPath, validateReportStructure, parseArgs, runCompareReportsCli } from "../src/compareReportsCli.js";
import type { ReportData } from "../src/types.js";

describe("resolveReportJsonPath", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(process.env.TEMP || "/tmp", `cli-test-${Date.now()}-${Math.random()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  it("returns .json path as-is when file exists", async () => {
    const jsonPath = join(tmpDir, "old.json");
    await writeFile(jsonPath, "{}");
    const result = await resolveReportJsonPath(jsonPath);
    expect(result).toBe(jsonPath);
  });

  it("maps .html to sibling .json when both exist", async () => {
    const htmlPath = join(tmpDir, "old.html");
    const jsonPath = join(tmpDir, "old.json");
    await writeFile(htmlPath, "<html></html>");
    await writeFile(jsonPath, "{}");
    const result = await resolveReportJsonPath(htmlPath);
    expect(result).toBe(jsonPath);
  });

  it("throws if .html but sibling .json does not exist", async () => {
    const htmlPath = join(tmpDir, "old.html");
    await writeFile(htmlPath, "<html></html>");
    await expect(resolveReportJsonPath(htmlPath)).rejects.toThrow(
      "无法找到 HTML 对应的 JSON 报告"
    );
  });

  it("throws if path does not exist", async () => {
    await expect(resolveReportJsonPath(join(tmpDir, "nonexistent.json"))).rejects.toThrow(
      "报告路径不存在"
    );
  });
});

describe("validateReportStructure", () => {
  it("accepts valid ReportData", () => {
    const data: ReportData = {
      generatedAt: "2026-05-21T10:00:00.000Z",
      profileIds: ["p1"],
      results: [
        {
          profileId: "p1",
          status: "ok",
          notes: [],
          settings: { profileId: "p1", settings: {}, randomFingerprintEnabled: false, fetchStatus: "ok" },
        },
      ],
    };
    expect(() => validateReportStructure(data)).not.toThrow();
  });

  it("throws if results is missing", () => {
    const data = { generatedAt: "2026-05-21T10:00:00.000Z", profileIds: [] } as unknown as ReportData;
    expect(() => validateReportStructure(data)).toThrow("报告 JSON 格式不正确：缺少 results[]");
  });
});

describe("parseArgs", () => {
  it("returns the two positional arguments", () => {
    const result = parseArgs(["old.json", "new.json"]);
    expect(result).toEqual(["old.json", "new.json"]);
  });

  it("throws if not exactly two args", () => {
    expect(() => parseArgs([])).toThrow(/用法：/);
    expect(() => parseArgs(["onlyone.json"])).toThrow(/用法：/);
    expect(() => parseArgs(["a.json", "b.json", "c.json"])).toThrow(/用法：/);
  });
});

describe("CLI smoke", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(process.env.TEMP || "/tmp", `cli-smoke-${Date.now()}-${Math.random()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("runs compare-reports and generates diff reports", async () => {
    const oldReport: ReportData = {
      generatedAt: new Date().toISOString(),
      profileIds: ["p1"],
      results: [
        {
          profileId: "p1",
          status: "ok",
          notes: [],
          settings: {
            profileId: "p1",
            settings: { ua: "Old UA" },
            randomFingerprintEnabled: false,
            fetchStatus: "ok",
          },
          browserScan: {
            profileId: "p1",
            values: { ua: { value: "Old BS UA", source: "runtime" } },
            rawText: "",
            status: "ok",
          },
        },
      ],
    };
    const newReport: ReportData = {
      generatedAt: new Date().toISOString(),
      profileIds: ["p1"],
      results: [
        {
          profileId: "p1",
          status: "ok",
          notes: [],
          settings: {
            profileId: "p1",
            settings: { ua: "New UA" },
            randomFingerprintEnabled: false,
            fetchStatus: "ok",
          },
          browserScan: {
            profileId: "p1",
            values: { ua: { value: "New BS UA", source: "runtime" } },
            rawText: "",
            status: "ok",
          },
        },
      ],
    };

    const oldPath = join(tmpDir, "old.json");
    const newPath = join(tmpDir, "new.json");
    await writeFile(oldPath, JSON.stringify(oldReport));
    await writeFile(newPath, JSON.stringify(newReport));

    const result = await runCompareReportsCli(oldPath, newPath, tmpDir);

    expect(result.htmlPath).toContain("diff-reports");
    expect(result.htmlPath).toContain(".html");
    expect(result.jsonPath).toContain("diff-reports");
    expect(result.jsonPath).toContain(".json");

    const diffDir = join(tmpDir, "diff-reports");
    const files = await readdir(diffDir);
    expect(files.some((f) => f.endsWith(".html"))).toBe(true);
    expect(files.some((f) => f.endsWith(".json"))).toBe(true);
  });
});