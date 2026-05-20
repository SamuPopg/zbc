import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReports } from "../src/reportWriter.js";

describe("writeReports", () => {
  it("produces Apple-style HTML with no secrets or pass/fail wording", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-report-"));
    try {
      const output = await writeReports(
        {
          generatedAt: "2026-05-20T00:00:00.000Z",
          profileIds: ["PROFILE_ID_1"],
          results: [
            {
              profileId: "PROFILE_ID_1",
              status: "failed",
              notes: ["设置值获取失败", "browser scan failed"],
              settings: {
                profileId: "PROFILE_ID_1",
                name: "测试环境-A",
                accId: "ACC_001",
                settings: {
                  ua: "Mozilla/5.0",
                  language: "evidence-pass-fail-通过-失败",
                  platform: `<script>alert("x")</script>&'`,
                  tls:
                    "Authorization: Bearer tls-bearer-secret password=tls-password-secret token=tls-token-secret api_key=tls-api-key-secret",
                  password: "secret-password",
                  user_proxy_config: { password: "proxy-secret" },
                  nested: {
                    ApiKey: "nested-api-key-secret",
                    proxyPassword: "nested-proxy-password-secret"
                  },
                  array_values: [
                    { TOKEN: "array-token-secret" },
                    { cookie_value: "array-cookie-secret" }
                  ],
                  api_key: "snake-api-key-secret",
                  Authorization: "Bearer authorization-token-secret",
                  launch_url:
                    "https://example.test/login?password=query-password-secret&token=query-token-secret&api_key=query-api-key-secret"
                },
                randomFingerprintEnabled: false,
                fetchStatus: "failed",
                error: "backend fetch failed"
              },
              browserScan: {
                profileId: "PROFILE_ID_1",
                status: "failed",
                rawText: "BrowserScan text",
                error: "BrowserScan 执行失败",
                values: {
                  ua: {
                    value: "evidence-pass-fail-通过-失败",
                    source: "runtime",
                    note: "runtime collection failed"
                  },
                  browser_scan_raw_text: {
                    value: "BrowserScan text snapshot",
                    source: "runtime"
                  }
                }
              }
            }
          ]
        },
        dir
      );

      const html = await readFile(output.htmlPath, "utf8");
      const json = await readFile(output.jsonPath, "utf8");
      const parsed = JSON.parse(json);
      const result = parsed.results[0];

      // Title check
      expect(html).toContain("AdsPower 指纹横向对比报告");

      // Value labels
      expect(html).toContain("设置值");
      expect(html).toContain("BS值");

      // Profile
      expect(html).toContain("PROFILE_ID_1");
      expect(html).toContain("ACC_001");
      expect(html).toContain("测试环境-A");

      // UA value
      expect(html).toContain("Mozilla/5.0");
      expect(html).toContain("evidence-pass-fail-通过-失败");

      // BrowserScan
      expect(html).toContain("BrowserScan text snapshot");

      // Script injection escaped
      expect(html).not.toContain(`<script>alert("x")</script>`);
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&quot;x&quot;");
      expect(html).toContain("&#39;");
      expect(html).toContain("&amp;");

      // Sensitive values redacted
      expect(html).not.toContain("secret-password");
      expect(html).not.toContain("proxy-secret");
      expect(html).not.toContain("nested-api-key-secret");
      expect(html).not.toContain("nested-proxy-password-secret");
      expect(html).not.toContain("array-token-secret");
      expect(html).not.toContain("array-cookie-secret");
      expect(html).not.toContain("snake-api-key-secret");
      expect(html).not.toContain("authorization-token-secret");
      expect(html).not.toContain("tls-bearer-secret");
      expect(html).not.toContain("tls-password-secret");
      expect(html).not.toContain("tls-token-secret");
      expect(html).not.toContain("tls-api-key-secret");
      expect(html).not.toContain("query-password-secret");
      expect(html).not.toContain("query-token-secret");
      expect(html).not.toContain("query-api-key-secret");
      expect(html).toContain("[REDACTED]");

      // No template literal residuals
      expect(html).not.toContain("{escapeHtml(");

      // JSON also redacted
      expect(json).not.toContain("secret-password");
      expect(json).not.toContain("proxy-secret");
      expect(json).not.toContain("nested-api-key-secret");
      expect(json).not.toContain("nested-proxy-password-secret");
      expect(json).not.toContain("array-token-secret");
      expect(json).not.toContain("array-cookie-secret");
      expect(json).not.toContain("snake-api-key-secret");
      expect(json).not.toContain("authorization-token-secret");
      expect(json).not.toContain("tls-bearer-secret");
      expect(json).not.toContain("tls-password-secret");
      expect(json).not.toContain("tls-token-secret");
      expect(json).not.toContain("tls-api-key-secret");
      expect(json).not.toContain("query-password-secret");
      expect(json).not.toContain("query-token-secret");
      expect(json).not.toContain("query-api-key-secret");
      expect(json).toContain("[REDACTED]");

      // Neutralized status
      expect(result.status).toBe("error");
      expect(result.settings.fetchStatus).toBe("unavailable");
      expect(result.notes.join(" ")).not.toMatch(/pass|fail|通过|失败/i);
      expect(result.settings.error).not.toMatch(/pass|fail|通过|失败/i);
      expect(result.browserScan.status).toBe("error");
      expect(result.browserScan.error).not.toMatch(/pass|fail|通过|失败/i);
      expect(result.browserScan.values.ua.note).not.toMatch(/pass|fail|通过|失败/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});