import { describe, expect, it, vi } from "vitest";
import { startProfile, stopProfile } from "../src/localApi.js";

type FetchArgs = [input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]];

const config = {
  backendBaseUrl: "https://api.example.test",
  localApiBaseUrl: "http://local.adspower.com:50325",
  apiKey: "secret-key",
  browserScanUrl: "https://www.browserscan.net/",
  profileIds: ["PROFILE_ID_1"],
  closeAfterRun: true,
  runMode: "sequential" as const,
  timeoutMs: 60000,
  outputDir: "reports"
};

describe("startProfile", () => {
  it("posts profile_id and parses browser connection info", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          debug_port: "53210",
          ws: { puppeteer: "ws://127.0.0.1:53210/devtools/browser/abc" },
          webdriver: "C:/driver/chromedriver.exe"
        }
      })
    }) as Response);

    const result = await startProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch);

    expect(result.profileId).toBe("PROFILE_ID_1");
    expect(result.debugPort).toBe("53210");
    expect(result.wsPuppeteer).toContain("ws://127.0.0.1");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://local.adspower.com:50325/api/v2/browser-profile/start"
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer secret-key" })
    );
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ profile_id: "PROFILE_ID_1" })
    );
  });
});

describe("stopProfile", () => {
  it("posts profile_id to stop endpoint", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => ({
      ok: true,
      json: async () => ({ code: 0, data: {} })
    }) as Response);

    await stopProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch);

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://local.adspower.com:50325/api/v2/browser-profile/stop"
    );
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ profile_id: "PROFILE_ID_1" })
    );
  });
});
