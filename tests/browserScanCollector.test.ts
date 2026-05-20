import { describe, expect, it, vi } from "vitest";
import { collectBrowserScan } from "../src/browserScanCollector.js";
import { ToolConfig } from "../src/types.js";

const config: ToolConfig = {
  backendBaseUrl: "https://api.example.test",
  localApiBaseUrl: "http://local.adspower.com:50325",
  apiKey: "secret-key",
  browserScanUrl: "https://www.browserscan.net/",
  profileIds: ["PROFILE_ID_1"],
  closeAfterRun: true,
  runMode: "sequential",
  timeoutMs: 60000,
  outputDir: "reports"
};

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BROWSER_SCAN_CHARS =
  "hTy1bfRJz4nLPcBCO7WtmNIaGvVeul5Zo8kq32UxrYw_-0gsjp96SDFXQiEMKdHA";

function encodeBrowserScanPayload(value: unknown): string {
  const base64 = Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  return base64
    .split("")
    .map((char) => {
      const index = BASE64_CHARS.indexOf(char);
      return index < 0 ? char : BROWSER_SCAN_CHARS[index];
    })
    .join("");
}

describe("collectBrowserScan", () => {
  it("uses a dedicated page, keeps runtime probe out of BS values, and closes only the page", async () => {
    const rawText = "x".repeat(20005);
    const existingPage = {
      goto: vi.fn()
    };
    const collectionPage = {
      goto: vi.fn(),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        innerText: vi.fn(async () => rawText)
      })),
      evaluate: vi.fn(async (fn: unknown) => {
        if (String(fn).includes("_getComponent")) {
          return null;
        }

        return {
          ua: "test ua",
          dpr: 2,
          device_pixel_ratio: 2
        };
      }),
      close: vi.fn(async () => undefined)
    };
    const context = {
      pages: vi.fn(() => [existingPage]),
      newPage: vi.fn(async () => collectionPage)
    };
    const browser = {
      contexts: vi.fn(() => [context]),
      newContext: vi.fn()
    };

    const result = await collectBrowserScan(config, "PROFILE_ID_1", browser as never);

    expect(result.status).toBe("ok");
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(existingPage.goto).not.toHaveBeenCalled();
    expect(collectionPage.goto).toHaveBeenCalledWith(config.browserScanUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });
    expect(collectionPage.close).toHaveBeenCalledTimes(1);
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(result.rawText).toHaveLength(20000);
    expect(result.values.browser_scan_raw_text.value).toBe(result.rawText);
    expect(result.values.dpr).toBeUndefined();
    expect(result.probe?.values.dpr).toEqual({ value: 2, source: "probe" });
    expect(result.probe?.raw).toMatchObject({
      ua: "test ua",
      dpr: 2
    });
    expect(collectionPage.evaluate).toHaveBeenCalledWith(
      expect.stringContaining("AdsPower probe")
    );
  });

  it("maps BrowserScan component snapshot values into report fingerprint fields", async () => {
    const snapshot = {
      allComplete: true,
      webrtc: {
        stun: "203.0.113.10",
        udp: "disabled"
      },
      hardware: {
        canvasHash: "canvas-hash",
        webGLHash: "webgl-image-hash",
        webGLReportHash: "webgl-report-hash",
        webGLUnmaskedVendor: "Google Inc.",
        webGLUnmaskedRenderer: "ANGLE Renderer",
        audioHash: "audio-hash",
        clientRectHash: "client-rect-hash",
        webGPUHash: "webgpu-hash",
        webGPU: {
          adapters: [{ vendor: "intel", architecture: "gen-12" }]
        }
      },
      software: {
        fontsHash: "fonts-hash",
        fontsList: ["Arial", "Calibri"],
        doNotTrack: "1",
        webdriver: false
      },
      ipdata: {
        ip: "198.51.100.20",
        ua: "header ua",
        language: "en-US",
        timezone: "America/New_York",
        longitude: "-73.99",
        latitude: "40.72"
      },
      httpFP: {
        ja3_hash: "ja3-hash",
        ja4: "ja4-value",
        tls_fp_hash: "tls-fp-hash"
      }
    };
    const encodedSnapshot = encodeBrowserScanPayload(snapshot);
    const collectionPage = {
      goto: vi.fn(),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        innerText: vi.fn(async () => "BrowserScan text")
      })),
      evaluate: vi.fn(async (fn: unknown) => {
        if (String(fn).includes("_getComponent")) {
          return encodedSnapshot;
        }

        return {
          ua: "runtime ua",
          dpr: 2,
          device_pixel_ratio: 2
        };
      }),
      close: vi.fn(async () => undefined)
    };
    const context = {
      newPage: vi.fn(async () => collectionPage)
    };
    const browser = {
      contexts: vi.fn(() => [context]),
      newContext: vi.fn()
    };

    const result = await collectBrowserScan(config, "PROFILE_ID_1", browser as never);

    expect(result.status).toBe("ok");
    expect(result.values.webrtc).toEqual({
      value: { stun: "203.0.113.10", udp: "disabled" },
      source: "dom",
      note: "BrowserScan _getComponent snapshot"
    });
    expect(result.values.canvas.value).toBe("canvas-hash");
    expect(result.values.webgl.value).toBe("webgl-report-hash");
    expect(result.values.webgl_image.value).toBe("webgl-image-hash");
    expect(result.values.webgl_config.value).toEqual({
      unmaskedVendor: "Google Inc.",
      unmaskedRenderer: "ANGLE Renderer"
    });
    expect(result.values.audio.value).toBe("audio-hash");
    expect(result.values.fonts.value).toEqual({
      hash: "fonts-hash",
      count: 2,
      sample: ["Arial", "Calibri"]
    });
    expect(result.values.client_rects.value).toBe("client-rect-hash");
    expect(result.values.gpu.value).toEqual({
      hash: "webgpu-hash",
      webGPU: snapshot.hardware.webGPU
    });
    expect(result.values.tls.value).toEqual(snapshot.httpFP);
    expect(result.values.ip.value).toBe("198.51.100.20");
    expect(result.values.language.value).toBe("en-US");
    expect(result.values.timezone.value).toBe("America/New_York");
  });

  it("keeps BrowserScan snapshot values when runtime probe evaluation fails", async () => {
    const encodedSnapshot = encodeBrowserScanPayload({
      allComplete: true,
      hardware: {
        canvasHash: "browser-scan-canvas-hash"
      }
    });
    const collectionPage = {
      goto: vi.fn(),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        innerText: vi.fn(async () => "BrowserScan text")
      })),
      evaluate: vi.fn(async (fn: unknown) => {
        if (String(fn).includes("_getComponent")) {
          return encodedSnapshot;
        }

        throw new Error("__name is not defined");
      }),
      close: vi.fn(async () => undefined)
    };
    const context = {
      newPage: vi.fn(async () => collectionPage)
    };
    const browser = {
      contexts: vi.fn(() => [context]),
      newContext: vi.fn()
    };

    const result = await collectBrowserScan(config, "PROFILE_ID_1", browser as never);

    expect(result.status).toBe("ok");
    expect(result.values.canvas).toEqual({
      value: "browser-scan-canvas-hash",
      source: "dom",
      note: "BrowserScan _getComponent snapshot"
    });
    expect(result.probe?.error).toContain("__name is not defined");
  });
});
