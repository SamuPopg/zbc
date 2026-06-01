import { fetchProfileSettings } from "./adspowerBackend.js";
import {
  connectAutomation,
  detectBrowserType,
  type BrowserType
} from "./browserSession.js";
import { collectBrowserScan } from "./browserScanCollector.js";
import { startProfile, stopProfile } from "./localApi.js";
import { buildProbeChecks } from "./probeValidation.js";
import { writeReports } from "./reportWriter.js";
import { buildStabilityFields } from "./stability.js";
import type {
  BrowserScanResult,
  ProfileRunResult,
  ProfileSettings,
  ReportData,
  ToolConfig
} from "./types.js";
import type { BrowserAutomation } from "./browserAutomation.js";

export interface FingerprintCompareRunResult {
  report: ReportData;
  htmlPath: string;
  jsonPath: string;
}

export type ProgressEvent =
  | {
      type: "settings_loaded";
      current: number;
      total: number;
      profileId: string;
    }
  | {
      type: "profile_starting";
      current: number;
      total: number;
      profileId: string;
    }
  | {
      type: "browser_connecting";
      current: number;
      total: number;
      profileId: string;
      browserType: BrowserType;
    }
  | {
      type: "browser_scanning";
      current: number;
      total: number;
      profileId: string;
    }
  | {
      type: "profile_done";
      current: number;
      total: number;
      profileId: string;
      status: ProfileRunResult["status"];
      bsFieldCount: number;
      probeFieldCount: number;
    };

export type ProgressCallback = (event: ProgressEvent) => void;

export interface RunFingerprintCompareOptions {
  onProgress?: ProgressCallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedSettings(profileId: string, error: unknown): ProfileSettings {
  return {
    profileId,
    settings: {},
    randomFingerprintEnabled: false,
    fetchStatus: "failed",
    error: errorMessage(error)
  };
}

function failedBrowserScanResult(
  profileId: string,
  error: unknown
): BrowserScanResult {
  return {
    profileId,
    values: {},
    rawText: "",
    status: "failed",
    error: errorMessage(error)
  };
}

export function buildReportData(results: ProfileRunResult[]): ReportData {
  return {
    generatedAt: new Date().toISOString(),
    profileIds: results.map((result) => result.profileId),
    results
  };
}

async function loadSettings(config: ToolConfig): Promise<ProfileSettings[]> {
  try {
    return await fetchProfileSettings(config);
  } catch (error) {
    return config.profileIds.map((profileId) => failedSettings(profileId, error));
  }
}

function statusFor(
  settings: ProfileSettings,
  browserScan: BrowserScanResult | undefined
): ProfileRunResult["status"] {
  if (settings.fetchStatus === "ok" && browserScan?.status === "ok") {
    return "ok";
  }

  return "partial";
}

/**
 * BrowserScan 页面已成功打开、`_getComponent()` 组件快照却没有初始化，
 * 报告里只剩 `browser_scan_raw_text` 时，看起来像"无原因未采集"。
 * 严格判断：仅在第一轮 BrowserScan、状态 ok、无 snapshot、values 只有一个 raw text 时触发。
 */
function isBrowserScanSnapshotMissing(
  browserScan: BrowserScanResult | undefined
): boolean {
  if (!browserScan || browserScan.status !== "ok") {
    return false;
  }
  if (browserScan.componentSnapshot) {
    return false;
  }
  if (!browserScan.values || typeof browserScan.values !== "object") {
    return false;
  }
  const keys = Object.keys(browserScan.values);
  if (keys.length !== 1) {
    return false;
  }
  return keys[0] === "browser_scan_raw_text";
}

function isWindowsNTUA(ua: string): boolean {
  return /Windows NT/.test(ua);
}

function isMacOSUA(ua: string): boolean {
  return /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua);
}

/**
 * Detect expected OS family from profile settings (top-level fields).
 * Returns null if detection is ambiguous or not a mobile OS.
 */
function detectMobileOSFromSettings(settings: ProfileSettings): "ios" | "android" | null {
  const s = settings.settings;
  const platform = s?.platform as string | undefined;
  if (typeof platform !== "string") return null;

  if (platform === "iPhone" || platform === "iPad") return "ios";
  if (platform === "Linux armv81" || platform === "Android") return "android";
  return null;
}

function validateFingerprintMismatch(
  settings: ProfileSettings,
  browserScan: BrowserScanResult | undefined,
  notes: string[]
): void {
  if (!browserScan) return;

  const browserType = detectBrowserType(settings);
  if (browserType !== "firefox") return;

  const probeUA = browserScan.values?.ua?.value;
  if (!probeUA || typeof probeUA !== "string") {
    return;
  }

  const probeUAStr = String(probeUA);
  const settingsMobileOS = detectMobileOSFromSettings(settings);

  if (settingsMobileOS === "ios" && (isWindowsNTUA(probeUAStr) || isMacOSUA(probeUAStr))) {
    notes.push(
      `身份校验异常：Profile 设置 platform=iPhone 但采集到桌面 Firefox UA（${probeUAStr.substring(0, 60)}...），可能是采集到了错误的浏览器环境`
    );
    return;
  }

  if (settingsMobileOS === "android" && (isWindowsNTUA(probeUAStr) || isMacOSUA(probeUAStr))) {
    notes.push(
      `身份校验异常：Profile 设置 platform=Android 但采集到桌面 Firefox UA（${probeUAStr.substring(0, 60)}...），可能是采集到了错误的浏览器环境`
    );
    return;
  }
}

async function closeBrowserIfNeeded(
  config: ToolConfig,
  automation: BrowserAutomation | undefined,
  notes: string[]
): Promise<void> {
  if (!config.closeAfterRun || !automation) {
    return;
  }

  try {
    await automation.close();
  } catch (error) {
    notes.push(`关闭浏览器连接错误：${errorMessage(error)}`);
  }
}

async function stopProfileIfNeeded(
  config: ToolConfig,
  profileId: string,
  notes: string[]
): Promise<void> {
  if (!config.closeAfterRun) {
    return;
  }

  try {
    await stopProfile(config, profileId);
  } catch (error) {
    if (/Profile is not open/i.test(errorMessage(error))) {
      return;
    }
    notes.push(`关闭环境错误：${errorMessage(error)}`);
  }
}

async function collectBrowserScanWithChecks(
  config: ToolConfig,
  settings: ProfileSettings,
  automation: BrowserAutomation
): Promise<BrowserScanResult> {
  const scan = await collectBrowserScan(config, settings.profileId, automation);
  if (scan.probe) {
    scan.probe.checks = buildProbeChecks(settings.settings, scan.probe.values);
  }
  return scan;
}

async function collectSessionStabilityScans(
  config: ToolConfig,
  settings: ProfileSettings,
  current: number,
  total: number,
  onProgress: ProgressCallback | undefined,
  notes: string[]
): Promise<BrowserScanResult[]> {
  let automation: BrowserAutomation | undefined;
  try {
    let started;
    try {
      onProgress?.({
        type: "profile_starting",
        current,
        total,
        profileId: settings.profileId
      });
      started = await startProfile(config, settings.profileId);
    } catch (startError) {
      notes.push(`启动环境失败：${errorMessage(startError)}`);
      return [];
    }
    try {
      onProgress?.({
        type: "browser_connecting",
        current,
        total,
        profileId: settings.profileId,
        browserType: detectBrowserType(settings)
      });
      automation = await connectAutomation(started, settings);
    } catch (connectError) {
      notes.push(`连接浏览器失败：${errorMessage(connectError)}`);
      return [];
    }

    const scans: BrowserScanResult[] = [];
    for (let i = 0; i < config.stabilityRuns; i += 1) {
      onProgress?.({
        type: "browser_scanning",
        current,
        total,
        profileId: settings.profileId
      });
      scans.push(await collectBrowserScanWithChecks(config, settings, automation));
    }
    return scans;
  } finally {
    await closeBrowserIfNeeded(config, automation, notes);
    await stopProfileIfNeeded(config, settings.profileId, notes);
  }
}

async function collectRestartStabilityScans(
  config: ToolConfig,
  settings: ProfileSettings,
  current: number,
  total: number,
  onProgress: ProgressCallback | undefined,
  notes: string[]
): Promise<BrowserScanResult[]> {
  const scans: BrowserScanResult[] = [];

  for (let i = 0; i < config.stabilityRuns; i += 1) {
    let automation: BrowserAutomation | undefined;
    try {
      onProgress?.({
        type: "profile_starting",
        current,
        total,
        profileId: settings.profileId
      });
      const started = await startProfile(config, settings.profileId);
      onProgress?.({
        type: "browser_connecting",
        current,
        total,
        profileId: settings.profileId,
        browserType: detectBrowserType(settings)
      });
      automation = await connectAutomation(started, settings);
      onProgress?.({
        type: "browser_scanning",
        current,
        total,
        profileId: settings.profileId
      });
      scans.push(await collectBrowserScanWithChecks(config, settings, automation));
    } catch (error) {
      scans.push(failedBrowserScanResult(settings.profileId, error));
    } finally {
      await closeBrowserIfNeeded(config, automation, notes);
      await stopProfileIfNeeded(config, settings.profileId, notes);
    }
  }

  return scans;
}

async function runProfile(
  config: ToolConfig,
  settings: ProfileSettings,
  current: number,
  total: number,
  onProgress: ProgressCallback | undefined
): Promise<ProfileRunResult> {
  const notes: string[] = [];
  let browserScan: BrowserScanResult | undefined;
  let browserScans: BrowserScanResult[] = [];
  let status: ProfileRunResult["status"] = "failed";

  if (settings.fetchStatus === "failed") {
    notes.push(`设置值不可用：${settings.error ?? "unknown error"}`);
  }

  if (settings.randomFingerprintEnabled) {
    notes.push("检测到随机指纹开启，第一版不支持精确设置值对比");
  }

  try {
    const isRestartMode =
      config.stabilityMode === "restart" && config.stabilityRuns > 1;
    browserScans = isRestartMode
      ? await collectRestartStabilityScans(
          config,
          settings,
          current,
          total,
          onProgress,
          notes
        )
      : await collectSessionStabilityScans(
          config,
          settings,
          current,
          total,
          onProgress,
          notes
        );

    browserScan = browserScans[0];
    status = statusFor(settings, browserScan);

    validateFingerprintMismatch(settings, browserScan, notes);

    if (isBrowserScanSnapshotMissing(browserScan)) {
      notes.push(
        "BrowserScan 页面已打开，但组件快照未初始化，仅采集到页面原文；请检查 BrowserScan 页面是否加载完整、代理/网络或移动 UA 兼容性。"
      );
    }

    if (config.stabilityRuns > 1) {
      const failedRunCount = browserScans.filter(
        (scan) => scan.status === "failed"
      ).length;
      if (failedRunCount > 0) {
        notes.push(
          `${config.stabilityMode === "restart" ? "冷启动复测" : "同会话复测"}有 ${failedRunCount}/${config.stabilityRuns} 轮未采集到 BrowserScan，详见 JSON stability.runs[].browserScan.error`
        );
      }
    }
  } catch (error) {
    status = "failed";
    notes.push(errorMessage(error));
  }

  onProgress?.({
    type: "profile_done",
    current,
    total,
    profileId: settings.profileId,
    status,
    bsFieldCount: Object.keys(browserScan?.values ?? {}).length,
    probeFieldCount: Object.keys(browserScan?.probe?.values ?? {}).length
  });

  const result: ProfileRunResult = {
    profileId: settings.profileId,
    status,
    notes,
    settings,
    browserScan
  };

  if (config.stabilityRuns > 1) {
    result.stability = {
      mode: config.stabilityMode,
      runCount: config.stabilityRuns,
      runs: browserScans.map((bs, index) => ({
        runIndex: index + 1,
        browserScan: bs
      })),
      fields: buildStabilityFields(browserScans)
    };
  }

  return result;
}

export async function runFingerprintCompare(
  config: ToolConfig,
  options: RunFingerprintCompareOptions = {}
): Promise<FingerprintCompareRunResult> {
  const onProgress = options.onProgress;
  const settings = await loadSettings(config);
  const settingsByProfileId = new Map(
    settings.map((item) => [item.profileId, item])
  );
  const results: ProfileRunResult[] = [];
  const total = config.profileIds.length;

  for (let index = 0; index < config.profileIds.length; index += 1) {
    const profileId = config.profileIds[index];
    const current = index + 1;
    const profileSettings =
      settingsByProfileId.get(profileId) ??
      failedSettings(profileId, "profile settings unavailable");

    onProgress?.({
      type: "settings_loaded",
      current,
      total,
      profileId
    });

    results.push(
      await runProfile(config, profileSettings, current, total, onProgress)
    );
  }

  const report = buildReportData(results);
  const { htmlPath, jsonPath } = await writeReports(report, config.outputDir);

  return { report, htmlPath, jsonPath };
}
