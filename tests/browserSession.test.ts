import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectToStartedBrowser } from "../src/browserSession.js";

const { connectOverCDP } = vi.hoisted(() => ({
  connectOverCDP: vi.fn()
}));

vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP
  }
}));

describe("connectToStartedBrowser", () => {
  beforeEach(() => {
    connectOverCDP.mockReset();
  });

  it("falls back to debugPort when wsPuppeteer connection fails", async () => {
    const browser = {};
    connectOverCDP
      .mockRejectedValueOnce(new Error("ws refused"))
      .mockResolvedValueOnce(browser);

    const result = await connectToStartedBrowser({
      profileId: "PROFILE_ID_1",
      wsPuppeteer: "ws://127.0.0.1:53210/devtools/browser/abc",
      debugPort: "53210",
      raw: {}
    });

    expect(result).toBe(browser);
    expect(connectOverCDP).toHaveBeenCalledTimes(2);
    expect(connectOverCDP).toHaveBeenNthCalledWith(
      1,
      "ws://127.0.0.1:53210/devtools/browser/abc"
    );
    expect(connectOverCDP).toHaveBeenNthCalledWith(2, "http://127.0.0.1:53210");
  });

  it("includes profileId and ws error when all connection attempts fail", async () => {
    connectOverCDP
      .mockRejectedValueOnce(new Error("ws refused"))
      .mockRejectedValueOnce(new Error("port refused"));

    await expect(
      connectToStartedBrowser({
        profileId: "PROFILE_ID_1",
        wsPuppeteer: "ws://127.0.0.1:53210/devtools/browser/abc",
        debugPort: "53210",
        raw: {}
      })
    ).rejects.toThrow(/PROFILE_ID_1.*ws refused/);
  });
});
