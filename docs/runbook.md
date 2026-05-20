# 指纹对比工具运行说明

## 适用场景

这个工具用于 AdsPower 指纹回归检查：批量启动指定环境，读取环境设置值，打开 BrowserScan 首页采集实测值，然后输出 HTML/JSON 报告。HTML 报告用于人工横向查看，JSON 报告用于排查和后续自动化。

报告只展示「设置值」和「BS值」，不在报告里做通过/失败判定。

## 准备

1. 启动 AdsPower 客户端。
2. 确认 Local API 地址，默认是 `http://local.adspower.com:50325`。
3. 准备后端 API 地址。
4. 准备要检测的环境 ID。
5. 准备 BrowserScan 首页地址，建议使用 `https://www.browserscan.net/`。

## 配置

复制模板：

```powershell
Copy-Item config.example.json config.local.json
```

填写 `config.local.json`：

- `backendBaseUrl`：AdsPower 后端接口地址。
- `localApiBaseUrl`：AdsPower Local API 地址。
- `browserScanUrl`：BrowserScan 首页地址。
- `profileIds`：要横向对比的环境 ID 列表。
- `closeAfterRun`：运行完成后是否关闭浏览器和环境。
- `timeoutMs`：单个页面加载超时时间。
- `outputDir`：报告输出目录。

不要把 API key 写进提交文件。PowerShell 里设置：

```powershell
$env:ADSPOWER_API_KEY="你的真实 API key"
```

`config.local.json` 只在本地使用，不要提交。

## 运行

```powershell
npm.cmd run start -- --config config.local.json
```

报告会生成到 `outputDir` 目录，默认是 `reports`：

- HTML：人工横向查看每个环境的设置值和 BS 值。
- JSON：排查和后续自动化扩展使用。

## BrowserScan 采集逻辑

工具打开 BrowserScan 后会做两类采集。

第一类是浏览器 runtime 兜底值：

- `ua`
- `language`
- `languages`
- `platform`
- `hardware_concurrency`
- `device_memory`
- `webdriver`
- `timezone`
- `screen_resolution`
- `screen_available_resolution`
- `color_depth`
- `dpr`

第二类是 BrowserScan 内部检测快照。BrowserScan 首页会挂载 `window._getComponent()`，工具会读取并解码这个快照，再映射为报告里的 BS 值：

- `webrtc`：STUN 和 UDP/TURN 结果。
- `canvas`：Canvas hash。
- `webgl`：WebGL report hash。
- `webgl_image`：WebGL image hash。
- `webgl_config`：Unmasked Vendor 和 Unmasked Renderer。
- `audio`：Audio hash。
- `fonts`：字体 hash、字体数量和前 20 个字体样例。
- `client_rects`：Client Rects hash。
- `gpu`：WebGPU hash 和 WebGPU 详情。
- `tls`：JA3、JA4、TLS fingerprint 等 HTTP 指纹数据。
- `ip`、`ip_country`、`ip_region`、`ip_city`、`timezone`、`language`：BrowserScan 网络和软件检测数据。

如果 `_getComponent()` 不存在、未完成或解码失败，工具不会中断，会继续保留 runtime 兜底值并生成报告。对应字段可能显示「未获取」。

## Local API 连通性检查

```powershell
Invoke-RestMethod -Method Post -Uri "http://local.adspower.com:50325/api/v2/browser-profile/list" -Headers @{ Authorization = "Bearer $env:ADSPOWER_API_KEY" } -ContentType "application/json" -Body '{"page":1,"page_size":1}'
```

返回 `code` 为 `0` 表示 Local API 和 API key 可用。

## 排查

### BS 值大面积显示「未获取」

先检查 `browserScanUrl`。如果配置成 `https://www.browserscan.net/webrtc`、`/canvas` 这类单项页面，首页快照 `_getComponent()` 可能不存在，WebRTC、Canvas、WebGL、音频、字体、TLS 等字段就无法完整映射。

建议改回：

```json
"browserScanUrl": "https://www.browserscan.net/"
```

### WebRTC 显示 `disabled`

这是 BrowserScan 的实测值。BrowserScan 通过 `RTCPeerConnection` 收集 ICE candidate，`srflx` 对应 STUN 公网 IP，`relay` 对应 TURN/UDP IP。显示 `disabled` 表示该通道没有拿到泄露 IP，不代表工具采集失败。

### TLS 为空

TLS 来自 BrowserScan 的 HTTP 指纹检测结果。如果为空，通常是 BrowserScan 的相关接口没有返回完整数据。检查页面是否加载完成、网络是否能访问 BrowserScan、代理是否拦截了相关请求。

### 报告里出现敏感字段

报告写入前会对密码、token、cookie、代理密钥、Authorization、API key 等值做脱敏，替换为 `[REDACTED]`。如果新增字段属于敏感字段但没有被脱敏，需要把字段名加入敏感键列表。

## 验证命令

```powershell
npm.cmd test
npm.cmd run typecheck
```
