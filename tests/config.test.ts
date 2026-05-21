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
    expect(config.stabilityRuns).toBe(1);
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

  it("defaults stabilityRuns to 1 when not configured", () => {
    const config = loadConfigFromObject(
      {
        backendBaseUrl: "https://api.example.test",
        localApiBaseUrl: "http://local.adspower.com:50325",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["PROFILE_ID_1"]
      },
      { ADSPOWER_API_KEY: "secret-key" }
    );
    expect(config.stabilityRuns).toBe(1);
  });

  it("accepts stabilityRuns: 2", () => {
    const config = loadConfigFromObject(
      {
        backendBaseUrl: "https://api.example.test",
        localApiBaseUrl: "http://local.adspower.com:50325",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["PROFILE_ID_1"],
        stabilityRuns: 2
      },
      { ADSPOWER_API_KEY: "secret-key" }
    );
    expect(config.stabilityRuns).toBe(2);
  });

  it("rejects stabilityRuns: 0", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api.example.test",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: ["PROFILE_ID_1"],
          stabilityRuns: 0
        },
        { ADSPOWER_API_KEY: "secret-key" }
      )
    ).toThrow("stabilityRuns must be an integer between 1 and 5");
  });

  it("rejects stabilityRuns: 6", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api.example.test",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: ["PROFILE_ID_1"],
          stabilityRuns: 6
        },
        { ADSPOWER_API_KEY: "secret-key" }
      )
    ).toThrow("stabilityRuns must be an integer between 1 and 5");
  });

  it("rejects stabilityRuns: 1.5", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api.example.test",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: ["PROFILE_ID_1"],
          stabilityRuns: 1.5
        },
        { ADSPOWER_API_KEY: "secret-key" }
      )
    ).toThrow("stabilityRuns must be an integer between 1 and 5");
  });

  it("defaults stabilityMode to session when not configured", () => {
    const config = loadConfigFromObject(
      {
        backendBaseUrl: "https://api.example.test",
        localApiBaseUrl: "http://local.adspower.com:50325",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["PROFILE_ID_1"]
      },
      { ADSPOWER_API_KEY: "secret-key" }
    );
    expect(config.stabilityMode).toBe("session");
  });

  it("accepts stabilityMode: session", () => {
    const config = loadConfigFromObject(
      {
        backendBaseUrl: "https://api.example.test",
        localApiBaseUrl: "http://local.adspower.com:50325",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["PROFILE_ID_1"],
        stabilityMode: "session"
      },
      { ADSPOWER_API_KEY: "secret-key" }
    );
    expect(config.stabilityMode).toBe("session");
  });

  it("accepts stabilityMode: restart", () => {
    const config = loadConfigFromObject(
      {
        backendBaseUrl: "https://api.example.test",
        localApiBaseUrl: "http://local.adspower.com:50325",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["PROFILE_ID_1"],
        stabilityMode: "restart"
      },
      { ADSPOWER_API_KEY: "secret-key" }
    );
    expect(config.stabilityMode).toBe("restart");
  });

  it("rejects stabilityMode: cold", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api.example.test",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: ["PROFILE_ID_1"],
          stabilityMode: "cold"
        },
        { ADSPOWER_API_KEY: "secret-key" }
      )
    ).toThrow('stabilityMode must be "session" or "restart"');
  });

  it("rejects stabilityMode restart with stabilityRuns 2 and closeAfterRun false", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api.example.test",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: ["PROFILE_ID_1"],
          stabilityMode: "restart",
          stabilityRuns: 2,
          closeAfterRun: false
        },
        { ADSPOWER_API_KEY: "secret-key" }
      )
    ).toThrow(
      "stabilityMode restart requires closeAfterRun=true when stabilityRuns > 1"
    );
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
