import { describe, expect, it, vi } from "vitest";
import { fetchProfileSettings, flattenProfile } from "../src/adspowerBackend.js";

describe("flattenProfile", () => {
  it("flattens fingerprint_config and keeps profile context", () => {
    const settings = flattenProfile({
      id: "PROFILE_ID_1",
      acc_id: "604",
      name: "w1485",
      ipchecker: "ip2location",
      fingerprint_config: {
        ua: "Mozilla/5.0",
        language: "en-US",
        webrtc: "disabled"
      },
      switch_random_finger: "0"
    });

    expect(settings.profileId).toBe("PROFILE_ID_1");
    expect(settings.accId).toBe("604");
    expect(settings.name).toBe("w1485");
    expect(settings.settings.ua).toBe("Mozilla/5.0");
    expect(settings.settings.language).toBe("en-US");
    expect(settings.settings.webrtc).toBe("disabled");
    expect(settings.settings.ipchecker).toBe("ip2location");
    expect(settings.randomFingerprintEnabled).toBe(false);
  });
});

describe("fetchProfileSettings", () => {
  it("calls get-open-user-list with api key and requested fields", async () => {
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        ({
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              list: [
                {
                  id: "PROFILE_ID_1",
                  acc_id: "604",
                  fingerprint_config: { ua: "Mozilla/5.0" },
                  switch_random_finger: "0"
                }
              ]
            }
          })
        }) as Response
    );

    const result = await fetchProfileSettings(
      {
        backendBaseUrl: "https://api.example.test",
        localApiBaseUrl: "http://local.adspower.com:50325",
        apiKey: "secret-key",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["PROFILE_ID_1"],
        closeAfterRun: true,
        runMode: "sequential",
        timeoutMs: 60000,
        outputDir: "reports"
      },
      fetchMock as unknown as typeof fetch
    );

    expect(result[0].profileId).toBe("PROFILE_ID_1");
    expect(result[0].fetchStatus).toBe("ok");

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/fbcc/user/get-open-user-list");
    expect(calledUrl).toContain("_local_api=adspower");
    expect(calledUrl).toContain("ids=PROFILE_ID_1");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ "api-key": "secret-key" })
    );
  });
});
