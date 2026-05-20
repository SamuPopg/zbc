import { chromium, Browser } from "playwright";
import { LocalApiStartResponse } from "./types.js";

export async function connectToStartedBrowser(
  started: LocalApiStartResponse
): Promise<Browser> {
  if (started.wsPuppeteer) {
    return chromium.connectOverCDP(started.wsPuppeteer);
  }

  if (started.debugPort) {
    return chromium.connectOverCDP(`http://127.0.0.1:${started.debugPort}`);
  }

  throw new Error(`profile ${started.profileId} did not return debug connection info`);
}
