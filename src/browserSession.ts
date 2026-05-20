import { chromium, type Browser } from "playwright";
import type { LocalApiStartResponse } from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function connectToStartedBrowser(
  started: LocalApiStartResponse
): Promise<Browser> {
  let wsError: unknown;

  if (started.wsPuppeteer) {
    try {
      return await chromium.connectOverCDP(started.wsPuppeteer);
    } catch (error) {
      wsError = error;
    }
  }

  if (started.debugPort) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${started.debugPort}`);
    } catch (debugPortError) {
      if (wsError) {
        throw new Error(
          `profile ${started.profileId} failed to connect with wsPuppeteer: ${errorMessage(
            wsError
          )}; debugPort fallback failed: ${errorMessage(debugPortError)}`
        );
      }

      throw new Error(
        `profile ${started.profileId} failed to connect with debugPort: ${errorMessage(
          debugPortError
        )}`
      );
    }
  }

  if (wsError) {
    throw new Error(
      `profile ${started.profileId} failed to connect with wsPuppeteer: ${errorMessage(wsError)}`
    );
  }

  throw new Error(`profile ${started.profileId} did not return debug connection info`);
}
