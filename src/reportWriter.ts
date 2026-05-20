import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPORT_FINGERPRINT_KEYS, SENSITIVE_KEYS } from "./fingerprintFields.js";
import type { ProfileRunResult, ReportData } from "./types.js";

export interface ReportOutput {
  htmlPath: string;
  jsonPath: string;
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

function safeSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !SENSITIVE_KEYS.has(key))
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "未获取";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function cellFor(result: ProfileRunResult, key: string): string {
  const settingsValue = result.settings.settings[key];
  const browserScanValue = result.browserScan?.values[key];
  const notes = [
    browserScanValue?.note,
    ...result.notes
  ].filter((note): note is string => Boolean(note));

  return [
    `<div><strong>设置值</strong>：${escapeHtml(formatValue(settingsValue))}</div>`,
    `<div><strong>BS值</strong>：${escapeHtml(formatValue(browserScanValue?.value))}</div>`,
    `<div><strong>note</strong>：${escapeHtml(notes.join("; ") || "未获取")}</div>`
  ].join("");
}

function buildHtml(report: ReportData): string {
  const columns = report.results
    .map((result) => `<th>${escapeHtml(result.profileId)}</th>`)
    .join("");
  const rows = REPORT_FINGERPRINT_KEYS.map((key) => {
    const cells = report.results
      .map((result) => `<td>${cellFor(result, key)}</td>`)
      .join("");

    return `<tr><th>${escapeHtml(key)}</th>${cells}</tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>AdsPower 指纹横向对比报告</title>
  <style>
    body { font-family: Arial, "Microsoft YaHei", sans-serif; margin: 24px; color: #1f2933; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; word-break: break-word; }
    th { background: #eef2f7; }
    caption { font-size: 22px; font-weight: 700; margin-bottom: 12px; text-align: left; }
  </style>
</head>
<body>
  <table>
    <caption>AdsPower 指纹横向对比报告</caption>
    <thead>
      <tr><th>profileId</th>${columns}</tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
}

function buildSafeJson(report: ReportData): ReportData {
  const safeReport = structuredClone(report) as ReportData;

  for (const result of safeReport.results) {
    result.settings.settings = safeSettings(result.settings.settings);
  }

  return safeReport;
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
