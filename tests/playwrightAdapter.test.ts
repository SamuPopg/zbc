import { describe, expect, it, vi } from "vitest";
import { PlaywrightAutomation } from "../src/playwrightAdapter.js";

describe("PlaywrightAutomation.newPage", () => {
  it("reuses an existing CDP page instead of creating a new target", async () => {
    const existingPage = {
      goto: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      locator: vi.fn(() => ({ innerText: vi.fn(async () => "") })),
      close: vi.fn(async () => undefined)
    };
    const context = {
      pages: vi.fn(() => [existingPage]),
      newPage: vi.fn(async () => {
        throw new Error("should not create a new target");
      })
    };
    const browser = {
      contexts: vi.fn(() => [context]),
      newContext: vi.fn()
    };

    const automation = new PlaywrightAutomation(browser as never);
    const page = await automation.newPage();
    await page.goto("https://example.test", 1234);
    await page.close();

    expect(context.newPage).not.toHaveBeenCalled();
    expect(existingPage.goto).toHaveBeenCalledWith("https://example.test", {
      waitUntil: "domcontentloaded",
      timeout: 1234
    });
    expect(existingPage.close).not.toHaveBeenCalled();
  });
});
