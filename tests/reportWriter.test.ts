import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReports } from "../src/reportWriter.js";

describe("writeReports", () => {
  it("produces Carbon-inspired QA report HTML with no secrets or pass/fail wording", async () => {
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

      // Carbon-inspired QA Report structure
      expect(html).toContain('class="report-header"');
      expect(html).toContain('class="summary-grid"');
      expect(html).toContain('class="summary-tile"');
      expect(html).toContain('class="status-badge');
      expect(html).toMatch(/class="status-badge status-error"/);
      // Old Apple-style masthead is gone
      expect(html).not.toContain("report-masthead");
      expect(html).not.toContain("masthead-eyebrow");
      expect(html).not.toContain("masthead-title");
      // 备注 label is preserved and not collapsed
      expect(html).toContain("备注");
      const noteLabelMatch = html.match(/<span class="value-label note">备注<\/span>/);
      expect(noteLabelMatch).not.toBeNull();
      // 备注 label has white-space: nowrap to keep it on a single line
      const noteLabelCss = html.match(/\.value-label\.note\s*\{[^}]*\}/);
      expect(noteLabelCss).not.toBeNull();
      expect(noteLabelCss![0]).toContain("white-space: nowrap");
      // Missing BS value renders as dashed-border "未获取"
      expect(html).toMatch(/<div class="value-box missing">[\s\S]*?未获取[\s\S]*?<\/div>/);

      // Carbon column split: first column field-col (170px), data columns profile-cell (280-320px)
      expect(html).toMatch(/<th class="field-col sticky-col">/);
      expect(html).toMatch(/<td class="profile-cell">/);
      const fieldColCss = html.match(/\.field-col\s*\{[^}]*\}/);
      expect(fieldColCss).not.toBeNull();
      expect(fieldColCss![0]).toContain("170px");
      // Mobile summary rule prevents the empty trailing tile
      const mobileSummaryCss = html.match(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.summary-grid\s*\{[\s\S]*?\}\s*\.summary-tile:nth-child\(7\)[\s\S]*?\}\s*\}/);
      expect(mobileSummaryCss).not.toBeNull();
      // Old item-col class is no longer used
      expect(html).not.toContain('class="item-col');
      expect(html).not.toMatch(/\.item-col\s*\{/);

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

  it("profile-level notes appear once in profile header, not in each field", async () => {
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
              notes: [
                "冷启动复测有 1/3 轮未采集到 BrowserScan，详见 JSON stability.runs[].browserScan.error"
              ],
              settings: {
                profileId: "PROFILE_ID_1",
                name: "测试环境-单",
                settings: {
                  ua: "Mozilla/5.0",
                  webgl: "Google Inc. -- ANGLE Renderer",
                  gpu: "NVIDIA GeForce RTX 3080"
                },
                randomFingerprintEnabled: false,
                fetchStatus: "ok"
              },
              browserScan: {
                profileId: "PROFILE_ID_1",
                status: "ok",
                rawText: "BS raw text",
                values: {
                  ua: { value: "Mozilla/5.0", source: "runtime" },
                  webgl: { value: "webgl-bs-hash", source: "runtime" },
                  gpu: { value: "gpu-bs-hash", source: "runtime" }
                }
              },
              stability: {
                mode: "restart",
                runCount: 3,
                runs: [
                  {
                    runIndex: 1,
                    browserScan: {
                      profileId: "PROFILE_ID_1",
                      status: "ok",
                      rawText: "BS raw text",
                      values: {
                        ua: { value: "Mozilla/5.0", source: "runtime" }
                      }
                    }
                  },
                  {
                    runIndex: 2,
                    browserScan: {
                      profileId: "PROFILE_ID_1",
                      status: "failed",
                      rawText: "",
                      error: "BrowserScan 连接失败",
                      values: {}
                    }
                  },
                  {
                    runIndex: 3,
                    browserScan: {
                      profileId: "PROFILE_ID_1",
                      status: "ok",
                      rawText: "BS raw text",
                      values: {
                        ua: { value: "Mozilla/5.0", source: "runtime" }
                      }
                    }
                  }
                ],
                fields: {}
              }
            }
          ]
        },
        dir
      );

      const html = await readFile(output.htmlPath, "utf8");
      const json = await readFile(output.jsonPath, "utf8");
      const parsed = JSON.parse(json);

      // JSON still contains the full profile-level note
      expect(parsed.results[0].notes).toContain(
        "冷启动复测有 1/3 轮未采集到 BrowserScan，详见 JSON stability.runs[].browserScan.error"
      );

      // The profile-level note appears exactly once in HTML
      expect(html.match(/冷启动复测有 1\/3 轮未采集到 BrowserScan/g) ?? []).toHaveLength(1);

      // It appears in a profile header area (profile-notes class), not in field notes
      const profileNotesMatch = html.match(/class="profile-notes"[^>]*>[\s\S]*?冷启动复测有 1\/3/);
      expect(profileNotesMatch).not.toBeNull();

      // Field note lines should NOT contain the profile-level note text
      const noteTextMatches = html.match(/class="note-text"[^>]*>([^<]+)/g) ?? [];
      for (const match of noteTextMatches) {
        expect(match).not.toContain("冷启动复测有 1/3");
      }

      // Field dependency notes still appear in their respective fields
      expect(html).toContain("WebGL BS值通常来自 vendor/renderer");
      expect(html).toContain("GPU BS值可能来自 WebGPU");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("probe long object values render as short summary with expandable details", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-report-"));
    try {
      const output = await writeReports(
        {
          generatedAt: "2026-05-21T00:00:00.000Z",
          profileIds: ["PROFILE_ID_LONG_PROBE"],
          results: [
            {
              profileId: "PROFILE_ID_LONG_PROBE",
              status: "ok",
              notes: [],
              settings: {
                profileId: "PROFILE_ID_LONG_PROBE",
                name: "长Probe测试",
                settings: {
                  webgl_config: {
                    unmasked_vendor: "Google Inc.",
                    unmasked_renderer: "ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Graphics 540, Unspecified Version)"
                  }
                },
                randomFingerprintEnabled: false,
                fetchStatus: "ok"
              },
              browserScan: {
                profileId: "PROFILE_ID_LONG_PROBE",
                status: "ok",
                rawText: "BS raw",
                values: {
                  webgl_config: { value: "webgl-config-bs-hash", source: "runtime" }
                },
                probe: {
                  raw: {
                    webgl_config: {
                      unmaskedVendor: "Google Inc. (Intel Inc.)",
                      unmaskedRenderer: "ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Graphics 540, Unspecified Version)",
                      extensions: [
                        "EXT_texture_filter_anisotropic",
                        "WEBGL_debug_renderer_info",
                        "OES_texture_float"
                      ]
                    }
                  },
                  values: {
                    webgl_config: {
                      value: {
                        unmaskedVendor: "Google Inc. (Intel Inc.)",
                        unmaskedRenderer: "ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Graphics 540, Unspecified Version)",
                        extensions: [
                          "EXT_texture_filter_anisotropic",
                          "WEBGL_debug_renderer_info",
                          "OES_texture_float"
                        ]
                      },
                      source: "probe"
                    }
                  },
                  checks: {}
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

      // Probe实测 summary appears
      expect(html).toContain("Probe实测：");

      // <details> element exists for the long value
      expect(html).toContain("<details");
      expect(html).toContain("</details>");

      // The long extension value appears in the detail (inside <pre>)
      expect(html).toContain("WEBGL_debug_renderer_info");

      // XSS safety: raw script tags from probe values are escaped
      const xssHtml = await writeReports(
        {
          generatedAt: "2026-05-21T00:00:00.000Z",
          profileIds: ["PROFILE_ID_XSS"],
          results: [
            {
              profileId: "PROFILE_ID_XSS",
              status: "ok",
              notes: [],
              settings: {
                profileId: "PROFILE_ID_XSS",
                settings: { ua: "Mozilla/5.0" },
                randomFingerprintEnabled: false,
                fetchStatus: "ok"
              },
              browserScan: {
                profileId: "PROFILE_ID_XSS",
                status: "ok",
                rawText: "BS raw",
                values: {
                  ua: { value: "Mozilla/5.0", source: "runtime" }
                },
                probe: {
                  raw: {},
                  values: {
                    ua: {
                      value: '<script>alert("xss")</script>',
                      source: "probe"
                    }
                  },
                  checks: {}
                }
              }
            }
          ]
        },
        dir
      );
      const xssContent = await readFile(xssHtml.htmlPath, "utf8");
      expect(xssContent).not.toContain('<script>alert("xss")</script>');
      expect(xssContent).toContain("&lt;script&gt;");

      // JSON still contains the full unescaped probe value
      expect(parsed.results[0].browserScan.probe.values.webgl_config.value.extensions).toEqual([
        "EXT_texture_filter_anisotropic",
        "WEBGL_debug_renderer_info",
        "OES_texture_float"
      ]);
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
