import type { Browser, Page } from "playwright";
import type { BrowserAutomation, BrowserAutomationPage } from "./browserAutomation.js";

export class PlaywrightAutomationPage implements BrowserAutomationPage {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(url: string, timeout?: number): Promise<void> {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout
    });
  }

  async waitForNetworkIdleOrDelay(): Promise<void> {
    await this.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await this.page.waitForTimeout(3000);
  }

  async wait(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  async evaluate(script: string | ((...args: unknown[]) => unknown)): Promise<unknown> {
    if (typeof script === "function") {
      return this.page.evaluate(script);
    }
    return this.page.evaluate(script as string);
  }

  async bodyText(timeout?: number): Promise<string> {
    return this.page.locator("body").innerText({ timeout: timeout ?? 10000 }).catch(() => "");
  }

  async close(): Promise<void> {
    await this.page.close().catch(() => undefined);
  }
}

export class PlaywrightAutomation implements BrowserAutomation {
  private browser: Browser;

  constructor(browser: Browser) {
    this.browser = browser;
  }

  async newPage(): Promise<BrowserAutomationPage> {
    const context = this.browser.contexts()[0] || (await this.browser.newContext());
    const page = await context.newPage();
    return new PlaywrightAutomationPage(page);
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
  }
}