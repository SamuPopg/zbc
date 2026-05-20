import { REPORT_FINGERPRINT_KEYS } from "./fingerprintFields.js";
import type { BrowserScanValue, ProbeCheck, ProbeCheckStatus } from "./types.js";

const DIRECT_COMPARE_FIELDS = new Set([
  "ua",
  "timezone",
  "language",
  "screen_resolution",
  "dpr",
  "hardware_concurrency",
  "device_memory",
  "do_not_track",
  "webgl_config"
]);

const JS_UNAVAILABLE_FIELDS = new Set([
  "tls",
  "ip",
  "ipchecker",
  "ip_country",
  "ip_region",
  "ip_city",
  "client_hints"
]);

const MANUAL_FIELDS = new Set([
  "canvas",
  "webgl",
  "webgl_image",
  "audio",
  "client_rects",
  "fonts",
  "media_devices",
  "webrtc",
  "gpu",
  "location",
  "longitude",
  "latitude",
  "accuracy"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function check(
  status: ProbeCheckStatus,
  note: string,
  settingValue: unknown,
  probeValue: unknown
): ProbeCheck {
  return {
    status,
    note,
    settingValue,
    probeValue
  };
}

function manual(settingValue: unknown, probeValue: unknown, note?: string): ProbeCheck {
  return check(
    "需人工判断",
    note ?? "需人工判断：设置值与 Probe值语义不同",
    settingValue,
    probeValue
  );
}

function unavailable(settingValue: unknown, probeValue: unknown): ProbeCheck {
  return check(
    "无法通过 JS 校验",
    "无法通过 JS 校验：该字段依赖服务端网络或 TLS 视角",
    settingValue,
    probeValue
  );
}

function normalizeScalar(value: unknown): string {
  return String(value).trim().toLowerCase();
}

function normalizeScreenResolution(value: unknown): string {
  return normalizeScalar(value).replace("_", "x");
}

function normalizeDoNotTrack(value: unknown): string {
  const normalized = normalizeScalar(value);
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return "1";
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return "0";
  }
  return normalized;
}

function languageMatches(settingValue: unknown, probeValue: unknown): boolean {
  const probeLanguages = Array.isArray(probeValue) ? probeValue : [probeValue];
  const normalizedProbe = probeLanguages.map(normalizeScalar);
  const settingLanguages = Array.isArray(settingValue) ? settingValue : [settingValue];
  return settingLanguages.some((item) => normalizedProbe.includes(normalizeScalar(item)));
}

function webglConfigMatches(settingValue: unknown, probeValue: unknown): boolean {
  if (!isRecord(settingValue) || !isRecord(probeValue)) {
    return false;
  }

  const settingVendor = settingValue.unmasked_vendor ?? settingValue.unmaskedVendor;
  const settingRenderer = settingValue.unmasked_renderer ?? settingValue.unmaskedRenderer;
  const probeVendor = probeValue.unmaskedVendor ?? probeValue.unmasked_vendor;
  const probeRenderer = probeValue.unmaskedRenderer ?? probeValue.unmasked_renderer;

  return (
    hasValue(settingVendor) &&
    hasValue(settingRenderer) &&
    normalizeScalar(settingVendor) === normalizeScalar(probeVendor) &&
    normalizeScalar(settingRenderer) === normalizeScalar(probeRenderer)
  );
}

function directValueMatches(key: string, settingValue: unknown, probeValue: unknown): boolean {
  if (key === "language") {
    return languageMatches(settingValue, probeValue);
  }
  if (key === "screen_resolution") {
    return normalizeScreenResolution(settingValue) === normalizeScreenResolution(probeValue);
  }
  if (key === "do_not_track") {
    return normalizeDoNotTrack(settingValue) === normalizeDoNotTrack(probeValue);
  }
  if (key === "webgl_config") {
    return webglConfigMatches(settingValue, probeValue);
  }

  return normalizeScalar(settingValue) === normalizeScalar(probeValue);
}

function usesModeValue(
  key: string,
  settings: Record<string, unknown>,
  settingValue: unknown
): boolean {
  if (key === "ua") {
    return !hasValue(settingValue) && hasValue(settings.random_ua);
  }
  if (key === "timezone") {
    return settings.automatic_timezone === "1" || !hasValue(settingValue);
  }
  if (key === "language") {
    return settings.language_switch === "1" || !hasValue(settingValue);
  }
  if (key === "screen_resolution") {
    return settingValue === "random" || settingValue === "none" || !hasValue(settingValue);
  }
  if (key === "do_not_track") {
    return settingValue === "default" || !hasValue(settingValue);
  }
  if (key === "webgl_config") {
    return settings.webgl !== "2" || !hasValue(settingValue);
  }

  return !hasValue(settingValue);
}

function directCheck(
  key: string,
  settings: Record<string, unknown>,
  settingValue: unknown,
  probeValue: unknown
): ProbeCheck {
  if (usesModeValue(key, settings, settingValue) || !hasValue(probeValue)) {
    return manual(settingValue, probeValue, "需人工判断：设置值为按 IP、随机或跟随本机模式");
  }

  if (directValueMatches(key, settingValue, probeValue)) {
    return check("一致", "设置值与 Probe一致", settingValue, probeValue);
  }

  return manual(settingValue, probeValue, "需人工判断：设置值与 Probe值不完全一致");
}

function manualNote(key: string, settingValue: unknown): string {
  if (key === "webrtc" && settingValue === "disabled") {
    return "需人工判断：WebRTC=disabled 可参考 Probe ICE candidate 是否无 srflx/relay";
  }
  return "需人工判断：设置值与 Probe值语义不同";
}

export function buildProbeChecks(
  settings: Record<string, unknown>,
  probeValues: Record<string, BrowserScanValue> | undefined
): Record<string, ProbeCheck> {
  const checks: Record<string, ProbeCheck> = {};

  for (const key of REPORT_FINGERPRINT_KEYS) {
    const settingValue = settings[key];
    const probeValue = probeValues?.[key]?.value;

    if (!hasValue(settingValue) && !hasValue(probeValue)) {
      continue;
    }

    if (JS_UNAVAILABLE_FIELDS.has(key)) {
      checks[key] = unavailable(settingValue, probeValue);
      continue;
    }

    if (DIRECT_COMPARE_FIELDS.has(key)) {
      checks[key] = directCheck(key, settings, settingValue, probeValue);
      continue;
    }

    if (MANUAL_FIELDS.has(key)) {
      checks[key] = manual(settingValue, probeValue, manualNote(key, settingValue));
    }
  }

  return checks;
}
