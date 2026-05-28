import { chromium, type Browser } from "playwright";
import { connectSelenium } from "./seleniumAdapter.js";
import type { LocalApiStartResponse, ProfileSettings } from "./types.js";
import type { BrowserAutomation } from "./browserAutomation.js";

export type BrowserType = "chromium" | "firefox" | "unknown";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface BrowserConnectOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

const DEFAULT_CONNECT_MAX_ATTEMPTS = 30;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function detectBrowserType(settings: ProfileSettings): BrowserType {
  const s = settings.settings;
  const browser = s?.browser as string | undefined;
  const browserKernelConfig = isRecord(s?.browser_kernel_config) ? s.browser_kernel_config : undefined;
  const type = browserKernelConfig?.type as string | undefined;

  if (browser === "firefox" || type === "firefox") {
    return "firefox";
  }
  if (browser === "chromium" || browser === "chrome" || type === "chromium" || type === "chrome") {
    return "chromium";
  }
  return "unknown";
}

export async function connectToStartedBrowser(
  started: LocalApiStartResponse,
  options: BrowserConnectOptions = {}
): Promise<Browser> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_CONNECT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_CONNECT_RETRY_DELAY_MS;

  let lastWsError: unknown;
  let lastDebugPortError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (started.wsPuppeteer) {
      try {
        return await chromium.connectOverCDP(started.wsPuppeteer);
      } catch (error) {
        lastWsError = error;
      }
    }

    if (started.debugPort) {
      try {
        return await chromium.connectOverCDP(`http://127.0.0.1:${started.debugPort}`);
      } catch (error) {
        lastDebugPortError = error;
      }
    }

    if (attempt < maxAttempts && retryDelayMs > 0) {
      await wait(retryDelayMs);
    }
  }

  const wsErrMsg = lastWsError ? errorMessage(lastWsError) : "unknown";
  const debugErrMsg = lastDebugPortError ? errorMessage(lastDebugPortError) : "unknown";

  const wsPart = started.wsPuppeteer
    ? `wsPuppeteer: ${wsErrMsg}`
    : "no wsPuppeteer";
  const debugPart = started.debugPort
    ? `debugPort fallback failed: ${debugErrMsg}`
    : "no debugPort fallback";

  throw new Error(
    `profile ${started.profileId} failed to connect after ${maxAttempts} attempt(s) with ${wsPart}; ${debugPart}`
  );
}

export async function connectAutomation(
  started: LocalApiStartResponse,
  settings: ProfileSettings,
  options: BrowserConnectOptions = {}
): Promise<BrowserAutomation> {
  const browserType = detectBrowserType(settings);

  if (browserType === "firefox") {
    return connectSelenium(started);
  }

  const browser = await connectToStartedBrowser(started, options);
  const { PlaywrightAutomation } = await import("./playwrightAdapter.js");
  return new PlaywrightAutomation(browser);
}