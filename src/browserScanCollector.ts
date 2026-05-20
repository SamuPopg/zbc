import type { BrowserScanResult, BrowserScanValue, ToolConfig } from "./types.js";
import type { Browser, Page } from "playwright";

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BROWSER_SCAN_CHARS =
  "hTy1bfRJz4nLPcBCO7WtmNIaGvVeul5Zo8kq32UxrYw_-0gsjp96SDFXQiEMKdHA";
const COMPONENT_SNAPSHOT_NOTE = "BrowserScan _getComponent snapshot";

type BrowserScanComponentSnapshot = {
  allComplete?: boolean;
  browser?: Record<string, unknown>;
  hardware?: Record<string, unknown>;
  httpFP?: Record<string, unknown>;
  ipdata?: Record<string, unknown>;
  kernelInfo?: Record<string, unknown>;
  software?: Record<string, unknown>;
  webrtc?: Record<string, unknown>;
};

function runtimeValue(value: unknown): BrowserScanValue {
  return { value, source: "runtime" };
}

function domValue(value: unknown, note = COMPONENT_SNAPSHOT_NOTE): BrowserScanValue {
  return { value, source: "dom", note };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwnValue(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function remapBrowserScanBase64(value: string): string {
  return value
    .split("")
    .map((char) => {
      const index = BROWSER_SCAN_CHARS.indexOf(char);
      return index < 0 ? char : BASE64_CHARS[index];
    })
    .join("");
}

function decodeBrowserScanSnapshot(value: string): BrowserScanComponentSnapshot | undefined {
  try {
    const json = Buffer.from(remapBrowserScanBase64(value), "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function collectRuntimeValues(page: Page): Promise<Record<string, BrowserScanValue>> {
  const runtime = await page.evaluate(() => {
    const nav = window.navigator as Navigator & {
      deviceMemory?: number;
      webdriver?: boolean;
    };

    return {
      ua: nav.userAgent,
      language: nav.language,
      languages: nav.languages,
      platform: nav.platform,
      hardware_concurrency: nav.hardwareConcurrency,
      device_memory: nav.deviceMemory,
      webdriver: nav.webdriver,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen_resolution: `${window.screen.width}x${window.screen.height}`,
      screen_available_resolution: `${window.screen.availWidth}x${window.screen.availHeight}`,
      color_depth: window.screen.colorDepth,
      dpr: window.devicePixelRatio,
      device_pixel_ratio: window.devicePixelRatio
    };
  });

  return Object.fromEntries(
    Object.entries(runtime).map(([key, value]) => [key, runtimeValue(value)])
  );
}

async function readComponentSnapshotPayload(page: Page): Promise<string | undefined> {
  return page
    .evaluate(() => {
      const getComponent = (window as Window & {
        _getComponent?: () => string;
      })._getComponent;

      if (typeof getComponent !== "function") {
        return undefined;
      }

      return getComponent();
    })
    .catch(() => undefined);
}

async function collectComponentSnapshot(
  page: Page
): Promise<BrowserScanComponentSnapshot | undefined> {
  let lastSnapshot: BrowserScanComponentSnapshot | undefined;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const payload = await readComponentSnapshotPayload(page);
    if (typeof payload !== "string" || payload.length === 0) {
      return lastSnapshot;
    }

    const snapshot = decodeBrowserScanSnapshot(payload);
    if (!snapshot) {
      return lastSnapshot;
    }

    lastSnapshot = snapshot;
    if (snapshot.allComplete === true) {
      return snapshot;
    }

    await page.waitForTimeout(500).catch(() => undefined);
  }

  return lastSnapshot;
}

function mapKnownObjectValues(
  values: Record<string, BrowserScanValue>,
  source: Record<string, unknown> | undefined,
  mapping: Record<string, string>,
  note: string
): void {
  if (!source) {
    return;
  }

  for (const [sourceKey, targetKey] of Object.entries(mapping)) {
    if (hasOwnValue(source, sourceKey)) {
      values[targetKey] = domValue(source[sourceKey], note);
    }
  }
}

function mapBrowserScanSnapshotValues(
  snapshot: BrowserScanComponentSnapshot | undefined
): Record<string, BrowserScanValue> {
  if (!snapshot) {
    return {};
  }

  const note = snapshot.allComplete === true
    ? COMPONENT_SNAPSHOT_NOTE
    : `${COMPONENT_SNAPSHOT_NOTE} (partial)`;
  const values: Record<string, BrowserScanValue> = {};
  const browser = isRecord(snapshot.browser) ? snapshot.browser : undefined;
  const hardware = isRecord(snapshot.hardware) ? snapshot.hardware : undefined;
  const httpFP = isRecord(snapshot.httpFP) ? snapshot.httpFP : undefined;
  const ipdata = isRecord(snapshot.ipdata) ? snapshot.ipdata : undefined;
  const kernelInfo = isRecord(snapshot.kernelInfo) ? snapshot.kernelInfo : undefined;
  const software = isRecord(snapshot.software) ? snapshot.software : undefined;
  const webrtc = isRecord(snapshot.webrtc) ? snapshot.webrtc : undefined;

  if (webrtc) {
    const webrtcValue: Record<string, unknown> = {};
    if (hasOwnValue(webrtc, "stun")) {
      webrtcValue.stun = webrtc.stun;
    }
    if (hasOwnValue(webrtc, "udp")) {
      webrtcValue.udp = webrtc.udp;
    }
    if (hasOwnValue(webrtc, "turn")) {
      webrtcValue.turn = webrtc.turn;
    }
    values.webrtc = domValue(webrtcValue, note);
  }

  if (hardware) {
    if (hasOwnValue(hardware, "canvasHash")) {
      values.canvas = domValue(hardware.canvasHash, note);
    }
    if (hasOwnValue(hardware, "webGLReportHash")) {
      values.webgl = domValue(hardware.webGLReportHash, note);
    }
    if (hasOwnValue(hardware, "webGLHash")) {
      values.webgl_image = domValue(hardware.webGLHash, note);
    }
    if (
      hasOwnValue(hardware, "webGLUnmaskedVendor") ||
      hasOwnValue(hardware, "webGLUnmaskedRenderer")
    ) {
      values.webgl_config = domValue(
        {
          unmaskedVendor: hardware.webGLUnmaskedVendor,
          unmaskedRenderer: hardware.webGLUnmaskedRenderer
        },
        note
      );
    }
    if (hasOwnValue(hardware, "audioHash")) {
      values.audio = domValue(hardware.audioHash, note);
    }
    if (hasOwnValue(hardware, "clientRectHash")) {
      values.client_rects = domValue(hardware.clientRectHash, note);
    }
    if (hasOwnValue(hardware, "mediaDeviceHash")) {
      values.media_devices = domValue(hardware.mediaDeviceHash, note);
    }
    if (hasOwnValue(hardware, "webGPUHash") || hasOwnValue(hardware, "webGPU")) {
      values.gpu = domValue(
        {
          hash: hardware.webGPUHash,
          webGPU: hardware.webGPU
        },
        note
      );
    }
  }

  if (software) {
    if (hasOwnValue(software, "fontsHash") || hasOwnValue(software, "fontsList")) {
      const fontsList = Array.isArray(software.fontsList) ? software.fontsList : [];
      values.fonts = domValue(
        {
          hash: software.fontsHash,
          count: fontsList.length,
          sample: fontsList.slice(0, 20)
        },
        note
      );
    }

    mapKnownObjectValues(
      values,
      software,
      {
        doNotTrack: "do_not_track",
        language: "language",
        timezone: "timezone",
        webdriver: "webdriver"
      },
      note
    );
  }

  if (httpFP) {
    values.tls = domValue(httpFP, note);
  }

  if (ipdata) {
    mapKnownObjectValues(
      values,
      ipdata,
      {
        ip: "ip",
        language: values.language ? "page_language" : "language",
        timezone: values.timezone ? "ip_timezone" : "timezone",
        longitude: "longitude",
        latitude: "latitude",
        country: "ip_country",
        region: "ip_region",
        city: "ip_city"
      },
      note
    );

    if (hasOwnValue(ipdata, "ua")) {
      values.ua = domValue(ipdata.ua, note);
    }
    if (
      hasOwnValue(ipdata, "longitude") ||
      hasOwnValue(ipdata, "latitude") ||
      hasOwnValue(ipdata, "country") ||
      hasOwnValue(ipdata, "region") ||
      hasOwnValue(ipdata, "city")
    ) {
      values.location = domValue(
        {
          longitude: ipdata.longitude,
          latitude: ipdata.latitude,
          country: ipdata.country,
          region: ipdata.region,
          city: ipdata.city
        },
        note
      );
    }
  }

  if (browser && hasOwnValue(browser, "clientHints")) {
    values.client_hints = domValue(browser.clientHints, note);
  }

  if (kernelInfo && Object.keys(kernelInfo).length > 0) {
    values.browser_kernel_config = domValue(kernelInfo, note);
  }

  return values;
}

async function collectVisibleText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
}

export async function collectBrowserScan(
  config: ToolConfig,
  profileId: string,
  browser: Browser
): Promise<BrowserScanResult> {
  let page: Page | undefined;

  try {
    const context = browser.contexts()[0] || (await browser.newContext());
    page = await context.newPage();

    await page.goto(config.browserScanUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const rawText = await collectVisibleText(page);
    const truncatedText = rawText.slice(0, 20000);
    const runtimeValues = await collectRuntimeValues(page);
    const componentSnapshot = await collectComponentSnapshot(page);
    const values = {
      ...runtimeValues,
      ...mapBrowserScanSnapshotValues(componentSnapshot)
    };

    values.browser_scan_raw_text = {
      value: truncatedText,
      source: "dom",
      note: "BrowserScan visible text snapshot truncated to 20000 characters"
    };

    return {
      profileId,
      values,
      rawText: truncatedText,
      status: "ok"
    };
  } catch (error) {
    return {
      profileId,
      values: {},
      rawText: "",
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await page?.close().catch(() => undefined);
  }
}
