# zbc 工具版本更新记录

本文档用于记录 zbc 指纹对比工具的功能更新、采集能力优化、报告能力优化、修复项和验证结果，方便团队后续快速了解每次改动的目的、影响范围和注意事项。

文档按时间倒序排列，每条更新包含：更新内容、影响范围、验证结果、注意事项四部分。涉及代码改动时附 commit hash；具体实现细节请直接查看 commit/PR。

补充约定：

- “设置值 / BS值 / Probe值”三类来源含义见 `README.md` 和 `docs/runbook.md`。
- 本文档不替代 README、runbook、superpowers 计划文档，只补充“这次改动做了什么、为什么、影响谁”。
- 报告功能不引入通过/失败判定；保持中性描述。

## 2026-06-02 - HTML 报告 UI 改版

### 更新内容

- HTML 报告视觉改为企业审计 / QA report 风格：白底浅灰面板、灰色 hairline 1px 分隔，IBM Blue `#0f62fe` 作为唯一品牌色，状态色 `#24a148` / `#f1c21b` / `#da1e28` 仅出现在状态 badge 上；去掉了之前的大色块 hero、圆角和阴影。
- 报告顶部新增 7 个摘要 tile：Profile 数、Fingerprint 项目数、OK、Partial、Error、需人工判断、未获取 BS 值；profile header 增加状态 badge（OK / Partial / Error）。
- 表格列宽拆分：首列 170px 固定，profile 数据列 280-320px；移动端 summary 改为 2 列布局，第 7 个 tile 跨满整行避免出现空灰块；"备注" 标签使用 `white-space: nowrap` 避免拆字。

### 影响范围

- 报告：仅 HTML 报告视觉与人工阅读体验。`reports/*.json` 字段结构、脱敏、中性化措辞、`stability` 块、Probe 校验状态等保持不变。
- 内部模块：`src/reportWriter.ts`（CSS 与 HTML 结构重写，业务函数未变）。
- 测试：`tests/reportWriter.test.ts` 新增 Carbon UI class 存在 / 旧 class 缺失 / 小屏 summary 规则等断言；XSS、脱敏、neutralize 等老断言全部保留。
- 配置：无需修改 `config.local.json`。

### 验证结果

- `npm.cmd run typecheck`：通过。
- `npm.cmd test -- tests/reportWriter.test.ts`：6/6 通过。
- `npm.cmd test`：14 个测试文件，161/161 通过。
- 旧 commit：`94eb3aa Redesign fingerprint report UI`。

### 注意事项

- 旧 HTML 报告不会自动变成新视觉风格，需要用新版代码重新跑采集并重新生成 `reports/*.html`。
- 旧报告 JSON 仍可继续阅读与对比，新 HTML 与旧 JSON 字段名完全兼容。
- 顶部摘要 tile 和状态 badge 仅用于人工快速定位采集完整性和复核重点，不替代对单字段（设置值 / BS值 / Probe / 备注）的中性判断。

## 2026-05-29 - Firefox 指纹采集稳定性优化

### 更新内容

- 修复 Firefox 环境下容易误采到本机 Firefox 而不是 AdsPower 启动的内核的问题，确保采集到的指纹值来自目标 AdsPower profile。
- 补齐 Firefox BrowserScan `_getComponent()` 字段映射，使 BS 值覆盖率从原来的部分字段提升到 31 个字段。
- 优化 Firefox 场景下 Probe 的超时处理：单个慢检测项不再阻塞整组 Probe，避免出现整组 Probe 为空或只返回 `probe.error` 的情况。

### 影响范围

- 浏览器：Firefox 内核 AdsPower profile。
- 报告：HTML 报告 BS 值列和 JSON 报告 `browserScan.componentSnapshot`、`browserScan.probe.values` 完整性提升。
- 内部模块：`src/browserScanCollector.ts`、`src/runner.ts`、`src/seleniumAdapter.ts`。
- 配置：无需修改 `config.local.json`。

### 验证结果

- 新增并调整了 `tests/browserScanCollector.test.ts`、`tests/runner.test.ts`、`tests/seleniumAdapter.test.ts`。
- 在三类 Firefox profile 场景下，BS 字段映射数量提升到 31，Probe 有效值数量提升到 20/20/19。
- 旧 commit：`feb19ac`。

### 注意事项

- Firefox 模式必须使用 AdsPower 启动的内核，本机独立启动的 Firefox 不会被工具接受。
- Probe 超时处理是“单项失败不影响其他项”，不保证所有字段 100% 采到，仍可能出现 `未获取` 或 `Probe实测：xxx` 的中性备注。

## 2026-05-28 - 新增 Firefox 内核环境指纹采集

### 更新内容

- 接入 Firefox Marionette，通过 Selenium WebDriver 附加到 AdsPower 已启动的 Firefox 环境，避免依赖本机 Firefox 或 Playwright 不支持 Firefox 时的连接问题。
- 抽象 `BrowserAutomation` / `BrowserAutomationPage` 接口，Chrome 链路走 Playwright/CDP，Firefox 链路走 Selenium/Marionette，由 `connectAutomation()` 统一派发。
- 根据 `settings.browser` 或 `browser_kernel_config.type` 自动识别浏览器类型，不再由调用方手动选择适配器。
- Local API 启动响应里增加 `ws.selenium` 和 `marionette_port` 解析，Firefox 启动后能直接拿到自动化连接信息。
- `collectBrowserScan` 内的字符串求值改为 `executeAsyncScript`，支持 Firefox 场景下的异步 IIFE。

### 影响范围

- 浏览器：Firefox 内核 AdsPower profile。
- 报告：新增对 Firefox 环境的指纹采集和报告输出能力。
- 内部模块：`src/browserAutomation.ts`、`src/seleniumAdapter.ts`、`src/playwrightAdapter.ts`、`src/browserScanCollector.ts`、`src/browserSession.ts`、`src/localApi.ts`、`src/runner.ts`。
- 依赖：新增 `selenium-webdriver` 和 `@types/selenium-webdriver`。
- 配置：无需修改 `config.local.json`。

### 验证结果

- 调整了 `tests/browserScanCollector.test.ts`、`tests/browserSession.test.ts`、`tests/localApi.test.ts`、`tests/runner.test.ts`。
- 在 Firefox profile 场景下完成端到端采集验证：能启动、连接 Marionette、打开 BrowserScan、采集 BS 值和 Probe 值。
- 旧 commit：`3abf3fc`。

### 注意事项

- Firefox 模式依赖 AdsPower 启动时返回 Marionette 端口；若环境未启用 Firefox 内核或端口不可用，profile 会回退到 `failed` 或 `partial` 状态。
- 现有 Chrome/CDP 链路保持兼容，未触发行为变化，老 profile 报告与之前一致。

## 2026-05-21 - 报告差异对比功能

### 更新内容

- 新增 `compareReportsCli`，支持对比两份已生成的指纹报告，输出 HTML 差异报告和 JSON 差异报告，输出位置在 `diff-reports/diff-report-<timestamp>.*`。
- 对比三类来源：设置值、BS值、Probe值；状态词为 `无变化 / 有变化 / 新增值 / 丢失值 / 均未获取`。
- 报告差异对比是“离线”功能，不启动 AdsPower，不访问 BrowserScan，不重新采集。
- 同步优化差异 HTML 体积和数值展示形式，输出更紧凑。

### 影响范围

- 命令行：`npm.cmd run compare-reports -- reports\old.json reports\new.json`（HTML 路径会自动查找同名 JSON）。
- 输出：`diff-reports/` 目录。
- 内部模块：`src/compareReportsCli.ts`、`src/reportDiff.ts`、`src/reportDiffWriter.ts`。
- 配置：无需修改 `config.local.json`；新增 `.gitignore` 忽略 `diff-reports/` 输出。

### 验证结果

- 新增 `tests/compareReportsCli.test.ts`、`tests/reportDiff.test.ts`、`tests/reportDiffWriter.test.ts`，覆盖 CLI 入口、深度 diff、HTML 数值简化等场景。
- 旧 commit：`56d52ae`、`9ad7904`、`52d9a9c`、`b2c3513`、`f502b81`。

### 注意事项

- 报告差异对比是“报告对报告”的工具，不替代实际的指纹采集。
- 差异只显示两类报告都采到的字段；BrowserScan 没采到的字段仍按 `未获取` 处理。

## 2026-05-21 - 冷启动稳定性复测与连接稳定性优化

### 更新内容

- 新增 BrowserScan 稳定性复测模式，支持 `session`（同会话内多次采集）和 `restart`（多次冷启动采集）两种模式。
- 修复冷启动复测在某一轮连接失败时，剩余轮次仍能完成采集并保留证据。
- 修复 AdsPower 启动后 CDP 连接偶发失败的问题，补充启动后重连机制。
- 稳定性 JSON 报告增加 `stability.fields` 摘要，状态词保持中性：`unchanged / changed / not_collected`。
- 修复稳定性 BrowserScan JSON 在某些字段上出现空值污染的问题，做了脱敏和过滤。

### 影响范围

- 配置：`stabilityRuns`、`stabilityMode`、`closeAfterRun` 行为变化；`stabilityMode=restart` 要求 `closeAfterRun=true`。
- 报告：JSON 报告增加 `stability` 块；HTML 仍以首轮为准，但备注区会标注多轮复测结果。
- 内部模块：`src/runner.ts`、`src/browserSession.ts`、`src/browserScanCollector.ts`。
- 文档：`README.md` 增加状态/返回结果说明。

### 验证结果

- 调整了 `tests/browserSession.test.ts`、`tests/runner.test.ts`。
- 旧 commit：`fa8b2f8`、`fac5300`、`a70c82d`、`c6d7f71`、`55c1a36`。

### 注意事项

- 冷启动复测会反复启动和关闭同一个 profile，请确认 `closeAfterRun=true` 且 AdsPower 客户端处于可用状态。
- `stabilityRuns` 建议 1-5；超过 5 会被配置校验拒绝。

## 2026-05-21 - 报告字段映射与采集能力补齐

### 更新内容

- 在 JSON 报告中保留 BrowserScan `_getComponent()` 完整快照，写入 `browserScan.componentSnapshot`，便于后续回溯原始 BS 字段。
- 增加指纹字段依赖说明（哪些字段相互影响，BS 值变化时的判断顺序），写入报告备注。
- 精简并规范化报告备注：把字段级备注和 profile 级备注统一汇总到备注区，避免每条记录重复展示。

### 影响范围

- 报告：JSON 报告体积增加（增加 componentSnapshot），但 HTML 报告展示保持简洁。
- 内部模块：`src/browserScanCollector.ts`、`src/reportWriter.ts`。

### 验证结果

- 调整了 `tests/browserScanCollector.test.ts`。
- 旧 commit：`7be2337`、`7c9dc3e`、`655791f`。

### 注意事项

- `componentSnapshot` 是 BrowserScan 的原始数据，可能较大；只在 JSON 中保留，HTML 不展示。
- 字段依赖说明以备注形式呈现，不改变报告的展示列。

## 2026-05-20 - 文档与安全性补齐

### 更新内容

- 新增 `docs/runbook.md`，补充工具运行说明、采集逻辑、Probe 校验规则和常见问题。
- 完善 `README.md` 使用说明书，补充配置示例和报告状态说明。
- 文档示例中的 profile ID、API key 等敏感占位符做了脱敏处理。
- 明确本地 `config.local.json` 不应提交，避免误提交真实配置。

### 影响范围

- 文档：`docs/runbook.md`、`README.md`、示例配置。
- 业务代码、报告、采集链路无任何变化。

### 验证结果

- 旧 commit：`1f8d421`、`fd7d1e4`、`c709a73`、`8be12f4`。

### 注意事项

- 后续修改文档时，继续保持示例数据脱敏。

## 2026-05-20 - 报告 Probe 校验与样式完善

### 更新内容

- 增加 Probe 校验说明：哪些字段可直接对齐（UA、timezone、language、screen、dpr、hardware_concurrency、device_memory、do_not_track、webgl_config），哪些字段只能辅助判断（canvas、audio、webgl_image、client_rects、fonts、media_devices、webrtc）。
- 报告 HTML 样式优化，增加设置值/BS值/备注的视觉层次，方便横向对比。
- 报告脱敏加强：嵌套结构中的敏感字段也会被脱敏，不只是顶层字段。

### 影响范围

- 报告：HTML 样式、JSON 报告 `browserScan.probe.checks` 字段。
- 内部模块：`src/reportWriter.ts`、`src/probeValidation.ts`（含嵌套脱敏逻辑）。
- 配置：无需修改。

### 验证结果

- 调整了 `tests/reportWriter.test.ts`、`tests/probeValidation.test.ts`。
- 旧 commit：`14c1cee`、`0f56659`、`4a499c3`。

### 注意事项

- Probe 是辅助排查工具，校验状态保持中性（`一致 / 需人工判断 / 无法通过 JS 校验`），不输出 pass/fail。

## 2026-05-20 - 报告编排与运行器测试

### 更新内容

- 工具入口完成编排：批量读取设置值、启动环境、连接浏览器、采集 BS 值、采集 Probe、生成 HTML/JSON 报告。
- 增加报告证据保留：BrowserScan 原始文本、Probe 原始数组等都写入 JSON。
- 状态词中性化：去除通过/失败相关措辞，避免误读。
- 补充 runner、report evidence 相关测试覆盖。

### 影响范围

- 内部模块：`src/runner.ts`、`src/reportWriter.ts`、`src/browserScanCollector.ts`。
- 配置：行为依赖 `config.local.json`，无新增字段。

### 验证结果

- 新增 `tests/runner.test.ts` 等覆盖。
- 旧 commit：`6481bd1`、`f66b648`、`01e5672`、`469ec93`、`224bea4`。

### 注意事项

- 旧 commit 同时引入了大量“中性化措辞”改动，阅读历史报告时如果对比老版本，措辞会略有差异，以新版为准。

## 2026-05-20 - 工具首次成型

### 更新内容

- 工具首次可用：批量启动 AdsPower 环境、读取设置值、打开 BrowserScan、生成 HTML/JSON 报告。
- Local API 完成浏览器生命周期管理：start / connect / collect / close。
- 后端接口调用 `get-open-user-list` 读取指纹设置，失败时回退 Local API profile list。
- 引入 `npm.cmd run start`、`npm.cmd run typecheck`、`npm.cmd test` 三个常用命令。
- 引入 BrowserScan 采集模块、配置加载模块、报告写入模块、配置脱敏模块。

### 影响范围

- 项目初始化：完整搭建 `src/`、`tests/`、`docs/superpowers/plans/`、`docs/superpowers/specs/`。
- 报告：v0.1.0 第一次可用版本。

### 验证结果

- 旧 commit：`c0f81cc`、`779caec`、`1fab73b`、`dc726c4`、`c714c83`、`872a0c1`、`f30db71`、`ff548d2`、`46e585b`、`c1d01bc`、`b760163`、`d0ebda6`、`34cdfd0`、`c35616e`、`3e1e2ad`。

### 注意事项

- v0.1.0 不做通过/失败判定；不创建/修改 AdsPower profile；不依赖本地 BrowserScan。
- 第一版仅支持已存在的 profile ID，由调用方在配置里传入。

