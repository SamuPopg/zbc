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
5. 读取 BrowserScan `_getComponent()` 快照，写入 BS值。
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

## 验证命令

```powershell
npm.cmd run typecheck
npm.cmd test
```
