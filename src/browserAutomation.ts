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