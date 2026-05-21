import { describe, it, expect } from "vitest";
import {
  compareValues,
  buildReportDiff,
  type DiffStatus,
  type DeepDiffEntry,
} from "../src/reportDiff.js";
import type { ReportData } from "../src/types.js";

function makeMinimalReport(profileIds: string[], results: ReportData["results"][number][]): ReportData {
  return {
    generatedAt: new Date().toISOString(),
    profileIds,
    results,
  };
}

function makeMinimalResult(profileId: string): ReportData["results"][number] {
  return {
    profileId,
    status: "ok",
    notes: [],
    settings: {
      profileId,
      settings: {},
      randomFingerprintEnabled: false,
      fetchStatus: "ok",
    },
    browserScan: {
      profileId,
      values: {},
      rawText: "",
      status: "ok",
    },
  };
}

describe("compareValues", () => {
  it("string: trim and compare", () => {
    expect(compareValues("  hello  ", "hello")).toBe<DiffStatus>("unchanged");
    expect(compareValues("hello", "hello ")).toBe<DiffStatus>("unchanged");
    expect(compareValues("hello", "world")).toBe<DiffStatus>("changed");
  });

  it("object: key order does not matter", () => {
    expect(compareValues({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe<DiffStatus>("unchanged");
    expect(compareValues({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe<DiffStatus>("changed");
  });

  it("array: order matters", () => {
    expect(compareValues([1, 2, 3], [1, 2, 3])).toBe<DiffStatus>("unchanged");
    expect(compareValues([1, 2, 3], [3, 2, 1])).toBe<DiffStatus>("changed");
    expect(compareValues([1, 2], [1, 2, 3])).toBe<DiffStatus>("changed");
  });

  it("undefined / null / missing all treated as missing", () => {
    expect(compareValues(undefined, undefined)).toBe<DiffStatus>("both_missing");
    expect(compareValues(null, null)).toBe<DiffStatus>("both_missing");
    expect(compareValues(undefined, null)).toBe<DiffStatus>("both_missing");
  });

  it("old missing / new value = added", () => {
    expect(compareValues(undefined, "new")).toBe<DiffStatus>("added");
    expect(compareValues(null, "new")).toBe<DiffStatus>("added");
  });

  it("old value / new missing = removed", () => {
    expect(compareValues("old", undefined)).toBe<DiffStatus>("removed");
    expect(compareValues("old", null)).toBe<DiffStatus>("removed");
  });

  it("one side missing, other has value = added/removed", () => {
    expect(compareValues(undefined, "value")).toBe<DiffStatus>("added");
    expect(compareValues(null, "value")).toBe<DiffStatus>("added");
  });

  it("both missing = both_missing", () => {
    expect(compareValues(undefined, undefined)).toBe<DiffStatus>("both_missing");
  });

  it("primitives: same = unchanged", () => {
    expect(compareValues(42, 42)).toBe<DiffStatus>("unchanged");
    expect(compareValues(true, true)).toBe<DiffStatus>("unchanged");
    expect(compareValues(false, false)).toBe<DiffStatus>("unchanged");
  });

  it("primitives: different = changed", () => {
    expect(compareValues(42, 43)).toBe<DiffStatus>("changed");
    expect(compareValues(true, false)).toBe<DiffStatus>("changed");
  });

  it("nested objects deep compare", () => {
    expect(
      compareValues({ deep: { a: [1, 2] } }, { deep: { a: [1, 2] } })
    ).toBe<DiffStatus>("unchanged");
    expect(
      compareValues({ deep: { a: [1, 2] } }, { deep: { a: [1, 3] } })
    ).toBe<DiffStatus>("changed");
  });
});

describe("buildReportDiff extraDiffs", () => {
  it("componentSnapshot deep value changed", () => {
    const baseline = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        browserScan: {
          profileId: "p1",
          values: {},
          rawText: "",
          status: "ok",
          componentSnapshot: {
            hardware: { webGPU: { vendor: "A" } },
          },
        },
      },
    ]);
    const current = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        browserScan: {
          profileId: "p1",
          values: {},
          rawText: "",
          status: "ok",
          componentSnapshot: {
            hardware: { webGPU: { vendor: "B" } },
          },
        },
      },
    ]);

    const diff = buildReportDiff(baseline, current, "b.json", "c.json");

    const gpuDiff = diff.extraDiffs.find((d) => d.path.includes("hardware.webGPU.vendor"));
    expect(gpuDiff).toBeDefined();
    expect(gpuDiff!.status).toBe("changed");
    expect(gpuDiff!.baselineValue).toBe("A");
    expect(gpuDiff!.currentValue).toBe("B");
  });

  it("probe.raw array element changed", () => {
    const baseline = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        browserScan: {
          profileId: "p1",
          values: {},
          rawText: "",
          status: "ok",
          probe: {
            raw: { webgl_config: { extensions: ["a", "b"] } },
            values: {},
          },
        },
      },
    ]);
    const current = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        browserScan: {
          profileId: "p1",
          values: {},
          rawText: "",
          status: "ok",
          probe: {
            raw: { webgl_config: { extensions: ["a", "c"] } },
            values: {},
          },
        },
      },
    ]);

    const diff = buildReportDiff(baseline, current, "b.json", "c.json");

    const extDiff = diff.extraDiffs.find((d) => d.path.includes("extensions[1]"));
    expect(extDiff).toBeDefined();
    expect(extDiff!.status).toBe("changed");
    expect(extDiff!.baselineValue).toBe("b");
    expect(extDiff!.currentValue).toBe("c");
  });

  it("extra field added in current", () => {
    const baseline = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        settings: {
          profileId: "p1",
          settings: { extraOld: "oldval" },
          randomFingerprintEnabled: false,
          fetchStatus: "ok",
        },
      },
    ]);
    const current = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        settings: {
          profileId: "p1",
          settings: { extraOld: "oldval", extraNew: "newval" },
          randomFingerprintEnabled: false,
          fetchStatus: "ok",
        },
        browserScan: {
          profileId: "p1",
          values: { extraBS: { value: "bsval", source: "dom" } },
          rawText: "",
          status: "ok",
        },
      },
    ]);

    const diff = buildReportDiff(baseline, current, "b.json", "c.json");

    const added = diff.extraDiffs.find(
      (d) => d.path.includes("extraNew") && d.status === "added"
    );
    expect(added).toBeDefined();
    expect(added!.currentValue).toBe("newval");

    const bsAdded = diff.extraDiffs.find(
      (d) => d.path.includes("extraBS") && d.status === "added"
    );
    expect(bsAdded).toBeDefined();
  });

  it("extra field removed from baseline", () => {
    const baseline = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        settings: {
          profileId: "p1",
          settings: { extraOld: "oldval" },
          randomFingerprintEnabled: false,
          fetchStatus: "ok",
        },
      },
    ]);
    const current = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        settings: {
          profileId: "p1",
          settings: {},
          randomFingerprintEnabled: false,
          fetchStatus: "ok",
        },
      },
    ]);

    const diff = buildReportDiff(baseline, current, "b.json", "c.json");

    const removed = diff.extraDiffs.find(
      (d) => d.path.includes("extraOld") && d.status === "removed"
    );
    expect(removed).toBeDefined();
    expect(removed!.baselineValue).toBe("oldval");
  });

  it("unchanged deep values do not enter extraDiffs", () => {
    const r = makeMinimalResult("p1");
    const baseline = makeMinimalReport(["p1"], [
      {
        ...r,
        browserScan: {
          profileId: "p1",
          values: {},
          rawText: "",
          status: "ok",
          componentSnapshot: { hardware: { webGPU: { vendor: "X" } } },
        },
      },
    ]);
    const current = makeMinimalReport(["p1"], [
      {
        ...r,
        browserScan: {
          profileId: "p1",
          values: {},
          rawText: "",
          status: "ok",
          componentSnapshot: { hardware: { webGPU: { vendor: "X" } } },
        },
      },
    ]);

    const diff = buildReportDiff(baseline, current, "b.json", "c.json");
    expect(diff.extraDiffs.every((d) => d.status !== "unchanged")).toBe(true);
  });

  it("rawText and browser_scan_raw_text excluded from extraDiffs", () => {
    const baseline = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        browserScan: {
          profileId: "p1",
          values: {},
          rawText: "SENSITIVE_OLD",
          status: "ok",
          componentSnapshot: { browser_scan_raw_text: "OLD_RAW" },
        },
      },
    ]);
    const current = makeMinimalReport(["p1"], [
      {
        ...makeMinimalResult("p1"),
        browserScan: {
          profileId: "p1",
          values: {},
          rawText: "SENSITIVE_NEW",
          status: "ok",
          componentSnapshot: { browser_scan_raw_text: "NEW_RAW" },
        },
      },
    ]);

    const diff = buildReportDiff(baseline, current, "b.json", "c.json");
    const rawTextPaths = diff.extraDiffs.filter(
      (d: DeepDiffEntry) => d.path.toLowerCase().includes("rawtext")
    );
    expect(rawTextPaths.length).toBe(0);
  });
});