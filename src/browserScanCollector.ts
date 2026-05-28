import type { BrowserScanComponentSnapshot, BrowserScanResult, BrowserScanValue, ProbeResult, ToolConfig, LocalApiStartResponse } from "./types.js";
import type { BrowserAutomation, BrowserAutomationPage } from "./browserAutomation.js";

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BROWSER_SCAN_CHARS =
  "hTy1bfRJz4nLPcBCO7WtmNIaGvVeul5Zo8kq32UxrYw_-0gsjp96SDFXQiEMKdHA";
const COMPONENT_SNAPSHOT_NOTE = "BrowserScan _getComponent snapshot";

const PROBE_SCRIPT = String.raw`(async () => {
  const nav = window.navigator;

  const hashString = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };

  const readCanvasHash = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 80;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.textBaseline = "top";
      context.font = "16px Arial";
      context.fillStyle = "#f60";
      context.fillRect(10, 10, 100, 32);
      context.fillStyle = "#069";
      context.fillText("AdsPower probe 123", 14, 18);
      context.strokeStyle = "rgba(120, 64, 180, 0.8)";
      context.arc(140, 35, 18, 0, Math.PI * 2);
      context.stroke();
      return hashString(canvas.toDataURL());
    } catch {
      return undefined;
    }
  };

  const readWebgl = () => {
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!context) return {};
      const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
      const unmaskedVendor = debugInfo ? context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : undefined;
      const unmaskedRenderer = debugInfo ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : undefined;
      const vendor = context.getParameter(context.VENDOR);
      const renderer = context.getParameter(context.RENDERER);
      const version = context.getParameter(context.VERSION);
      return {
        vendor,
        renderer,
        version,
        unmaskedVendor,
        unmaskedRenderer,
        reportHash: hashString(JSON.stringify({ vendor, renderer, version, unmaskedVendor, unmaskedRenderer })),
        imageHash: readCanvasHash()
      };
    } catch {
      return {};
    }
  };

  const readAudioHash = async () => {
    try {
      const OfflineAudio = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineAudio) return undefined;
      const context = new OfflineAudio(1, 44100, 44100);
      const oscillator = context.createOscillator();
      const compressor = context.createDynamicsCompressor();
      oscillator.type = "triangle";
      oscillator.frequency.value = 10000;
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;
      oscillator.connect(compressor);
      compressor.connect(context.destination);
      oscillator.start(0);
      const buffer = await context.startRendering();
      let sample = "";
      const channel = buffer.getChannelData(0);
      for (let index = 4500; index < 5000; index += 5) {
        sample += channel[index].toFixed(6);
      }
      return hashString(sample);
    } catch {
      return undefined;
    }
  };

  const readClientRectsHash = () => {
    try {
      const element = document.createElement("div");
      element.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:123.45px;height:67.89px;font:13px Arial;";
      element.textContent = "AdsPower probe";
      document.body.appendChild(element);
      const rect = element.getBoundingClientRect();
      const value = JSON.stringify({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom
      });
      element.remove();
      return hashString(value);
    } catch {
      return undefined;
    }
  };

  const readMediaDevices = async () => {
    try {
      if (!nav.mediaDevices || !nav.mediaDevices.enumerateDevices) return undefined;
      const devices = await nav.mediaDevices.enumerateDevices();
      const counts = devices.reduce((acc, device) => {
        acc[device.kind] = (acc[device.kind] || 0) + 1;
        return acc;
      }, {});
      return {
        count: devices.length,
        counts,
        kinds: devices.map((device) => device.kind)
      };
    } catch {
      return undefined;
    }
  };

  const readWebrtc = async () => {
    try {
      if (!window.RTCPeerConnection) return undefined;
      const candidates = [];
      const candidateTypes = new Set();
      await new Promise((resolve) => {
        const peer = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });
        const timer = window.setTimeout(() => {
          peer.close();
          resolve();
        }, 3000);
        peer.createDataChannel("probe");
        peer.onicecandidate = (event) => {
          if (!event.candidate) {
            window.clearTimeout(timer);
            peer.close();
            resolve();
            return;
          }
          const candidate = event.candidate.candidate;
          candidates.push(candidate);
          const type = candidate.match(/\btyp\s+(\w+)/)?.[1];
          if (type) candidateTypes.add(type);
        };
        peer
          .createOffer()
          .then((offer) => peer.setLocalDescription(offer))
          .catch(() => {
            window.clearTimeout(timer);
            peer.close();
            resolve();
          });
      });
      return {
        candidates,
        candidateTypes: Array.from(candidateTypes),
        hasSrflx: candidateTypes.has("srflx"),
        hasRelay: candidateTypes.has("relay")
      };
    } catch {
      return undefined;
    }
  };

  const readWebGpu = async () => {
    try {
      if (!nav.gpu || !nav.gpu.requestAdapter) return undefined;
      const adapter = await nav.gpu.requestAdapter();
      if (!adapter) return undefined;
      return { info: adapter.info };
    } catch {
      return undefined;
    }
  };

  const readFonts = () => {
    try {
      if (!document.fonts || !document.fonts.check) return undefined;
      const candidates = [
        "Arial",
        "Calibri",
        "Times New Roman",
        "Courier New",
        "Microsoft YaHei",
        "SimSun",
        "PingFang SC"
      ];
      const available = candidates.filter((font) => document.fonts.check('12px "' + font + '"'));
      return {
        count: available.length,
        sample: available,
        hash: hashString(available.join("|"))
      };
    } catch {
      return undefined;
    }
  };

  const readSpeechVoices = () => {
    try {
      if (!window.speechSynthesis || !window.speechSynthesis.getVoices) return undefined;
      const voices = window.speechSynthesis.getVoices();
      return {
        count: voices.length,
        sample: voices.slice(0, 20).map((voice) => ({
          name: voice.name,
          lang: voice.lang,
          localService: voice.localService
        }))
      };
    } catch {
      return undefined;
    }
  };

  const webgl = readWebgl();
  const audioHash = await readAudioHash();
  const mediaDevices = await readMediaDevices();
  const webrtc = await readWebrtc();
  const webgpu = await readWebGpu();

  return {
    ua: nav.userAgent,
    language: nav.language,
    languages: nav.languages,
    platform: nav.platform,
    hardware_concurrency: nav.hardwareConcurrency,
    device_memory: nav.deviceMemory,
    webdriver: nav.webdriver,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen_resolution: window.screen.width + "x" + window.screen.height,
    screen_available_resolution: window.screen.availWidth + "x" + window.screen.availHeight,
    color_depth: window.screen.colorDepth,
    dpr: window.devicePixelRatio,
    device_pixel_ratio: window.devicePixelRatio,
    do_not_track: nav.doNotTrack,
    client_hints: nav.userAgentData,
    canvasHash: readCanvasHash(),
    webgl,
    audioHash,
    clientRectHash: readClientRectsHash(),
    mediaDevices,
    webrtc,
    webgpu,
    fonts: readFonts(),
    speechVoices: readSpeechVoices()
  };
})()`;

function probeValue(value: unknown): BrowserScanValue {
  return { value, source: "probe" };
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

async function collectProbe(page: BrowserAutomationPage): Promise<{
  raw: Record<string, unknown>;
  values: Record<string, BrowserScanValue>;
}> {
  const raw = await page.evaluate(PROBE_SCRIPT);
  const values: Record<string, BrowserScanValue> = {};
  const source: Record<string, unknown> = isRecord(raw) ? raw : {};
  const webgl = isRecord(source.webgl) ? source.webgl : undefined;

  mapKnownObjectValues(
    values,
    source,
    {
      ua: "ua",
      language: "language",
      platform: "platform",
      hardware_concurrency: "hardware_concurrency",
      device_memory: "device_memory",
      timezone: "timezone",
      screen_resolution: "screen_resolution",
      dpr: "dpr",
      do_not_track: "do_not_track",
      client_hints: "client_hints"
    },
    "Probe runtime"
  );

  for (const [key, value] of Object.entries(values)) {
    values[key] = probeValue(value.value);
  }

  if (hasOwnValue(source, "canvasHash")) {
    values.canvas = probeValue(source.canvasHash);
  }
  if (webgl) {
    if (hasOwnValue(webgl, "reportHash")) {
      values.webgl = probeValue(webgl.reportHash);
    }
    if (hasOwnValue(webgl, "imageHash")) {
      values.webgl_image = probeValue(webgl.imageHash);
    }
    if (hasOwnValue(webgl, "unmaskedVendor") || hasOwnValue(webgl, "unmaskedRenderer")) {
      values.webgl_config = probeValue({
        unmaskedVendor: webgl.unmaskedVendor,
        unmaskedRenderer: webgl.unmaskedRenderer
      });
    }
  }
  if (hasOwnValue(source, "audioHash")) {
    values.audio = probeValue(source.audioHash);
  }
  if (hasOwnValue(source, "clientRectHash")) {
    values.client_rects = probeValue(source.clientRectHash);
  }
  if (hasOwnValue(source, "mediaDevices")) {
    values.media_devices = probeValue(source.mediaDevices);
  }
  if (hasOwnValue(source, "webrtc")) {
    values.webrtc = probeValue(source.webrtc);
  }
  if (hasOwnValue(source, "webgpu")) {
    values.gpu = probeValue(source.webgpu);
  }
  if (hasOwnValue(source, "fonts")) {
    values.fonts = probeValue(source.fonts);
  }

  return {
    raw: source,
    values
  };
}

async function collectProbeSafely(page: BrowserAutomationPage): Promise<ProbeResult> {
  try {
    return await collectProbe(page);
  } catch (error) {
    return {
      raw: {},
      values: {},
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function readComponentSnapshotPayload(page: BrowserAutomationPage): Promise<string | undefined> {
  const result = await page.evaluate(() => {
    const getComponent = (window as Window & {
      _getComponent?: () => string;
    })._getComponent;

    if (typeof getComponent !== "function") {
      return undefined;
    }

    return getComponent();
  });
  return typeof result === "string" ? result : undefined;
}

async function collectComponentSnapshot(
  page: BrowserAutomationPage
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

async function collectVisibleText(page: BrowserAutomationPage): Promise<string> {
  return page.bodyText(10000);
}

export async function collectBrowserScan(
  config: ToolConfig,
  profileId: string,
  automation: BrowserAutomation
): Promise<BrowserScanResult> {
  let page: BrowserAutomationPage | undefined;

  try {
    page = await automation.newPage();

    await page.goto(config.browserScanUrl, config.timeoutMs);
    await page.waitForNetworkIdleOrDelay();

    const rawText = await collectVisibleText(page);
    const truncatedText = rawText.slice(0, 20000);
    const componentSnapshot = await collectComponentSnapshot(page);
    const probe = await collectProbeSafely(page);
    const values = {
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
      componentSnapshot,
      probe,
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
