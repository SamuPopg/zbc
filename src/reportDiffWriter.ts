import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPORT_FINGERPRINT_KEYS } from "./fingerprintFields.js";
import type { ReportDiffData, ProfileDiff, DiffSource } from "./reportDiff.js";

export interface ReportDiffOutput {
  htmlPath: string;
  jsonPath: string;
}

const STATUS_LABELS: Record<string, string> = {
  unchanged: "无变化",
  changed: "有变化",
  added: "新增值",
  removed: "丢失值",
  both_missing: "均未获取",
};

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

function statusHtml(status: string): string {
  const label = STATUS_LABELS[status] ?? status;
  const cls =
    status === "unchanged" || status === "both_missing"
      ? "status-muted"
      : status === "changed" || status === "added" || status === "removed"
      ? "status-strong"
      : "";
  return `<span class="status-badge ${cls}">${escapeHtml(label)}</span>`;
}

function formatValueCompact(value: unknown): string {
  if (value === undefined || value === null) return "未获取";
  if (typeof value === "string") return value;
  const s = JSON.stringify(value);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

function buildSourceCell(source: DiffSource, diff: ProfileDiff["fields"][number]["sources"][DiffSource]): string {
  const statusBlock = statusHtml(diff.status);
  const hasDetails =
    diff.baselineValue !== undefined ||
    diff.currentValue !== undefined;

  if (!hasDetails) {
    return `<div class="source-cell source-${source}">
      <span class="source-label">${source === "settings" ? "设置值" : source === "browserScan" ? "BS值" : "Probe值"}</span>
      ${statusBlock}
    </div>`;
  }

  return `<div class="source-cell source-${source}">
    <span class="source-label">${source === "settings" ? "设置值" : source === "browserScan" ? "BS值" : "Probe值"}</span>
    ${statusBlock}
    <details>
      <summary>查看旧值 / 新值</summary>
      <div class="diff-values">
        <div class="diff-side baseline">
          <span class="diff-side-label">旧报告</span>
          <pre>${escapeHtml(formatValueCompact(diff.baselineValue))}</pre>
        </div>
        <div class="diff-side current">
          <span class="diff-side-label">新报告</span>
          <pre>${escapeHtml(formatValueCompact(diff.currentValue))}</pre>
        </div>
      </div>
    </details>
  </div>`;
}

function highlightClass(highlight: ProfileDiff["fields"][number]["highlight"]): string {
  return highlight === "strong" ? " field-strong" : highlight === "soft" ? " field-soft" : " field-none";
}

function buildProfileSection(profile: ProfileDiff): string {
  const { profileId, presence, fields, summary } = profile;

  if (presence === "baseline_only") {
    return `<div class="profile-section presence-baseline-only">
      <div class="profile-header">
        <span class="profile-id">${escapeHtml(profileId)}</span>
        <span class="presence-tag">仅旧报告存在</span>
      </div>
    </div>`;
  }

  if (presence === "current_only") {
    return `<div class="profile-section presence-current-only">
      <div class="profile-header">
        <span class="profile-id">${escapeHtml(profileId)}</span>
        <span class="presence-tag">仅新报告存在</span>
      </div>
    </div>`;
  }

  const rows = fields.map((field) => {
    const { field: f, sources, highlight } = field;
    const label = FINGERPRINT_LABELS[f] ?? { label: f, key: f };
    const hcls = highlightClass(highlight);

    return `<tr class="field-row${hcls}">
      <th class="item-col sticky-col">
        <div class="item-label">${escapeHtml(label.label)}</div>
        <div class="item-key">${escapeHtml(f)}</div>
      </th>
      <td class="item-col">
        <div class="sources-row">
          ${buildSourceCell("settings", sources.settings)}
          ${buildSourceCell("browserScan", sources.browserScan)}
          ${buildSourceCell("probe", sources.probe)}
        </div>
      </td>
    </tr>`;
  }).join("\n");

  const summaryParts = (["settings", "browserScan", "probe"] as DiffSource[]).map((src) => {
    const s = summary[src];
    const srcLabel = src === "settings" ? "设置值" : src === "browserScan" ? "BS值" : "Probe值";
    const parts = [
      `无变化 ${s.unchanged}`,
      `有变化 ${s.changed}`,
      `新增 ${s.added}`,
      `丢失 ${s.removed}`,
      `均未获取 ${s.both_missing}`,
    ].filter((p) => !p.endsWith(" 0"));
    return `<div class="summary-source"><span class="summary-source-label">${srcLabel}</span>: ${parts.join(" / ")}</div>`;
  }).join("");

  return `<div class="profile-section presence-both">
    <div class="profile-header">
      <span class="profile-id">${escapeHtml(profileId)}</span>
    </div>
    <div class="profile-summary">${summaryParts}</div>
    <table class="compare-table">
      <thead>
        <tr>
          <th class="sticky-col">指纹项</th>
          <th>对比结果</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;
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
  browser_scan_raw_text: { label: "BrowserScan 原文", key: "browser_scan_raw_text" },
};

function buildHtml(data: ReportDiffData): string {
  const generatedAt = new Date(data.generatedAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const baselineAt = data.baselineReport.generatedAt
    ? new Date(data.baselineReport.generatedAt).toLocaleString("zh-CN")
    : "未知";
  const currentAt = data.currentReport.generatedAt
    ? new Date(data.currentReport.generatedAt).toLocaleString("zh-CN")
    : "未知";

  const baselineProfileCount = data.baselineReport.profileIds.length;
  const currentProfileCount = data.currentReport.profileIds.length;
  const fieldCount = REPORT_FINGERPRINT_KEYS.length;
  const extraDiffCount = data.extraDiffs.length;

  const globalSummaryParts = (["settings", "browserScan", "probe"] as DiffSource[]).map((src) => {
    const s = data.summary[src];
    const srcLabel = src === "settings" ? "设置值" : src === "browserScan" ? "BS值" : "Probe值";
    const parts = [
      `无变化 ${s.unchanged}`,
      `有变化 ${s.changed}`,
      `新增 ${s.added}`,
      `丢失 ${s.removed}`,
      `均未获取 ${s.both_missing}`,
    ].filter((p) => !p.endsWith(" 0"));
    return `<div class="summary-source"><span class="summary-source-label">${srcLabel}</span>：${parts.join(" / ")}</div>`;
  }).join("");

  const profileSections = data.profiles.map(buildProfileSection).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>AdsPower 指纹报告差异对比</title>
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
      --changed-bg: rgba(255, 149, 0, 0.08);
      --changed-border: rgba(255, 149, 0, 0.4);
      --added-bg: rgba(52, 199, 89, 0.08);
      --added-border: rgba(52, 199, 89, 0.4);
      --removed-bg: rgba(255, 59, 48, 0.08);
      --removed-border: rgba(255, 59, 48, 0.4);
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
    .report-main { padding: 32px 40px 48px; }
    .global-summary-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 24px 28px;
      margin-bottom: 24px;
    }
    .global-summary-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 16px;
    }
    .summary-source {
      font-size: 15px;
      color: var(--ink);
      margin-bottom: 8px;
    }
    .summary-source-label {
      font-weight: 600;
    }
    .profile-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      margin-bottom: 20px;
      overflow: hidden;
    }
    .profile-header {
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .profile-id {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 16px;
      font-weight: 600;
      color: var(--ink);
    }
    .presence-tag {
      font-size: 13px;
      padding: 3px 10px;
      border-radius: 20px;
      background: var(--page-bg);
      color: var(--muted);
      border: 1px solid var(--border);
    }
    .presence-baseline-only .presence-tag {
      background: var(--removed-bg);
      color: #c63030;
      border-color: var(--removed-border);
    }
    .presence-current-only .presence-tag {
      background: var(--added-bg);
      color: #22863a;
      border-color: var(--added-border);
    }
    .profile-summary {
      padding: 12px 24px;
      background: var(--page-bg);
      border-bottom: 1px solid var(--border);
      font-size: 14px;
      color: var(--muted);
      flex-wrap: wrap;
      display: flex;
      gap: 8px 24px;
    }
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
    .compare-table td:last-child { border-right: none; }
    .compare-table tbody tr:last-child th,
    .compare-table tbody tr:last-child td { border-bottom: none; }
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
      background: var(--page-bg);
    }
    .sticky-col {
      position: sticky;
      left: 0;
      z-index: 1;
      background: var(--surface);
      min-width: 120px;
      max-width: 160px;
    }
    .compare-table thead th.sticky-col { z-index: 3; background: var(--page-bg); }
    .item-col { min-width: 280px; }
    .item-label { font-size: 16px; font-weight: 600; color: var(--ink); }
    .item-key { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; color: var(--muted); margin-top: 2px; }
    .sources-row { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; }
    .source-cell { display: flex; flex-direction: column; gap: 4px; }
    .source-label { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; color: var(--muted); }
    .status-badge { display: inline-block; font-size: 13px; padding: 2px 8px; border-radius: 12px; }
    .status-muted { background: var(--page-bg); color: var(--muted); }
    .status-strong { background: var(--changed-bg); color: #b25a00; border: 1px solid var(--changed-border); }
    .field-row.field-strong { background: var(--changed-bg); }
    .field-row.field-strong:hover { background: rgba(255, 149, 0, 0.12); }
    .field-row.field-soft { background: rgba(0, 113, 227, 0.04); }
    .field-row.field-soft:hover { background: rgba(0, 113, 227, 0.08); }
    .field-row.field-none { }
    .diff-values { display: flex; gap: 12px; margin-top: 8px; }
    .diff-side { flex: 1; }
    .diff-side-label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 4px; }
    details { margin: 0; }
    details summary { cursor: pointer; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 14px; color: var(--accent); padding: 4px 0; list-style: none; }
    details summary::-webkit-details-marker { display: none; }
    details summary::before { content: "▶ "; font-size: 12px; }
    details[open] summary::before { content: "▼ "; font-size: 12px; }
    details pre { margin: 6px 0 0; padding: 8px; background: var(--page-bg); border: 1px solid var(--border); border-radius: 6px; font-size: 14px; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow: auto; }
    .report-footer { padding: 20px 40px; border-top: 1px solid var(--border); font-size: 14px; color: var(--muted); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  </style>
</head>
<body>
  <header class="report-masthead">
    <p class="masthead-eyebrow">Fingerprint Compare</p>
    <h1 class="masthead-title">AdsPower 指纹报告差异对比</h1>
    <p class="masthead-subtitle">对比两份已生成报告中的设置值、BrowserScan 实测值与 Probe 辅助实测值</p>
    <div class="summary-strip">
      <div class="summary-card">
        <div class="summary-value">${escapeHtml(generatedAt)}</div>
        <div class="summary-label">生成时间</div>
      </div>
      <div class="summary-card">
        <div class="summary-value">${escapeHtml(baselineAt)}</div>
        <div class="summary-label">旧报告时间</div>
      </div>
      <div class="summary-card">
        <div class="summary-value">${escapeHtml(currentAt)}</div>
        <div class="summary-label">新报告时间</div>
      </div>
      <div class="summary-card">
        <div class="summary-value">${baselineProfileCount} → ${currentProfileCount}</div>
        <div class="summary-label">Profile 数</div>
      </div>
      <div class="summary-card">
        <div class="summary-value">${fieldCount}</div>
        <div class="summary-label">主指纹字段数</div>
      </div>
    </div>
  </header>

  <main class="report-main">
    <div class="global-summary-section">
      <h2 class="global-summary-title">全局摘要</h2>
      ${globalSummaryParts}
      <p style="font-size:13px;color:var(--muted);margin:12px 0 0">说明：第一个路径为旧报告，第二个路径为新报告。深层差异条目：${extraDiffCount} 条（仅 JSON 保留）。</p>
    </div>
    ${profileSections}
  </main>

  <footer class="report-footer">
    <span>AdsPower 指纹报告差异对比</span>
    <span>Generated at ${escapeHtml(generatedAt)}</span>
  </footer>
</body>
</html>`;
}

export async function writeReportDiff(
  data: ReportDiffData,
  outputBaseDir: string
): Promise<ReportDiffOutput> {
  const outputDir = join(outputBaseDir, "diff-reports");
  await mkdir(outputDir, { recursive: true });

  const stamp = data.generatedAt.replace(/[:.]/g, "-");
  const htmlPath = join(outputDir, `diff-report-${stamp}.html`);
  const jsonPath = join(outputDir, `diff-report-${stamp}.json`);

  const html = buildHtml(data);
  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  return { htmlPath, jsonPath };
}