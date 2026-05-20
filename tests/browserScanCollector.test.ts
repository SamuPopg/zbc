import { describe, expect, it, vi } from "vitest";
import { collectBrowserScan } from "../src/browserScanCollector.js";
import { ToolConfig } from "../src/types.js";

const config: ToolConfig = {
  backendBaseUrl: "https://api.example.test",
  localApiBaseUrl: "http://local.adspower.com:50325",
  apiKey: "secret-key",
  browserScanUrl: "https://www.browserscan.net/",
  profileIds: ["PROFILE_ID_1"],
  closeAfterRun: true,
  runMode: "sequential",
  timeoutMs: 60000,
  outputDir: "reports"
};

describe("collectBrowserScan", () => {
  it("uses a dedicated page, truncates rawText, records dpr, and closes only the page", async () => {
    const rawText = "x".repeat(20005);
    const existingPage = {
      goto: vi.fn()
    };
    const collectionPage = {
      goto: vi.fn(),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        innerText: vi.fn(async () => rawText)
      })),
      evaluate: vi.fn(async () => ({
        ua: "test ua",
        dpr: 2,
        device_pixel_ratio: 2
      })),
      close: vi.fn(async () => undefined)
    };
    const context = {
      pages: vi.fn(() => [existingPage]),
      newPage: vi.fn(async () => collectionPage)
    };
    const browser = {
      contexts: vi.fn(() => [context]),
      newContext: vi.fn()
    };

    const result = await collectBrowserScan(config, "PROFILE_ID_1", browser as never);

    expect(result.status).toBe("ok");
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(existingPage.goto).not.toHaveBeenCalled();
    expect(collectionPage.goto).toHaveBeenCalledWith(config.browserScanUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });
    expect(collectionPage.close).toHaveBeenCalledTimes(1);
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(result.rawText).toHaveLength(20000);
    expect(result.values.browser_scan_raw_text.value).toBe(result.rawText);
    expect(result.values.dpr).toEqual({ value: 2, source: "runtime" });
  });
});
