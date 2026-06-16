import { chromium, type Browser } from "playwright";
import { connectNativeCdp } from "./nativeCdpAdapter.js";
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
  connectTimeoutMs?: number;
  overallTimeoutMs?: number;
  nativeCdpFallback?: boolean;
}

const DEFAULT_CONNECT_MAX_ATTEMPTS = 30;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1000;
const DEFAULT_CONNECT_TIMEOUT_MS = 8000;
const DEFAULT_CONNECT_OVERALL_TIMEOUT_MS = 30000;

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
  if (!started.wsPuppeteer && !started.debugPort) {
    throw new Error(
      `profile ${started.profileId} has no wsPuppeteer and no debugPort; cannot connect over CDP`
    );
  }

  const maxAttempts = options.maxAttempts ?? DEFAULT_CONNECT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_CONNECT_RETRY_DELAY_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const overallTimeoutMs = options.overallTimeoutMs ?? DEFAULT_CONNECT_OVERALL_TIMEOUT_MS;
  const deadline = Date.now() + overallTimeoutMs;

  let lastWsError: unknown;
  let lastDebugPortError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remainingBeforeAttempt = deadline - Date.now();
    if (remainingBeforeAttempt <= 0) {
      break;
    }
    const attemptTimeoutMs = Math.max(1, Math.min(connectTimeoutMs, remainingBeforeAttempt));

    if (started.wsPuppeteer) {
      try {
        return await chromium.connectOverCDP(started.wsPuppeteer, {
          timeout: attemptTimeoutMs
        });
      } catch (error) {
        lastWsError = error;
      }
    }

    const remainingBeforeDebugFallback = deadline - Date.now();
    if (remainingBeforeDebugFallback <= 0) {
      break;
    }
    const debugFallbackTimeoutMs = Math.max(
      1,
      Math.min(connectTimeoutMs, remainingBeforeDebugFallback)
    );

    if (started.debugPort) {
      try {
        return await chromium.connectOverCDP(`http://127.0.0.1:${started.debugPort}`, {
          timeout: debugFallbackTimeoutMs
        });
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
    `profile ${started.profileId} failed to connect after ${maxAttempts} attempt(s) or ${overallTimeoutMs}ms with ${wsPart}; ${debugPart}`
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

  try {
    const browser = await connectToStartedBrowser(started, options);
    const { PlaywrightAutomation } = await import("./playwrightAdapter.js");
    return new PlaywrightAutomation(browser);
  } catch (playwrightError) {
    if (options.nativeCdpFallback === false) {
      throw playwrightError;
    }
    try {
      return await connectNativeCdp(started, {
        connectTimeoutMs: options.connectTimeoutMs,
        commandTimeoutMs: options.connectTimeoutMs
      });
    } catch (nativeError) {
      throw new Error(
        `profile ${started.profileId} failed to connect with Playwright CDP and native CDP fallback; ` +
        `playwright: ${errorMessage(playwrightError)}; native: ${errorMessage(nativeError)}`
      );
    }
  }
}
