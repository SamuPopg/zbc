import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProfileSettings } from "../src/adspowerBackend.js";
import { connectToStartedBrowser } from "../src/browserSession.js";
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

vi.mock("../src/adspowerBackend.js", () => ({
  fetchProfileSettings: vi.fn()
}));

vi.mock("../src/localApi.js", () => ({
  startProfile: vi.fn(),
  stopProfile: vi.fn()
}));

vi.mock("../src/browserSession.js", () => ({
  connectToStartedBrowser: vi.fn()
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
  outputDir: "reports"
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
const connectToStartedBrowserMock = vi.mocked(connectToStartedBrowser);
const collectBrowserScanMock = vi.mocked(collectBrowserScan);
const writeReportsMock = vi.mocked(writeReports);

beforeEach(() => {
  vi.clearAllMocks();
  fetchProfileSettingsMock.mockResolvedValue(settings);
  startProfileMock.mockImplementation(async (_config, profileId) => ({
    profileId,
    raw: {}
  }) as LocalApiStartResponse);
  connectToStartedBrowserMock.mockImplementation(async () => browser() as never);
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
    expect(connectToStartedBrowserMock).toHaveBeenCalledTimes(2);
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
    connectToStartedBrowserMock
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
});
