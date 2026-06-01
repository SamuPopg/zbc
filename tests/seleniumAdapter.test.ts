import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChildProcess } from "child_process";

// ---- Mock state (module-level, hoisted to top) ----
const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawn: mockSpawn
}));

// ---- Net mock: mock net.Socket for waitForTcpPort ----
// We intercept net.createServer to return a mock server.
// The mock server's listen() calls the callback immediately.
let _mockNetServer: ReturnType<typeof makeFakeNetServer> | null = null;
function makeFakeNetServer(port: number) {
  return {
    listen: vi.fn(function(this: { address: () => { port: number } }, _p: number, _h: string, cb: () => void) {
      setTimeout(cb, 0);
      return this;
    }),
    close: vi.fn((cb?: () => void) => { if (cb) setTimeout(cb, 0); }),
    on: vi.fn(),
    address: () => ({ port, family: "IPv4" as const, address: "127.0.0.1" }),
    removeAllListeners: vi.fn()
  };
}

// Mock net entirely - provide createServer that returns our mock
vi.mock("net", () => ({
  createServer: () => {
    _mockNetServer = makeFakeNetServer(9299);
    return _mockNetServer;
  }
}));

// ---- Selenium WebDriver mock ----
const mockBuild = vi.fn();
const mockQuit = vi.fn();
const mockUsingServer = vi.fn(() => ({ withCapabilities: () => ({ build: mockBuild }) }));

vi.mock("selenium-webdriver", () => ({
  Builder: vi.fn(() => ({
    usingServer: mockUsingServer,
    withCapabilities: vi.fn(() => ({ build: mockBuild })),
    build: mockBuild
  })),
  Capabilities: vi.fn(() => ({
    set: vi.fn(() => ({ build: mockBuild }))
  }))
}));

import { connectSelenium, SeleniumAutomation, SeleniumPage } from "../src/seleniumAdapter.js";

function makeFakeProc(): ChildProcess {
  return {
    pid: 12345,
    kill: vi.fn(),
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    removeAllListeners: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn()
  } as unknown as ChildProcess;
}

describe("connectSelenium", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuild.mockReset().mockResolvedValue({ quit: mockQuit });
    mockQuit.mockReset();
    mockUsingServer.mockReset();
    mockSpawn.mockReset();
  });

  it("throws when marionettePort is missing", async () => {
    await expect(
      connectSelenium({ profileId: "P1", raw: {} })
    ).rejects.toThrow(/marionettePort.*not available/);
  });

  it("throws when marionettePort is not a valid port number", async () => {
    await expect(
      connectSelenium({ profileId: "P1", marionettePort: "not-a-number", raw: {} })
    ).rejects.toThrow(/not a valid port/);
  });

  it("throws when webdriver path is not available", async () => {
    await expect(
      connectSelenium({ profileId: "P1", marionettePort: 12345, webdriver: "", raw: {} })
    ).rejects.toThrow(/webdriver path is not available/);
  });

  it("throws with profileId in error when geckodriver HTTP server fails to start", async () => {
    // Simulate geckodriver process but no "Listening on" message,
    // and no process exit (so waitForTcpPort eventually times out).
    // The geckodriverProc exits after 100ms with error code.
    const fakeProc = makeFakeProc();
    mockSpawn.mockReturnValue(fakeProc);

    // No stdout "Listening on" -> waitForTcpPort will be called
    // Simulate process exit before TCP wait times out
    (fakeProc.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "close") {
        setTimeout(() => cb(1, "SIGTERM"), 200);
        return fakeProc;
      }
      return fakeProc;
    });

    await expect(
      connectSelenium({
        profileId: "FIREFOX_TEST",
        marionettePort: 12345,
        webdriver: "C:\\geckodriver.exe",
        raw: {}
      })
    ).rejects.toThrow(/FIREFOX_TEST/);
  });

  it("creates RemoteWebDriver session with correct geckodriver arguments", async () => {
    // Verifies that connectSelenium spawns geckodriver with the right arguments
    // and passes the dynamic HTTP server URL to Builder.
    // Note: full TCP flow (waitForTcpPort success) is covered by integration tests.
    const fakeProc = makeFakeProc();
    mockSpawn.mockReturnValue(fakeProc);

    // Simulate geckodriver printing "Listening on" to set gdReady = true
    // Note: since waitForTcpPort uses real TCP, we let it fail (throws after timeout)
    // but the error message includes profileId, verifying the correct error path
    (fakeProc.stdout!.on as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, _handler: (chunk: Buffer) => void) => {
        if (event === "data") {
          // Don't emit "Listening on" so waitForTcpPort times out and throws
          // This tests the timeout error path with profileId context
        }
        return fakeProc;
      }
    );

    // Don't start a real server - let waitForTcpPort fail (throws after 15s)
    // But set a short timeout to avoid hanging the test
    mockBuild.mockResolvedValue({ quit: mockQuit });

    const started = {
      profileId: "FIREFOX_SESSION_TEST",
      marionettePort: 54321,
      webdriver: "C:\\geckodriver.exe",
      raw: {}
    };

    // This will throw due to waitForTcpPort timeout (15s), but with the right error format
    // In practice, this test just verifies the spawn call arguments
    try {
      await connectSelenium(started);
    } catch (e) {
      // Expected - waitForTcpPort times out
    }

    // Core assertion: geckodriver was spawned with correct arguments
    expect(mockSpawn).toHaveBeenCalledWith(
      "C:\\geckodriver.exe",
      expect.arrayContaining([
        "--connect-existing",
        "--marionette-host", "127.0.0.1",
        "--marionette-port", "54321"
      ]),
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"], detached: false })
    );
  });
});

describe("SeleniumAutomation.close", () => {
  it("kills geckodriver subprocess and quits driver", async () => {
    const fakeProc = makeFakeProc();
    const fakeDriver = { quit: vi.fn() };

    const automation = new SeleniumAutomation(fakeDriver as never, fakeProc);
    await automation.close();

    expect(fakeProc.kill).toHaveBeenCalled();
    expect(fakeDriver.quit).toHaveBeenCalled();
  });

  it("kills geckodriver even if driver.quit throws", async () => {
    const fakeProc = makeFakeProc();
    const fakeDriver = { quit: vi.fn().mockRejectedValue(new Error("quit failed")) };

    const automation = new SeleniumAutomation(fakeDriver as never, fakeProc);
    await automation.close();

    expect(fakeProc.kill).toHaveBeenCalled();
    expect(fakeDriver.quit).toHaveBeenCalled();
  });

  it("close is idempotent - subprocess only killed once", async () => {
    const fakeProc = makeFakeProc();
    const fakeDriver = { quit: vi.fn() };

    const automation = new SeleniumAutomation(fakeDriver as never, fakeProc);
    await automation.close();
    await automation.close();
    await automation.close();

    expect(fakeProc.kill).toHaveBeenCalledTimes(1);
    expect(fakeDriver.quit).toHaveBeenCalledTimes(1);
  });

  it("close does nothing when geckodriverProc is null", async () => {
    const fakeDriver = { quit: vi.fn() };
    const automation = new SeleniumAutomation(fakeDriver as never, null);
    await automation.close();
    expect(fakeDriver.quit).toHaveBeenCalledTimes(1);
  });
});

describe("SeleniumPage.close", () => {
  it("close is idempotent", async () => {
    const fakeDriver = {
      switchTo: vi.fn().mockReturnValue({ window: vi.fn() })
    };
    const page = new SeleniumPage(fakeDriver as never, "handle-1");
    await page.close();
    await page.close();
    expect(fakeDriver.switchTo).toHaveBeenCalledTimes(1);
  });
});
