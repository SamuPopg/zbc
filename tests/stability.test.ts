import { describe, expect, it } from "vitest";
import { buildStabilityFields } from "../src/stability.js";
import type { BrowserScanResult, BrowserScanValue } from "../src/types.js";

function makeBrowserScan(
  valuesOverrides: Partial<Record<string, BrowserScanValue>>,
  rawTextValue?: string
): BrowserScanResult {
  return {
    profileId: "PROFILE_ID_1",
    status: "ok",
    rawText: rawTextValue ?? "",
    values: {
      ua: { value: undefined, source: "not_collected" },
      webgl: { value: undefined, source: "not_collected" },
      canvas: { value: undefined, source: "not_collected" },
      gpu: { value: undefined, source: "not_collected" },
      ...valuesOverrides
    }
  };
}

describe("buildStabilityFields", () => {
  it("excludes browser_scan_raw_text from fields", () => {
    const run1 = makeBrowserScan(
      { browser_scan_raw_text: { value: "raw text 1", source: "runtime" } },
      "raw text 1"
    );
    const run2 = makeBrowserScan(
      { browser_scan_raw_text: { value: "raw text 2", source: "runtime" } },
      "raw text 2"
    );

    const fields = buildStabilityFields([run1, run2]);
    expect(fields).not.toHaveProperty("browser_scan_raw_text");
  });

  it("marks field as unchanged when all non-empty values are identical", () => {
    const run1 = makeBrowserScan({
      ua: { value: "ua-a", source: "runtime" }
    });
    const run2 = makeBrowserScan({
      ua: { value: "ua-a", source: "runtime" }
    });

    const fields = buildStabilityFields([run1, run2]);

    expect(fields.ua.status).toBe("unchanged");
    expect(fields.ua.uniqueValues).toEqual(["ua-a"]);
    expect(fields.ua.samples).toHaveLength(2);
  });

  it("marks field as changed when non-empty values differ", () => {
    const run1 = makeBrowserScan({
      webgl: { value: "hash-1", source: "runtime" }
    });
    const run2 = makeBrowserScan({
      webgl: { value: "hash-2", source: "runtime" }
    });

    const fields = buildStabilityFields([run1, run2]);

    expect(fields.webgl.status).toBe("changed");
    expect(fields.webgl.uniqueValues).toEqual(["hash-1", "hash-2"]);
  });

  it("marks field as changed when array order differs (object with sorted keys)", () => {
    const run1 = makeBrowserScan({
      gpu: { value: { features: ["b", "a"] }, source: "runtime" }
    });
    const run2 = makeBrowserScan({
      gpu: { value: { features: ["a", "b"] }, source: "runtime" }
    });

    const fields = buildStabilityFields([run1, run2]);

    expect(fields.gpu.status).toBe("changed");
  });

  it("marks field as not_collected when all runs have no value", () => {
    const run1 = makeBrowserScan({});
    const run2 = makeBrowserScan({});

    const fields = buildStabilityFields([run1, run2]);

    expect(fields.canvas.status).toBe("not_collected");
    expect(fields.canvas.uniqueValues).toEqual([]);
  });

  it("populates runIndex in samples", () => {
    const run1 = makeBrowserScan({ ua: { value: "ua-a", source: "runtime" } });
    const run2 = makeBrowserScan({ ua: { value: "ua-b", source: "runtime" } });

    const fields = buildStabilityFields([run1, run2]);

    expect(fields.ua.samples[0].runIndex).toBe(1);
    expect(fields.ua.samples[1].runIndex).toBe(2);
    expect(fields.ua.samples[0].value).toBe("ua-a");
    expect(fields.ua.samples[1].value).toBe("ua-b");
  });

  it("handles mixed collected and not-collected values", () => {
    const run1 = makeBrowserScan({});
    const run2 = makeBrowserScan({
      canvas: { value: "canvas-hash", source: "runtime" }
    });

    const fields = buildStabilityFields([run1, run2]);

    expect(fields.canvas.status).toBe("unchanged");
    expect(fields.canvas.samples).toHaveLength(2);
    expect(fields.canvas.samples[0].value).toBeUndefined();
    expect(fields.canvas.samples[1].value).toBe("canvas-hash");
    expect(fields.canvas.uniqueValues).toEqual(["canvas-hash"]);
  });
});