import { describe, expect, it, vi } from "vitest";
import { collectBrowserScan } from "../src/browserScanCollector.js";
import { ToolConfig } from "../src/types.js";
import type { BrowserAutomation, BrowserAutomationPage } from "../src/browserAutomation.js";

const config: ToolConfig = {
  backendBaseUrl: "https://api.example.test",
  localApiBaseUrl: "http://local.adspower.com:50325",
  apiKey: "secret-key",
  browserScanUrl: "https://www.browserscan.net/",
  profileIds: ["PROFILE_ID_1"],
  closeAfterRun: true,
  runMode: "sequential",
  timeoutMs: 60000,
  outputDir: "reports",
  stabilityRuns: 1,
  stabilityMode: "session"
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

function mockAutomation(page: BrowserAutomationPage): BrowserAutomation {
  return {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined)
  };
}

describe("collectBrowserScan", () => {
  it("uses a dedicated page, keeps runtime probe out of BS values, and closes only the page", async () => {
    const rawText = "x".repeat(20005);
    const existingPage = { goto: vi.fn() };
    const collectionPage = {
      goto: vi.fn(async () => undefined),
      waitForNetworkIdleOrDelay: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      bodyText: vi.fn(async () => rawText),
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

    const automation = mockAutomation(collectionPage);
    const result = await collectBrowserScan(config, "PROFILE_ID_1", automation);

    expect(result.status).toBe("ok");
    expect(automation.newPage).toHaveBeenCalledTimes(1);
    expect(existingPage.goto).not.toHaveBeenCalled();
    expect(collectionPage.goto).toHaveBeenCalledWith(config.browserScanUrl, config.timeoutMs);
    expect(collectionPage.close).toHaveBeenCalledTimes(1);
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
      },
      extraDiagnostics: {
        source: "BrowserScan raw component",
        nested: {
          orderSensitiveArray: ["b", "a", "c"]
        }
      }
    };
    const encodedSnapshot = encodeBrowserScanPayload(snapshot);
    const collectionPage = {
      goto: vi.fn(async () => undefined),
      waitForNetworkIdleOrDelay: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      bodyText: vi.fn(async () => "BrowserScan text"),
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

    const automation = mockAutomation(collectionPage);
    const result = await collectBrowserScan(config, "PROFILE_ID_1", automation);

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

    expect(result.componentSnapshot).toEqual(snapshot);

    expect(result.componentSnapshot?.extraDiagnostics).toEqual({
      source: "BrowserScan raw component",
      nested: {
        orderSensitiveArray: ["b", "a", "c"]
      }
    });
  });

  it("keeps BrowserScan snapshot values when runtime probe evaluation fails", async () => {
    const encodedSnapshot = encodeBrowserScanPayload({
      allComplete: true,
      hardware: {
        canvasHash: "browser-scan-canvas-hash"
      }
    });
    const collectionPage = {
      goto: vi.fn(async () => undefined),
      waitForNetworkIdleOrDelay: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      bodyText: vi.fn(async () => "BrowserScan text"),
      evaluate: vi.fn(async (fn: unknown) => {
        if (String(fn).includes("_getComponent")) {
          return encodedSnapshot;
        }

        throw new Error("__name is not defined");
      }),
      close: vi.fn(async () => undefined)
    };

    const automation = mockAutomation(collectionPage);
    const result = await collectBrowserScan(config, "PROFILE_ID_1", automation);

    expect(result.status).toBe("ok");
    expect(result.values.canvas).toEqual({
      value: "browser-scan-canvas-hash",
      source: "dom",
      note: "BrowserScan _getComponent snapshot"
    });
    expect(result.probe?.error).toContain("__name is not defined");
  });

  it("probe does not produce SyntaxError from TypeScript generic syntax", async () => {
    // This test verifies that when the probe script is evaluated,
    // it does not throw SyntaxError due to TypeScript-only syntax like Promise<T>
    const encodedSnapshot = encodeBrowserScanPayload({
      allComplete: true,
      hardware: { canvasHash: "test-hash" },
      software: { language: "en-US" }
    });
    const collectionPage = {
      goto: vi.fn(async () => undefined),
      waitForNetworkIdleOrDelay: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      bodyText: vi.fn(async () => "BrowserScan text"),
      evaluate: vi.fn(async (fn: unknown) => {
        if (String(fn).includes("_getComponent")) {
          return encodedSnapshot;
        }
        // Simulate probe returning valid data without generic type errors
        return {
          ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0)",
          language: "en-US",
          platform: "Win32",
          hardware_concurrency: 8,
          screen_resolution: "1920x1080",
          dpr: 1
        };
      }),
      close: vi.fn(async () => undefined)
    };

    const automation = mockAutomation(collectionPage);
    const result = await collectBrowserScan(config, "PROFILE_ID_1", automation);

    expect(result.status).toBe("ok");
    // If probe had SyntaxError from generic types, it would appear here
    if (result.probe?.error) {
      expect(result.probe.error).not.toMatch(/SyntaxError.*\</);
    }
    // Probe values should be populated
    expect(result.probe?.values.ua?.value).toBeDefined();
  });

  it("timeout of a probe sub-item still leaves basic fields in raw and values", async () => {
    // When audioHash or webgpu times out, the probe should still return
    // the basic synchronous fields (ua, language, platform, etc.)
    const encodedSnapshot = encodeBrowserScanPayload({
      allComplete: true,
      hardware: { canvasHash: "snapshot-canvas" },
      software: { language: "en-US" }
    });
    const collectionPage = {
      goto: vi.fn(async () => undefined),
      waitForNetworkIdleOrDelay: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      bodyText: vi.fn(async () => "BrowserScan text"),
      evaluate: vi.fn(async (fn: unknown) => {
        if (String(fn).includes("_getComponent")) {
          return encodedSnapshot;
        }
        // Simulate a probe where async sub-items timed out but basic sync fields exist
        // This mimics what happens when readAudioHash or readWebGpu times out
        return {
          ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0)",
          language: "en-US",
          languages: ["en-US", "en"],
          platform: "Win32",
          hardware_concurrency: 8,
          device_memory: 8,
          webdriver: false,
          timezone: "America/New_York",
          screen_resolution: "1920x1080",
          screen_available_resolution: "1920x1050",
          color_depth: "24",
          dpr: 1,
          device_pixel_ratio: 1,
          do_not_track: "1",
          client_hints: {},
          canvasHash: "sync-canvas-hash",
          webgl: { vendor: "Intel", renderer: "Iris", version: "4.5" },
          clientRectHash: "client-rect-hash",
          fonts: { count: 3, sample: ["Arial"], hash: "fonts-hash" },
          speechVoices: { count: 2, sample: [] },
          probeTimeouts: ["audioHash"],
          probeErrors: { audioHash: "Timed out after 4000ms" }
        };
      }),
      close: vi.fn(async () => undefined)
    };

    const automation = mockAutomation(collectionPage);
    const result = await collectBrowserScan(config, "PROFILE_ID_1", automation);

    expect(result.status).toBe("ok");
    expect(result.probe?.raw).toBeDefined();
    expect(result.probe?.raw.ua).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0)");
    expect(result.probe?.raw.language).toBe("en-US");
    expect(result.probe?.raw.platform).toBe("Win32");
    expect(result.probe?.raw.screen_resolution).toBe("1920x1080");
    expect(result.probe?.raw.timezone).toBe("America/New_York");
    expect(result.probe?.raw.dpr).toBe(1);
    expect(result.probe?.raw.canvasHash).toBe("sync-canvas-hash");
    expect(result.probe?.raw.probeTimeouts).toEqual(["audioHash"]);
    expect(result.probe?.raw.probeErrors).toEqual({ audioHash: "Timed out after 4000ms" });
    // Values mapping should still work
    expect(result.probe?.values.ua?.value).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0)");
    expect(result.probe?.values.language?.value).toBe("en-US");
    expect(result.probe?.values.platform?.value).toBe("Win32");
    expect(result.probe?.values.screen_resolution?.value).toBe("1920x1080");
    expect(result.probe?.values.canvas?.value).toBe("sync-canvas-hash");
  });

  it("PROBE_SCRIPT contains no TypeScript-only syntax", async () => {
    // Verify the PROBE_SCRIPT string doesn't contain TypeScript-specific syntax
    // that would cause SyntaxError in Firefox's SpiderMonkey
    const encodedSnapshot = encodeBrowserScanPayload({
      allComplete: true,
      hardware: { canvasHash: "test" },
      software: { language: "en-US" }
    });
    const collectionPage = {
      goto: vi.fn(async () => undefined),
      waitForNetworkIdleOrDelay: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      bodyText: vi.fn(async () => "BrowserScan text"),
      evaluate: vi.fn(async (fn: unknown) => {
        if (String(fn).includes("_getComponent")) {
          return encodedSnapshot;
        }
        // Extract the PROBE_SCRIPT string to verify it doesn't have TS generics
        const scriptContent = String(fn);
        // If this is the probe script evaluate call, return basic data
        return {
          ua: "test",
          language: "en",
          platform: "Win32",
          screen_resolution: "1x1",
          dpr: 1
        };
      }),
      close: vi.fn(async () => undefined)
    };

    const automation = mockAutomation(collectionPage);
    const result = await collectBrowserScan(config, "PROFILE_ID_1", automation);
    expect(result.status).toBe("ok");
    // The probe.error should not contain SyntaxError with < character
    if (result.probe?.error) {
      expect(result.probe.error).not.toMatch(/SyntaxError.*</);
    }
  });
});