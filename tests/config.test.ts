import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigFromFile, loadConfigFromObject } from "../src/config.js";

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

  it("trims api key read from env", () => {
    const config = loadConfigFromObject(
      {
        backendBaseUrl: "https://api.example.test/",
        localApiBaseUrl: "http://local.adspower.com:50325/",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["PROFILE_ID_1"]
      },
      { ADSPOWER_API_KEY: "  secret-key  " }
    );

    expect(config.apiKey).toBe("secret-key");
  });

  it("rejects blank api key read from env", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api.example.test",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: ["PROFILE_ID_1"]
        },
        { ADSPOWER_API_KEY: "   " }
      )
    ).toThrow("apiKey is required");
  });
});

describe("loadConfigFromFile", () => {
  it("rejects null config file root", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "fingerprint-config-"));
    const configPath = join(tempDir, "config.json");

    try {
      await writeFile(configPath, "null", "utf8");

      await expect(loadConfigFromFile(configPath)).rejects.toThrow(
        "config file must contain a JSON object"
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
