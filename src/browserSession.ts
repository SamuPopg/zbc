import { chromium, type Browser } from "playwright";
import type { LocalApiStartResponse } from "./types.js";

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