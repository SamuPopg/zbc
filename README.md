# AdsPower 指纹横向对比工具

这个工具用于批量启动 AdsPower 环境，读取环境指纹设置值，打开 BrowserScan，并生成 HTML/JSON 横向对比报告。报告重点展示每个指纹项的「设置值」和「BS值」，不做通过/失败判定。

## 功能

- 从 AdsPower 后端详情接口读取环境指纹配置。
- 通过 Local API 启动指定环境，并用 Playwright 连接已启动浏览器。
- 打开 BrowserScan 首页采集实测值。
- 优先读取 BrowserScan 内部 `window._getComponent()` 快照，补齐 WebRTC、Canvas、WebGL、音频、字体、Client Rects、GPU、TLS 等值。
- 保留浏览器运行时采集作为兜底，例如 UA、语言、平台、时区、屏幕、DPR、CPU 核心数、设备内存。
- 输出 HTML 报告和脱敏后的 JSON 报告。

## 准备

1. 安装依赖：

   ```powershell
   npm install
   ```

2. 启动 AdsPower 客户端，并确认 Local API 可用。

3. 准备后端地址、Local API 地址、BrowserScan 地址和环境 ID。

4. 设置 API key 环境变量：

   ```powershell
   $env:ADSPOWER_API_KEY="你的 API key"
   ```

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
  "outputDir": "reports"
}
```

`browserScanUrl` 建议使用 BrowserScan 首页，例如 `https://www.browserscan.net/`。首页会暴露 `_getComponent()` 快照，工具才能稳定拿到 WebRTC、Canvas、WebGL、音频、字体、TLS 等 BS 值。若配置为单项页面，例如 `/webrtc` 或 `/canvas`，部分 BS 值可能只能依赖兜底采集，报告会显示「未获取」。

不要提交真实的 `config.local.json` 或 API key。

## 运行

```powershell
npm.cmd run start -- --config config.local.json
```

输出文件生成在 `outputDir`，默认是 `reports`：

- `fingerprint-report-*.html`：人工查看的横向对比报告。
- `fingerprint-report-*.json`：用于排查和后续自动化的脱敏数据。

## BS 值来源

BrowserScan 首页完成检测后会在页面上提供 `window._getComponent()`。工具会解码这个快照，并映射到报告字段：

- `webrtc`：`stun`、`udp`。
- `canvas`：Canvas hash。
- `webgl`：WebGL report hash。
- `webgl_image`：WebGL image hash。
- `webgl_config`：Unmasked Vendor、Unmasked Renderer。
- `audio`：Audio hash。
- `fonts`：字体 hash、数量、前 20 个样例。
- `client_rects`：Client Rects hash。
- `gpu`：WebGPU hash 和 WebGPU 详情。
- `tls`：JA3、JA4、TLS fingerprint 等 HTTP 指纹数据。
- `ip`、`ip_country`、`ip_region`、`ip_city`、`timezone`、`language`：BrowserScan 的网络和软件检测数据。

如果 `_getComponent()` 不存在、未完成或解码失败，工具会保留已采集到的 runtime 值，并继续生成报告。

## 常用检查

```powershell
npm.cmd test
npm.cmd run typecheck
```

Local API 连通性检查：

```powershell
Invoke-RestMethod -Method Post -Uri "http://local.adspower.com:50325/api/v2/browser-profile/list" -Headers @{ Authorization = "Bearer $env:ADSPOWER_API_KEY" } -ContentType "application/json" -Body '{"page":1,"page_size":1}'
```

返回 `code` 为 `0` 表示 Local API 和 API key 可用。

## 排查

- BS 值显示「未获取」：先确认 `browserScanUrl` 是否为 BrowserScan 首页。
- WebRTC 显示 `disabled`：这是 BrowserScan 的实测值，表示 STUN/TURN 未拿到对应泄露 IP，不等于采集失败。
- TLS 为空：通常是 BrowserScan 的 HTTP 指纹接口没有返回完整数据，检查页面是否完成加载和网络是否可访问。
- 只看到 runtime 值：说明 `_getComponent()` 不存在或没有完成，检查 BrowserScan 页面是否变更、是否被广告/网络/权限问题阻塞。
- HTML/JSON 中不会保留敏感字段，密码、token、cookie、代理密钥等会被替换为 `[REDACTED]`。
