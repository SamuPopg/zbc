import { describe, expect, it } from "vitest";
import { loadConfigFromObject } from "../src/config.js";

describe("loadConfigFromObject", () => {
  it("loads required config and reads api key from env", () => {
    const config = loadConfigFromObject(
      {
        backendBaseUrl: "https://api.example.test/",
        localApiBaseUrl: "http://local.adspower.com:50325/",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["PROFILE_ID_1"]
      },
      { ADSPOWER_API_KEY: "secret-key" }
    );

    expect(config.backendBaseUrl).toBe("https://api.example.test");
    expect(config.localApiBaseUrl).toBe("http://local.adspower.com:50325");
    expect(config.apiKey).toBe("secret-key");
    expect(config.closeAfterRun).toBe(true);
    expect(config.runMode).toBe("sequential");
  });

  it("rejects empty profile id list", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api.example.test",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: []
        },
        { ADSPOWER_API_KEY: "secret-key" }
      )
    ).toThrow("profileIds must contain at least one profile id");
  });

  it("rejects missing api key", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api.example.test",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: ["PROFILE_ID_1"]
        },
        {}
      )
    ).toThrow("apiKey is required");
  });
});
