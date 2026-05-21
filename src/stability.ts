import { REPORT_FINGERPRINT_KEYS } from "./fingerprintFields.js";
import type {
  BrowserScanResult,
  BrowserScanValue,
  StabilityFieldSample,
  StabilityFieldStatus,
  StabilityFieldSummary
} from "./types.js";

const EXCLUDED_KEYS = new Set(["browser_scan_raw_text"]);

function stableValueKey(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(stableValueKey);
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = stableValueKey((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

export function buildStabilityFields(
  runs: BrowserScanResult[]
): Record<string, StabilityFieldSummary> {
  const runCount = runs.length;
  const allKeys = new Set<string>();

  for (const run of runs) {
    for (const key of Object.keys(run.values)) {
      if (!EXCLUDED_KEYS.has(key)) {
        allKeys.add(key);
      }
    }
  }

  const fields: Record<string, StabilityFieldSummary> = {};

  for (const key of REPORT_FINGERPRINT_KEYS) {
    if (EXCLUDED_KEYS.has(key)) {
      continue;
    }
    allKeys.add(key);
  }

  for (const key of allKeys) {
    const samples: StabilityFieldSample[] = runs.map((run, index) => {
      const value = run.values[key];
      return {
        runIndex: index + 1,
        value: value?.value,
        source: value?.source as BrowserScanValue["source"]
      };
    });

    const nonEmptyValues = samples
      .filter((s) => s.value !== undefined && s.value !== null)
      .map((s) => s.value);

    let status: StabilityFieldStatus;
    if (nonEmptyValues.length === 0) {
      status = "not_collected";
    } else {
      const uniqueNormalized = new Set(
        nonEmptyValues.map((v) => JSON.stringify(stableValueKey(v)))
      );
      status = uniqueNormalized.size === 1 ? "unchanged" : "changed";
    }

    const uniqueValues = Array.from(
      new Map(
        nonEmptyValues.map((v) => [JSON.stringify(stableValueKey(v)), v])
      ).values()
    );

    fields[key] = { status, samples, uniqueValues };
  }

  return fields;
}