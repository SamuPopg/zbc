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
    notes.push(`关闭环境错误：${errorMessage(error)}`);
  }
}

async function runProfile(
  config: ToolConfig,
  settings: ProfileSettings
): Promise<ProfileRunResult> {
  const notes: string[] = [];
  let browser: Browser | undefined;
  let browserScan: BrowserScanResult | undefined;
  let status: ProfileRunResult["status"] = "failed";
  const stabilityRuns = config.stabilityRuns ?? 1;

  if (settings.fetchStatus === "failed") {
    notes.push(`设置值不可用：${settings.error ?? "unknown error"}`);
  }

  if (settings.randomFingerprintEnabled) {
    notes.push("检测到随机指纹开启，第一版不支持精确设置值对比");
  }

  try {
    const started = await startProfile(config, settings.profileId);
    browser = await connectToStartedBrowser(started);

    const browserScans: BrowserScanResult[] = [];
    for (let i = 0; i < stabilityRuns; i++) {
      const scan = await collectBrowserScan(config, settings.profileId, browser);
      if (scan.probe) {
        scan.probe.checks = buildProbeChecks(settings.settings, scan.probe.values);
      }
      browserScans.push(scan);
    }

    browserScan = browserScans[0];
    status = statusFor(settings, browserScan);

    const result: ProfileRunResult = {
      profileId: settings.profileId,
      status,
      notes,
      settings,
      browserScan
    };

    if (stabilityRuns > 1) {
      result.stability = {
        runCount: stabilityRuns,
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
  } finally {
    await closeBrowserIfNeeded(config, browser, notes);
    await stopProfileIfNeeded(config, settings.profileId, notes);
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
