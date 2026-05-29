import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProfileSettings } from "../src/adspowerBackend.js";
import { connectToStartedBrowser, connectAutomation } from "../src/browserSession.js";
import { collectBrowserScan } from "../src/browserScanCollector.js";
import { startProfile, stopProfile } from "../src/localApi.js";
import { writeReports } from "../src/reportWriter.js";
import { buildReportData, runFingerprintCompare } from "../src/runner.js";
import type {
  BrowserScanResult,
  LocalApiStartResponse,
  ProfileSettings,
  ToolConfig
} from "../src/types.js";
import type { BrowserAutomation } from "../src/browserAutomation.js";

vi.mock("../src/adspowerBackend.js", () => ({
  fetchProfileSettings: vi.fn()
}));

vi.mock("../src/localApi.js", () => ({
  startProfile: vi.fn(),
  stopProfile: vi.fn()
}));

vi.mock("../src/browserSession.js", () => ({
  connectToStartedBrowser: vi.fn(),
  connectAutomation: vi.fn(),
  detectBrowserType: vi.fn().mockReturnValue("unknown")
}));

vi.mock("../src/browserScanCollector.js", () => ({
  collectBrowserScan: vi.fn()
}));

vi.mock("../src/reportWriter.js", () => ({
  writeReports: vi.fn()
}));

const config: ToolConfig = {
  backendBaseUrl: "https://api.example.test",
  localApiBaseUrl: "http://local.adspower.com:50325",
  apiKey: "secret-key",
  browserScanUrl: "https://www.browserscan.net/",
  profileIds: ["PROFILE_ID_1", "PROFILE_ID_2"],
  closeAfterRun: true,
  runMode: "sequential",
  timeoutMs: 60000,
  outputDir: "reports",
  stabilityRuns: 1,
  stabilityMode: "session"
};

const settings: ProfileSettings[] = config.profileIds.map((profileId) => ({
  profileId,
  settings: { ua: `ua ${profileId}` },
  randomFingerprintEnabled: false,
  fetchStatus: "ok"
}));

function browserScan(profileId: string): BrowserScanResult {
  return {
    profileId,
    status: "ok",
    rawText: "",
    values: {
      ua: { value: `ua ${profileId}`, source: "runtime" }
    }
  };
}

function browser() {
  return {
    close: vi.fn(async () => undefined)
  };
}

const fetchProfileSettingsMock = vi.mocked(fetchProfileSettings);
const startProfileMock = vi.mocked(startProfile);
const stopProfileMock = vi.mocked(stopProfile);
const connectAutomationMock = vi.mocked(connectAutomation);
const collectBrowserScanMock = vi.mocked(collectBrowserScan);
const writeReportsMock = vi.mocked(writeReports);

beforeEach(() => {
  vi.clearAllMocks();
  fetchProfileSettingsMock.mockResolvedValue(settings);
  startProfileMock.mockImplementation(async (_config, profileId) => ({
    profileId,
    raw: {}
  }) as LocalApiStartResponse);
  connectAutomationMock.mockImplementation(async () => browser() as never);
  connectAutomationMock.mockImplementation(async (_started, _settings) => browser() as unknown as BrowserAutomation);
  collectBrowserScanMock.mockImplementation(async (_config, profileId) =>
    browserScan(profileId)
  );
  writeReportsMock.mockResolvedValue({
    htmlPath: "reports/report.html",
    jsonPath: "reports/report.json"
  });
});

describe("buildReportData", () => {
  it("keeps one failed profile and one successful profile in the same report", () => {
    const report = buildReportData([
      {
        profileId: "PROFILE_ID_1",
        status: "failed",
        notes: ["Local API start error"],
        settings: {
          profileId: "PROFILE_ID_1",
          settings: {},
          randomFingerprintEnabled: false,
          fetchStatus: "failed",
          error: "backend unavailable"
        }
      },
      {
        profileId: "PROFILE_ID_2",
        status: "ok",
        notes: [],
        settings: {
          profileId: "PROFILE_ID_2",
          settings: { ua: "Mozilla/5.0" },
          randomFingerprintEnabled: false,
          fetchStatus: "ok"
        },
        browserScan: {
          profileId: "PROFILE_ID_2",
          status: "ok",
          rawText: "",
          values: {
            ua: { value: "Mozilla/5.0", source: "runtime" }
          }
        }
      }
    ]);

    expect(report.profileIds).toEqual(["PROFILE_ID_1", "PROFILE_ID_2"]);
    expect(report.results).toHaveLength(2);
  });
});

describe("runFingerprintCompare", () => {
  it("keeps the next profile in the report after one profile collection throws", async () => {
    collectBrowserScanMock
      .mockRejectedValueOnce(new Error("BrowserScan unavailable"))
      .mockResolvedValueOnce(browserScan("PROFILE_ID_2"));

    const result = await runFingerprintCompare(config);

    expect(startProfileMock).toHaveBeenCalledTimes(2);
    expect(connectAutomationMock).toHaveBeenCalledTimes(2);
    expect(collectBrowserScanMock).toHaveBeenCalledTimes(2);
    expect(result.report.profileIds).toEqual(["PROFILE_ID_1", "PROFILE_ID_2"]);
    expect(result.report.results).toMatchObject([
      {
        profileId: "PROFILE_ID_1",
        status: "failed"
      },
      {
        profileId: "PROFILE_ID_2",
        status: "ok"
      }
    ]);
  });

  it("marks every profile settings as failed when fetching settings throws", async () => {
    fetchProfileSettingsMock.mockRejectedValueOnce(new Error("backend unavailable"));

    const result = await runFingerprintCompare(config);

    expect(result.report.results.map((item) => item.settings.fetchStatus)).toEqual([
      "failed",
      "failed"
    ]);
  });

  it("does not close the browser or stop profiles when closeAfterRun is false", async () => {
    const firstBrowser = browser();
    const secondBrowser = browser();
    connectAutomationMock
      .mockResolvedValueOnce(firstBrowser as never)
      .mockResolvedValueOnce(secondBrowser as never);

    await runFingerprintCompare({
      ...config,
      closeAfterRun: false
    });

    expect(firstBrowser.close).not.toHaveBeenCalled();
    expect(secondBrowser.close).not.toHaveBeenCalled();
    expect(stopProfileMock).not.toHaveBeenCalled();
  });

  it("collects BrowserScan multiple times for stability mode without restarting profile", async () => {
    const stabilityConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"],
      stabilityRuns: 2
    };

    const stabilitySettings: ProfileSettings[] = [
      {
        profileId: "PROFILE_ID_1",
        settings: { ua: "ua-stable" },
        randomFingerprintEnabled: false,
        fetchStatus: "ok"
      }
    ];
    fetchProfileSettingsMock.mockResolvedValueOnce(stabilitySettings);

    collectBrowserScanMock
      .mockResolvedValueOnce({
        profileId: "PROFILE_ID_1",
        status: "ok",
        rawText: "",
        values: {
          ua: { value: "ua-first", source: "runtime" },
          webgl: { value: "hash-a", source: "runtime" }
        }
      })
      .mockResolvedValueOnce({
        profileId: "PROFILE_ID_1",
        status: "ok",
        rawText: "",
        values: {
          ua: { value: "ua-first", source: "runtime" },
          webgl: { value: "hash-b", source: "runtime" }
        }
      });

    const result = await runFingerprintCompare(stabilityConfig);

    expect(startProfileMock).toHaveBeenCalledTimes(1);
    expect(connectAutomationMock).toHaveBeenCalledTimes(1);
    expect(collectBrowserScanMock).toHaveBeenCalledTimes(2);
    expect(stopProfileMock).toHaveBeenCalledTimes(1);

    const profileResult = result.report.results[0];
    expect(profileResult.browserScan?.values.ua?.value).toBe("ua-first");
    expect(profileResult.stability).toBeDefined();
    expect(profileResult.stability!.runCount).toBe(2);
    expect(profileResult.stability!.runs).toHaveLength(2);
    expect(profileResult.stability!.runs[0].runIndex).toBe(1);
    expect(profileResult.stability!.runs[1].runIndex).toBe(2);
    expect(profileResult.stability!.mode).toBe("session");
    expect(profileResult.stability!.fields.ua.status).toBe("unchanged");
    expect(profileResult.stability!.fields.webgl.status).toBe("changed");
  });

  it("keeps restart stability runs when one cold start cannot connect", async () => {
    const restartConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"],
      stabilityRuns: 2,
      stabilityMode: "restart",
      closeAfterRun: true
    };

    const stabilitySettings: ProfileSettings[] = [
      {
        profileId: "PROFILE_ID_1",
        settings: { ua: "ua-stable" },
        randomFingerprintEnabled: false,
        fetchStatus: "ok"
      }
    ];
    fetchProfileSettingsMock.mockResolvedValueOnce(stabilitySettings);

    const secondBrowser = browser();
    connectAutomationMock
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:14192"))
      .mockResolvedValueOnce(secondBrowser as never);

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "",
      values: {
        ua: { value: "ua-second", source: "runtime" },
        webgl: { value: "hash-b", source: "runtime" }
      }
    });

    stopProfileMock
      .mockRejectedValueOnce(new Error("Profile is not open"))
      .mockResolvedValueOnce(undefined);

    const result = await runFingerprintCompare(restartConfig);

    expect(startProfileMock).toHaveBeenCalledTimes(2);
    expect(connectAutomationMock).toHaveBeenCalledTimes(2);
    expect(collectBrowserScanMock).toHaveBeenCalledTimes(1);
    expect(stopProfileMock).toHaveBeenCalledTimes(2);

    const profileResult = result.report.results[0];
    expect(profileResult.stability?.mode).toBe("restart");
    expect(profileResult.stability?.runs).toHaveLength(2);

    expect(profileResult.stability?.runs[0].browserScan.status).toBe("failed");
    expect(profileResult.stability?.runs[0].browserScan.error).toContain("ECONNREFUSED");

    expect(profileResult.stability?.runs[1].browserScan.status).toBe("ok");
    expect(profileResult.stability?.runs[1].browserScan.values.webgl?.value).toBe("hash-b");

    expect(profileResult.notes.join(" ")).toContain("冷启动复测有 1/2 轮未采集到 BrowserScan");
    expect(profileResult.notes.join(" ")).not.toContain("ECONNREFUSED");
    expect(profileResult.notes.join(" ")).not.toContain("Profile is not open");

    expect(profileResult.browserScan?.status).toBe("failed");
  });

  it("ignores Profile is not open cleanup errors in restart mode", async () => {
    const restartConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"],
      stabilityRuns: 1,
      stabilityMode: "restart",
      closeAfterRun: true
    };

    const stabilitySettings: ProfileSettings[] = [
      {
        profileId: "PROFILE_ID_1",
        settings: { ua: "ua-stable" },
        randomFingerprintEnabled: false,
        fetchStatus: "ok"
      }
    ];
    fetchProfileSettingsMock.mockResolvedValueOnce(stabilitySettings);

    const firstBrowser = browser();
    connectAutomationMock.mockResolvedValueOnce(firstBrowser as never);

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "",
      values: {
        ua: { value: "ua-first", source: "runtime" }
      }
    });

    stopProfileMock.mockRejectedValueOnce(new Error("Profile is not open"));

    const result = await runFingerprintCompare(restartConfig);

    expect(stopProfileMock).toHaveBeenCalledTimes(1);
    const profileResult = result.report.results[0];
    expect(profileResult.notes.join(" ")).not.toContain("Profile is not open");
    expect(profileResult.browserScan?.status).toBe("ok");
  });

  it("restarts profile for each stability run when stabilityMode is restart", async () => {
    const restartConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"],
      stabilityRuns: 2,
      stabilityMode: "restart",
      closeAfterRun: true
    };

    const stabilitySettings: ProfileSettings[] = [
      {
        profileId: "PROFILE_ID_1",
        settings: { ua: "ua-stable" },
        randomFingerprintEnabled: false,
        fetchStatus: "ok"
      }
    ];
    fetchProfileSettingsMock.mockResolvedValueOnce(stabilitySettings);

    const firstBrowser = browser();
    const secondBrowser = browser();
    connectAutomationMock
      .mockResolvedValueOnce(firstBrowser as never)
      .mockResolvedValueOnce(secondBrowser as never);

    collectBrowserScanMock
      .mockResolvedValueOnce({
        profileId: "PROFILE_ID_1",
        status: "ok",
        rawText: "",
        values: {
          ua: { value: "ua-first", source: "runtime" },
          webgl: { value: "hash-a", source: "runtime" }
        }
      })
      .mockResolvedValueOnce({
        profileId: "PROFILE_ID_1",
        status: "ok",
        rawText: "",
        values: {
          ua: { value: "ua-first", source: "runtime" },
          webgl: { value: "hash-b", source: "runtime" }
        }
      });

    const result = await runFingerprintCompare(restartConfig);

    expect(startProfileMock).toHaveBeenCalledTimes(2);
    expect(connectAutomationMock).toHaveBeenCalledTimes(2);
    expect(collectBrowserScanMock).toHaveBeenCalledTimes(2);
    expect(firstBrowser.close).toHaveBeenCalledTimes(1);
    expect(secondBrowser.close).toHaveBeenCalledTimes(1);
    expect(stopProfileMock).toHaveBeenCalledTimes(2);

    const profileResult = result.report.results[0];
    expect(profileResult.browserScan?.values.ua?.value).toBe("ua-first");
    expect(profileResult.stability).toBeDefined();
    expect(profileResult.stability!.mode).toBe("restart");
    expect(profileResult.stability!.runCount).toBe(2);
    expect(profileResult.stability!.runs).toHaveLength(2);
    expect(profileResult.stability!.fields.webgl.status).toBe("changed");
  });
});
