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
                componentSnapshot: {
                  allComplete: true,
                  hardware: {
                    webGPUHash: "component-webgpu-hash",
                    webGPU: {
                      adapter: "component-adapter",
                      wgslLanguageFeatures: ["readonly_and_readwrite_storage_textures", "packed_4x8_integer_dot_product"]
                    }
                  },
                  httpFP: {
                    tls_fp_hash: "component-tls-hash",
                    authorization: "Bearer component-authorization-secret"
                  },
                  software: {
                    fontsList: ["Arial", "Calibri"],
                    token: "component-token-secret"
                  },
                  ipdata: {
                    ip: "198.51.100.20",
                    city: "New York"
                  }
                },
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

      // componentSnapshot present in JSON with nested structure
      expect(result.browserScan.componentSnapshot.hardware.webGPU.wgslLanguageFeatures).toEqual([
        "readonly_and_readwrite_storage_textures",
        "packed_4x8_integer_dot_product"
      ]);
      expect(result.browserScan.componentSnapshot.httpFP.tls_fp_hash).toBe("component-tls-hash");
      expect(result.browserScan.componentSnapshot.ipdata.city).toBe("New York");

      // Sensitive fields redacted in JSON
      expect(json).not.toContain("component-authorization-secret");
      expect(json).not.toContain("component-token-secret");
      expect(result.browserScan.componentSnapshot.httpFP.authorization).toBe("[REDACTED]");
      expect(result.browserScan.componentSnapshot.software.token).toBe("[REDACTED]");

      // HTML does NOT display componentSnapshot data
      expect(html).not.toContain("wgslLanguageFeatures");
      expect(html).not.toContain("component-webgpu-hash");
      expect(html).not.toContain("component-tls-hash");
      expect(html).not.toContain("component-token-secret");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps missing BS values empty while showing probe notes and checks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-report-"));
    try {
      const output = await writeReports(
        {
          generatedAt: "2026-05-20T00:00:00.000Z",
          profileIds: ["PROFILE_ID_1"],
          results: [
            {
              profileId: "PROFILE_ID_1",
              status: "ok",
              notes: [],
              settings: {
                profileId: "PROFILE_ID_1",
                settings: {
                  ua: "Mozilla/5.0",
                  timezone: "Asia/Shanghai",
                  webgl_config: {
                    unmasked_vendor: "Google Inc.",
                    unmasked_renderer: "ANGLE Renderer"
                  },
                  canvas: "1",
                  tls: "0xC02C"
                },
                randomFingerprintEnabled: false,
                fetchStatus: "ok"
              },
              browserScan: {
                profileId: "PROFILE_ID_1",
                status: "ok",
                rawText: "BrowserScan text",
                values: {
                  browser_scan_raw_text: {
                    value: "BrowserScan text snapshot",
                    source: "dom"
                  }
                },
                probe: {
                  raw: {
                    ua: "Mozilla/5.0",
                    timezone: "Asia/Shanghai",
                    webgl_config: {
                      unmaskedVendor: "Google Inc.",
                      unmaskedRenderer: "ANGLE Renderer"
                    },
                    canvasHash: "probe-canvas-hash"
                  },
                  values: {
                    ua: { value: "Mozilla/5.0", source: "probe" },
                    timezone: { value: "Asia/Shanghai", source: "probe" },
                    webgl_config: {
                      value: {
                        unmaskedVendor: "Google Inc.",
                        unmaskedRenderer: "ANGLE Renderer"
                      },
                      source: "probe"
                    },
                    canvas: { value: "probe-canvas-hash", source: "probe" },
                    tls: { value: undefined, source: "probe" }
                  },
                  checks: {
                    ua: {
                      status: "一致",
                      note: "设置值与 Probe一致",
                      settingValue: "Mozilla/5.0",
                      probeValue: "Mozilla/5.0"
                    },
                    timezone: {
                      status: "一致",
                      note: "设置值与 Probe一致",
                      settingValue: "Asia/Shanghai",
                      probeValue: "Asia/Shanghai"
                    },
                    webgl_config: {
                      status: "一致",
                      note: "设置值与 Probe一致",
                      settingValue: {
                        unmasked_vendor: "Google Inc.",
                        unmasked_renderer: "ANGLE Renderer"
                      },
                      probeValue: {
                        unmaskedVendor: "Google Inc.",
                        unmaskedRenderer: "ANGLE Renderer"
                      }
                    },
                    canvas: {
                      status: "需人工判断",
                      note: "需人工判断：设置值与 Probe值语义不同",
                      settingValue: "1",
                      probeValue: "probe-canvas-hash"
                    },
                    tls: {
                      status: "无法通过 JS 校验",
                      note: "无法通过 JS 校验：该字段依赖服务端网络或 TLS 视角",
                      settingValue: "0xC02C"
                    }
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
      const probe = parsed.results[0].browserScan.probe;

      expect(html).toContain("BS值");
      expect(html).toContain("未获取");
      expect(html).not.toContain(`<span class="value-label bs">BS值</span>
    <div class="value-box"><pre>Mozilla/5.0</pre></div>`);
      expect(html).toContain("设置值与 Probe一致");
      expect(html).toContain("Probe实测：Mozilla/5.0");
      expect(html).toContain("需人工判断");
      expect(html).toContain("Probe实测：probe-canvas-hash");
      expect(html).toContain("无法通过 JS 校验");

      expect(probe.raw.canvasHash).toBe("probe-canvas-hash");
      expect(probe.checks.ua.note).toBe("设置值与 Probe一致");
      expect(probe.checks.canvas.status).toBe("需人工判断");
      expect(probe.checks.tls.status).toBe("无法通过 JS 校验");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("adds field-dependency notes for webgl, client_rects, gpu, longitude, latitude", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-report-"));
    try {
      const output = await writeReports(
        {
          generatedAt: "2026-05-21T00:00:00.000Z",
          profileIds: ["PROFILE_ID_DEP"],
          results: [
            {
              profileId: "PROFILE_ID_DEP",
              status: "ok",
              notes: [],
              settings: {
                profileId: "PROFILE_ID_DEP",
                settings: {
                  webgl: "Google Inc. -- ANGLE Renderer",
                  client_rects: "layout-sensitive-value",
                  gpu: "NVIDIA GeForce RTX 3080",
                  longitude: "116.397128",
                  latitude: "39.916527",
                  location: "Beijing"
                },
                randomFingerprintEnabled: false,
                fetchStatus: "ok"
              },
              browserScan: {
                profileId: "PROFILE_ID_DEP",
                status: "ok",
                rawText: "BS raw text",
                values: {
                  webgl: { value: "BS_webgl_hash", source: "runtime" },
                  client_rects: { value: "BS_client_rects_hash", source: "runtime" },
                  gpu: { value: "BS_gpu_hash", source: "runtime" },
                  longitude: { value: "116.397128", source: "runtime" },
                  latitude: { value: "39.916527", source: "runtime" },
                  location: { value: "Beijing", source: "runtime" }
                }
              }
            }
          ]
        },
        dir
      );

      const html = await readFile(output.htmlPath, "utf8");

      // Core UI columns preserved
      expect(html).toContain("设置值");
      expect(html).toContain("BS值");

      // No pass/fail style wording
      expect(html).not.toMatch(/pass|fail|通过|失败|异常|不通过/i);

      // Field dependency notes present
      expect(html).toContain("WebGL BS值通常来自 vendor/renderer 与完整 WebGL 参数 hash");
      expect(html).toContain("DOM 布局测量对字体、DPR、缩放、渲染管线和测量时机敏感");
      expect(html).toContain("GPU BS值可能来自 WebGPU adapter/features/limits hash，需结合 raw/probe 判断");
      expect(html).toContain("依赖代理出口 IP 地理库，代理变化时可能变化");

      // browser_scan_raw_text row does NOT get a dependency note (other rows may)
      // We just verify none of the dependency note strings appear with browser_scan_raw_text label
      const bsRawRowMatch = html.match(/BrowserScan 原文[\s\S]*?<div class="note-text">([^<]*)/);
      if (bsRawRowMatch) {
        const note = bsRawRowMatch[1];
        expect(note).not.toContain("字段说明：WebGL");
        expect(note).not.toContain("字段说明：DOM 布局");
        expect(note).not.toContain("字段说明：GPU BS值");
        expect(note).not.toContain("依赖代理出口 IP");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stability data appears in JSON but not in HTML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-report-"));
    try {
      const output = await writeReports(
        {
          generatedAt: "2026-05-21T00:00:00.000Z",
          profileIds: ["PROFILE_ID_1"],
          results: [
            {
              profileId: "PROFILE_ID_1",
              status: "ok",
              notes: [],
              settings: {
                profileId: "PROFILE_ID_1",
                settings: { ua: "Mozilla/5.0" },
                randomFingerprintEnabled: false,
                fetchStatus: "ok"
              },
              browserScan: {
                profileId: "PROFILE_ID_1",
                status: "ok",
                rawText: "BrowserScan raw",
                values: {
                  ua: { value: "Mozilla/5.0", source: "runtime" },
                  webgl: { value: "webgl-hash-first", source: "runtime" }
                },
                componentSnapshot: {
                  allComplete: true,
                  software: {
                    token: "SECOND_RUN_ONLY_HASH_SHOULD_NOT_BE_IN_HTML"
                  }
                }
              },
              stability: {
                mode: "session",
                runCount: 2,
                runs: [
                  {
                    runIndex: 1,
                    browserScan: {
                      profileId: "PROFILE_ID_1",
                      status: "ok",
                      rawText: "BrowserScan raw",
                      values: {
                        ua: { value: "Mozilla/5.0", source: "runtime" },
                        webgl: { value: "webgl-hash-first", source: "runtime" }
                      }
                    }
                  },
                  {
                    runIndex: 2,
                    browserScan: {
                      profileId: "PROFILE_ID_1",
                      status: "ok",
                      rawText: "BrowserScan raw 2",
                      values: {
                        ua: { value: "Mozilla/5.0", source: "runtime" },
                        webgl: { value: "webgl-hash-second", source: "runtime" },
                        second_run_only_key: {
                          value: "SECOND_RUN_ONLY_HASH_SHOULD_NOT_BE_IN_HTML",
                          source: "runtime"
                        }
                      },
                      componentSnapshot: {
                        allComplete: true,
                        software: {
                          token: "SECOND_RUN_ONLY_HASH_SHOULD_NOT_BE_IN_HTML"
                        }
                      }
                    }
                  }
                ],
                fields: {
                  ua: {
                    status: "unchanged",
                    samples: [
                      { runIndex: 1, value: "Mozilla/5.0", source: "runtime" },
                      { runIndex: 2, value: "Mozilla/5.0", source: "runtime" }
                    ],
                    uniqueValues: ["Mozilla/5.0"]
                  },
                  webgl: {
                    status: "changed",
                    samples: [
                      { runIndex: 1, value: "webgl-hash-first", source: "runtime" },
                      { runIndex: 2, value: "webgl-hash-second", source: "runtime" }
                    ],
                    uniqueValues: ["webgl-hash-first", "webgl-hash-second"]
                  },
                  second_run_only_key: {
                    status: "changed",
                    samples: [
                      { runIndex: 1, value: undefined, source: "not_collected" },
                      { runIndex: 2, value: "SECOND_RUN_ONLY_HASH_SHOULD_NOT_BE_IN_HTML", source: "runtime" }
                    ],
                    uniqueValues: ["SECOND_RUN_ONLY_HASH_SHOULD_NOT_BE_IN_HTML"]
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

      // JSON contains stability data
      expect(result.stability.runCount).toBe(2);
      expect(result.stability.runs).toHaveLength(2);
      expect(result.stability.fields.ua.status).toBe("unchanged");
      expect(result.stability.fields.webgl.status).toBe("changed");

      // Second run unique value appears in JSON (not sensitive, so not redacted)
      expect(json).toContain("webgl-hash-second");
      expect(json).toContain("SECOND_RUN_ONLY_HASH_SHOULD_NOT_BE_IN_HTML");

      // HTML does NOT contain stability-related strings
      expect(html).not.toContain("stability");
      expect(html).not.toContain("unchanged");
      expect(html).not.toContain("changed");
      expect(html).not.toContain("not_collected");
      expect(html).not.toContain("SECOND_RUN_ONLY_HASH_SHOULD_NOT_BE_IN_HTML");
      expect(html).not.toContain("webgl-hash-second");
      expect(html).not.toContain("second_run_only_key");

      // Sensitive field from componentSnapshot in second run is redacted in JSON
      expect(result.stability.runs[1].browserScan.componentSnapshot?.software?.token).toBe("[REDACTED]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
