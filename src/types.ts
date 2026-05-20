export type RunMode = "sequential";

export interface ToolConfig {
  backendBaseUrl: string;
  localApiBaseUrl: string;
  apiKey: string;
  browserScanUrl: string;
  profileIds: string[];
  closeAfterRun: boolean;
  runMode: RunMode;
  timeoutMs: number;
  outputDir: string;
}

export interface RawProfile {
  id: string;
  acc_id?: string;
  name?: string;
  fingerprint_config?: Record<string, unknown>;
  switch_random_finger?: string | number | boolean;
  [key: string]: unknown;
}

export interface ProfileSettings {
  profileId: string;
  accId?: string;
  name?: string;
  settings: Record<string, unknown>;
  randomFingerprintEnabled: boolean;
  fetchStatus: "ok" | "failed";
  error?: string;
}

export interface LocalApiStartResponse {
  profileId: string;
  debugPort?: string | number;
  wsPuppeteer?: string;
  webdriver?: string;
  raw: unknown;
}

export interface BrowserScanValue {
  value: unknown;
  source: "dom" | "runtime" | "probe" | "not_collected";
  note?: string;
}

export type ProbeCheckStatus = "一致" | "需人工判断" | "无法通过 JS 校验";

export interface ProbeCheck {
  status: ProbeCheckStatus;
  note: string;
  settingValue?: unknown;
  probeValue?: unknown;
}

export interface ProbeResult {
  raw: Record<string, unknown>;
  values: Record<string, BrowserScanValue>;
  checks?: Record<string, ProbeCheck>;
  error?: string;
}

export interface BrowserScanResult {
  profileId: string;
  values: Record<string, BrowserScanValue>;
  probe?: ProbeResult;
  rawText: string;
  status: "ok" | "failed";
  error?: string;
}

export interface ProfileRunResult {
  profileId: string;
  settings: ProfileSettings;
  browserScan?: BrowserScanResult;
  status: "ok" | "partial" | "failed";
  notes: string[];
}

export interface ReportData {
  generatedAt: string;
  profileIds: string[];
  results: ProfileRunResult[];
}
