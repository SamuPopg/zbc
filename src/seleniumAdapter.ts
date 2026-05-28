import { Builder, ThenableWebDriver, Capabilities } from "selenium-webdriver";
import type { BrowserAutomation, BrowserAutomationPage } from "./browserAutomation.js";
import type { LocalApiStartResponse } from "./types.js";

export class SeleniumPage implements BrowserAutomationPage {
  private driver: ThenableWebDriver;
  private windowHandle: string;
  private closed = false;

  constructor(driver: ThenableWebDriver, windowHandle: string) {
    this.driver = driver;
    this.windowHandle = windowHandle;
  }

  async goto(url: string, timeout?: number): Promise<void> {
    await this.driver.get(url);
    if (timeout !== undefined) {
      await this.driver.sleep(timeout);
    }
  }

  async waitForNetworkIdleOrDelay(): Promise<void> {
    try {
      await this.driver.wait(
        async () => {
          const state = await this.driver.executeScript(() => document.readyState);
          return state === "complete";
        },
        5000
      );
    } catch {
      // fallthrough
    }
    await this.driver.sleep(3000);
  }

  async wait(ms: number): Promise<void> {
    await this.driver.sleep(ms);
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.driver.sleep(ms);
  }

  async evaluate(script: string | ((...args: unknown[]) => unknown)): Promise<unknown> {
    if (typeof script === "function") {
      return this.driver.executeScript(script);
    }
    const asyncScript =
      "const cb = arguments[arguments.length - 1]; (" +
      script +
      ").then(cb).catch(e => cb({error: e.message}));";
    return this.driver.executeAsyncScript(asyncScript);
  }

  async bodyText(_timeout?: number): Promise<string> {
    try {
      const body = await this.driver.findElement({ tagName: "body" });
      return await body.getText();
    } catch {
      return "";
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.driver.switchTo().window(this.windowHandle);
    } catch {
      // ignore
    }
  }
}

export class SeleniumAutomation implements BrowserAutomation {
  private driver: ThenableWebDriver;

  constructor(driver: ThenableWebDriver) {
    this.driver = driver;
  }

  async newPage(): Promise<BrowserAutomationPage> {
    const handle = await this.driver.getWindowHandle();
    return new SeleniumPage(this.driver, handle);
  }

  async close(): Promise<void> {
    try {
      await this.driver.quit();
    } catch {
      // ignore
    }
  }
}

export async function connectSelenium(started: LocalApiStartResponse): Promise<BrowserAutomation> {
  const wsSelenium = started.wsSelenium;
  if (!wsSelenium && !started.marionettePort) {
    throw new Error(
      "Firefox profile requires ws.selenium or marionettePort from AdsPower Local API"
    );
  }

  const caps = new Capabilities();
  caps.set("browserName", "firefox");

  const port = started.marionettePort !== undefined
    ? (typeof started.marionettePort === "string" ? parseInt(started.marionettePort, 10) : started.marionettePort)
    : (() => { throw new Error("Firefox profile requires marionettePort"); })();

  caps.set("moz:firefoxOptions", {
    args: [`-marionette-port ${port}`]
  });

  const builder = new Builder().withCapabilities(caps);
  const driver = builder.build();
  return new SeleniumAutomation(driver as ThenableWebDriver);
}