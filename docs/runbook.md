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
5. 设置 API key：

```powershell
$env:ADSPOWER_API_KEY="你的真实 API key"
```

## 配置

复制模板：

```powershell
Copy-Item config.example.json config.local.json
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

设置 `stabilityRuns` 为 2-5 时，工具会在同一个已启动 AdsPower 环境中连续采集 BrowserScan 多次，用于观察同配置下哪些字段稳定、哪些字段有波动。

### 行为说明

- Profile 只启动一次，Browser 只连接一次，然后连续采集 N 轮。
- `browserScan` 始终是第一轮采集结果，HTML 报告和现有 JSON 消费者行为不变。
- `stability.runs` 保存全部 N 轮次的 browserScan 数据。
- `stability.fields` 是字段波动摘要，status 为 `unchanged`、`changed` 或 `not_collected`。
- `changed` 不是失败，只表示多轮采到的值不同，需结合设置值、BS值、Probe、componentSnapshot 判断。
- `browser_scan_raw_text` 不纳入 `stability.fields`，避免 JSON 变大且无意义。
- 不自动修改代理、不自动改 WebGL、不编辑 AdsPower profile。

### 字段状态说明

- `unchanged`：该字段在所有轮次中采集到的非空值相同。
- `changed`：该字段在多轮中采集到的非空值不完全相同。
- `not_collected`：该字段在所有轮次中都没有采集到有效值。

### JSON 新增字段

```json
{
  "stability": {
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

## 验证命令

```powershell
npm.cmd run typecheck
npm.cmd test
```
