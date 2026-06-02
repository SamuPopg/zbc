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
  outputDir: "reports",
  stabilityRuns: 1,
  stabilityMode: "session" as const
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

  it("parses ws.selenium and marionette_port for Firefox profiles", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          debug_port: "8346",
          ws: { selenium: "127.0.0.1:8346" },
          marionette_port: "8345"
        }
      })
    }) as Response);

    const result = await startProfile(config, "PROFILE_ID_FIREFOX", fetchMock as unknown as typeof fetch);

    expect(result.profileId).toBe("PROFILE_ID_FIREFOX");
    expect(result.wsSelenium).toBe("127.0.0.1:8346");
    expect(result.marionettePort).toBe("8345");
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

describe("Local API request timeout", () => {
  function makeNeverResolvingFetch(): ReturnType<typeof vi.fn<FetchArgs, Promise<Response>>> {
    return vi.fn<FetchArgs, Promise<Response>>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
            return;
          }
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
        // never resolve
      });
    });
  }

  it("passes an AbortSignal to the underlying fetch", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => ({
      ok: true,
      json: async () => ({ code: 0, data: {} })
    }) as Response);

    await stopProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch);

    expect(fetchMock.mock.calls[0][1]?.signal).toBeDefined();
  });

  it("rejects with a timeout error that includes the Local API path (start)", async () => {
    const fetchMock = makeNeverResolvingFetch();
    const shortConfig = { ...config, timeoutMs: 30 };

    await expect(
      startProfile(shortConfig, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(
      /\/api\/v2\/browser-profile\/start.*timed out after 30ms/
    );
  });

  it("rejects with a timeout error that includes the Local API path (stop)", async () => {
    const fetchMock = makeNeverResolvingFetch();
    const shortConfig = { ...config, timeoutMs: 30 };

    await expect(
      stopProfile(shortConfig, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(
      /\/api\/v2\/browser-profile\/stop.*timed out after 30ms/
    );
  });

  it("rejects within roughly timeoutMs when fetch never resolves", async () => {
    const fetchMock = makeNeverResolvingFetch();
    const shortConfig = { ...config, timeoutMs: 50 };

    const start = Date.now();
    await expect(
      startProfile(shortConfig, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow();
    const elapsed = Date.now() - start;

    // Should not wait for the default 60s; abort kicks in within ~timeoutMs.
    expect(elapsed).toBeLessThan(2000);
  });

  it("includes Local API path in the HTTP failure error message", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    }) as Response);

    await expect(
      stopProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(
      /\/api\/v2\/browser-profile\/stop.*HTTP 500/
    );
  });
});

describe("Local API error path coverage", () => {
  it("wraps non-AbortError fetch rejections with the Local API path and original message (start)", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => {
      throw new Error("fetch errored");
    });

    await expect(
      startProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(
      /Local API \/api\/v2\/browser-profile\/start request failed: fetch errored/
    );
  });

  it("wraps non-AbortError fetch rejections with the Local API path and original message (stop)", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:50325");
    });

    await expect(
      stopProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(
      /Local API \/api\/v2\/browser-profile\/stop request failed: ECONNREFUSED 127\.0\.0\.1:50325/
    );
  });

  it("falls back to String() when the rejection is not an Error instance", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "string-only failure";
    });

    await expect(
      startProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(
      /Local API \/api\/v2\/browser-profile\/start request failed: string-only failure/
    );
  });

  it("includes path, code, and msg when AdsPower returns code != 0 with msg (start)", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => ({
      ok: true,
      json: async () => ({ code: 1, msg: "Profile is not open" })
    }) as Response);

    await expect(
      startProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(
      /Local API \/api\/v2\/browser-profile\/start returned code 1: Profile is not open/
    );
  });

  it("includes path, code, and msg when AdsPower returns code != 0 with msg (stop)", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => ({
      ok: true,
      json: async () => ({ code: 1, msg: "Profile is not open" })
    }) as Response);

    await expect(
      stopProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(
      /Local API \/api\/v2\/browser-profile\/stop returned code 1: Profile is not open/
    );
  });

  it("includes path and code (but not an empty msg segment) when AdsPower returns code != 0 without msg", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => ({
      ok: true,
      json: async () => ({ code: 1 })
    }) as Response);

    await expect(
      stopProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(
      /^Local API \/api\/v2\/browser-profile\/stop returned code 1$/
    );
  });

  it("preserves 'Profile is not open' substring in stop error so runner's ignore regex still matches", async () => {
    const fetchMock = vi.fn<FetchArgs, Promise<Response>>(async () => ({
      ok: true,
      json: async () => ({ code: 1, msg: "Profile is not open" })
    }) as Response);

    let caught: Error | undefined;
    try {
      await stopProfile(config, "PROFILE_ID_1", fetchMock as unknown as typeof fetch);
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeDefined();
    expect(/Profile is not open/i.test(caught!.message)).toBe(true);
  });
});
