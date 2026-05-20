# Fingerprint Compare Tool Implementation Plan（指纹对比工具实现计划）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个独立的 AdsPower 指纹横向对比工具：读取环境设置值，启动环境，打开线上 BrowserScan，采集实际值，并生成 HTML/JSON 报告。

**Architecture:** 使用 Node.js + TypeScript 做命令行工具。后端详情接口负责拿 AdsPower 设置值，Local API 负责启动和关闭环境，Playwright 负责连接已启动浏览器并采集 BrowserScan 页面，Report 模块负责输出报告。

**Tech Stack:** Node.js 20+、TypeScript、tsx、Vitest、Playwright、内置 `fetch`、JSON 配置文件。

---

## 文件结构

- Create: `package.json`  
  项目脚本、依赖、测试命令。

- Create: `tsconfig.json`  
  TypeScript 编译配置。

- Create: `.gitignore`  
  忽略本地配置、输出报告、依赖目录。

- Create: `config.example.json`  
  给用户看的配置模板，不包含真实 API key。

- Create: `src/types.ts`  
  所有核心类型定义：配置、环境、设置值、BS 值、报告结构、错误结构。

- Create: `src/config.ts`  
  读取 JSON 配置，支持环境变量覆盖 API key，做基础校验。

- Create: `src/fingerprintFields.ts`  
  统一维护后端要取的字段，以及报告里要展示的指纹项映射。

- Create: `src/adspowerBackend.ts`  
  调 AdsPower 后端 `fbcc/user/get-open-user-list`，提取并扁平化 `fingerprint_config`。

- Create: `src/localApi.ts`  
  调 Local API 启动/关闭环境。

- Create: `src/browserSession.ts`  
  用 Playwright 连接 Local API 返回的调试端口或 WebSocket。

- Create: `src/browserScanCollector.ts`  
  打开线上 BrowserScan，采集页面可见文本和浏览器运行时指纹值。

- Create: `src/reportWriter.ts`  
  生成 JSON 和 HTML 报告，过滤敏感字段。

- Create: `src/runner.ts`  
  串联完整流程：取设置值、启动环境、采集 BS、关闭环境、写报告。

- Create: `src/index.ts`  
  CLI 入口，解析 `--config` 参数并调用 runner。

- Create: `tests/config.test.ts`  
  配置读取和密钥保护测试。

- Create: `tests/adspowerBackend.test.ts`  
  后端接口参数和 `fingerprint_config` 扁平化测试。

- Create: `tests/localApi.test.ts`  
  Local API 启动/关闭请求测试。

- Create: `tests/reportWriter.test.ts`  
  报告输出、敏感字段过滤、无 pass/fail 文案测试。

- Create: `tests/runner.test.ts`  
  单环境失败不影响其它环境的流程测试。

---

### Task 1: 项目骨架和基础脚本

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `config.example.json`

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "fingerprint-compare-tool",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts --config config.local.json",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "playwright": "^1.44.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "tsx": "^4.11.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: 创建 `.gitignore`**

```gitignore
node_modules/
dist/
reports/
config.local.json
.env
*.log
```

- [ ] **Step 4: 创建 `config.example.json`**

```json
{
  "backendBaseUrl": "https://api.example.test",
  "localApiBaseUrl": "http://local.adspower.com:50325",
  "browserScanUrl": "https://www.browserscan.net/",
  "profileIds": ["PROFILE_ID_1", "PROFILE_ID_2"],
  "closeAfterRun": true,
  "runMode": "sequential",
  "timeoutMs": 60000,
  "outputDir": "reports"
}
```

- [ ] **Step 5: 安装依赖**

Run:

```powershell
npm install
```

Expected:

```text
added ... packages
found 0 vulnerabilities
```

- [ ] **Step 6: 运行基础校验**

Run:

```powershell
npm run typecheck
npm test
```

Expected:

```text
tsc --noEmit
No test files found
```

- [ ] **Step 7: 提交骨架**

```powershell
git add package.json tsconfig.json .gitignore config.example.json package-lock.json
git commit -m "chore: scaffold fingerprint compare tool"
```

---

### Task 2: 类型和配置读取

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: 写配置测试 `tests/config.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { loadConfigFromObject } from "../src/config.js";

describe("loadConfigFromObject", () => {
  it("loads required config and reads api key from env", () => {
    const config = loadConfigFromObject(
      {
        backendBaseUrl: "https://api-ds-testing.xmp.one/",
        localApiBaseUrl: "http://local.adspower.com:50325/",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["i6xdqf"]
      },
      { ADSPOWER_API_KEY: "secret-key" }
    );

    expect(config.backendBaseUrl).toBe("https://api-ds-testing.xmp.one");
    expect(config.localApiBaseUrl).toBe("http://local.adspower.com:50325");
    expect(config.apiKey).toBe("secret-key");
    expect(config.closeAfterRun).toBe(true);
    expect(config.runMode).toBe("sequential");
  });

  it("rejects empty profile id list", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api-ds-testing.xmp.one",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: []
        },
        { ADSPOWER_API_KEY: "secret-key" }
      )
    ).toThrow("profileIds must contain at least one profile id");
  });

  it("rejects missing api key", () => {
    expect(() =>
      loadConfigFromObject(
        {
          backendBaseUrl: "https://api-ds-testing.xmp.one",
          localApiBaseUrl: "http://local.adspower.com:50325",
          browserScanUrl: "https://www.browserscan.net/",
          profileIds: ["i6xdqf"]
        },
        {}
      )
    ).toThrow("apiKey is required");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm test -- tests/config.test.ts
```

Expected:

```text
FAIL tests/config.test.ts
Cannot find module '../src/config.js'
```

- [ ] **Step 3: 创建 `src/types.ts`**

```ts
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
  source: "dom" | "runtime" | "not_collected";
  note?: string;
}

export interface BrowserScanResult {
  profileId: string;
  values: Record<string, BrowserScanValue>;
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
```

- [ ] **Step 4: 创建 `src/config.ts`**

```ts
import { readFile } from "node:fs/promises";
import { ToolConfig } from "./types.js";

type EnvLike = Record<string, string | undefined>;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function loadConfigFromObject(
  source: Record<string, unknown>,
  env: EnvLike = process.env
): ToolConfig {
  const apiKey =
    typeof source.apiKey === "string" && source.apiKey.trim() !== ""
      ? source.apiKey.trim()
      : env.ADSPOWER_API_KEY;

  if (!apiKey) {
    throw new Error("apiKey is required");
  }

  const profileIds = source.profileIds;
  if (!Array.isArray(profileIds) || profileIds.length === 0) {
    throw new Error("profileIds must contain at least one profile id");
  }

  const cleanedProfileIds = profileIds.map((item) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error("profileIds must only contain non-empty strings");
    }
    return item.trim();
  });

  return {
    backendBaseUrl: trimTrailingSlash(requireString(source, "backendBaseUrl")),
    localApiBaseUrl: trimTrailingSlash(requireString(source, "localApiBaseUrl")),
    apiKey,
    browserScanUrl: requireString(source, "browserScanUrl"),
    profileIds: cleanedProfileIds,
    closeAfterRun:
      typeof source.closeAfterRun === "boolean" ? source.closeAfterRun : true,
    runMode: "sequential",
    timeoutMs:
      typeof source.timeoutMs === "number" && source.timeoutMs > 0
        ? source.timeoutMs
        : 60000,
    outputDir:
      typeof source.outputDir === "string" && source.outputDir.trim() !== ""
        ? source.outputDir.trim()
        : "reports"
  };
}

export async function loadConfigFromFile(path: string): Promise<ToolConfig> {
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return loadConfigFromObject(parsed);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```powershell
npm test -- tests/config.test.ts
```

Expected:

```text
PASS tests/config.test.ts
```

- [ ] **Step 6: 运行类型检查**

Run:

```powershell
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

- [ ] **Step 7: 提交配置模块**

```powershell
git add src/types.ts src/config.ts tests/config.test.ts
git commit -m "feat: add config loader"
```

---

### Task 3: 指纹字段清单和后端详情客户端

**Files:**
- Create: `src/fingerprintFields.ts`
- Create: `src/adspowerBackend.ts`
- Test: `tests/adspowerBackend.test.ts`

- [ ] **Step 1: 写后端客户端测试 `tests/adspowerBackend.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { fetchProfileSettings, flattenProfile } from "../src/adspowerBackend.js";

describe("flattenProfile", () => {
  it("flattens fingerprint_config and keeps profile context", () => {
    const settings = flattenProfile({
      id: "i6xdqf",
      acc_id: "604",
      name: "w1485",
      ipchecker: "ip2location",
      fingerprint_config: {
        ua: "Mozilla/5.0",
        language: "en-US",
        webrtc: "disabled"
      },
      switch_random_finger: "0"
    });

    expect(settings.profileId).toBe("i6xdqf");
    expect(settings.accId).toBe("604");
    expect(settings.name).toBe("w1485");
    expect(settings.settings.ua).toBe("Mozilla/5.0");
    expect(settings.settings.language).toBe("en-US");
    expect(settings.settings.webrtc).toBe("disabled");
    expect(settings.settings.ipchecker).toBe("ip2location");
    expect(settings.randomFingerprintEnabled).toBe(false);
  });
});

describe("fetchProfileSettings", () => {
  it("calls get-open-user-list with api key and requested fields", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          list: [
            {
              id: "i6xdqf",
              acc_id: "604",
              fingerprint_config: { ua: "Mozilla/5.0" },
              switch_random_finger: "0"
            }
          ]
        }
      })
    })) as unknown as typeof fetch;

    const result = await fetchProfileSettings(
      {
        backendBaseUrl: "https://api-ds-testing.xmp.one",
        localApiBaseUrl: "http://local.adspower.com:50325",
        apiKey: "secret-key",
        browserScanUrl: "https://www.browserscan.net/",
        profileIds: ["i6xdqf"],
        closeAfterRun: true,
        runMode: "sequential",
        timeoutMs: 60000,
        outputDir: "reports"
      },
      fetchMock
    );

    expect(result[0].profileId).toBe("i6xdqf");
    expect(result[0].fetchStatus).toBe("ok");

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/fbcc/user/get-open-user-list");
    expect(calledUrl).toContain("_local_api=adspower");
    expect(calledUrl).toContain("ids=i6xdqf");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ "api-key": "secret-key" })
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm test -- tests/adspowerBackend.test.ts
```

Expected:

```text
FAIL tests/adspowerBackend.test.ts
Cannot find module '../src/adspowerBackend.js'
```

- [ ] **Step 3: 创建 `src/fingerprintFields.ts`**

```ts
export const BACKEND_PROFILE_FIELDS = [
  "acc_id",
  "number",
  "id",
  "ip",
  "batch_id",
  "user_proxy_config",
  "unique_id",
  "ua",
  "geo",
  "ip_country",
  "ip_region",
  "ip_city",
  "timezone",
  "language",
  "page_language",
  "ip_timezone",
  "automatic_timezone",
  "screen_resolution",
  "fonts",
  "canvas",
  "webgl",
  "webgl_image",
  "webgl_config",
  "audio",
  "browser",
  "platform",
  "dpr",
  "webrtc",
  "browser_kernel_config",
  "mac_address_config",
  "client_rects",
  "hardware_concurrency",
  "device_memory",
  "do_not_track",
  "media_devices",
  "media_devices_num",
  "location",
  "location_switch",
  "longitude",
  "latitude",
  "accuracy",
  "language_switch",
  "page_language_switch",
  "client_hints",
  "gpu",
  "tls",
  "tls_switch",
  "name",
  "ipchecker",
  "browser_run_args",
  "storage_strategy",
  "storage_cloud_option",
  "switch_random_finger"
] as const;

export const REPORT_FINGERPRINT_KEYS = [
  "ua",
  "browser_kernel_config",
  "platform",
  "timezone",
  "automatic_timezone",
  "language",
  "page_language",
  "screen_resolution",
  "dpr",
  "webrtc",
  "canvas",
  "webgl",
  "webgl_image",
  "webgl_config",
  "audio",
  "fonts",
  "client_rects",
  "hardware_concurrency",
  "device_memory",
  "do_not_track",
  "media_devices",
  "location",
  "longitude",
  "latitude",
  "accuracy",
  "client_hints",
  "gpu",
  "tls",
  "ip",
  "ipchecker",
  "ip_country",
  "ip_region",
  "ip_city"
] as const;

export const SENSITIVE_KEYS = new Set([
  "password",
  "fakey",
  "login_cookie",
  "original_cookie",
  "cookie",
  "password_list",
  "user_proxy_config",
  "proxy",
  "proxy_username",
  "proxy_password"
]);
```

- [ ] **Step 4: 创建 `src/adspowerBackend.ts`**

```ts
import { BACKEND_PROFILE_FIELDS } from "./fingerprintFields.js";
import { ProfileSettings, RawProfile, ToolConfig } from "./types.js";

type FetchLike = typeof fetch;

function isRandomFingerprintEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function flattenProfile(profile: RawProfile): ProfileSettings {
  const fingerprintConfig =
    profile.fingerprint_config && typeof profile.fingerprint_config === "object"
      ? profile.fingerprint_config
      : {};

  const settings: Record<string, unknown> = {
    ...profile,
    ...fingerprintConfig,
    ipchecker: profile.ipchecker
  };

  delete settings.fingerprint_config;

  return {
    profileId: profile.id,
    accId: typeof profile.acc_id === "string" ? profile.acc_id : undefined,
    name: typeof profile.name === "string" ? profile.name : undefined,
    settings,
    randomFingerprintEnabled: isRandomFingerprintEnabled(profile.switch_random_finger),
    fetchStatus: "ok"
  };
}

export async function fetchProfileSettings(
  config: ToolConfig,
  fetchImpl: FetchLike = fetch
): Promise<ProfileSettings[]> {
  const url = new URL(`${config.backendBaseUrl}/fbcc/user/get-open-user-list`);
  url.searchParams.set("_local_api", "adspower");
  url.searchParams.set("ids", config.profileIds.join(","));
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", String(Math.min(config.profileIds.length, 100)));
  url.searchParams.set("action", "openfb");
  url.searchParams.set("fields", BACKEND_PROFILE_FIELDS.join(","));

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      "api-key": config.apiKey,
      "x-client-local-api-version": "2.0"
    }
  });

  if (!response.ok) {
    throw new Error(`backend request failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: { list?: RawProfile[] };
  };

  if (body.code !== 0) {
    throw new Error(body.msg || `backend returned code ${String(body.code)}`);
  }

  const list = body.data?.list || [];
  const byId = new Map(list.map((item) => [item.id, flattenProfile(item)]));

  return config.profileIds.map((profileId) => {
    const found = byId.get(profileId);
    if (found) {
      return found;
    }
    return {
      profileId,
      settings: {},
      randomFingerprintEnabled: false,
      fetchStatus: "failed",
      error: "profile not returned by backend"
    };
  });
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```powershell
npm test -- tests/adspowerBackend.test.ts
```

Expected:

```text
PASS tests/adspowerBackend.test.ts
```

- [ ] **Step 6: 运行所有测试和类型检查**

Run:

```powershell
npm test
npm run typecheck
```

Expected:

```text
Test Files ... passed
tsc --noEmit
```

- [ ] **Step 7: 提交后端设置值模块**

```powershell
git add src/fingerprintFields.ts src/adspowerBackend.ts tests/adspowerBackend.test.ts
git commit -m "feat: fetch profile fingerprint settings"
```

---

### Task 4: Local API 启动和关闭环境

**Files:**
- Create: `src/localApi.ts`
- Test: `tests/localApi.test.ts`

- [ ] **Step 1: 写 Local API 测试 `tests/localApi.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { startProfile, stopProfile } from "../src/localApi.js";

const config = {
  backendBaseUrl: "https://api-ds-testing.xmp.one",
  localApiBaseUrl: "http://local.adspower.com:50325",
  apiKey: "secret-key",
  browserScanUrl: "https://www.browserscan.net/",
  profileIds: ["i6xdqf"],
  closeAfterRun: true,
  runMode: "sequential" as const,
  timeoutMs: 60000,
  outputDir: "reports"
};

describe("startProfile", () => {
  it("posts profile_id and parses browser connection info", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          debug_port: "53210",
          ws: { puppeteer: "ws://127.0.0.1:53210/devtools/browser/abc" },
          webdriver: "C:/driver/chromedriver.exe"
        }
      })
    })) as unknown as typeof fetch;

    const result = await startProfile(config, "i6xdqf", fetchMock);

    expect(result.profileId).toBe("i6xdqf");
    expect(result.debugPort).toBe("53210");
    expect(result.wsPuppeteer).toContain("ws://127.0.0.1");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://local.adspower.com:50325/api/v2/browser-profile/start"
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer secret-key" })
    );
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ profile_id: "i6xdqf" })
    );
  });
});

describe("stopProfile", () => {
  it("posts profile_id to stop endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 0, data: {} })
    })) as unknown as typeof fetch;

    await stopProfile(config, "i6xdqf", fetchMock);

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://local.adspower.com:50325/api/v2/browser-profile/stop"
    );
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ profile_id: "i6xdqf" })
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm test -- tests/localApi.test.ts
```

Expected:

```text
FAIL tests/localApi.test.ts
Cannot find module '../src/localApi.js'
```

- [ ] **Step 3: 创建 `src/localApi.ts`**

```ts
import { LocalApiStartResponse, ToolConfig } from "./types.js";

type FetchLike = typeof fetch;

async function postLocalApi(
  config: ToolConfig,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike
): Promise<unknown> {
  const response = await fetchImpl(`${config.localApiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Local API ${path} failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: Record<string, unknown>;
  };

  if (data.code !== 0) {
    throw new Error(data.msg || `Local API ${path} returned code ${String(data.code)}`);
  }

  return data.data || {};
}

export async function startProfile(
  config: ToolConfig,
  profileId: string,
  fetchImpl: FetchLike = fetch
): Promise<LocalApiStartResponse> {
  const data = (await postLocalApi(
    config,
    "/api/v2/browser-profile/start",
    { profile_id: profileId },
    fetchImpl
  )) as {
    debug_port?: string | number;
    ws?: { puppeteer?: string };
    webdriver?: string;
  };

  return {
    profileId,
    debugPort: data.debug_port,
    wsPuppeteer: data.ws?.puppeteer,
    webdriver: data.webdriver,
    raw: data
  };
}

export async function stopProfile(
  config: ToolConfig,
  profileId: string,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  await postLocalApi(
    config,
    "/api/v2/browser-profile/stop",
    { profile_id: profileId },
    fetchImpl
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
npm test -- tests/localApi.test.ts
```

Expected:

```text
PASS tests/localApi.test.ts
```

- [ ] **Step 5: 运行所有测试和类型检查**

Run:

```powershell
npm test
npm run typecheck
```

Expected:

```text
Test Files ... passed
tsc --noEmit
```

- [ ] **Step 6: 提交 Local API 模块**

```powershell
git add src/localApi.ts tests/localApi.test.ts
git commit -m "feat: add local api browser lifecycle"
```

---

### Task 5: 浏览器连接和 BrowserScan 采集

**Files:**
- Create: `src/browserSession.ts`
- Create: `src/browserScanCollector.ts`

- [ ] **Step 1: 创建 `src/browserSession.ts`**

```ts
import { chromium, Browser } from "playwright";
import { LocalApiStartResponse } from "./types.js";

export async function connectToStartedBrowser(
  started: LocalApiStartResponse
): Promise<Browser> {
  if (started.wsPuppeteer) {
    return chromium.connectOverCDP(started.wsPuppeteer);
  }

  if (started.debugPort) {
    return chromium.connectOverCDP(`http://127.0.0.1:${started.debugPort}`);
  }

  throw new Error(`profile ${started.profileId} did not return debug connection info`);
}
```

- [ ] **Step 2: 创建 `src/browserScanCollector.ts`**

```ts
import { BrowserScanResult, BrowserScanValue, ToolConfig } from "./types.js";
import { Browser, Page } from "playwright";

function runtimeValue(value: unknown): BrowserScanValue {
  return { value, source: "runtime" };
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
      device_pixel_ratio: window.devicePixelRatio
    };
  });

  return Object.fromEntries(
    Object.entries(runtime).map(([key, value]) => [key, runtimeValue(value)])
  );
}

async function collectVisibleText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
}

export async function collectBrowserScan(
  config: ToolConfig,
  profileId: string,
  browser: Browser
): Promise<BrowserScanResult> {
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto(config.browserScanUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const rawText = await collectVisibleText(page);
    const values = await collectRuntimeValues(page);

    values.browser_scan_raw_text = {
      value: rawText.slice(0, 20000),
      source: "dom",
      note: "BrowserScan visible text snapshot truncated to 20000 characters"
    };

    return {
      profileId,
      values,
      rawText,
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
  }
}
```

- [ ] **Step 3: 运行类型检查**

Run:

```powershell
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

- [ ] **Step 4: 提交浏览器采集模块**

```powershell
git add src/browserSession.ts src/browserScanCollector.ts
git commit -m "feat: collect browserscan values"
```

---

### Task 6: 报告输出

**Files:**
- Create: `src/reportWriter.ts`
- Test: `tests/reportWriter.test.ts`

- [ ] **Step 1: 写报告测试 `tests/reportWriter.test.ts`**

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReports } from "../src/reportWriter.js";

describe("writeReports", () => {
  it("writes json and html without secrets or pass/fail wording", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-report-"));
    try {
      const output = await writeReports(
        {
          generatedAt: "2026-05-20T00:00:00.000Z",
          profileIds: ["i6xdqf"],
          results: [
            {
              profileId: "i6xdqf",
              status: "ok",
              notes: [],
              settings: {
                profileId: "i6xdqf",
                settings: {
                  ua: "Mozilla/5.0",
                  password: "secret-password"
                },
                randomFingerprintEnabled: false,
                fetchStatus: "ok"
              },
              browserScan: {
                profileId: "i6xdqf",
                status: "ok",
                rawText: "BrowserScan text",
                values: {
                  ua: { value: "Mozilla/5.0", source: "runtime" }
                }
              }
            }
          ]
        },
        dir
      );

      const html = await readFile(output.htmlPath, "utf8");
      const json = await readFile(output.jsonPath, "utf8");

      expect(html).toContain("i6xdqf");
      expect(html).toContain("Mozilla/5.0");
      expect(html).not.toContain("secret-password");
      expect(html).not.toMatch(/pass|fail|通过|失败/i);
      expect(json).not.toContain("secret-password");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm test -- tests/reportWriter.test.ts
```

Expected:

```text
FAIL tests/reportWriter.test.ts
Cannot find module '../src/reportWriter.js'
```

- [ ] **Step 3: 创建 `src/reportWriter.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPORT_FINGERPRINT_KEYS, SENSITIVE_KEYS } from "./fingerprintFields.js";
import { ReportData } from "./types.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function buildHtml(report: ReportData): string {
  const rows = REPORT_FINGERPRINT_KEYS.map((key) => {
    const cells = report.results
      .map((result) => {
        const setting = safeSettings(result.settings.settings)[key];
        const browserScan = result.browserScan?.values[key]?.value;
        const note = result.browserScan?.values[key]?.note || result.notes.join("; ");
        return `<td><div><b>设置值</b><pre>${escapeHtml(formatValue(setting))}</pre></div><div><b>BS值</b><pre>${escapeHtml(formatValue(browserScan))}</pre></div><div class="note">${escapeHtml(note)}</div></td>`;
      })
      .join("");
    return `<tr><th>${escapeHtml(key)}</th>${cells}</tr>`;
  }).join("\n");

  const headers = report.results
    .map((result) => `<th>${escapeHtml(result.profileId)}</th>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>AdsPower 指纹横向对比报告</title>
  <style>
    body { font-family: Arial, "Microsoft YaHei", sans-serif; margin: 24px; color: #1f2937; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 1px solid #d1d5db; padding: 10px; vertical-align: top; }
    th { background: #f3f4f6; text-align: left; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 4px 0 10px; font-family: Consolas, monospace; }
    .note { color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <h1>AdsPower 指纹横向对比报告</h1>
  <p>生成时间：${escapeHtml(report.generatedAt)}</p>
  <table>
    <thead><tr><th>指纹项</th>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function buildSafeJson(report: ReportData): string {
  const cleaned: ReportData = {
    ...report,
    results: report.results.map((result) => ({
      ...result,
      settings: {
        ...result.settings,
        settings: safeSettings(result.settings.settings)
      }
    }))
  };
  return JSON.stringify(cleaned, null, 2);
}

export async function writeReports(
  report: ReportData,
  outputDir: string
): Promise<{ htmlPath: string; jsonPath: string }> {
  await mkdir(outputDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const htmlPath = join(outputDir, `fingerprint-report-${stamp}.html`);
  const jsonPath = join(outputDir, `fingerprint-report-${stamp}.json`);

  await writeFile(htmlPath, buildHtml(report), "utf8");
  await writeFile(jsonPath, buildSafeJson(report), "utf8");

  return { htmlPath, jsonPath };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
npm test -- tests/reportWriter.test.ts
```

Expected:

```text
PASS tests/reportWriter.test.ts
```

- [ ] **Step 5: 运行所有测试和类型检查**

Run:

```powershell
npm test
npm run typecheck
```

Expected:

```text
Test Files ... passed
tsc --noEmit
```

- [ ] **Step 6: 提交报告模块**

```powershell
git add src/reportWriter.ts tests/reportWriter.test.ts
git commit -m "feat: write fingerprint comparison reports"
```

---

### Task 7: 主流程 Runner 和 CLI

**Files:**
- Create: `src/runner.ts`
- Create: `src/index.ts`
- Test: `tests/runner.test.ts`

- [ ] **Step 1: 写 runner 测试 `tests/runner.test.ts`**

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportData } from "../src/runner.js";

describe("buildReportData", () => {
  it("keeps one failed profile and one successful profile in the same report", () => {
    const report = buildReportData([
      {
        profileId: "i6xdjv",
        status: "failed",
        notes: ["Local API start error"],
        settings: {
          profileId: "i6xdjv",
          settings: {},
          randomFingerprintEnabled: false,
          fetchStatus: "failed",
          error: "backend unavailable"
        }
      },
      {
        profileId: "i6xdqf",
        status: "ok",
        notes: [],
        settings: {
          profileId: "i6xdqf",
          settings: { ua: "Mozilla/5.0" },
          randomFingerprintEnabled: false,
          fetchStatus: "ok"
        },
        browserScan: {
          profileId: "i6xdqf",
          status: "ok",
          rawText: "",
          values: {
            ua: { value: "Mozilla/5.0", source: "runtime" }
          }
        }
      }
    ]);

    expect(report.profileIds).toEqual(["i6xdjv", "i6xdqf"]);
    expect(report.results).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm test -- tests/runner.test.ts
```

Expected:

```text
FAIL tests/runner.test.ts
Cannot find module '../src/runner.js'
```

- [ ] **Step 3: 创建 `src/runner.ts`**

```ts
import { fetchProfileSettings } from "./adspowerBackend.js";
import { connectToStartedBrowser } from "./browserSession.js";
import { collectBrowserScan } from "./browserScanCollector.js";
import { startProfile, stopProfile } from "./localApi.js";
import { writeReports } from "./reportWriter.js";
import { ProfileRunResult, ProfileSettings, ReportData, ToolConfig } from "./types.js";

export function buildReportData(results: ProfileRunResult[]): ReportData {
  return {
    generatedAt: new Date().toISOString(),
    profileIds: results.map((result) => result.profileId),
    results
  };
}

function failedSettings(profileId: string, error: unknown): ProfileSettings {
  return {
    profileId,
    settings: {},
    randomFingerprintEnabled: false,
    fetchStatus: "failed",
    error: error instanceof Error ? error.message : String(error)
  };
}

export async function runFingerprintCompare(config: ToolConfig): Promise<{
  report: ReportData;
  htmlPath: string;
  jsonPath: string;
}> {
  let settingsList: ProfileSettings[];
  try {
    settingsList = await fetchProfileSettings(config);
  } catch (error) {
    settingsList = config.profileIds.map((profileId) => failedSettings(profileId, error));
  }

  const settingsById = new Map(settingsList.map((settings) => [settings.profileId, settings]));
  const results: ProfileRunResult[] = [];

  for (const profileId of config.profileIds) {
    const settings = settingsById.get(profileId) || failedSettings(profileId, "missing settings");
    const notes: string[] = [];

    if (settings.fetchStatus === "failed" && settings.error) {
      notes.push(`设置值获取失败：${settings.error}`);
    }
    if (settings.randomFingerprintEnabled) {
      notes.push("检测到随机指纹开启，第一版不支持精确设置值对比");
    }

    try {
      const started = await startProfile(config, profileId);
      const browser = await connectToStartedBrowser(started);
      const browserScan = await collectBrowserScan(config, profileId, browser);
      if (config.closeAfterRun) {
        await browser.close().catch(() => undefined);
      }

      results.push({
        profileId,
        settings,
        browserScan,
        status: browserScan.status === "ok" && settings.fetchStatus === "ok" ? "ok" : "partial",
        notes
      });
    } catch (error) {
      notes.push(error instanceof Error ? error.message : String(error));
      results.push({
        profileId,
        settings,
        status: "failed",
        notes
      });
    } finally {
      if (config.closeAfterRun) {
        await stopProfile(config, profileId).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          const last = results[results.length - 1];
          if (last?.profileId === profileId) {
            last.notes.push(`关闭环境失败：${message}`);
          }
        });
      }
    }
  }

  const report = buildReportData(results);
  const paths = await writeReports(report, config.outputDir);

  return { report, ...paths };
}
```

- [ ] **Step 4: 创建 `src/index.ts`**

```ts
import { loadConfigFromFile } from "./config.js";
import { runFingerprintCompare } from "./runner.js";

function getConfigPath(argv: string[]): string {
  const index = argv.indexOf("--config");
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }
  return "config.local.json";
}

async function main(): Promise<void> {
  const configPath = getConfigPath(process.argv.slice(2));
  const config = await loadConfigFromFile(configPath);
  const result = await runFingerprintCompare(config);

  console.log(`HTML report: ${result.htmlPath}`);
  console.log(`JSON report: ${result.jsonPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```powershell
npm test -- tests/runner.test.ts
```

Expected:

```text
PASS tests/runner.test.ts
```

- [ ] **Step 6: 运行所有测试和类型检查**

Run:

```powershell
npm test
npm run typecheck
```

Expected:

```text
Test Files ... passed
tsc --noEmit
```

- [ ] **Step 7: 提交主流程**

```powershell
git add src/runner.ts src/index.ts tests/runner.test.ts
git commit -m "feat: orchestrate fingerprint comparison run"
```

---

### Task 8: 真实环境连通性验证

**Files:**
- Create: `docs/runbook.md`

- [ ] **Step 1: 创建本地配置 `config.local.json`**

这个文件不能提交。内容由执行人本地填写：

```json
{
  "backendBaseUrl": "https://api-ds-testing.xmp.one",
  "localApiBaseUrl": "http://local.adspower.com:50325",
  "browserScanUrl": "https://www.browserscan.net/",
  "profileIds": ["i6xdqf"],
  "closeAfterRun": true,
  "runMode": "sequential",
  "timeoutMs": 60000,
  "outputDir": "reports"
}
```

PowerShell 中设置 API key：

```powershell
$env:ADSPOWER_API_KEY="你的真实 API key"
```

- [ ] **Step 2: 启动 AdsPower 客户端并确认 Local API 可用**

Run:

```powershell
Invoke-RestMethod -Method Post -Uri "http://local.adspower.com:50325/api/v2/browser-profile/list" -Headers @{ Authorization = "Bearer $env:ADSPOWER_API_KEY" } -ContentType "application/json" -Body '{"page":1,"page_size":1}'
```

Expected:

```text
返回 code 为 0，说明 Local API 和 API key 可用。
```

- [ ] **Step 3: 跑完整流程**

Run:

```powershell
npm run start -- --config config.local.json
```

Expected:

```text
HTML report: reports\fingerprint-report-...
JSON report: reports\fingerprint-report-...
```

- [ ] **Step 4: 检查报告**

打开输出的 HTML 文件，确认：

```text
能看到环境 ID。
能看到“设置值”和“BS值”。
没有“通过”“失败”“pass”“fail”判断。
没有 API key、密码、cookie。
```

- [ ] **Step 5: 创建 `docs/runbook.md`**

```md
# 指纹对比工具运行说明

## 准备

1. 启动 AdsPower 客户端。
2. 确认 Local API 地址是 `http://local.adspower.com:50325`。
3. 准备后端地址，例如 `https://api-ds-testing.xmp.one`。
4. 准备要检测的环境 ID。

## 配置

复制 `config.example.json` 为 `config.local.json`，填写：

- `backendBaseUrl`
- `localApiBaseUrl`
- `browserScanUrl`
- `profileIds`

不要把 API key 写进提交文件。PowerShell 里设置：

```powershell
$env:ADSPOWER_API_KEY="你的真实 API key"
```

## 运行

```powershell
npm run start -- --config config.local.json
```

## 输出

报告会生成到 `reports` 目录：

- HTML：人工横向查看。
- JSON：排查和后续自动化扩展。

第一版只展示设置值和 BS 值，不做通过/失败判断。
```

- [ ] **Step 6: 提交运行说明**

```powershell
git add docs/runbook.md
git commit -m "docs: add runbook for fingerprint compare tool"
```

---

## 最终验收命令

Run:

```powershell
npm test
npm run typecheck
```

Expected:

```text
Test Files ... passed
tsc --noEmit
```

真实环境 smoke test：

```powershell
$env:ADSPOWER_API_KEY="你的真实 API key"
npm run start -- --config config.local.json
```

Expected:

```text
生成 HTML 和 JSON 报告。
报告包含每个环境的设置值和 BS 值。
报告不包含 API key、cookie、密码。
报告不包含通过/失败判断。
```

---

## 计划自查

- Spec 覆盖：本计划覆盖配置、后端设置值、Local API 启动、BrowserScan 采集、HTML/JSON 报告、失败不中断、敏感字段过滤、随机指纹提示。
- 范围控制：第一版不创建环境、不修改 AdsPower 源码、不跑本地 BrowserScan、不做断言。
- 类型一致性：核心类型都集中在 `src/types.ts`，后续模块只引用这些类型。
- 敏感信息处理：API key 只允许通过环境变量或本地配置读取，`.gitignore` 忽略 `config.local.json`，报告模块过滤敏感字段。
