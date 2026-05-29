import { Builder, ThenableWebDriver, Capabilities } from "selenium-webdriver";
import type { BrowserAutomation, BrowserAutomationPage } from "./browserAutomation.js";
import type { LocalApiStartResponse } from "./types.js";
import { spawn, type ChildProcess } from "child_process";
import * as net from "net";

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
  private geckodriverProc: ChildProcess | null;
  private closed = false;

  constructor(driver: ThenableWebDriver, geckodriverProc: ChildProcess | null = null) {
    this.driver = driver;
    this.geckodriverProc = geckodriverProc;
  }

  async newPage(): Promise<BrowserAutomationPage> {
    const handle = await this.driver.getWindowHandle();
    return new SeleniumPage(this.driver, handle);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.geckodriverProc) {
      try {
        this.geckodriverProc.kill();
      } catch {
        // ignore
      }
    }
    try {
      await this.driver.quit();
    } catch {
      // ignore
    }
  }
}

function findGeckodriverPath(started: LocalApiStartResponse): string {
  if (started.webdriver && typeof started.webdriver === "string" && started.webdriver.length > 0) {
    return started.webdriver;
  }
  throw new Error(
    "AdsPower Firefox endpoint is not attachable: webdriver path is not available from AdsPower Local API. " +
    "wsSelenium is httpd.js (not WebDriver), and Marionette port alone cannot be used without geckodriver as a bridge. " +
    "Refusing to launch local Firefox because it would collect host fingerprints instead of profile fingerprints."
  );
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unexpected server address type"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", (err) => {
      reject(err);
    });
  });
}

async function waitForTcpPort(port: number, maxMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 200));
    const client = new net.Socket();
    try {
      await new Promise<void>((res, rej) => {
        client.connect(port, "127.0.0.1", () => { res(); client.destroy(); });
        client.on("error", () => { rej(); client.destroy(); });
      });
      return;
    } catch {
      // not ready
    }
  }
  throw new Error(`Timed out waiting for TCP port ${port} after ${maxMs}ms`);
}

export async function connectSelenium(started: LocalApiStartResponse): Promise<BrowserAutomation> {
  const profileId = started.profileId;

  const marionettePort = started.marionettePort;
  if (marionettePort === undefined) {
    throw new Error(
      `profile ${profileId}: AdsPower Firefox endpoint is not attachable: marionettePort is not available from AdsPower Local API. ` +
      "Refusing to launch local Firefox because it would collect host fingerprints instead of profile fingerprints."
    );
  }

  const portNum = typeof marionettePort === "string" ? parseInt(marionettePort, 10) : marionettePort;
  if (isNaN(portNum)) {
    throw new Error(
      `profile ${profileId}: AdsPower Firefox endpoint is not attachable: marionettePort "${marionettePort}" is not a valid port number. ` +
      "Refusing to launch local Firefox."
    );
  }

  const geckodriverPath = findGeckodriverPath(started);
  const gdHttpPort = await findAvailablePort();

  const geckodriverProc = spawn(geckodriverPath, [
    "--connect-existing",
    "--marionette-host", "127.0.0.1",
    "--marionette-port", String(portNum),
    "--port", String(gdHttpPort),
    "--log", "warn"
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });

  let procExitedEarly = false;
  let earlyExitCode: number | null = null;
  geckodriverProc.on("error", () => { procExitedEarly = true; });
  geckodriverProc.on("close", (code) => { earlyExitCode = code; });

  let geckodriverReady = false;
  geckodriverProc.stdout?.on("data", (chunk: Buffer) => {
    if (geckodriverReady) return;
    const line = chunk.toString();
    if (line.includes("Listening on")) {
      geckodriverReady = true;
    }
  });

  // Wait for geckodriver HTTP server to be ready
  try {
    await waitForTcpPort(gdHttpPort, 15000);
  } catch {
    geckodriverProc.kill();
    if (procExitedEarly) {
      throw new Error(
        `profile ${profileId}: geckodriver exited early during Marionette attach ` +
        `(marionettePort=${portNum}, exitCode=${earlyExitCode}). ` +
        "Marionette endpoint may be unreachable or AdsPower Firefox process crashed."
      );
    }
    throw new Error(
      `profile ${profileId}: geckodriver HTTP server did not start on port ${gdHttpPort} within 15000ms ` +
      `(marionettePort=${portNum}).`
    );
  }

  const caps = new Capabilities();
  caps.set("browserName", "firefox");
  caps.set("moz:firefoxOptions", {});

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let driver: ThenableWebDriver;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    driver = await new Builder()
      .usingServer(`http://127.0.0.1:${gdHttpPort}`)
      .withCapabilities(caps)
      .build() as unknown as ThenableWebDriver;
  } catch (builderErr) {
    geckodriverProc.kill();
    throw new Error(
      `profile ${profileId}: RemoteWebDriver session creation failed ` +
      `(geckodriver=http://127.0.0.1:${gdHttpPort}): ${builderErr instanceof Error ? builderErr.message : String(builderErr)}`
    );
  }

  return new SeleniumAutomation(driver, geckodriverProc);
}
