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
  "outputDir": "reports"
}
```

`browserScanUrl` 建议使用 BrowserScan 首页，例如 `https://www.browserscan.net/`。如果配置为 `/webrtc`、`/canvas` 等单项页面，BrowserScan 快照可能不存在，BS值会显示「未获取」。

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

## 只改代理或 WebGL 后，BS 值为什么会变化

同一浏览器环境下，只改了代理信息或 WebGL 元数据配置，BrowserScan 的 webgl、Client Rects、经度、纬度、GPU 等 BS 值发生变化，通常是符合采集原理的正常现象，不是环境配置失败。详细解释和排查方式见 [runbook](docs/runbook.md#为什么只改代理或-webgl-后部分-bs-值会变化)。

## 验证

```powershell
npm.cmd run typecheck
npm.cmd test
```
