import { loadConfigFromFile } from "./config.js";
import { runFingerprintCompare, type ProgressEvent } from "./runner.js";
import { pathToFileURL } from "node:url";

export function getConfigPath(argv: string[]): string {
  const configWithValue = argv.find((item) => item.startsWith("--config="));
  if (configWithValue) {
    const value = configWithValue.slice("--config=".length);
    if (!value) {
      throw new Error("--config requires a file path");
    }
    return value;
  }

  const index = argv.indexOf("--config");
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--config requires a file path");
    }
    return value;
  }

  return "config.local.json";
}

function browserLabel(browserType: "firefox" | "chromium" | "unknown"): string {
  if (browserType === "firefox") return "连接 Firefox/Marionette...";
  if (browserType === "chromium") return "连接 Chrome/CDP...";
  return "连接浏览器...";
}

function browserConnectedLabel(browserType: "firefox" | "chromium" | "unknown"): string {
  if (browserType === "firefox") return "Firefox/Marionette 已连接";
  if (browserType === "chromium") return "Chrome/CDP 已连接";
  return "浏览器已连接";
}

function formatDuration(durationMs: number | undefined): string {
  if (typeof durationMs !== "number") return "";
  return `（${durationMs}ms）`;
}

export function formatProgress(event: ProgressEvent): string {
  const { current, total, profileId } = event;
  switch (event.type) {
    case "settings_loaded":
      return `[${current}/${total}] ${profileId} 读取设置值完成`;
    case "profile_starting":
      return `[${current}/${total}] ${profileId} 启动 AdsPower 环境...`;
    case "profile_started":
      return `[${current}/${total}] ${profileId} AdsPower 环境启动成功${formatDuration(event.durationMs)}`;
    case "browser_connecting":
      return `[${current}/${total}] ${profileId} ${browserLabel(event.browserType)}`;
    case "browser_connected":
      return `[${current}/${total}] ${profileId} ${browserConnectedLabel(event.browserType)}${formatDuration(event.durationMs)}`;
    case "browser_scanning":
      return `[${current}/${total}] ${profileId} 打开 BrowserScan 并采集...`;
    case "scan_completed":
      return `[${current}/${total}] ${profileId} ${event.scanStatus === "ok" ? "BrowserScan 采集完成" : "BrowserScan 采集未完成"}${formatDuration(event.durationMs)}`;
    case "profile_done":
      return `[${current}/${total}] ${profileId} 完成：${event.status}，BS 字段 ${event.bsFieldCount} 个，Probe ${event.probeFieldCount} 个${formatDuration(event.durationMs)}`;
  }
}

export function summarizeStatuses(
  statuses: Array<"ok" | "partial" | "failed">
): string {
  const ok = statuses.filter((s) => s === "ok").length;
  const partial = statuses.filter((s) => s === "partial").length;
  const failed = statuses.filter((s) => s === "failed").length;
  return `完成：${statuses.length} 个 profile，ok ${ok}，partial ${partial}，failed ${failed}`;
}

async function main(): Promise<void> {
  const configPath = getConfigPath(process.argv.slice(2));
  const config = await loadConfigFromFile(configPath);
  const result = await runFingerprintCompare(config, {
    onProgress: (event) => {
      console.log(formatProgress(event));
    }
  });

  console.log(`HTML report: ${result.htmlPath}`);
  console.log(`JSON report: ${result.jsonPath}`);
  console.log(summarizeStatuses(result.report.results.map((r) => r.status)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
