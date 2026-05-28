export interface BrowserAutomationPage {
  goto(url: string, timeout?: number): Promise<void>;
  waitForNetworkIdleOrDelay(): Promise<void>;
  wait(ms: number): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(script: string | ((...args: unknown[]) => unknown)): Promise<unknown>;
  bodyText(timeout?: number): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserAutomation {
  newPage(): Promise<BrowserAutomationPage>;
  close(): Promise<void>;
}

export function isPlaywrightBrowser(browser: unknown): browser is { contexts(): Array<{ newPage(): Promise<unknown> }>; close(): Promise<void> } {
  if (browser === null || typeof browser !== "object") return false;
  if ("contexts" in browser && typeof (browser as Record<string, unknown>).contexts === "function") return true;
  return false;
}