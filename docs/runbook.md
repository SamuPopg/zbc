# 指纹对比工具运行说明

## 适用场景

这个工具用于 AdsPower 指纹回归检查：批量启动指定环境，读取环境设置值，打开 BrowserScan 首页采集第三方实测值，同时执行一组 JS Probe 采集浏览器运行时辅助值，然后输出 HTML/JSON 报告。

HTML 报告保持简单：每个指纹项只显示「设置值」和「BS值」。Probe 值只进入备注，不新增列，也不替代 BS值。

它主要解决测试执行中的四个问题：

- 手工慢：不用逐个 profile 打开环境、复制配置、截图 BrowserScan；工具会批量启动、采集并生成横向对比报告。
- 证据散：HTML 展示给人工看，JSON 保留脱敏后的完整设置值、BS值、Probe 原始值和校验备注，方便回溯同一次验收。
- 来源难定位：设置值来自后端/Local API，BS值来自 BrowserScan，Probe值来自当前浏览器运行时 JS 实测；三类来源分开后，能更快判断问题卡在配置、浏览器生效、第三方采集还是网络视角。
- 容易误判：对 UA、timezone、webgl_config 这类字段给出中性的一致性备注；对 Canvas、Audio、WebRTC 这类不能直接等价判断的字段，只提示 `需人工判断` 和 `Probe实测：xxx`，不把报告变成简单 pass/fail。

## 三类来源

- 设置值：AdsPower 后端配置。后端不可用时，工具回退到 Local API `/api/v2/browser-profile/list`。
- BS值：BrowserScan 第三方实测。工具优先读取首页 `window._getComponent()` 快照，并映射到报告字段。
- Probe值：工具在启动后的 AdsPower 环境里执行 JS 得到的辅助实测值。Probe 用来帮助判断设置是否生效，但不是 BrowserScan 值。

如果 BrowserScan 没采到某个字段，BS值显示「未获取」。即使 Probe 采到了对应 runtime 值，也只会显示在备注里，例如 `Probe实测：Mozilla/5.0`。

## 运行前准备

1. 启动 AdsPower 客户端。
2. 确认 Local API 可用，默认地址是 `http://local.adspower.com:50325`。
3. 准备后端 API 地址。
4. 准备要检测的环境 ID。
5. 设置 API key。

### Windows（PowerShell）

```powershell
$env:ADSPOWER_API_KEY="你的真实 API key"
```

### macOS（bash / zsh）

```bash
export ADSPOWER_API_KEY="你的真实 API key"
```

> macOS 上若 `local.adspower.com` 解析不通，可将 `config.local.json` 中的 `localApiBaseUrl` 改为 `http://127.0.0.1:50325`。

## 配置

复制模板。

### Windows（PowerShell）

```powershell
Copy-Item config.example.json config.local.json
```

### macOS（bash / zsh）

```bash
cp config.example.json config.local.json
```

关键字段：

- `backendBaseUrl`：AdsPower 后端接口地址。
- `localApiBaseUrl`：AdsPower Local API 地址。
- `browserScanUrl`：BrowserScan 首页地址，建议使用 `https://www.browserscan.net/`。
- `profileIds`：要横向对比的环境 ID 列表。
- `closeAfterRun`：运行完成后是否关闭浏览器和环境。
- `timeoutMs`：单个页面加载超时时间。
- `outputDir`：报告输出目录。

`config.local.json` 只在本地使用，不要提交。

## 采集逻辑

工具对每个 profile 按顺序执行：

1. 读取设置值。优先走后端 `get-open-user-list`，失败后回退 Local API profile list。
2. 通过 Local API `/api/v2/browser-profile/start` 启动环境。
3. 用 `ws.puppeteer` 或 `debug_port` 连接已启动浏览器。
4. 打开 BrowserScan 首页。
5. 读取 BrowserScan `_getComponent()` 快照，解码后写入 JSON 的 `browserScan.componentSnapshot`，同时映射到 BS值。
6. 执行 runtime Probe，写入 JSON 的 `browserScan.probe.raw` 和 `browserScan.probe.values`。
7. 用设置值和 Probe 值生成 `browserScan.probe.checks`。
8. 生成 HTML/JSON 报告。

## Probe 校验规则

直接对齐字段：

- `ua`
- `timezone`
- `language`
- `screen_resolution`
- `dpr`
- `hardware_concurrency`
- `device_memory`
- `do_not_track`
- `webgl_config`

这些字段如果设置值不是按 IP、随机、跟随本机等模式，并且 Probe 值一致，备注会显示 `设置值与 Probe一致`。

需人工判断字段：

- `canvas`
- `webgl`
- `webgl_image`
- `audio`
- `client_rects`
- `fonts`
- `media_devices`
- `webrtc`

这些字段的设置值通常是开关或模式，Probe 采到的是 hash、列表或 ICE candidate，因此不能强判定。报告只显示 `需人工判断` 和 `Probe实测：xxx`。

无法通过 JS 校验字段：

- `tls`
- `ip`
- `ip_country`
- `ip_region`
- `ip_city`
- HTTP header / 服务端网络视角相关字段

这些字段需要服务端或第三方网络视角，JS Probe 不能直接验证。

## 常见排查

### BS值大面积显示「未获取」

先检查 `browserScanUrl`。如果配置成 `https://www.browserscan.net/webrtc`、`/canvas` 这类单项页面，首页快照 `_getComponent()` 可能不存在。建议改回：

```json
"browserScanUrl": "https://www.browserscan.net/"
```

### WebRTC 如何看

BrowserScan 的 BS值仍以 BrowserScan 结果为准。Probe 会额外采集 `RTCPeerConnection` ICE candidate，备注里可参考是否出现 `srflx` 或 `relay`。`webrtc=disabled` 时，没有 `srflx/relay` 可作为辅助判断，但报告不会把它写成通过/失败。

### TLS 为空

TLS 来自 BrowserScan 的 HTTP 指纹检测结果。Probe 无法通过 JS 直接验证 TLS，所以这类字段会标记为 `无法通过 JS 校验`。如果 BS值为空，检查 BrowserScan 页面是否加载完成、网络是否能访问 BrowserScan、代理是否拦截相关请求。

### 敏感字段

报告写入前会对密码、token、cookie、代理密钥、Authorization、API key 等值脱敏为 `[REDACTED]`。

## 为什么只改代理或 WebGL 后，部分 BS 值会变化

### 总体结论

- BS值是 BrowserScan 第三方页面在当前浏览器运行环境中实时计算出来的结果。
- 有些 BS 指纹项不是单纯等于 AdsPower 的某个设置值，而是由代理出口、浏览器渲染管线、图形接口、DOM 布局测量、WebGL/WebGPU 能力等多个因素共同计算出来。
- 所以，在只改代理信息或 WebGL 元数据后，部分 BS 值变化是正常现象。
- 这些变化应该结合「设置值、BS值、Probe实测、备注」一起判断，不要简单当成通过/失败。

### 逐项解释

#### 1. 经度、纬度

经度、纬度不是浏览器本地配置直接决定的。BrowserScan 通常根据出口 IP 的地理位置数据库返回 country、region、city、latitude、longitude、timezone 等信息。因此只要代理出口 IP 变了，经度和纬度变化就是预期现象。这类字段应该归因到代理/IP 地理位置，而不是 WebGL 或浏览器硬件指纹。

> 参考源码：`mix_scan/src/composables/useIP.ts`，其中 `ip_data` 包含 city、country、region、latitude、longitude、timezone 等字段。

#### 2. WebGL

BrowserScan 的 webgl BS值通常不是单个 vendor 或 renderer 字符串，而是对一整组 WebGL 检测结果做 hash。这组检测结果包含 UNMASKED_VENDOR_WEBGL、UNMASKED_RENDERER_WEBGL，以及 WebGL 参数、扩展、渲染能力等。因此修改 AdsPower 的 webgl_config，例如 vendor / renderer，导致 BrowserScan 的 webgl hash 变化，是正常且预期的。判断时应优先看 webgl_config 的设置值、BS 展示值、Probe 读取到的 UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL 是否方向一致，而不是只盯 hash 是否变化。

> 参考源码：`mix_scan/src/utils/sources/webgl.ts`（读取 UNMASKED_VENDOR_WEBGL 和 UNMASKED_RENDERER_WEBGL）、`mix_scan/src/components/index/hardware.vue`（webGLReportHash 对 webgl.value JSON 序列化后做 SHA1）。

#### 3. Client Rects

Client Rects 来自浏览器对 DOM 元素布局结果的测量，例如 `getClientRects()`。它受字体、DPR、缩放、渲染管线、图形环境、CSS transform、浏览器版本、反指纹噪声等影响。Client Rects 不是直接依赖 WebGL 元数据，但它对渲染环境非常敏感。如果只改 WebGL 后 Client Rects 也发生变化，不能直接说明 WebGL 影响了 Client Rects；更准确的说法是：BrowserScan 的 Client Rects 采集结果可能受渲染环境、噪声策略或测量时机影响。如果工具里的 Probe Client Rects 稳定，但 BS 的 Client Rects 变化，应标记为「需人工判断」，不要直接判失败。

> 参考源码：`mix_scan/src/utils/sources/clientRect.ts`（创建 DOM 元素并读取 `getClientRects()[0].toJSON()`）、`mix_scan/src/components/index/hardware.vue`（clientRectHash 对 clientRect.value 做 SHA1）。

#### 4. GPU

BrowserScan 里的 GPU 项不一定等同于 WebGL renderer。它可能来自 WebGPU、GPU adapter、WGSL language features、limits/features 等信息的组合 hash。因此 GPU BS值变化不一定代表真实显卡变了，也可能是 WebGPU 返回对象、特性数组顺序、浏览器图形后端、WebGL/WebGPU 适配策略变化导致。如果只看到 GPU hash 变化，应继续查看 raw/probe 里的 WebGPU 或 GPU 相关原始信息，不要仅凭 hash 判失败。

> 参考源码：`mix_scan/src/utils/sources/webgpu.ts`（采集 navigator.gpu、adapter、features、limits、wgslLanguageFeatures 等）、`mix_scan/src/components/index/hardware.vue`（webGPUHash 对 webGPU.value JSON 序列化后做 SHA1）。

### 建议的排查方式

- 如果要判断代理影响，只改代理，WebGL 配置保持不变，连续跑两次报告。
- 如果要判断 WebGL 影响，只改 WebGL 元数据，代理保持不变，连续跑两次报告。
- 如果要判断采集稳定性，完全不改任何配置，连续跑两次报告。
- 对经度、纬度、timezone、language 这类字段，优先检查代理出口 IP 和 IP 地理库结果。
- 对 webgl、gpu、client_rects 这类 hash 字段，不要只看 hash 是否变化，要结合 BrowserScan 原始值、Probe 实测值和备注判断。
- 结论文案要使用「正常/可解释/需人工判断/建议复测」这类中性说法，不要写成强通过或强失败。

## 稳定性复测模式

`stabilityRuns` 可设置为 1-5，默认 1。`stabilityMode` 默认为 `session`。

### 两种模式

- `session`：同会话采集复测。Profile 只启动一次，Browser 只连接一次，然后连续采集 N 轮。用于观察 BrowserScan 页面采集、测量时机、WebGPU/Client Rects 等运行时字段是否波动。
- `restart`：冷启动复测。每一轮都执行 `start profile -> connect browser -> collect BrowserScan -> close browser -> stop profile`。用于观察同一个 profile 多次重新启动后，BrowserScan 字段是否一致。该模式要求 `closeAfterRun=true`。

### 行为说明

- `browserScan` 始终是第一轮采集结果，HTML 报告和现有 JSON 消费者行为不变。
- `stability.runs` 保存全部 N 轮次的 browserScan 数据。
- `stability.fields` 是字段波动摘要，status 为 `unchanged`、`changed` 或 `not_collected`。
- `stability.mode` 表示复测模式。
- `changed` 不是失败，只表示多轮采到的值不同，需结合设置值、BS值、Probe、componentSnapshot 判断。
- `browser_scan_raw_text` 不纳入 `stability.fields`，避免 JSON 变大且无意义。
- restart 模式不自动修改代理、不自动改 WebGL、不编辑 AdsPower profile，只重复启动同一个 profile。

### 字段状态说明

- `unchanged`：该字段在所有轮次中采集到的非空值相同。
- `changed`：该字段在多轮中采集到的非空值不完全相同。
- `not_collected`：该字段在所有轮次中都没有采集到有效值。

### JSON 新增字段

```json
{
  "stability": {
    "mode": "session",
    "runCount": 2,
    "runs": [
      { "runIndex": 1, "browserScan": { ...第一轮完整结果 } },
      { "runIndex": 2, "browserScan": { ...第二轮完整结果 } }
    ],
    "fields": {
      "ua": { "status": "unchanged", "samples": [...], "uniqueValues": [...] },
      "webgl": { "status": "changed", "samples": [...], "uniqueValues": [...] }
    }
  }
}
```

## 状态与返回结果说明

本节详细说明报告中可能出现的各类状态和返回值的含义，便于查看 JSON 和 HTML 报告时快速定位问题来源。措辞保持中性，不做通过/失败判定。

### 一、配置阶段错误

配置加载阶段会直接终止运行，通常不生成报告。常见错误及含义：

| 错误信息 | 含义 |
|---|---|
| `apiKey is required` | 未设置 API key，工具无法调用 AdsPower 接口 |
| `profileIds must contain at least one profile id` | 未传入任何 profile ID |
| `profileIds must only contain non-empty strings` | profile ID 列表中包含空字符串 |
| `backendBaseUrl is required` | 未设置后端接口地址 |
| `localApiBaseUrl is required` | 未设置 Local API 地址 |
| `browserScanUrl is required` | 未设置 BrowserScan 地址 |
| `stabilityRuns must be an integer between 1 and 5` | 复测轮数超出 1-5 范围 |
| `stabilityMode must be "session" or "restart"` | 稳定性模式值不合法，应为 session 或 restart |
| `stabilityMode restart requires closeAfterRun=true when stabilityRuns > 1` | 冷启动复测需要 closeAfterRun=true |

### 二、profile 整体状态（results[].status）

| 状态 | 含义 |
|---|---|
| `ok` | 设置值获取成功，并且第一轮 BrowserScan 采集成功 |
| `partial` | 设置值或第一轮 BrowserScan 有一边不完整。例如设置值获取失败但 BrowserScan 采集成功，或 BrowserScan 第一轮失败 |
| `failed` | profile 运行过程中出现未处理异常。冷启动复测中的单轮连接失败通常会记录到 `stability.runs[].browserScan`，不一定导致整个 profile failed |

### 三、设置值状态（results[].settings.fetchStatus）

| 状态 | 含义 |
|---|---|
| `ok` | 后端或 Local API 取到了 AdsPower profile 设置 |
| `failed` | 设置值获取失败，原因在 `results[].settings.error` |

### 四、BrowserScan 状态（results[].browserScan.status）

| 状态 | 含义 |
|---|---|
| `ok` | BrowserScan 采集成功 |
| `failed` | 启动环境、连接 CDP、访问 BrowserScan 或采集过程失败，原因在 `results[].browserScan.error` |

 BrowserScan 采集失败可能出现在以下环节：环境启动超时、CDP 连接失败、BrowserScan 页面加载超时、页面 DOM 解析异常等。查看 `browserScan.error` 字段可定位具体环节。

### 五、稳定性模式（stability.mode）

| 模式 | 含义 |
|---|---|
| `session` | 同一个已启动环境中连续采集多轮，用于观察 BrowserScan 页面/采集过程本身的短时间波动，例如 WebGPU、Client Rects 等运行时字段在同一次会话内的稳定性 |
| `restart` | 每轮执行 start -> connect -> collect -> close -> stop，用于观察冷启动后的指纹稳定性。该模式要求 `closeAfterRun=true` |

`stabilityRuns` 为 1 时通常不会生成 stability 摘要；设置为 2-5 时才有复测意义。

### 六、稳定性字段状态（stability.fields[field].status）

| 状态 | 含义 |
|---|---|
| `unchanged` | 多轮采到的非空值一致 |
| `changed` | 多轮采到的非空值不一致；不是失败，只表示有波动，需要结合设置值、BS值、Probe、componentSnapshot 判断 |
| `not_collected` | 所有轮次都没有采到这个字段 |

判断规则说明：

- 失败轮次中没有采到的空值不参与 changed/unchanged 判断。
- 例如 3 轮中 1 轮 BrowserScan 失败，另外 2 轮 webgl 都是同一个值，则 webgl 仍会是 `unchanged`，但 `samples` 会显示某一轮没有值。
- `browser_scan_raw_text` 不纳入 `stability.fields`，避免 JSON 变大且无意义。

### 七、单轮稳定性采集结果（stability.runs[].browserScan.status）

| 状态 | 含义 |
|---|---|
| `ok` | 该轮 BrowserScan 采集成功 |
| `failed` | 该轮没有采集到 BrowserScan，原因在 `stability.runs[].browserScan.error` |

**重要示例说明**：

"冷启动复测有 1/3 轮未采集到 BrowserScan" 表示 3 轮中有 1 轮失败、2 轮成功。这是该 profile 的复测摘要，不是每个指纹项都失败。`stability.runs[].browserScan.status` 描述的是该 profile 该轮 BrowserScan 采集的整体结果，不是逐字段的采集状态。

### 八、字段值来源（BrowserScanValue.source）

| 来源 | 含义 |
|---|---|
| `dom` | 从 BrowserScan 页面 DOM 读取 |
| `runtime` | 从 BrowserScan 页面运行态/组件快照读取（即 `window._getComponent()` 快照） |
| `probe` | 工具自己的 JS Probe 采集到的辅助实测值 |
| `not_collected` | 未采到该字段 |

**强调**：Probe 值不能顶替 BS 值。BrowserScan 没采到时，BS值仍应显示未获取。Probe 只是辅助排查手段，用于判断 AdsPower 设置是否在浏览器运行时生效，不作为 BrowserScan 第三方实测值的替代。

### 九、Probe 校验状态

| 状态 | 含义 |
|---|---|
| `一致` | 设置值和 Probe 实测值可直接比较且一致 |
| `需人工判断` | 字段可辅助观察，但不能自动判定。例如 canvas、audio、webgl、webgl_image 等，Probe 采到的是 hash 或列表，与设置值的语义不对等，需要人工判断图形渲染是否正常 |
| `无法通过 JS 校验` | 该字段不适合通过页面 JS Probe 验证。例如 TLS、出口 IP、HTTP header 等，需要服务端或第三方网络视角 |

**强调**：Probe 是辅助排查工具，不是 BrowserScan 的替代来源。即使 Probe 采到某个值，也不能将 BS 值字段标记为"已采集"。

### 十、备注来源

HTML 备注可能来自以下来源，查看备注时可先判断来源类型：

- **BrowserScan 字段自身备注**：BrowserScan 页面中该字段带的备注信息
- **字段依赖说明**：该字段依赖的其他字段说明，例如 webgl 可能注明依赖 renderer 设置
- **Probe 校验备注**：Probe 值和设置值的对比结果，例如 `设置值与 Probe一致` 或 `需人工判断`
- **Probe 实测值**：工具自己的 JS Probe 在浏览器运行环境中采集到的辅助值，显示为 `Probe实测：xxx`
- **profile 级摘要**：profile 整体运行状态说明，例如冷启动复测有多少轮未采集到 BrowserScan
- **关闭浏览器/关闭环境时的清理提示**：描述关闭过程中是否成功清理了浏览器进程和环境

**注意**：当前 HTML 备注区域可能比较长，因为字段级备注（每个指纹项的采集情况）和 profile 级备注（profile 整体运行状态）都会进入同一个备注区域。查看时需区分备注来源类型，结合字段名、状态和备注综合判断。

## 报告差异对比

对比两份已经生成的指纹检测报告，输出差异 HTML 和 JSON。该功能**不启动 AdsPower，不访问 BrowserScan，不重新采集**，只读取已有报告 JSON 比较设置值、BS值、Probe值是否变化。

### 使用方式

#### Windows（PowerShell）

```powershell
npm.cmd run compare-reports -- reports\old.json reports\new.json
npm.cmd run compare-reports -- reports\old.html reports\new.html
```

#### macOS（bash / zsh）

```bash
npm run compare-reports -- reports/old.json reports/new.json
npm run compare-reports -- reports/old.html reports/new.html
```

> macOS 上路径分隔符使用 `/`，不要使用 `\`；使用 `npm`，不要使用 `npm.cmd`。

第一个路径是旧报告/基准报告，第二个路径是新报告/当前报告。

### 输出位置

输出固定写入 `diff-reports/` 子目录，文件名包含生成时间戳：

```
diff-reports/diff-report-2026-05-21Txx-xx-xx-xxxZ.html
diff-reports/diff-report-2026-05-21Txx-xx-xx-xxxZ.json
```

### 状态词说明

| 状态 | 含义 |
|---|---|
| `无变化` | 旧报告和新报告中该值相同 |
| `有变化` | 旧报告和新报告中该值不同 |
| `新增值` | 旧报告中缺失，新报告中有值 |
| `丢失值` | 旧报告中有值，新报告中缺失 |
| `均未获取` | 两边都没有值 |

### 三类来源对比

对每个 profile 的每个指纹字段，比较三类来源：

1. **设置值**：`settings.settings[field]`
2. **BS值**：`browserScan.values[field].value`
3. **Probe值**：`browserScan.probe.values[field].value`

Probe 仍为辅助来源，不能顶替 BS。如果只有 Probe 变化，字段高亮为"soft"；如果设置值或 BS 值变化，高亮为"strong"。

### 轻度归一化比较规则

- `undefined`、`null`、字段不存在，都视为缺失。
- 字符串只 trim 首尾空白后比较，不做其他规范化。
- 对象按结构比较，key 顺序不影响结果。
- 数组按顺序比较，顺序不同算不同。
- 深层 diff 排除 `rawText`、`browser_scan_raw_text` 以及含 `rawText` 的 key。

### 兼容旧报告

如果报告 JSON 缺少 `probe`、`componentSnapshot`、`stability`，按缺失处理，不阻塞设置值/BS值对比。如果缺少 `profileIds`，从 `results[].profileId` 推导。

### 错误处理

- 报告路径不存在：报错并退出
- 传 HTML 但找不到同名 JSON：报错并退出
- JSON 解析失败或缺少 `results[]`：报错并退出

## 验证命令

### Windows（PowerShell）

```powershell
npm.cmd run typecheck
npm.cmd test
```

### macOS（bash / zsh）

```bash
npm run typecheck
npm test
```

## macOS 平台说明

macOS 下使用本工具时的关键差异和注意事项：

- **环境前置**：
  - 已安装 Node.js 和 npm（建议使用官方 LTS 版本，或通过 nvm 管理）。
  - 已启动 AdsPower 客户端，且 Local API 可用，默认地址仍是 `http://local.adspower.com:50325`。
  - 如果 macOS 上 `local.adspower.com` 解析不通，可将 `config.local.json` 中的 `localApiBaseUrl` 改为 `http://127.0.0.1:50325`。
- **命令差异**：
  - 使用 `cp` 而不是 `Copy-Item`。
  - 使用 `export ADSPOWER_API_KEY="..."` 而不是 `$env:ADSPOWER_API_KEY=...`。
  - 使用 `npm`，不要使用 `npm.cmd`（`npm.cmd` 是 Windows / cmd 下的可执行文件名）。
  - 路径分隔符使用 `/`，不要使用 `\`。
- **Firefox 采集链路**：Firefox 内核环境并非用本机 Firefox 采集。工具会通过 AdsPower Local API 启动 profile，并使用 AdsPower 返回的 `webdriver` + `marionette_port` 通过 geckodriver + Marionette 附加到 AdsPower 已启动的 Firefox 环境。如果 macOS 版 AdsPower 未返回 `webdriver` 或 `marionette_port`，Firefox 采集会报错，这是为了避免误采本机指纹。
- **Windows 专用脚本**：`scripts/run-scenario.ps1` 是 Windows PowerShell 辅助脚本，macOS 不作为推荐入口；如需类似辅助，请直接使用 `npm run start -- --config config.local.json` 等 npm 脚本。
