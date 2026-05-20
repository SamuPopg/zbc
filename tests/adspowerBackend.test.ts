import { describe, expect, it, vi } from "vitest";
import { fetchProfileSettings, flattenProfile } from "../src/adspowerBackend.js";
import { BACKEND_PROFILE_FIELDS } from "../src/fingerprintFields.js";

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
    const parsedUrl = new URL(calledUrl);

    expect(parsedUrl.pathname).toBe("/fbcc/user/get-open-user-list");
    expect(parsedUrl.searchParams.get("_local_api")).toBe("adspower");
    expect(parsedUrl.searchParams.get("ids")).toBe("PROFILE_ID_1");
    expect(parsedUrl.searchParams.get("page")).toBe("1");
    expect(parsedUrl.searchParams.get("page_size")).toBe("1");
    expect(parsedUrl.searchParams.get("action")).toBe("openfb");
    expect(parsedUrl.searchParams.get("fields")).toBe(
      BACKEND_PROFILE_FIELDS.join(",")
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({
        "api-key": "secret-key",
        "x-client-local-api-version": "2.0"
      })
    );
  });

  it("falls back to Local API profile list when backend settings are unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            list: [
              {
                id: "PROFILE_ID_1",
                acc_id: "604",
                name: "Local profile",
                fingerprint_config: {
                  ua: "Mozilla/5.0 Local",
                  timezone: "Asia/Shanghai"
                },
                switch_random_finger: "0"
              }
            ]
          }
        })
      } as Response);

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

    expect(result[0]).toMatchObject({
      profileId: "PROFILE_ID_1",
      name: "Local profile",
      fetchStatus: "ok"
    });
    expect(result[0].settings.ua).toBe("Mozilla/5.0 Local");
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "http://local.adspower.com:50325/api/v2/browser-profile/list"
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-key"
      },
      body: JSON.stringify({
        profile_id: ["PROFILE_ID_1"],
        page: 1,
        limit: 1
      })
    });
  });
});
