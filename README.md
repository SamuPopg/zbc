# AdsPower 指纹横向对比工具

这个工具用于批量启动 AdsPower 环境，读取环境指纹设置值，打开 BrowserScan，并生成 HTML/JSON 横向对比报告。报告主界面仍只展示每个指纹项的「设置值」和「BS值」，不做通过/失败判定。

## 解决测试人员什么问题

这个工具把测试人员手工打开 AdsPower 环境、逐项查看指纹配置、再去 BrowserScan 对照截图的流程，变成批量、可复查、可定位问题来源的报告。

- 批量验收环境指纹是否按配置生效：一次性对比多个 profile 的 UA、时区、语言、屏幕、WebGL、Canvas、WebRTC 等字段，减少重复手工检查。
- 明确区分问题来源：报告把「设置值」「BS值」「Probe值」分开，便于判断是配置没下发、浏览器运行时没生效、BrowserScan 没采到，还是字段本身不能直接用 JS 判断。
- 降低误判：Canvas、Audio、WebGL Image、WebRTC 这类字段不会被粗暴写成通过/失败，而是提供中性备注和 Probe 实测值，让测试人员基于证据人工判断。
- 留下可回溯证据：HTML 适合人工查看和转发，JSON 保留脱敏后的完整排查数据，方便回归、复盘和交给开发定位。

## 数据来源

报告里有三类来源：

- 设置值：来自 AdsPower 后端配置；后端不可用时，会回退到 AdsPower Local API `/api/v2/browser-profile/list`。
- BS值：来自 BrowserScan 第三方实测，优先读取 BrowserScan 首页的 `window._getComponent()` 快照。
- Probe值：工具自己在已启动环境里执行 JS 得到的辅助实测值，只写入 JSON 和 HTML 备注，不会顶替 BS值。

如果 BrowserScan 没采到某个字段，HTML 里的 BS值会保持「未获取」。Probe 值只会在备注里显示为 `Probe实测：xxx`，用于排查 AdsPower 设置是否在浏览器运行时生效。

## 功能

- 批量读取环境设置值。
- 通过 AdsPower Local API 启动指定环境，并用 Playwright 连接已启动浏览器。
- 打开 BrowserScan 首页采集第三方实测值。
- 执行 runtime probe，采集 UA、时区、语言、屏幕、DPR、WebGL、Canvas、Audio、ClientRects、字体、媒体设备、WebRTC ICE candidate 等辅助值。
- 生成 HTML 报告和脱敏 JSON 报告。

## 配置

复制配置模板：

```powershell
Copy-Item config.example.json config.local.json
```

编辑 `config.local.json`：

```json
{
  "backendBaseUrl": "https://api.example.test",
  "localApiBaseUrl": "http://local.adspower.com:50325",
  "browserScanUrl": "https://www.browserscan.net/",
  "profileIds": ["PROFILE_ID_1", "PROFILE_ID_2"],
  "closeAfterRun": true,
  "runMode": "sequential",
  "timeoutMs": 60000,
  "outputDir": "reports",
  "stabilityRuns": 1,
  "stabilityMode": "session"
}
```

`browserScanUrl` 建议使用 BrowserScan 首页，例如 `https://www.browserscan.net/`。如果配置为 `/webrtc`、`/canvas` 等单项页面，BrowserScan 快照可能不存在，BS值会显示「未获取」。

`stabilityRuns` 可设置为 1-5，默认 1。`stabilityMode` 默认为 `session`。

- `session`：同一个已启动 AdsPower 环境内连续采集 BrowserScan 多次，用于观察 BrowserScan 页面采集、测量时机、WebGPU/Client Rects 等运行时字段是否波动。
- `restart`：每轮重新启动并关闭同一个 AdsPower profile，用于观察多次冷启动后指纹配置是否一致生效。该模式要求 `closeAfterRun=true`。

HTML 仍展示第一轮的「设置值 / BS值 / 备注」；JSON 会额外写入 `stability.mode`、`stability.runs` 和 `stability.fields`。`changed` 不是失败，只表示多轮采到的值不同。

不要提交真实的 `config.local.json` 或 API key。

## 运行

```powershell
$env:ADSPOWER_API_KEY="你的 API key"
npm.cmd run start -- --config config.local.json
```

输出文件生成到 `outputDir`：

- `fingerprint-report-*.html`：人工查看的横向对比报告。
- `fingerprint-report-*.json`：脱敏后的完整排查数据，包含完整 Probe 原始值、BrowserScan `_getComponent()` 原始快照 `browserScan.componentSnapshot` 和每个字段的校验备注。

## Probe 校验

Probe 校验只使用中性状态：

- `一致`：设置值和 Probe 值可以直接对齐，例如 UA、timezone、language、screen_resolution、DPR、hardware_concurrency、device_memory、do_not_track、webgl_config。
- `需人工判断`：设置值和 Probe 值不是同一种语义，例如 canvas、webgl、webgl_image、audio、client_rects、fonts、media_devices、webrtc。
- `无法通过 JS 校验`：TLS、出口 IP、HTTP header、服务端网络视角相关字段。

`canvas=1`、`audio=1`、`webgl_image=1` 这类设置不会判断”正确 hash”，只在备注里显示 Probe hash 并标记为 `需人工判断`。

## 状态与返回结果说明

本节说明报告中可能出现的各类状态和返回值的含义，便于查看 JSON 和 HTML 报告时快速理解。措辞保持中性，不做通过/失败判定。

### 配置阶段错误

配置加载阶段会直接终止运行，通常不生成报告。常见错误：

| 错误信息 | 含义 |
|---|---|
| `apiKey is required` | 未设置 API key |
| `profileIds must contain at least one profile id` | 未传入任何 profile ID |
| `profileIds must only contain non-empty strings` | profile ID 列表中包含空字符串 |
| `backendBaseUrl is required` | 未设置后端接口地址 |
| `localApiBaseUrl is required` | 未设置 Local API 地址 |
| `browserScanUrl is required` | 未设置 BrowserScan 地址 |
| `stabilityRuns must be an integer between 1 and 5` | 复测轮数超出 1-5 范围 |
| `stabilityMode must be “session” or “restart”` | 稳定性模式值不合法 |
| `stabilityMode restart requires closeAfterRun=true when stabilityRuns > 1` | 冷启动复测需要 closeAfterRun=true |

### profile 整体状态（results[].status）

| 状态 | 含义 |
|---|---|
| `ok` | 设置值获取成功，且第一轮 BrowserScan 采集成功 |
| `partial` | 设置值或第一轮 BrowserScan 有一边不完整。例如设置值获取失败但 BrowserScan 采集成功，或 BrowserScan 第一轮失败 |
| `failed` | profile 运行过程中出现未处理异常。冷启动复测中的单轮连接失败通常记录到 `stability.runs[].browserScan`，不一定导致整个 profile failed |

### 设置值状态（results[].settings.fetchStatus）

| 状态 | 含义 |
|---|---|
| `ok` | 通过后端或 Local API 获取到了 AdsPower profile 设置 |
| `failed` | 设置值获取失败，原因在 `results[].settings.error` |

### BrowserScan 状态（results[].browserScan.status）

| 状态 | 含义 |
|---|---|
| `ok` | BrowserScan 采集成功 |
| `failed` | 启动环境、连接 CDP、访问 BrowserScan 或采集过程失败，原因在 `results[].browserScan.error` |

### 稳定性模式（stability.mode）

| 模式 | 含义 |
|---|---|
| `session` | 同一个已启动环境中连续采集多轮，观察 BrowserScan 页面/采集过程本身的短时间波动 |
| `restart` | 每轮执行 start -> connect -> collect -> close -> stop，观察冷启动后的指纹稳定性 |

`stabilityRuns` 为 1 时通常不生成 stability 摘要；设置为 2-5 时才有复测意义。

### 稳定性字段状态（stability.fields[field].status）

| 状态 | 含义 |
|---|---|
| `unchanged` | 多轮采到的非空值一致 |
| `changed` | 多轮采到的非空值不一致，不是失败，只表示有波动，需结合设置值、BS值、Probe、componentSnapshot 判断 |
| `not_collected` | 所有轮次都没有采到这个字段 |

失败轮次中没有采到的空值不参与 changed/unchanged 判断。例如 3 轮中 1 轮 BrowserScan 失败，另外 2 轮该字段值相同，则该字段仍为 `unchanged`，但 `samples` 会显示某一轮没有值。`browser_scan_raw_text` 不纳入 stability.fields。

### 单轮稳定性采集结果（stability.runs[].browserScan.status）

| 状态 | 含义 |
|---|---|
| `ok` | 该轮 BrowserScan 采集成功 |
| `failed` | 该轮没有采集到 BrowserScan，原因在 `stability.runs[].browserScan.error` |

“冷启动复测有 1/3 轮未采集到 BrowserScan” 表示 3 轮中有 1 轮失败、2 轮成功，这是该 profile 的复测摘要，不是每个指纹项都失败。

### 字段值来源（BrowserScanValue.source）

| 来源 | 含义 |
|---|---|
| `dom` | 从 BrowserScan 页面 DOM 读取 |
| `runtime` | 从 BrowserScan 页面运行态/组件快照读取 |
| `probe` | 工具自己的 JS Probe 采集到的辅助实测值 |
| `not_collected` | 未采到该字段 |

Probe 值不能顶替 BS 值。BrowserScan 没采到时，BS值仍应显示未获取。

### Probe 校验状态

| 状态 | 含义 |
|---|---|
| `一致` | 设置值和 Probe 实测值可直接比较且一致 |
| `需人工判断` | 字段可辅助观察，但不能自动判定 |
| `无法通过 JS 校验` | 该字段不适合通过页面 JS Probe 验证 |

Probe 是辅助排查工具，不是 BrowserScan 的替代来源。

### 备注来源

HTML 备注可能来自：

- BrowserScan 字段自身备注
- 字段依赖说明
- Probe 校验备注
- Probe 实测值
- profile 级摘要，例如冷启动复测有多少轮未采集到 BrowserScan
- 关闭浏览器/关闭环境时的清理提示

备注可能会比较长，因为字段级备注和 profile 级备注都会进入备注区域。

## 只改代理或 WebGL 后，BS 值为什么会变化

同一浏览器环境下，只改了代理信息或 WebGL 元数据配置，BrowserScan 的 webgl、Client Rects、经度、纬度、GPU 等 BS 值发生变化，通常是符合采集原理的正常现象，不是环境配置失败。详细解释和排查方式见 [runbook](docs/runbook.md#为什么只改代理或-webgl-后部分-bs-值会变化)。

## 报告差异对比

对比两份已生成的指纹检测报告，输出差异 HTML 和 JSON。该功能**不启动 AdsPower，不访问 BrowserScan，不重新采集**。

```powershell
npm.cmd run compare-reports -- reports\old.json reports\new.json
npm.cmd run compare-reports -- reports\old.html reports\new.html
```

第一个路径为旧报告/基准报告，第二个为新报告/当前报告。HTML 路径会自动查找同名 JSON。

输出到 `diff-reports/diff-report-<timestamp>.html` 和 `.json`。

状态词：`无变化` `有变化` `新增值` `丢失值` `均未获取`。

三类来源对比：设置值、BS值、Probe值。Probe 为辅助，不能顶替 BS。

详细说明见 [runbook](docs/runbook.md#报告差异对比)。

## 验证

```powershell
npm.cmd run typecheck
npm.cmd test
```
