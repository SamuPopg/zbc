import type { BrowserScanResult, BrowserScanValue, ToolConfig } from "./types.js";
import type { Browser, Page } from "playwright";

function runtimeValue(value: unknown): BrowserScanValue {
  return { value, source: "runtime" };
}

async function collectRuntimeValues(page: Page): Promise<Record<string, BrowserScanValue>> {
  const runtime = await page.evaluate(() => {
    const nav = window.navigator as Navigator & {
      deviceMemory?: number;
      webdriver?: boolean;
    };

    return {
      ua: nav.userAgent,
      language: nav.language,
      languages: nav.languages,
      platform: nav.platform,
      hardware_concurrency: nav.hardwareConcurrency,
      device_memory: nav.deviceMemory,
      webdriver: nav.webdriver,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen_resolution: `${window.screen.width}x${window.screen.height}`,
      screen_available_resolution: `${window.screen.availWidth}x${window.screen.availHeight}`,
      color_depth: window.screen.colorDepth,
      dpr: window.devicePixelRatio,
      device_pixel_ratio: window.devicePixelRatio
    };
  });

  return Object.fromEntries(
    Object.entries(runtime).map(([key, value]) => [key, runtimeValue(value)])
  );
}

async function collectVisibleText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
}

export async function collectBrowserScan(
  config: ToolConfig,
  profileId: string,
  browser: Browser
): Promise<BrowserScanResult> {
  let page: Page | undefined;

  try {
    const context = browser.contexts()[0] || (await browser.newContext());
    page = await context.newPage();

    await page.goto(config.browserScanUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const rawText = await collectVisibleText(page);
    const truncatedText = rawText.slice(0, 20000);
    const values = await collectRuntimeValues(page);

    values.browser_scan_raw_text = {
      value: truncatedText,
      source: "dom",
      note: "BrowserScan visible text snapshot truncated to 20000 characters"
    };

    return {
      profileId,
      values,
      rawText: truncatedText,
      status: "ok"
    };
  } catch (error) {
    return {
      profileId,
      values: {},
      rawText: "",
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await page?.close().catch(() => undefined);
  }
}
