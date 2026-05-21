import { fetchProfileSettings } from "./adspowerBackend.js";
import { connectToStartedBrowser } from "./browserSession.js";
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
import type { Browser } from "playwright";

export interface FingerprintCompareRunResult {
  report: ReportData;
  htmlPath: string;
  jsonPath: string;
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

async function closeBrowserIfNeeded(
  config: ToolConfig,
  browser: Browser | undefined,
  notes: string[]
): Promise<void> {
  if (!config.closeAfterRun || !browser) {
    return;
  }

  try {
    await browser.close();
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
  browser: Browser
): Promise<BrowserScanResult> {
  const scan = await collectBrowserScan(config, settings.profileId, browser);
  if (scan.probe) {
    scan.probe.checks = buildProbeChecks(settings.settings, scan.probe.values);
  }
  return scan;
}

async function collectSessionStabilityScans(
  config: ToolConfig,
  settings: ProfileSettings,
  notes: string[]
): Promise<BrowserScanResult[]> {
  let browser: Browser | undefined;
  try {
    const started = await startProfile(config, settings.profileId);
    browser = await connectToStartedBrowser(started);

    const scans: BrowserScanResult[] = [];
    for (let i = 0; i < config.stabilityRuns; i += 1) {
      scans.push(await collectBrowserScanWithChecks(config, settings, browser));
    }
    return scans;
  } finally {
    await closeBrowserIfNeeded(config, browser, notes);
    await stopProfileIfNeeded(config, settings.profileId, notes);
  }
}

async function collectRestartStabilityScans(
  config: ToolConfig,
  settings: ProfileSettings,
  notes: string[]
): Promise<BrowserScanResult[]> {
  const scans: BrowserScanResult[] = [];

  for (let i = 0; i < config.stabilityRuns; i += 1) {
    let browser: Browser | undefined;
    try {
      const started = await startProfile(config, settings.profileId);
      browser = await connectToStartedBrowser(started);
      scans.push(await collectBrowserScanWithChecks(config, settings, browser));
    } catch (error) {
      scans.push(failedBrowserScanResult(settings.profileId, error));
    } finally {
      await closeBrowserIfNeeded(config, browser, notes);
      await stopProfileIfNeeded(config, settings.profileId, notes);
    }
  }

  return scans;
}

async function runProfile(
  config: ToolConfig,
  settings: ProfileSettings
): Promise<ProfileRunResult> {
  const notes: string[] = [];
  let browserScan: BrowserScanResult | undefined;
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
    const browserScans = isRestartMode
      ? await collectRestartStabilityScans(config, settings, notes)
      : await collectSessionStabilityScans(config, settings, notes);

    browserScan = browserScans[0];
    status = statusFor(settings, browserScan);

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
  } catch (error) {
    status = "failed";
    notes.push(errorMessage(error));
    return {
      profileId: settings.profileId,
      status,
      notes,
      settings,
      browserScan
    };
  }
}

export async function runFingerprintCompare(
  config: ToolConfig
): Promise<FingerprintCompareRunResult> {
  const settings = await loadSettings(config);
  const settingsByProfileId = new Map(
    settings.map((item) => [item.profileId, item])
  );
  const results: ProfileRunResult[] = [];

  for (const profileId of config.profileIds) {
    results.push(
      await runProfile(
        config,
        settingsByProfileId.get(profileId) ??
          failedSettings(profileId, "profile settings unavailable")
      )
    );
  }

  const report = buildReportData(results);
  const { htmlPath, jsonPath } = await writeReports(report, config.outputDir);

  return { report, htmlPath, jsonPath };
}
