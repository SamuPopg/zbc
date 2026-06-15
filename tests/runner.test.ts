import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProfileSettings } from "../src/adspowerBackend.js";
import { connectAutomation, detectBrowserType } from "../src/browserSession.js";
import { collectBrowserScan } from "../src/browserScanCollector.js";
import { startProfile, stopProfile } from "../src/localApi.js";
import { writeReports } from "../src/reportWriter.js";
import {
  buildReportData,
  runFingerprintCompare,
  type ProgressEvent
} from "../src/runner.js";
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
    expect(profileResult.notes.join(" ")).toContain("BrowserScan 采集失败");
    expect(profileResult.notes.join(" ")).toContain("ECONNREFUSED");
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

  it("adds a profile-level note when BrowserScan page opened but component snapshot was never initialized", async () => {
    const singleProfileConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"]
    };

    const singleProfileSettings: ProfileSettings[] = [
      {
        profileId: "PROFILE_ID_1",
        settings: { ua: "ua-snapshot-missing" },
        randomFingerprintEnabled: false,
        fetchStatus: "ok"
      }
    ];
    fetchProfileSettingsMock.mockResolvedValueOnce(singleProfileSettings);

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "<html>BrowserScan body</html>",
      // intentionally no componentSnapshot
      values: {
        browser_scan_raw_text: {
          value: "<html>BrowserScan body</html>",
          source: "dom",
          note: "BrowserScan visible text snapshot truncated to 20000 characters"
        }
      }
    });

    const result = await runFingerprintCompare(singleProfileConfig);

    const profileResult = result.report.results[0];
    expect(profileResult.status).toBe("ok");
    expect(profileResult.notes).toHaveLength(1);
    expect(profileResult.notes[0]).toContain("组件快照未初始化");
    expect(profileResult.notes[0]).toContain("BrowserScan 页面已打开");
    expect(profileResult.notes[0]).toContain("代理/网络或移动 UA 兼容性");
  });

  it("does not add the snapshot-missing note when componentSnapshot is present", async () => {
    const singleProfileConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"]
    };

    const singleProfileSettings: ProfileSettings[] = [
      {
        profileId: "PROFILE_ID_1",
        settings: { ua: "ua-snapshot-present" },
        randomFingerprintEnabled: false,
        fetchStatus: "ok"
      }
    ];
    fetchProfileSettingsMock.mockResolvedValueOnce(singleProfileSettings);

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "",
      componentSnapshot: {
        allComplete: true,
        hardware: { canvasHash: "abc123" }
      },
      values: {
        ua: { value: "ua-snapshot-present", source: "runtime" },
        canvas: { value: "abc123", source: "dom", note: "BrowserScan _getComponent snapshot" },
        browser_scan_raw_text: {
          value: "<html>BrowserScan body</html>",
          source: "dom",
          note: "BrowserScan visible text snapshot truncated to 20000 characters"
        }
      }
    });

    const result = await runFingerprintCompare(singleProfileConfig);

    const profileResult = result.report.results[0];
    expect(profileResult.status).toBe("ok");
    expect(profileResult.notes.join(" ")).not.toContain("组件快照未初始化");
  });

  it("does not add the snapshot-missing note when values contain fields beyond raw text even without componentSnapshot", async () => {
    const singleProfileConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"]
    };

    const singleProfileSettings: ProfileSettings[] = [
      {
        profileId: "PROFILE_ID_1",
        settings: { ua: "ua-probe-only" },
        randomFingerprintEnabled: false,
        fetchStatus: "ok"
      }
    ];
    fetchProfileSettingsMock.mockResolvedValueOnce(singleProfileSettings);

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "",
      // no componentSnapshot
      values: {
        ua: { value: "ua-probe-only", source: "probe" },
        browser_scan_raw_text: {
          value: "<html>BrowserScan body</html>",
          source: "dom",
          note: "BrowserScan visible text snapshot truncated to 20000 characters"
        }
      }
    });

    const result = await runFingerprintCompare(singleProfileConfig);

    const profileResult = result.report.results[0];
    expect(profileResult.status).toBe("ok");
    expect(profileResult.notes.join(" ")).not.toContain("组件快照未初始化");
  });

  it("emits profile-level progress events in starting/started/connecting/connected/scanning/completed/done order", async () => {
    vi.mocked(detectBrowserType).mockReturnValue("firefox");

    const singleProfileConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"]
    };

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "",
      probe: {
        raw: {},
        values: {
          ua: { value: "ua-x", source: "probe" },
          webgl: { value: "hash-x", source: "probe" }
        }
      },
      values: {
        ua: { value: "ua-x", source: "runtime" },
        webgl: { value: "hash-x", source: "runtime" },
        canvas: { value: "hash-c", source: "dom" }
      }
    });

    const events: ProgressEvent[] = [];
    await runFingerprintCompare(singleProfileConfig, {
      onProgress: (event) => {
        events.push(event);
      }
    });

    expect(events.map((event) => event.type)).toEqual([
      "settings_loaded",
      "profile_starting",
      "profile_started",
      "browser_connecting",
      "browser_connected",
      "browser_scanning",
      "scan_completed",
      "profile_done"
    ]);

    const settingsLoaded = events[0];
    expect(settingsLoaded).toMatchObject({
      type: "settings_loaded",
      current: 1,
      total: 1,
      profileId: "PROFILE_ID_1"
    });

    const profileStarted = events[2];
    expect(profileStarted).toMatchObject({
      type: "profile_started",
      current: 1,
      total: 1,
      profileId: "PROFILE_ID_1"
    });

    const browserConnecting = events[3];
    expect(browserConnecting).toMatchObject({
      type: "browser_connecting",
      current: 1,
      total: 1,
      profileId: "PROFILE_ID_1",
      browserType: "firefox"
    });

    const browserConnected = events[4];
    expect(browserConnected).toMatchObject({
      type: "browser_connected",
      current: 1,
      total: 1,
      profileId: "PROFILE_ID_1",
      browserType: "firefox"
    });

    const scanCompleted = events[6];
    expect(scanCompleted).toMatchObject({
      type: "scan_completed",
      current: 1,
      total: 1,
      profileId: "PROFILE_ID_1",
      scanStatus: "ok"
    });

    const done = events[7];
    expect(done).toMatchObject({
      type: "profile_done",
      current: 1,
      total: 1,
      profileId: "PROFILE_ID_1",
      status: "ok",
      bsFieldCount: 3,
      probeFieldCount: 2
    });
  });

  it("includes durationMs on profile_started/browser_connected/scan_completed/profile_done events", async () => {
    vi.mocked(detectBrowserType).mockReturnValue("firefox");

    const singleProfileConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"]
    };

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "",
      values: {
        ua: { value: "ua-x", source: "runtime" }
      }
    });

    const events: ProgressEvent[] = [];
    await runFingerprintCompare(singleProfileConfig, {
      onProgress: (event) => {
        events.push(event);
      }
    });

    const profileStarted = events.find((e) => e.type === "profile_started");
    expect(profileStarted).toBeDefined();
    if (profileStarted && profileStarted.type === "profile_started") {
      expect(typeof profileStarted.durationMs).toBe("number");
      expect(profileStarted.durationMs).toBeGreaterThanOrEqual(0);
    }

    const browserConnected = events.find((e) => e.type === "browser_connected");
    expect(browserConnected).toBeDefined();
    if (browserConnected && browserConnected.type === "browser_connected") {
      expect(typeof browserConnected.durationMs).toBe("number");
      expect(browserConnected.durationMs).toBeGreaterThanOrEqual(0);
    }

    const scanCompleted = events.find((e) => e.type === "scan_completed");
    expect(scanCompleted).toBeDefined();
    if (scanCompleted && scanCompleted.type === "scan_completed") {
      expect(typeof scanCompleted.durationMs).toBe("number");
      expect(scanCompleted.durationMs).toBeGreaterThanOrEqual(0);
      expect(scanCompleted.scanStatus).toBe("ok");
    }

    const done = events.find((e) => e.type === "profile_done");
    expect(done).toBeDefined();
    if (done && done.type === "profile_done") {
      expect(typeof done.durationMs).toBe("number");
      expect(done.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("tracks per-run durations in restart stability mode", async () => {
    vi.mocked(detectBrowserType).mockReturnValue("chromium");

    const restartConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"],
      stabilityRuns: 2,
      stabilityMode: "restart"
    };

    collectBrowserScanMock.mockResolvedValue({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "",
      values: {
        ua: { value: "ua-stable", source: "runtime" }
      }
    });

    const events: ProgressEvent[] = [];
    await runFingerprintCompare(restartConfig, {
      onProgress: (event) => {
        events.push(event);
      }
    });

    const starteds = events.filter((e) => e.type === "profile_started");
    const connecteds = events.filter((e) => e.type === "browser_connected");
    const scanCompleted = events.filter((e) => e.type === "scan_completed");
    const dones = events.filter((e) => e.type === "profile_done");

    expect(starteds).toHaveLength(2);
    expect(connecteds).toHaveLength(2);
    expect(scanCompleted).toHaveLength(2);
    expect(dones).toHaveLength(1);

    for (const event of starteds) {
      if (event.type === "profile_started") {
        expect(typeof event.durationMs).toBe("number");
      }
    }
    for (const event of connecteds) {
      if (event.type === "browser_connected") {
        expect(typeof event.durationMs).toBe("number");
      }
    }
    for (const event of scanCompleted) {
      if (event.type === "scan_completed") {
        expect(typeof event.durationMs).toBe("number");
      }
    }
    const done = dones[0];
    if (done && done.type === "profile_done") {
      expect(typeof done.durationMs).toBe("number");
    }
  });

  it("emits one settings_loaded event per profile with increasing current index", async () => {
    const events: ProgressEvent[] = [];
    await runFingerprintCompare(config, {
      onProgress: (event) => {
        events.push(event);
      }
    });

    const settingsLoaded = events.filter(
      (event) => event.type === "settings_loaded"
    );
    expect(settingsLoaded.map((event) => event.profileId)).toEqual([
      "PROFILE_ID_1",
      "PROFILE_ID_2"
    ]);
    expect(settingsLoaded[0]).toMatchObject({ current: 1, total: 2 });
    expect(settingsLoaded[1]).toMatchObject({ current: 2, total: 2 });

    const done = events.filter((event) => event.type === "profile_done");
    expect(done[0]).toMatchObject({
      profileId: "PROFILE_ID_1",
      status: "ok",
      bsFieldCount: 1,
      probeFieldCount: 0
    });
    expect(done[1]).toMatchObject({
      profileId: "PROFILE_ID_2",
      status: "ok",
      bsFieldCount: 1,
      probeFieldCount: 0
    });
  });

  it("marks profile as partial and pushes BrowserScan error into notes when collectBrowserScan returns status=failed", async () => {
    const singleProfileConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"]
    };

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "failed",
      error: "Navigation timed out after 60000 ms",
      values: {},
      rawText: ""
    });

    const events: ProgressEvent[] = [];
    const result = await runFingerprintCompare(singleProfileConfig, {
      onProgress: (event) => {
        events.push(event);
      }
    });

    const profileResult = result.report.results[0];
    expect(profileResult.status).toBe("partial");
    expect(profileResult.notes.join(" ")).toContain("BrowserScan 采集失败");
    expect(profileResult.notes.join(" ")).toContain("Navigation timed out after 60000 ms");
    expect(profileResult.browserScan?.status).toBe("failed");
    expect(profileResult.browserScan?.error).toBe("Navigation timed out after 60000 ms");

    const scanCompleted = events.find((e) => e.type === "scan_completed");
    expect(scanCompleted).toBeDefined();
    if (scanCompleted && scanCompleted.type === "scan_completed") {
      expect(scanCompleted.scanStatus).toBe("failed");
      expect(scanCompleted.scanError).toBe("Navigation timed out after 60000 ms");
      expect(typeof scanCompleted.durationMs).toBe("number");
    }
  });

  it("omits scanError on scan_completed when status is ok", async () => {
    const singleProfileConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"]
    };

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "",
      values: {}
    });

    const events: ProgressEvent[] = [];
    await runFingerprintCompare(singleProfileConfig, {
      onProgress: (event) => {
        events.push(event);
      }
    });

    const scanCompleted = events.find((e) => e.type === "scan_completed");
    expect(scanCompleted).toBeDefined();
    if (scanCompleted && scanCompleted.type === "scan_completed") {
      expect(scanCompleted.scanStatus).toBe("ok");
      expect(scanCompleted.scanError).toBeUndefined();
    }
  });

  it("does not duplicate the BrowserScan error note when the same error is already present", async () => {
    const singleProfileConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"]
    };

    collectBrowserScanMock.mockResolvedValueOnce({
      profileId: "PROFILE_ID_1",
      status: "failed",
      error: "Navigation timed out after 60000 ms",
      values: {},
      rawText: ""
    });

    const result = await runFingerprintCompare(singleProfileConfig);

    const profileResult = result.report.results[0];
    const matches = profileResult.notes.filter((n) => n.includes("BrowserScan 采集失败"));
    expect(matches).toHaveLength(1);
  });

  it("emits profile_done with status failed and zero field counts when startProfile throws", async () => {
    const singleProfileConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"]
    };

    startProfileMock.mockRejectedValueOnce(new Error("startup failed"));

    const events: ProgressEvent[] = [];
    await runFingerprintCompare(singleProfileConfig, {
      onProgress: (event) => {
        events.push(event);
      }
    });

    const done = events.find((event) => event.type === "profile_done");
    expect(done).toMatchObject({
      type: "profile_done",
      current: 1,
      total: 1,
      profileId: "PROFILE_ID_1",
      status: "partial",
      bsFieldCount: 0,
      probeFieldCount: 0
    });
  });

  it("emits per-run starting/started/connecting/connected/scanning/completed events in restart stability mode", async () => {
    vi.mocked(detectBrowserType).mockReturnValue("chromium");

    const restartConfig: ToolConfig = {
      ...config,
      profileIds: ["PROFILE_ID_1"],
      stabilityRuns: 2,
      stabilityMode: "restart"
    };

    collectBrowserScanMock.mockResolvedValue({
      profileId: "PROFILE_ID_1",
      status: "ok",
      rawText: "",
      values: {
        ua: { value: "ua-stable", source: "runtime" }
      }
    });

    const events: ProgressEvent[] = [];
    await runFingerprintCompare(restartConfig, {
      onProgress: (event) => {
        events.push(event);
      }
    });

    const types = events.map((event) => event.type);
    expect(types).toEqual([
      "settings_loaded",
      "profile_starting",
      "profile_started",
      "browser_connecting",
      "browser_connected",
      "browser_scanning",
      "scan_completed",
      "profile_starting",
      "profile_started",
      "browser_connecting",
      "browser_connected",
      "browser_scanning",
      "scan_completed",
      "profile_done"
    ]);

    const connecting = events.filter(
      (event) => event.type === "browser_connecting"
    );
    expect(connecting).toHaveLength(2);
    for (const event of connecting) {
      expect(event).toMatchObject({ browserType: "chromium" });
    }

    const scanCompleted = events.filter((event) => event.type === "scan_completed");
    expect(scanCompleted).toHaveLength(2);
    for (const event of scanCompleted) {
      expect(event).toMatchObject({ profileId: "PROFILE_ID_1" });
    }
  });

  it("runs cleanly without an onProgress callback (no throw, no events)", async () => {
    const events = vi.fn();
    const result = await runFingerprintCompare(config);
    expect(events).not.toHaveBeenCalled();
    expect(result.report.profileIds).toEqual(config.profileIds);
  });
});
