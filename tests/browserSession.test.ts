import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectToStartedBrowser, connectAutomation, detectBrowserType } from "../src/browserSession.js";
import type { ProfileSettings } from "../src/types.js";

const { connectOverCDP } = vi.hoisted(() => ({
  connectOverCDP: vi.fn()
}));

const { connectSeleniumMock } = vi.hoisted(() => ({
  connectSeleniumMock: vi.fn()
}));

vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP
  }
}));

vi.mock("../src/seleniumAdapter.js", () => ({
  connectSelenium: (...args: unknown[]) => connectSeleniumMock(...args)
}));

function settings(browser: string, kernelType?: string): ProfileSettings {
  return {
    profileId: "TEST",
    settings: {
      ...(kernelType ? { browser_kernel_config: { type: kernelType } } : { browser }),
      randomFinger: false
    },
    randomFingerprintEnabled: false,
    fetchStatus: "ok"
  };
}

describe("connectToStartedBrowser", () => {
  beforeEach(() => {
    connectOverCDP.mockReset();
  });

  it("falls back to debugPort when wsPuppeteer connection fails", async () => {
    const browser = {};
    connectOverCDP
      .mockRejectedValueOnce(new Error("ws refused"))
      .mockResolvedValueOnce(browser);

    const result = await connectToStartedBrowser(
      {
        profileId: "PROFILE_ID_1",
        wsPuppeteer: "ws://127.0.0.1:53210/devtools/browser/abc",
        debugPort: "53210",
        raw: {}
      },
      { maxAttempts: 1, retryDelayMs: 0 }
    );

    expect(result).toBe(browser);
    expect(connectOverCDP).toHaveBeenCalledTimes(2);
    expect(connectOverCDP).toHaveBeenNthCalledWith(
      1,
      "ws://127.0.0.1:53210/devtools/browser/abc"
    );
    expect(connectOverCDP).toHaveBeenNthCalledWith(2, "http://127.0.0.1:53210");
  });

  it("includes profileId and ws error when all connection attempts fail", async () => {
    connectOverCDP
      .mockRejectedValueOnce(new Error("ws refused"))
      .mockRejectedValueOnce(new Error("port refused"));

    await expect(
      connectToStartedBrowser(
        {
          profileId: "PROFILE_ID_1",
          wsPuppeteer: "ws://127.0.0.1:53210/devtools/browser/abc",
          debugPort: "53210",
          raw: {}
        },
        { maxAttempts: 1, retryDelayMs: 0 }
      )
    ).rejects.toThrow(/PROFILE_ID_1.*ws refused/);
  });

  it("retries wsPuppeteer and debugPort until the CDP endpoint is ready", async () => {
    const browser = {};
    connectOverCDP
      .mockRejectedValueOnce(new Error("ws refused 1"))
      .mockRejectedValueOnce(new Error("port refused 1"))
      .mockRejectedValueOnce(new Error("ws refused 2"))
      .mockResolvedValueOnce(browser);

    const result = await connectToStartedBrowser(
      {
        profileId: "PROFILE_ID_1",
        wsPuppeteer: "ws://127.0.0.1:53210/devtools/browser/abc",
        debugPort: "53210",
        raw: {}
      },
      { maxAttempts: 2, retryDelayMs: 0 }
    );

    expect(result).toBe(browser);
    expect(connectOverCDP).toHaveBeenCalledTimes(4);
    expect(connectOverCDP).toHaveBeenNthCalledWith(
      1,
      "ws://127.0.0.1:53210/devtools/browser/abc"
    );
    expect(connectOverCDP).toHaveBeenNthCalledWith(2, "http://127.0.0.1:53210");
    expect(connectOverCDP).toHaveBeenNthCalledWith(
      3,
      "ws://127.0.0.1:53210/devtools/browser/abc"
    );
    expect(connectOverCDP).toHaveBeenNthCalledWith(4, "http://127.0.0.1:53210");
  });

  it("reports attempt count when all attempts exhaust", async () => {
    connectOverCDP
      .mockRejectedValueOnce(new Error("ws refused 1"))
      .mockRejectedValueOnce(new Error("port refused 1"))
      .mockRejectedValueOnce(new Error("ws refused 2"))
      .mockRejectedValueOnce(new Error("port refused 2"));

    await expect(
      connectToStartedBrowser(
        {
          profileId: "PROFILE_ID_1",
          wsPuppeteer: "ws://127.0.0.1:53210/devtools/browser/abc",
          debugPort: "53210",
          raw: {}
        },
        { maxAttempts: 2, retryDelayMs: 0 }
      )
    ).rejects.toThrow(/after 2 attempt\(s\)/);
  });

  it("still retries when only wsPuppeteer is available", async () => {
    const browser = {};
    connectOverCDP
      .mockRejectedValueOnce(new Error("ws refused 1"))
      .mockRejectedValueOnce(new Error("ws refused 2"))
      .mockResolvedValueOnce(browser);

    const result = await connectToStartedBrowser(
      {
        profileId: "PROFILE_ID_2",
        wsPuppeteer: "ws://127.0.0.1:53210/devtools/browser/abc",
        raw: {}
      },
      { maxAttempts: 3, retryDelayMs: 0 }
    );

    expect(result).toBe(browser);
    expect(connectOverCDP).toHaveBeenCalledTimes(3);
  });
});

describe("detectBrowserType", () => {
  it("returns firefox when settings.browser is firefox", () => {
    expect(detectBrowserType(settings("firefox"))).toBe("firefox");
  });

  it("returns firefox when browser_kernel_config.type is firefox", () => {
    expect(detectBrowserType(settings("chromium", "firefox"))).toBe("firefox");
  });

  it("returns chromium when settings.browser is chromium", () => {
    expect(detectBrowserType(settings("chromium"))).toBe("chromium");
  });

  it("returns chromium when settings.browser is chrome", () => {
    expect(detectBrowserType(settings("chrome"))).toBe("chromium");
  });

  it("returns chromium when browser_kernel_config.type is chromium", () => {
    expect(detectBrowserType(settings("firefox", "chromium"))).toBe("chromium");
  });

  it("returns unknown for unrecognized browser type", () => {
    expect(detectBrowserType(settings("safari"))).toBe("unknown");
  });
});

describe("connectAutomation", () => {
  beforeEach(() => {
    connectOverCDP.mockReset();
    connectSeleniumMock.mockReset();
  });

  it("calls connectSelenium when browser type is firefox", async () => {
    connectSeleniumMock.mockResolvedValueOnce({ close: vi.fn() });

    const started = {
      profileId: "FIREFOX_PROFILE",
      wsSelenium: "127.0.0.1:8346",
      marionettePort: "8345",
      raw: {}
    };
    const s = settings("firefox");

    await connectAutomation(started, s);

    expect(connectSeleniumMock).toHaveBeenCalledWith(started);
  });

  it("propagates error from connectSelenium when Firefox profile lacks both wsSelenium and marionettePort", async () => {
    connectSeleniumMock.mockRejectedValueOnce(
      new Error("Firefox profile requires ws.selenium or marionettePort from AdsPower Local API")
    );

    const started = {
      profileId: "FIREFOX_NO_WS",
      raw: {}
    };
    const s = settings("firefox");

    await expect(connectAutomation(started, s)).rejects.toThrow(/ws\.selenium|marionettePort/);
  });
});