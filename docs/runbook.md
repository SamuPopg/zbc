# 指纹对比工具运行说明

## 准备

1. 启动 AdsPower 客户端。
2. 确认 Local API 地址是 `http://local.adspower.com:50325`。
3. 准备后端地址，例如测试环境或正式环境 API 域名。
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
npm.cmd run start -- --config config.local.json
```

## 输出

报告会生成到 `reports` 目录：

- HTML：人工横向查看。
- JSON：排查和后续自动化扩展。

第一版只展示设置值和 BS 值，不做通过/失败判断。

## Local API 连通性检查

```powershell
Invoke-RestMethod -Method Post -Uri "http://local.adspower.com:50325/api/v2/browser-profile/list" -Headers @{ Authorization = "Bearer $env:ADSPOWER_API_KEY" } -ContentType "application/json" -Body '{"page":1,"page_size":1}'
```

返回 `code` 为 `0` 表示 Local API 和 API key 可用。
