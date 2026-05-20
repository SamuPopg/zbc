import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReports } from "../src/reportWriter.js";

describe("writeReports", () => {
  it("writes json and html without secrets or pass/fail wording", async () => {
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
                settings: {
                  ua: "Mozilla/5.0",
                  password: "secret-password",
                  user_proxy_config: { password: "proxy-secret" }
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
                    value: "Mozilla/5.0",
                    source: "runtime",
                    note: "runtime collection failed"
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

      expect(html).toContain("PROFILE_ID_1");
      expect(html).toContain("Mozilla/5.0");
      expect(html).not.toContain("secret-password");
      expect(html).not.toContain("proxy-secret");
      expect(html).not.toMatch(/pass|fail|通过|失败/i);
      expect(json).not.toContain("secret-password");
      expect(json).not.toContain("proxy-secret");
      expect(json).not.toMatch(/pass|fail|通过|失败/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
