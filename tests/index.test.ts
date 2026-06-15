import { describe, expect, it } from "vitest";
import { formatProgress, getConfigPath, summarizeStatuses } from "../src/index.js";
import type { ProgressEvent } from "../src/runner.js";

describe("getConfigPath", () => {
  it("defaults to config.local.json without --config", () => {
    expect(getConfigPath([])).toBe("config.local.json");
  });

  it("reads --config path", () => {
    expect(getConfigPath(["--config", "config.test.json"])).toBe(
      "config.test.json"
    );
  });

  it("reads --config=path", () => {
    expect(getConfigPath(["--config=config.test.json"])).toBe(
      "config.test.json"
    );
  });

  it("throws when --config has no value", () => {
    expect(() => getConfigPath(["--config"])).toThrow(
      "--config requires a file path"
    );
  });

  it("throws when --config value is another flag", () => {
    expect(() => getConfigPath(["--config", "--verbose"])).toThrow(
      "--config requires a file path"
    );
  });
});

describe("formatProgress", () => {
  it("formats settings_loaded with current/total and profileId", () => {
    const event: ProgressEvent = {
      type: "settings_loaded",
      current: 1,
      total: 4,
      profileId: "PROFILE_A"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A 读取设置值完成"
    );
  });

  it("formats profile_starting as '启动 AdsPower 环境...'", () => {
    const event: ProgressEvent = {
      type: "profile_starting",
      current: 1,
      total: 4,
      profileId: "PROFILE_A"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A 启动 AdsPower 环境..."
    );
  });

  it("formats profile_started as 'AdsPower 环境启动成功'", () => {
    const event: ProgressEvent = {
      type: "profile_started",
      current: 1,
      total: 4,
      profileId: "PROFILE_A"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A AdsPower 环境启动成功"
    );
  });

  it("formats browser_connecting for firefox as '连接 Firefox/Marionette...'", () => {
    const event: ProgressEvent = {
      type: "browser_connecting",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      browserType: "firefox"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A 连接 Firefox/Marionette..."
    );
  });

  it("formats browser_connecting for chromium as '连接 Chrome/CDP...'", () => {
    const event: ProgressEvent = {
      type: "browser_connecting",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      browserType: "chromium"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A 连接 Chrome/CDP..."
    );
  });

  it("formats browser_connecting for unknown as '连接浏览器...'", () => {
    const event: ProgressEvent = {
      type: "browser_connecting",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      browserType: "unknown"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A 连接浏览器..."
    );
  });

  it("formats browser_connected for firefox as 'Firefox/Marionette 已连接'", () => {
    const event: ProgressEvent = {
      type: "browser_connected",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      browserType: "firefox"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A Firefox/Marionette 已连接"
    );
  });

  it("formats browser_connected for chromium as 'Chrome/CDP 已连接'", () => {
    const event: ProgressEvent = {
      type: "browser_connected",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      browserType: "chromium"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A Chrome/CDP 已连接"
    );
  });

  it("formats browser_connected for unknown as '浏览器已连接'", () => {
    const event: ProgressEvent = {
      type: "browser_connected",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      browserType: "unknown"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A 浏览器已连接"
    );
  });

  it("formats browser_scanning as '打开 BrowserScan 并采集...'", () => {
    const event: ProgressEvent = {
      type: "browser_scanning",
      current: 1,
      total: 4,
      profileId: "PROFILE_A"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A 打开 BrowserScan 并采集..."
    );
  });

  it("formats scan_completed as 'BrowserScan 采集完成'", () => {
    const event: ProgressEvent = {
      type: "scan_completed",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      scanStatus: "ok"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A BrowserScan 采集完成"
    );
  });

  it("formats scan_completed with failed scanStatus as 'BrowserScan 采集未完成'", () => {
    const event: ProgressEvent = {
      type: "scan_completed",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      scanStatus: "failed"
    };
    const out = formatProgress(event);
    expect(out).toBe("[1/4] PROFILE_A BrowserScan 采集未完成");
    expect(out).not.toContain("采集完成");
  });

  it("formats profile_done with status and field counts", () => {
    const event: ProgressEvent = {
      type: "profile_done",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      status: "ok",
      bsFieldCount: 31,
      probeFieldCount: 20
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A 完成：ok，BS 字段 31 个，Probe 20 个"
    );
  });

  it("formats profile_done for partial status with zero counts", () => {
    const event: ProgressEvent = {
      type: "profile_done",
      current: 2,
      total: 4,
      profileId: "PROFILE_B",
      status: "partial",
      bsFieldCount: 0,
      probeFieldCount: 0
    };
    expect(formatProgress(event)).toBe(
      "[2/4] PROFILE_B 完成：partial，BS 字段 0 个，Probe 0 个"
    );
  });

  it("appends durationMs to profile_started when present", () => {
    const event: ProgressEvent = {
      type: "profile_started",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      durationMs: 1234
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A AdsPower 环境启动成功（1234ms）"
    );
  });

  it("appends durationMs to browser_connected for chromium when present", () => {
    const event: ProgressEvent = {
      type: "browser_connected",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      browserType: "chromium",
      durationMs: 567
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A Chrome/CDP 已连接（567ms）"
    );
  });

  it("appends durationMs to scan_completed when present", () => {
    const event: ProgressEvent = {
      type: "scan_completed",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      scanStatus: "ok",
      durationMs: 89
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A BrowserScan 采集完成（89ms）"
    );
  });

  it("appends durationMs to scan_completed with failed scanStatus and shows '采集未完成'", () => {
    const event: ProgressEvent = {
      type: "scan_completed",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      scanStatus: "failed",
      durationMs: 60000
    };
    const out = formatProgress(event);
    expect(out).toBe("[1/4] PROFILE_A BrowserScan 采集未完成（60000ms）");
    expect(out).not.toContain("采集完成");
  });

  it("appends scanError to scan_completed with failed scanStatus", () => {
    const event: ProgressEvent = {
      type: "scan_completed",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      scanStatus: "failed",
      scanError: 'BrowserScan stage="probe" timed out after 60000ms'
    };
    const out = formatProgress(event);
    expect(out).toBe(
      '[1/4] PROFILE_A BrowserScan 采集未完成：BrowserScan stage="probe" timed out after 60000ms'
    );
  });

  it("appends scanError and durationMs to scan_completed with failed scanStatus", () => {
    const event: ProgressEvent = {
      type: "scan_completed",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      scanStatus: "failed",
      scanError: "Navigation timed out after 60000 ms",
      durationMs: 60000
    };
    const out = formatProgress(event);
    expect(out).toBe(
      "[1/4] PROFILE_A BrowserScan 采集未完成：Navigation timed out after 60000 ms（60000ms）"
    );
  });

  it("does not append scanError when scanStatus is ok", () => {
    const event: ProgressEvent = {
      type: "scan_completed",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      scanStatus: "ok",
      scanError: "should be ignored"
    };
    const out = formatProgress(event);
    expect(out).toBe("[1/4] PROFILE_A BrowserScan 采集完成");
    expect(out).not.toContain("should be ignored");
  });

  it("does not append scanError on failed scan when scanError is missing or empty", () => {
    const event: ProgressEvent = {
      type: "scan_completed",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      scanStatus: "failed"
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A BrowserScan 采集未完成"
    );
  });

  it("appends durationMs to profile_done when present", () => {
    const event: ProgressEvent = {
      type: "profile_done",
      current: 1,
      total: 4,
      profileId: "PROFILE_A",
      status: "ok",
      bsFieldCount: 31,
      probeFieldCount: 20,
      durationMs: 4000
    };
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A 完成：ok，BS 字段 31 个，Probe 20 个（4000ms）"
    );
  });

  it("does not append undefined duration marker when durationMs is missing", () => {
    const event: ProgressEvent = {
      type: "profile_started",
      current: 1,
      total: 4,
      profileId: "PROFILE_A"
    };
    expect(formatProgress(event)).not.toContain("undefined");
    expect(formatProgress(event)).toBe(
      "[1/4] PROFILE_A AdsPower 环境启动成功"
    );
  });
});

describe("summarizeStatuses", () => {
  it("counts ok/partial/failed and reports total", () => {
    expect(
      summarizeStatuses(["ok", "ok", "partial", "failed"])
    ).toBe("完成：4 个 profile，ok 2，partial 1，failed 1");
  });

  it("returns all-zero counts for empty input", () => {
    expect(summarizeStatuses([])).toBe(
      "完成：0 个 profile，ok 0，partial 0，failed 0"
    );
  });

  it("handles all profiles with the same status", () => {
    expect(summarizeStatuses(["ok", "ok", "ok"])).toBe(
      "完成：3 个 profile，ok 3，partial 0，failed 0"
    );
  });
});
