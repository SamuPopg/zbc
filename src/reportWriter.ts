import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPORT_FINGERPRINT_KEYS, SENSITIVE_KEYS } from "./fingerprintFields.js";
import type { ProfileRunResult, ReportData } from "./types.js";

type ReportOutputData = Omit<ReportData, "results"> & {
  results: Array<Omit<ProfileRunResult, "status" | "settings" | "browserScan"> & {
    status: string;
    settings: Omit<ProfileRunResult["settings"], "fetchStatus"> & {
      fetchStatus: string;
    };
    browserScan?: Omit<NonNullable<ProfileRunResult["browserScan"]>, "status"> & {
      status: string;
    };
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

function neutralizeStatus(status: ProfileRunResult["status"] | NonNullable<ProfileRunResult["browserScan"]>["status"]): string {
  return status === "failed" ? "error" : status;
}

function neutralizeFetchStatus(status: ProfileRunResult["settings"]["fetchStatus"]): string {
  return status === "failed" ? "unavailable" : status;
}

function neutralizeOptionalText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : neutralizeText(value);
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

function compactValue(value: unknown): string {
  const raw = formatValue(value).replace(/\s+/g, " ").trim();
  return raw.length > NOTE_VALUE_THRESHOLD
    ? `${raw.slice(0, NOTE_VALUE_THRESHOLD)}…`
    : raw;
}

function probeNotesFor(result: ReportOutputData["results"][number], key: string): string[] {
  const probe = result.browserScan?.probe;
  if (!probe) {
    return [];
  }

  const notes: string[] = [];
  const check = probe.checks?.[key];
  const probeValue = probe.values?.[key];

  if (check?.note) {
    notes.push(check.note);
  }
  if (probeValue && probeValue.value !== undefined) {
    notes.push(`Probe实测：${compactValue(probeValue.value)}`);
  }

  return notes;
}

function cellFor(result: ReportOutputData["results"][number], key: string): string {
  const settingsValue = result.settings.settings[key];
  const browserScanValue = result.browserScan?.values[key];
  const notes = [
    browserScanValue?.note,
    ...probeNotesFor(result, key),
    ...result.notes
  ].filter((note): note is string => Boolean(note));

  const settingBlock = renderValueBlock("设置值", settingsValue, "setting");
  const bsBlock = renderValueBlock("BS值", browserScanValue?.value, "bs");
  const noteLine = notes.length > 0
    ? `<div class="note-line"><span class="value-label setting">备注</span><span class="note-text">${escapeHtml(notes.join("; "))}</span></div>`
    : `<div class="note-line"><span class="value-label setting">备注</span><span class="note-text missing">未获取</span></div>`;

  return `<div class="value-pair">${settingBlock}${bsBlock}${noteLine}</div>`;
}

function buildHtml(report: ReportOutputData): string {
  const generatedAt = new Date(report.generatedAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  const profileIds = report.profileIds;
  const fingerprintCount = REPORT_FINGERPRINT_KEYS.length;

  const profileHeaders = report.results.map((result) => {
    const name = result.settings.name;
    const accId = result.settings.accId;
    const metaParts: string[] = [name, accId].filter((v): v is string => typeof v === "string");
    const metaHtml = metaParts.length > 0
      ? `<div class="profile-meta">${metaParts.map(m => escapeHtml(m)).join(" · ")}</div>`
      : "";
    return `<th class="profile-head">
      <div class="profile-id">${escapeHtml(result.profileId)}</div>
      ${metaHtml}
    </th>`;
  }).join("");

  const rows = REPORT_FINGERPRINT_KEYS.map((key) => {
    const { label } = fingerprintLabel(key);
    const cells = report.results
      .map((result) => `<td class="item-col">${cellFor(result, key)}</td>`)
      .join("");

    return `<tr>
      <th class="item-col sticky-col">
        <div class="item-label">${escapeHtml(label)}</div>
        <div class="item-key">${escapeHtml(key)}</div>
      </th>
      ${cells}
    </tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>AdsPower 指纹横向对比报告</title>
  <style>
    :root {
      --page-bg: #f5f5f7;
      --surface: #ffffff;
      --ink: #1d1d1f;
      --muted: #6e6e73;
      --border: #d2d2d7;
      --strong-border: #86868b;
      --accent: #0071e3;
      --accent-soft: rgba(0, 113, 227, 0.10);
    }

    *, *::before, *::after { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }

    body {
      margin: 0;
      background: var(--page-bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Microsoft YaHei", sans-serif;
      font-size: 16px;
      line-height: 1.5;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── masthead ─────────────────────────────────────────────────── */
    .report-masthead {
      background: var(--ink);
      color: var(--surface);
      padding: 48px 40px 40px;
    }
    .masthead-eyebrow {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 13px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.5);
      margin: 0 0 12px;
    }
    .masthead-title {
      font-size: 32px;
      font-weight: 600;
      letter-spacing: -0.015em;
      margin: 0 0 8px;
      color: var(--surface);
    }
    .masthead-subtitle {
      font-size: 17px;
      color: rgba(255,255,255,0.6);
      margin: 0 0 32px;
    }
    .summary-strip {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
    }
    .summary-card {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 16px 20px;
      min-width: 120px;
    }
    .summary-value {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--surface);
    }
    .summary-label {
      font-size: 14px;
      color: rgba(255,255,255,0.5);
      margin-top: 4px;
    }

    /* ─── main content ─────────────────────────────────────────────── */
    .report-main {
      padding: 32px 40px 48px;
    }
    .comparison-shell {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 18px;
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
      border-bottom: 1px solid var(--border);
      border-right: 1px solid var(--border);
      padding: 0;
      text-align: left;
      vertical-align: top;
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
      background: var(--page-bg);
      padding: 14px 16px;
    }
    .compare-table thead th:first-child {
      position: sticky;
      top: 0;
      left: 0;
      z-index: 3;
    }

    /* ─── sticky first column ─────────────────────────────────────── */
    .sticky-col {
      position: sticky;
      left: 0;
      z-index: 1;
      background: var(--surface);
      min-width: 120px;
      max-width: 120px;
    }
    .compare-table thead th.sticky-col {
      z-index: 3;
      background: var(--page-bg);
    }

    /* ─── profile header cell ─────────────────────────────────────── */
    .profile-head {
      min-width: 220px;
      text-align: left;
    }
    .profile-id {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 16px;
      font-weight: 600;
      color: var(--ink);
    }
    .profile-meta {
      font-size: 13px;
      color: var(--muted);
      margin-top: 3px;
    }

    /* ─── fingerprint item cell ───────────────────────────────────── */
    .item-col {
      min-width: 120px;
      max-width: 120px;
    }
    .item-label {
      font-size: 16px;
      font-weight: 600;
      color: var(--ink);
    }
    .item-key {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 13px;
      color: var(--muted);
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
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 600;
    }
    .value-label.setting { color: var(--muted); }
    .value-label.bs { color: var(--accent); }

    .value-box {
      background: var(--page-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      overflow: auto;
      max-height: 160px;
    }
    .value-box.missing {
      background: transparent;
      border-style: dashed;
    }
    .value-box pre {
      margin: 0;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 14px;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--ink);
    }
    .value-box.missing pre {
      color: var(--muted);
      font-style: italic;
    }

    .note-line {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding-top: 4px;
      border-top: 1px solid var(--border);
    }
    .note-text {
      font-size: 14px;
      color: var(--muted);
    }
    .note-text.missing {
      font-style: italic;
    }

    details {
      margin: 0;
    }
    details summary {
      cursor: pointer;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 14px;
      color: var(--accent);
      padding: 4px 0;
      list-style: none;
    }
    details summary::-webkit-details-marker { display: none; }
    details summary::before { content: "▶ "; font-size: 12px; }
    details[open] summary::before { content: "▼ "; font-size: 12px; }
    details pre {
      margin: 6px 0 0;
      padding: 8px;
      background: var(--page-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* ─── footer ──────────────────────────────────────────────────── */
    .report-footer {
      padding: 20px 40px;
      border-top: 1px solid var(--border);
      font-size: 14px;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
  </style>
</head>
<body>
  <header class="report-masthead">
    <p class="masthead-eyebrow">Fingerprint Compare</p>
    <h1 class="masthead-title">AdsPower 指纹横向对比报告</h1>
    <p class="masthead-subtitle">横向查看每个环境的设置值与 BrowserScan 实测值</p>
    <div class="summary-strip">
      <div class="summary-card">
        <div class="summary-value">${escapeHtml(generatedAt)}</div>
        <div class="summary-label">生成时间</div>
      </div>
      <div class="summary-card">
        <div class="summary-value">${profileIds.length}</div>
        <div class="summary-label">Profile 数</div>
      </div>
      <div class="summary-card">
        <div class="summary-value">${fingerprintCount}</div>
        <div class="summary-label">Fingerprint 项目数</div>
      </div>
    </div>
  </header>

  <main class="report-main">
    <div class="comparison-shell">
      <div class="table-scroll">
        <table class="compare-table">
          <thead>
            <tr>
              <th class="sticky-col">指纹项</th>
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
    results: safeReport.results.map((result) => ({
      ...result,
      status: neutralizeStatus(result.status),
      notes: result.notes.map((note) => neutralizeText(note)),
      settings: {
        ...result.settings,
        settings: result.settings.settings,
        fetchStatus: neutralizeFetchStatus(result.settings.fetchStatus),
        error: neutralizeOptionalText(result.settings.error)
      },
      browserScan: result.browserScan
        ? {
            ...result.browserScan,
            status: neutralizeStatus(result.browserScan.status),
            error: neutralizeOptionalText(result.browserScan.error),
            values: Object.fromEntries(
              Object.entries(result.browserScan.values).map(([key, value]) => [
                key,
                {
                  ...value,
                  note: neutralizeOptionalText(value.note)
                }
              ])
            ),
            probe: result.browserScan.probe
              ? {
                  ...result.browserScan.probe,
                  values: Object.fromEntries(
                    Object.entries(result.browserScan.probe.values).map(([key, value]) => [
                      key,
                      {
                        ...value,
                        note: neutralizeOptionalText(value.note)
                      }
                    ])
                  ),
                  checks: result.browserScan.probe.checks
                    ? Object.fromEntries(
                        Object.entries(result.browserScan.probe.checks).map(([key, value]) => [
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
          }
        : undefined
    }))
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
