import { REPORT_FINGERPRINT_KEYS } from "./fingerprintFields.js";
import type { ReportData, ProfileRunResult } from "./types.js";

export type DiffStatus =
  | "unchanged"
  | "changed"
  | "added"
  | "removed"
  | "both_missing";

export type DiffSource = "settings" | "browserScan" | "probe";

export interface ValuePairDiff {
  status: DiffStatus;
  baselineValue?: unknown;
  currentValue?: unknown;
}

export interface FieldDiff {
  field: string;
  sources: Record<DiffSource, ValuePairDiff>;
  highlight: "strong" | "soft" | "none";
}

export interface SourceSummary {
  unchanged: number;
  changed: number;
  added: number;
  removed: number;
  both_missing: number;
}

export interface ProfileDiff {
  profileId: string;
  presence: "both" | "baseline_only" | "current_only";
  fields: FieldDiff[];
  summary: Record<DiffSource, SourceSummary>;
}

export interface DeepDiffEntry {
  path: string;
  status: DiffStatus;
  baselineValue?: unknown;
  currentValue?: unknown;
}

export interface ReportDiffData {
  generatedAt: string;
  baselineReport: {
    path: string;
    generatedAt?: string;
    profileIds: string[];
  };
  currentReport: {
    path: string;
    generatedAt?: string;
    profileIds: string[];
  };
  summary: Record<DiffSource, SourceSummary>;
  profiles: ProfileDiff[];
  extraDiffs: DeepDiffEntry[];
}

export function isMissing(val: unknown): boolean {
  return val === undefined || val === null;
}

function normalizeForCompare(val: unknown): unknown {
  if (isMissing(val)) return undefined;
  if (typeof val === "string") return val.trim();
  if (typeof val === "object" && !Array.isArray(val)) {
    return Object.keys(val as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = normalizeForCompare((val as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return val;
}

export function compareValues(
  baseline: unknown,
  current: unknown
): DiffStatus {
  const bMissing = isMissing(baseline);
  const cMissing = isMissing(current);

  if (bMissing && cMissing) return "both_missing";
  if (bMissing) return "added";
  if (cMissing) return "removed";

  if (typeof baseline === "string" && typeof current === "string") {
    return baseline.trim() === current.trim() ? "unchanged" : "changed";
  }

  if (typeof baseline !== typeof current) return "changed";

  if (Array.isArray(baseline) && Array.isArray(current)) {
    if (baseline.length !== current.length) return "changed";
    for (let i = 0; i < baseline.length; i++) {
      if (compareValues(baseline[i], current[i]) !== "unchanged") {
        return "changed";
      }
    }
    return "unchanged";
  }

  if (
    typeof baseline === "object" &&
    baseline !== null &&
    current !== null &&
    !Array.isArray(baseline) &&
    !Array.isArray(current)
  ) {
    const bObj = baseline as Record<string, unknown>;
    const cObj = current as Record<string, unknown>;
    const bKeys = Object.keys(bObj);
    const cKeys = Object.keys(cObj);
    if (bKeys.length !== cKeys.length) return "changed";
    for (const key of bKeys) {
      if (compareValues(bObj[key], cObj[key]) !== "unchanged") {
        return "changed";
      }
    }
    return "unchanged";
  }

  return baseline === current ? "unchanged" : "changed";
}

function buildSourceSummary(): Record<DiffSource, SourceSummary> {
  return {
    settings: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 0 },
    browserScan: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 0 },
    probe: { unchanged: 0, changed: 0, added: 0, removed: 0, both_missing: 0 },
  };
}

function getFieldFromSettings(result: ProfileRunResult, field: string): unknown {
  return result.settings?.settings?.[field];
}

function getFieldFromBrowserScan(result: ProfileRunResult, field: string): unknown {
  return result.browserScan?.values?.[field]?.value;
}

function getFieldFromProbe(result: ProfileRunResult, field: string): unknown {
  return result.browserScan?.probe?.values?.[field]?.value;
}

export function computeProfileDiff(
  baselineResult: ProfileRunResult | undefined,
  currentResult: ProfileRunResult | undefined,
  profileId: string
): ProfileDiff {
  if (!baselineResult && !currentResult) {
    throw new Error("At least one result must be present");
  }

  const presence: ProfileDiff["presence"] =
    !baselineResult ? "current_only" : !currentResult ? "baseline_only" : "both";

  const fields: FieldDiff[] = [];

  for (const field of REPORT_FINGERPRINT_KEYS) {
    const settingsBaseline = baselineResult ? getFieldFromSettings(baselineResult, field) : undefined;
    const settingsCurrent = currentResult ? getFieldFromSettings(currentResult, field) : undefined;
    const bsBaseline = baselineResult ? getFieldFromBrowserScan(baselineResult, field) : undefined;
    const bsCurrent = currentResult ? getFieldFromBrowserScan(currentResult, field) : undefined;
    const probeBaseline = baselineResult ? getFieldFromProbe(baselineResult, field) : undefined;
    const probeCurrent = currentResult ? getFieldFromProbe(currentResult, field) : undefined;

    const sources: Record<DiffSource, ValuePairDiff> = {
      settings: {
        status: compareValues(settingsBaseline, settingsCurrent),
        baselineValue: settingsBaseline,
        currentValue: settingsCurrent,
      },
      browserScan: {
        status: compareValues(bsBaseline, bsCurrent),
        baselineValue: bsBaseline,
        currentValue: bsCurrent,
      },
      probe: {
        status: compareValues(probeBaseline, probeCurrent),
        baselineValue: probeBaseline,
        currentValue: probeCurrent,
      },
    };

    const settingsChanged =
      sources.settings.status === "changed" ||
      sources.settings.status === "added" ||
      sources.settings.status === "removed";
    const bsChanged =
      sources.browserScan.status === "changed" ||
      sources.browserScan.status === "added" ||
      sources.browserScan.status === "removed";
    const probeChanged =
      sources.probe.status === "changed" ||
      sources.probe.status === "added" ||
      sources.probe.status === "removed";

    let highlight: FieldDiff["highlight"] = "none";
    if (settingsChanged || bsChanged) {
      highlight = "strong";
    } else if (probeChanged) {
      highlight = "soft";
    }

    fields.push({ field, sources, highlight });
  }

  const summary = buildSourceSummary();

  if (presence === "both") {
    for (const field of fields) {
      for (const source of ["settings", "browserScan", "probe"] as DiffSource[]) {
        summary[source][field.sources[source].status]++;
      }
    }
  }

  return { profileId, presence, fields, summary };
}

export function buildReportDiff(
  baselineReport: ReportData,
  currentReport: ReportData,
  baselinePath: string,
  currentPath: string
): ReportDiffData {
  const generatedAt = new Date().toISOString();

  const baselineIds = baselineReport.profileIds ?? baselineReport.results.map((r) => r.profileId);
  const currentIds = currentReport.profileIds ?? currentReport.results.map((r) => r.profileId);

  const baselineMap = new Map(baselineReport.results.map((r) => [r.profileId, r]));
  const currentMap = new Map(currentReport.results.map((r) => [r.profileId, r]));

  const orderedIds: string[] = [];
  for (const id of baselineIds) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }
  for (const id of currentIds) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }

  const profiles: ProfileDiff[] = [];
  for (const profileId of orderedIds) {
    const baselineResult = baselineMap.get(profileId);
    const currentResult = currentMap.get(profileId);
    profiles.push(computeProfileDiff(baselineResult, currentResult, profileId));
  }

  const globalSummary = buildSourceSummary();
  for (const p of profiles) {
    if (p.presence !== "both") continue;
    for (const source of ["settings", "browserScan", "probe"] as DiffSource[]) {
      for (const [status, count] of Object.entries(p.summary[source])) {
        if (count > 0) {
          globalSummary[source][status as DiffStatus] += count;
        }
      }
    }
  }

  const extraDiffs = buildExtraDiffs(baselineReport, currentReport, baselineMap, currentMap);

  return {
    generatedAt,
    baselineReport: {
      path: baselinePath,
      generatedAt: baselineReport.generatedAt,
      profileIds: baselineIds,
    },
    currentReport: {
      path: currentPath,
      generatedAt: currentReport.generatedAt,
      profileIds: currentIds,
    },
    summary: globalSummary,
    profiles,
    extraDiffs,
  };
}

const RAW_TEXT_KEYS = new Set(["rawText", "browser_scan_raw_text"]);

function shouldExcludeKey(key: string): boolean {
  if (RAW_TEXT_KEYS.has(key)) return true;
  if (key.toLowerCase().includes("rawtext")) return true;
  return false;
}

function diffExtraField(
  baselineVal: unknown,
  currentVal: unknown,
  makePath: () => string,
  out: DeepDiffEntry[]
): void {
  const status = compareValues(baselineVal, currentVal);
  if (status !== "unchanged") {
    out.push({ path: makePath(), status, baselineValue: baselineVal, currentValue: currentVal });
  }
}

function collectExtraFieldsDiff(
  baselineResult: ProfileRunResult | undefined,
  currentResult: ProfileRunResult | undefined,
  profileId: string,
  out: DeepDiffEntry[]
): void {
  const presence: ProfileDiff["presence"] =
    !baselineResult ? "current_only" : !currentResult ? "baseline_only" : "both";
  if (presence !== "both") return;

  const base = `profiles.${profileId}`;

  // settings extra fields
  const bsExSettings = baselineResult!.settings?.settings ?? {};
  const csExSettings = currentResult!.settings?.settings ?? {};
  const allSettingKeys = new Set([...Object.keys(bsExSettings), ...Object.keys(csExSettings)]);
  for (const key of allSettingKeys) {
    if (REPORT_FINGERPRINT_KEYS.includes(key as typeof REPORT_FINGERPRINT_KEYS[number])) continue;
    if (shouldExcludeKey(key)) continue;
    const p = () => `${base}.extraFields.settings.settings.${key}`;
    diffExtraField(bsExSettings[key], csExSettings[key], p, out);
  }

  // browserScan.values extra fields
  const bsExBS = baselineResult!.browserScan?.values ?? {};
  const csExBS = currentResult!.browserScan?.values ?? {};
  const allBSKeys = new Set([...Object.keys(bsExBS), ...Object.keys(csExBS)]);
  for (const key of allBSKeys) {
    if (REPORT_FINGERPRINT_KEYS.includes(key as typeof REPORT_FINGERPRINT_KEYS[number])) continue;
    if (shouldExcludeKey(key)) continue;
    const p = () => `${base}.extraFields.browserScan.values.${key}`;
    diffExtraField(bsExBS[key]?.value, csExBS[key]?.value, p, out);
  }

  // probe.values extra fields
  const bsExProbe = baselineResult!.browserScan?.probe?.values ?? {};
  const csExProbe = currentResult!.browserScan?.probe?.values ?? {};
  const allProbeKeys = new Set([...Object.keys(bsExProbe), ...Object.keys(csExProbe)]);
  for (const key of allProbeKeys) {
    if (REPORT_FINGERPRINT_KEYS.includes(key as typeof REPORT_FINGERPRINT_KEYS[number])) continue;
    if (shouldExcludeKey(key)) continue;
    const p = () => `${base}.extraFields.probe.values.${key}`;
    diffExtraField(bsExProbe[key]?.value, csExProbe[key]?.value, p, out);
  }
}

function diffDeepObj(
  baseline: unknown,
  current: unknown,
  basePath: string,
  out: DeepDiffEntry[]
): void {
  const bMissing = isMissing(baseline);
  const cMissing = isMissing(current);

  if (bMissing && cMissing) return;
  if (bMissing) {
    out.push({ path: basePath, status: "added", currentValue: current });
    return;
  }
  if (cMissing) {
    out.push({ path: basePath, status: "removed", baselineValue: baseline });
    return;
  }

  if (typeof baseline !== typeof current) {
    out.push({ path: basePath, status: "changed", baselineValue: baseline, currentValue: current });
    return;
  }

  if (Array.isArray(baseline) && Array.isArray(current)) {
    const len = Math.max(baseline.length, current.length);
    for (let i = 0; i < len; i++) {
      diffDeepObj(baseline[i], current[i], `${basePath}[${i}]`, out);
    }
    return;
  }

  if (typeof baseline === "object" && baseline !== null && current !== null) {
    const bObj = baseline as Record<string, unknown>;
    const cObj = current as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(bObj), ...Object.keys(cObj)]);
    for (const key of allKeys) {
      if (shouldExcludeKey(key)) continue;
      diffDeepObj(bObj[key], cObj[key], `${basePath}.${key}`, out);
    }
    return;
  }

  if (baseline === current) return;
  out.push({ path: basePath, status: "changed", baselineValue: baseline, currentValue: current });
}

function collectSnapshotDiffs(
  baselineResult: ProfileRunResult,
  currentResult: ProfileRunResult,
  profileId: string,
  out: DeepDiffEntry[]
): void {
  const base = `profiles.${profileId}`;
  const bs = baselineResult.browserScan?.componentSnapshot;
  const cs = currentResult.browserScan?.componentSnapshot;
  if (!bs && !cs) return;
  diffDeepObj(bs, cs, `${base}.browserScan.componentSnapshot`, out);
}

function collectProbeRawDiffs(
  baselineResult: ProfileRunResult,
  currentResult: ProfileRunResult,
  profileId: string,
  out: DeepDiffEntry[]
): void {
  const base = `profiles.${profileId}`;
  const bs = baselineResult.browserScan?.probe?.raw;
  const cs = currentResult.browserScan?.probe?.raw;
  if (!bs && !cs) return;
  diffDeepObj(bs, cs, `${base}.browserScan.probe.raw`, out);
}

function collectStabilityDiffs(
  baselineResult: ProfileRunResult,
  currentResult: ProfileRunResult,
  profileId: string,
  out: DeepDiffEntry[]
): void {
  const base = `profiles.${profileId}`;
  const bs = baselineResult.stability?.fields;
  const cs = currentResult.stability?.fields;
  if (!bs && !cs) return;
  diffDeepObj(bs as unknown, cs as unknown, `${base}.stability.fields`, out);
}

function buildExtraDiffs(
  baselineReport: ReportData,
  currentReport: ReportData,
  baselineMap: Map<string, ProfileRunResult>,
  currentMap: Map<string, ProfileRunResult>
): DeepDiffEntry[] {
  const diffs: DeepDiffEntry[] = [];
  const allIds = new Set([
    ...baselineReport.results.map((r) => r.profileId),
    ...currentReport.results.map((r) => r.profileId),
  ]);

  for (const profileId of allIds) {
    const baselineResult = baselineMap.get(profileId);
    const currentResult = currentMap.get(profileId);
    const presence: ProfileDiff["presence"] =
      !baselineResult ? "current_only" : !currentResult ? "baseline_only" : "both";

    if (presence !== "both") continue;

    // presence === "both" guarantees both are defined
    collectExtraFieldsDiff(baselineResult!, currentResult!, profileId, diffs);
    collectSnapshotDiffs(baselineResult!, currentResult!, profileId, diffs);
    collectProbeRawDiffs(baselineResult!, currentResult!, profileId, diffs);
    collectStabilityDiffs(baselineResult!, currentResult!, profileId, diffs);
  }

  return diffs;
}