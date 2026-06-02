import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPORT_FINGERPRINT_KEYS, SENSITIVE_KEYS } from "./fingerprintFields.js";
import type { ProfileRunResult, ReportData } from "./types.js";

type ReportOutputData = {
  generatedAt: string;
  profileIds: string[];
  results: Array<{
    profileId: string;
    status: string;
    notes: string[];
    settings: {
      profileId: string;
      name?: string;
      accId?: string;
      settings: Record<string, unknown>;
      randomFingerprintEnabled: boolean;
      fetchStatus: string;
      error?: string;
    };
    browserScan?: {
      status: string;
      error?: string;
      rawText: string;
      values: Record<string, { value: unknown; source: string; note?: string }>;
      componentSnapshot?: Record<string, unknown>;
      probe?: {
        raw: Record<string, unknown>;
        values: Record<string, { value: unknown; source: string; note?: string }>;
        checks?: Record<string, { status: string; note: string; settingValue?: unknown; probeValue?: unknown }>;
        error?: string;
      };
      [key: string]: unknown;
    };
    stability?: {
      runCount: number;
      runs: Array<{
        runIndex: number;
        browserScan: {
          status: string;
          rawText: string;
          values: Record<string, { value: unknown; source: string; note?: string }>;
          componentSnapshot?: Record<string, unknown>;
          [key: string]: unknown;
        };
      }>;
      fields: Record<string, {
        status: string;
        samples: Array<{ runIndex: number; value?: unknown; source?: string }>;
        uniqueValues: unknown[];
      }>;
    };
    [key: string]: unknown;
  }>;
};

export interface ReportOutput {
  htmlPath: string;
  jsonPath: string;
}

const REDACTED = "[REDACTED]";
const EXTRA_SENSITIVE_KEYS = [
  "apiKey",
  "api_key",
  "authorization",
  "token",
  "secret",
  "passwd",
  "proxyPassword",
  "proxy_password",
  "cookieValue",
  "cookie_value"
];

const NORMALIZED_SENSITIVE_KEYS = new Set(
  [...SENSITIVE_KEYS, ...EXTRA_SENSITIVE_KEYS].map(normalizeSensitiveKey)
);

function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function sanitizeAuthText(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `\$1${REDACTED}`)
    .replace(
      /\b(password|token|api[_-]?key)=([^&\s"'<>]+)/gi,
      (_match, key: string) => `${key}=${REDACTED}`
    );
}

function sanitizeReportValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReportValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        NORMALIZED_SENSITIVE_KEYS.has(normalizeSensitiveKey(key))
          ? REDACTED
          : sanitizeReportValue(child)
      ])
    );
  }

  if (typeof value === "string") {
    return sanitizeAuthText(value);
  }

  return value;
}

function neutralizeText(value: string): string {
  const unavailableJsCheck = "__UNAVAILABLE_JS_CHECK__";
  return value
    .replace(/无法通过 JS 校验/g, unavailableJsCheck)
    .replace(/pass/gi, "ok")
    .replace(/fail/gi, "error")
    .replace(/通过/g, "完成")
    .replace(/失败/g, "错误")
    .replace(new RegExp(unavailableJsCheck, "g"), "无法通过 JS 校验");
}

function neutralizeStatus(status: string): string {
  return status === "failed" ? "error" : status;
}

function neutralizeFetchStatus(status: ProfileRunResult["settings"]["fetchStatus"]): string {
  return status === "failed" ? "unavailable" : status;
}

function neutralizeBrowserScan(
  bs: NonNullable<ProfileRunResult["browserScan"]>
): ReportOutputData["results"][number]["browserScan"] {
  return {
    ...bs,
    status: neutralizeStatus(bs.status),
    error: neutralizeOptionalText(bs.error),
    values: Object.fromEntries(
      Object.entries(bs.values).map(([key, value]) => [
        key,
        {
          ...value,
          note: neutralizeOptionalText(value.note)
        }
      ])
    ),
    probe: bs.probe
      ? {
          ...bs.probe,
          values: Object.fromEntries(
            Object.entries(bs.probe.values).map(([key, value]) => [
              key,
              {
                ...value,
                note: neutralizeOptionalText(value.note)
              }
            ])
          ),
          checks: bs.probe.checks
            ? Object.fromEntries(
                Object.entries(bs.probe.checks).map(([key, value]) => [
                  key,
                  {
                    ...value,
                    note: neutralizeText(value.note)
                  }
                ])
              )
            : undefined
        }
      : undefined
  };
}

function neutralizeOptionalText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : neutralizeText(value);
}

const FIELD_DEPENDENCY_NOTES: Record<string, string> = {
  webgl: "字段说明：WebGL BS值通常来自 vendor/renderer 与完整 WebGL 参数 hash",
  client_rects: "字段说明：DOM 布局测量对字体、DPR、缩放、渲染管线和测量时机敏感",
  gpu: "字段说明：GPU BS值可能来自 WebGPU adapter/features/limits hash，需结合 raw/probe 判断",
  longitude: "字段说明：依赖代理出口 IP 地理库，代理变化时可能变化",
  latitude: "字段说明：依赖代理出口 IP 地理库，代理变化时可能变化",
  location: "字段说明：依赖代理出口 IP 地理库，代理变化时可能变化"
};

function dependencyNoteFor(key: string): string | undefined {
  return FIELD_DEPENDENCY_NOTES[key];
}

const FINGERPRINT_LABELS: Record<string, { label: string; key: string }> = {
  ua: { label: "User Agent", key: "ua" },
  browser_kernel_config: { label: "浏览器内核配置", key: "browser_kernel_config" },
  platform: { label: "平台", key: "platform" },
  timezone: { label: "时区", key: "timezone" },
  automatic_timezone: { label: "自动时区", key: "automatic_timezone" },
  language: { label: "语言", key: "language" },
  page_language: { label: "页面语言", key: "page_language" },
  screen_resolution: { label: "屏幕分辨率", key: "screen_resolution" },
  dpr: { label: "DPR", key: "dpr" },
  webrtc: { label: "WebRTC", key: "webrtc" },
  canvas: { label: "Canvas", key: "canvas" },
  webgl: { label: "WebGL", key: "webgl" },
  webgl_image: { label: "WebGL 图像", key: "webgl_image" },
  webgl_config: { label: "WebGL 配置", key: "webgl_config" },
  audio: { label: "音频指纹", key: "audio" },
  fonts: { label: "字体", key: "fonts" },
  client_rects: { label: "Client Rects", key: "client_rects" },
  hardware_concurrency: { label: "硬件并发", key: "hardware_concurrency" },
  device_memory: { label: "设备内存", key: "device_memory" },
  do_not_track: { label: "Do Not Track", key: "do_not_track" },
  media_devices: { label: "媒体设备", key: "media_devices" },
  location: { label: "位置", key: "location" },
  longitude: { label: "经度", key: "longitude" },
  latitude: { label: "纬度", key: "latitude" },
  accuracy: { label: "精度", key: "accuracy" },
  client_hints: { label: "Client Hints", key: "client_hints" },
  gpu: { label: "GPU", key: "gpu" },
  tls: { label: "TLS", key: "tls" },
  ip: { label: "IP", key: "ip" },
  ipchecker: { label: "IP 核查", key: "ipchecker" },
  ip_country: { label: "IP 国家", key: "ip_country" },
  ip_region: { label: "IP 区域", key: "ip_region" },
  ip_city: { label: "IP 城市", key: "ip_city" },
  browser_scan_raw_text: { label: "BrowserScan 原文", key: "browser_scan_raw_text" }
};

function fingerprintLabel(key: string): { label: string; key: string } {
  return FINGERPRINT_LABELS[key] ?? { label: key, key };
}

const LONG_VALUE_THRESHOLD = 300;

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "未获取";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function renderPre(content: string): string {
  if (content.length > LONG_VALUE_THRESHOLD) {
    const summary = content.slice(0, LONG_VALUE_THRESHOLD) + "…";
    return `<details><summary>${escapeHtml(summary)}</summary><pre>${escapeHtml(content)}</pre></details>`;
  }
  return `<pre>${escapeHtml(content)}</pre>`;
}

function renderValueBlock(
  label: "设置值" | "BS值",
  value: unknown,
  variant: "setting" | "bs"
): string {
  const raw = formatValue(value);
  const isMissing = raw === "未获取";
  return `<div class="value-block">
    <span class="value-label ${variant}">${label}</span>
    <div class="value-box${isMissing ? " missing" : ""}">${renderPre(raw)}</div>
  </div>`;
}

const NOTE_VALUE_THRESHOLD = 160;

type NoteItem =
  | { kind: "text"; text: string }
  | { kind: "details"; summary: string; detail: string };

function renderNoteItems(items: NoteItem[]): string {
  if (items.length === 0) return "";
  const parts: string[] = [];
  for (const item of items) {
    if (item.kind === "text") {
      parts.push(escapeHtml(item.text));
    } else {
      parts.push(`<details><summary>${escapeHtml(item.summary)}</summary><pre>${escapeHtml(item.detail)}</pre></details>`);
    }
  }
  return parts.join("; ");
}

function compactValue(value: unknown): string {
  const raw = formatValue(value).replace(/\s+/g, " ").trim();
  return raw.length > NOTE_VALUE_THRESHOLD
    ? `${raw.slice(0, NOTE_VALUE_THRESHOLD)}…`
    : raw;
}

function probeValueNeedsDetails(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "object") return true;
  const formatted = formatValue(value);
  return formatted.length > NOTE_VALUE_THRESHOLD;
}

function probeNoteItemsFor(result: ReportOutputData["results"][number], key: string): NoteItem[] {
  const probe = result.browserScan?.probe;
  if (!probe) {
    return [];
  }

  const items: NoteItem[] = [];
  const check = probe.checks?.[key];
  const probeValue = probe.values?.[key];

  if (check?.note) {
    items.push({ kind: "text", text: check.note });
  }
  if (probeValue && probeValue.value !== undefined) {
    const compact = compactValue(probeValue.value);
    const full = formatValue(probeValue.value);
    if (probeValueNeedsDetails(probeValue.value)) {
      items.push({ kind: "details", summary: `Probe实测：${compact}`, detail: full });
    } else {
      items.push({ kind: "text", text: `Probe实测：${compact}` });
    }
  }

  return items;
}

function cellFor(result: ReportOutputData["results"][number], key: string): string {
  const settingsValue = result.settings.settings[key];
  const browserScanValue = result.browserScan?.values[key];
  const fieldNoteItems: NoteItem[] = [
    browserScanValue?.note ? { kind: "text", text: browserScanValue.note } : undefined,
    dependencyNoteFor(key) ? { kind: "text", text: dependencyNoteFor(key)! } : undefined,
    ...probeNoteItemsFor(result, key)
  ].filter((item): item is NoteItem => Boolean(item));

  const settingBlock = renderValueBlock("设置值", settingsValue, "setting");
  const bsBlock = renderValueBlock("BS值", browserScanValue?.value, "bs");
  const noteHtml = fieldNoteItems.length > 0
    ? `<div class="note-line"><span class="value-label note">备注</span><span class="note-text">${renderNoteItems(fieldNoteItems)}</span></div>`
    : `<div class="note-line"><span class="value-label note">备注</span><span class="note-text missing">未获取</span></div>`;

  return `<div class="value-pair">${settingBlock}${bsBlock}${noteHtml}</div>`;
}

function countByStatus(results: ReportOutputData["results"]): { ok: number; partial: number; error: number } {
  const counts = { ok: 0, partial: 0, error: 0 };
  for (const result of results) {
    const status = neutralizeStatus(result.status);
    if (status === "ok") counts.ok += 1;
    else if (status === "partial") counts.partial += 1;
    else if (status === "error") counts.error += 1;
  }
  return counts;
}

function countProbeChecks(results: ReportOutputData["results"]): { manual: number; jsUnavailable: number; consistent: number } {
  const counts = { manual: 0, jsUnavailable: 0, consistent: 0 };
  for (const result of results) {
    const checks = result.browserScan?.probe?.checks;
    if (!checks) continue;
    for (const check of Object.values(checks)) {
      if (check.status === "需人工判断") counts.manual += 1;
      else if (check.status === "无法通过 JS 校验") counts.jsUnavailable += 1;
      else if (check.status === "一致") counts.consistent += 1;
    }
  }
  return counts;
}

function countMissingBsValues(results: ReportOutputData["results"]): number {
  let missing = 0;
  for (const result of results) {
    const values = result.browserScan?.values;
    if (!values) {
      missing += REPORT_FINGERPRINT_KEYS.length;
      continue;
    }
    for (const key of REPORT_FINGERPRINT_KEYS) {
      const v = values[key];
      if (!v || v.value === undefined || v.value === null) {
        missing += 1;
      }
    }
  }
  return missing;
}

function statusBadgeHtml(status: string): string {
  const normalized = neutralizeStatus(status as ProfileRunResult["status"]);
  const labelMap: Record<string, string> = {
    ok: "OK",
    partial: "Partial",
    error: "Error"
  };
  const label = labelMap[normalized] ?? "Unknown";
  return `<span class="status-badge status-${escapeHtml(normalized)}">${label}</span>`;
}

function buildHtml(report: ReportOutputData): string {
  const generatedAt = new Date(report.generatedAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");

  const profileIds = report.profileIds;
  const fingerprintCount = REPORT_FINGERPRINT_KEYS.length;
  const statusCounts = countByStatus(report.results);
  const probeCounts = countProbeChecks(report.results);
  const missingBsCount = countMissingBsValues(report.results);

  const profileHeaders = report.results.map((result) => {
    const name = result.settings.name;
    const accId = result.settings.accId;
    const metaParts: string[] = [name, accId].filter((v): v is string => typeof v === "string");
    const metaHtml = metaParts.length > 0
      ? `<div class="profile-meta">${metaParts.map(m => escapeHtml(m)).join(" · ")}</div>`
      : "";
    const notesHtml = result.notes.length > 0
      ? `<div class="profile-notes">${result.notes.map(n => escapeHtml(n)).join("；")}</div>`
      : "";
    return `<th class="profile-head profile-cell">
      <div class="profile-id-row">
        <span class="profile-id">${escapeHtml(result.profileId)}</span>
        ${statusBadgeHtml(result.status)}
      </div>
      ${metaHtml}
      ${notesHtml}
    </th>`;
  }).join("");

  const rows = REPORT_FINGERPRINT_KEYS.map((key) => {
    const { label } = fingerprintLabel(key);
    const cells = report.results
      .map((result) => `<td class="profile-cell">${cellFor(result, key)}</td>`)
      .join("");

    return `<tr>
      <th class="field-col sticky-col">
        <div class="item-label">${escapeHtml(label)}</div>
        <div class="item-key">${escapeHtml(key)}</div>
      </th>
      ${cells}
    </tr>`;
  }).join("\n");

  const tiles: Array<{ value: string; label: string }> = [
    { value: String(profileIds.length), label: "Profile 数" },
    { value: String(fingerprintCount), label: "Fingerprint 项目数" },
    { value: String(statusCounts.ok), label: "OK" },
    { value: String(statusCounts.partial), label: "Partial" },
    { value: String(statusCounts.error), label: "Error" },
    { value: String(probeCounts.manual), label: "需人工判断" },
    { value: String(missingBsCount), label: "未获取 BS 值" }
  ];
  const tilesHtml = tiles.map((t) => `
      <div class="summary-tile">
        <div class="tile-value">${escapeHtml(t.value)}</div>
        <div class="tile-label">${escapeHtml(t.label)}</div>
      </div>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AdsPower 指纹横向对比报告</title>
  <style>
    :root {
      --page-bg: #ffffff;
      --surface-1: #f4f4f4;
      --surface-2: #ffffff;
      --ink: #161616;
      --ink-muted: #525252;
      --ink-subtle: #8d8d8d;
      --hairline: #e0e0e0;
      --accent: #0f62fe;
      --accent-hover: #0353e9;
      --status-ok: #24a148;
      --status-warning: #f1c21b;
      --status-error: #da1e28;
      --status-neutral: #8d8d8d;
    }

    *, *::before, *::after { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }

    body {
      margin: 0;
      background: var(--page-bg);
      color: var(--ink);
      font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
      font-size: 14px;
      font-weight: 400;
      line-height: 1.4;
      letter-spacing: 0.16px;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── report header (light, compact, Carbon) ──────────────────── */
    .report-header {
      background: var(--page-bg);
      border-bottom: 1px solid var(--hairline);
      padding: 24px 32px 20px;
    }
    .header-eyebrow {
      font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      letter-spacing: 0.32px;
      text-transform: uppercase;
      color: var(--ink-subtle);
      margin: 0 0 8px;
    }
    .header-title {
      font-size: 24px;
      font-weight: 300;
      letter-spacing: 0;
      color: var(--ink);
      margin: 0 0 4px;
    }
    .header-subtitle {
      font-size: 14px;
      color: var(--ink-muted);
      margin: 0 0 20px;
    }
    .header-meta {
      display: flex;
      gap: 24px;
      font-size: 12px;
      color: var(--ink-muted);
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .header-meta-item .meta-key {
      color: var(--ink-subtle);
      text-transform: uppercase;
      letter-spacing: 0.32px;
      margin-right: 6px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 1px;
      background: var(--hairline);
      border: 1px solid var(--hairline);
    }
    @media (max-width: 640px) {
      .summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .summary-tile:nth-child(7) {
        grid-column: 1 / -1;
      }
    }
    .summary-tile {
      background: var(--surface-1);
      padding: 12px 16px;
      min-height: 64px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .tile-value {
      font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 24px;
      font-weight: 300;
      color: var(--ink);
      line-height: 1.2;
    }
    .tile-label {
      font-size: 12px;
      color: var(--ink-muted);
      margin-top: 4px;
      letter-spacing: 0.16px;
    }

    /* ─── status badges (Carbon) ───────────────────────────────────── */
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.32px;
      text-transform: uppercase;
      border-radius: 2px;
      color: #ffffff;
      background: var(--status-neutral);
      line-height: 1.4;
    }
    .status-badge.status-ok { background: var(--status-ok); }
    .status-badge.status-partial { background: var(--status-warning); color: var(--ink); }
    .status-badge.status-error { background: var(--status-error); }

    /* ─── main content ─────────────────────────────────────────────── */
    .report-main {
      padding: 24px 32px 32px;
    }
    .comparison-shell {
      background: var(--surface-2);
      border: 1px solid var(--hairline);
      overflow: hidden;
    }
    .table-scroll {
      overflow: auto;
      -webkit-overflow-scrolling: touch;
    }

    /* ─── table ────────────────────────────────────────────────────── */
    .compare-table {
      border-collapse: collapse;
      width: 100%;
      min-width: 600px;
    }
    .compare-table th,
    .compare-table td {
      border-bottom: 1px solid var(--hairline);
      border-right: 1px solid var(--hairline);
      padding: 0;
      text-align: left;
      vertical-align: top;
      background: var(--surface-2);
    }
    .compare-table th:last-child,
    .compare-table td:last-child {
      border-right: none;
    }
    .compare-table tbody tr:last-child th,
    .compare-table tbody tr:last-child td {
      border-bottom: none;
    }

    /* ─── sticky header ─────────────────────────────────────────────── */
    .compare-table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--surface-1);
      padding: 12px 16px;
    }
    .compare-table thead th:first-child {
      position: sticky;
      top: 0;
      left: 0;
      z-index: 3;
      background: var(--surface-1);
    }

    /* ─── sticky first column (170px) ───────────────────────────── */
    .sticky-col {
      position: sticky;
      left: 0;
      z-index: 1;
      background: var(--surface-2);
    }
    .compare-table thead th.sticky-col {
      z-index: 3;
      background: var(--surface-1);
    }
    .field-col {
      min-width: 170px;
      max-width: 170px;
      width: 170px;
    }

    /* ─── profile header cell ─────────────────────────────────────── */
    .profile-head {
      text-align: left;
    }
    .profile-cell {
      min-width: 280px;
      max-width: 320px;
    }

    .profile-id-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .profile-id {
      font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 14px;
      font-weight: 600;
      color: var(--ink);
    }
    .profile-meta {
      font-size: 12px;
      color: var(--ink-muted);
      margin-top: 4px;
    }
    .profile-notes {
      font-size: 12px;
      color: var(--ink-muted);
      margin-top: 6px;
      line-height: 1.4;
    }

    /* ─── fingerprint item cell ───────────────────────────────────── */
    .item-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--ink);
    }
    .item-key {
      font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      color: var(--ink-subtle);
      margin-top: 2px;
    }

    /* ─── value pair ──────────────────────────────────────────────── */
    .value-pair {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .value-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .value-label {
      font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 11px;
      letter-spacing: 0.32px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .value-label.setting { color: var(--ink-muted); }
    .value-label.bs { color: var(--accent); }
    .value-label.note {
      color: var(--ink-muted);
      white-space: nowrap;
    }

    .value-box {
      background: var(--page-bg);
      border: 1px solid var(--hairline);
      padding: 8px 10px;
      overflow: auto;
      max-height: 160px;
    }
    .value-box.missing {
      background: transparent;
      border-style: dashed;
      border-color: var(--ink-subtle);
    }
    .value-box pre {
      margin: 0;
      font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--ink);
    }
    .value-box.missing pre {
      color: var(--ink-subtle);
      font-style: italic;
    }

    .note-line {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--hairline);
    }
    .note-text {
      font-size: 13px;
      color: var(--ink-muted);
    }
    .note-text.missing {
      font-style: italic;
      color: var(--ink-subtle);
    }

    details {
      margin: 0;
    }
    details summary {
      cursor: pointer;
      font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 13px;
      color: var(--accent);
      padding: 2px 0;
      list-style: none;
    }
    details summary::-webkit-details-marker { display: none; }
    details summary::before { content: "▶ "; font-size: 11px; }
    details[open] summary::before { content: "▼ "; font-size: 11px; }
    details pre {
      margin: 4px 0 0;
      padding: 8px;
      background: var(--surface-1);
      border: 1px solid var(--hairline);
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* ─── footer ──────────────────────────────────────────────────── */
    .report-footer {
      padding: 16px 32px;
      border-top: 1px solid var(--hairline);
      font-size: 12px;
      color: var(--ink-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
  </style>
</head>
<body>
  <header class="report-header">
    <p class="header-eyebrow">Fingerprint Compare / QA Report</p>
    <h1 class="header-title">AdsPower 指纹横向对比报告</h1>
    <p class="header-subtitle">横向查看每个环境的设置值与 BrowserScan 实测值</p>
    <div class="header-meta">
      <span class="header-meta-item"><span class="meta-key">生成时间</span>${escapeHtml(generatedAt)}</span>
      <span class="header-meta-item"><span class="meta-key">报告 ID</span>${escapeHtml(stamp)}</span>
    </div>
    <div class="summary-grid">${tilesHtml}
    </div>
  </header>

  <main class="report-main">
    <div class="comparison-shell">
      <div class="table-scroll">
        <table class="compare-table">
          <thead>
            <tr>
              <th class="field-col sticky-col">指纹项</th>
              ${profileHeaders}
            </tr>
          </thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <footer class="report-footer">
    <span>AdsPower 指纹横向对比报告</span>
    <span>Generated at ${escapeHtml(generatedAt)}</span>
  </footer>
</body>
</html>
`;
}

function buildSafeJson(report: ReportData): ReportOutputData {
  const safeReport = structuredClone(report) as ReportData;

  const output: ReportOutputData = {
    ...safeReport,
    profileIds: [...safeReport.profileIds],
    results: safeReport.results.map((result) => {
      const resultRecord = result as unknown as Record<string, unknown>;
      const { stability: _stability, ...restResult } = resultRecord;
      const base: ReportOutputData["results"][number] = {
        ...restResult,
        profileId: result.profileId,
        status: neutralizeStatus(result.status),
        notes: result.notes.map((note) => neutralizeText(note)),
        settings: {
          ...result.settings,
          settings: result.settings.settings,
          fetchStatus: neutralizeFetchStatus(result.settings.fetchStatus),
          error: neutralizeOptionalText(result.settings.error)
        },
        browserScan: result.browserScan
          ? neutralizeBrowserScan(result.browserScan)
          : undefined
      };

      if (result.stability) {
        (base as Record<string, unknown>).stability = {
          runCount: result.stability.runCount,
          runs: result.stability.runs.map((run) => ({
            runIndex: run.runIndex,
            browserScan: neutralizeBrowserScan(run.browserScan)!
          })),
          fields: Object.fromEntries(
            Object.entries(result.stability.fields).map(([key, field]) => [
              key,
              {
                status: field.status,
                samples: field.samples,
                uniqueValues: field.uniqueValues
              }
            ])
          )
        };
      }

      return base;
    })
  };

  return sanitizeReportValue(output) as ReportOutputData;
}

export async function writeReports(
  report: ReportData,
  outputDir: string
): Promise<ReportOutput> {
  await mkdir(outputDir, { recursive: true });

  const safeReport = buildSafeJson(report);
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const htmlPath = join(outputDir, `fingerprint-report-${stamp}.html`);
  const jsonPath = join(outputDir, `fingerprint-report-${stamp}.json`);

  await writeFile(htmlPath, buildHtml(safeReport), "utf8");
  await writeFile(jsonPath, `${JSON.stringify(safeReport, null, 2)}\n`, "utf8");

  return { htmlPath, jsonPath };
}
