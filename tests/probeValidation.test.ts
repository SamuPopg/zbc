import { describe, expect, it } from "vitest";
import { buildProbeChecks } from "../src/probeValidation.js";

describe("buildProbeChecks", () => {
  it("uses neutral probe check statuses for direct, manual, and JS-unavailable fields", () => {
    const checks = buildProbeChecks(
      {
        ua: "Mozilla/5.0",
        timezone: "Asia/Shanghai",
        language: ["zh-CN", "zh"],
        screen_resolution: "1920_1080",
        hardware_concurrency: "8",
        device_memory: "8",
        do_not_track: "true",
        webgl: "2",
        webgl_config: {
          unmasked_vendor: "Google Inc.",
          unmasked_renderer: "ANGLE Renderer"
        },
        canvas: "1",
        webrtc: "disabled",
        tls: "0xC02C"
      },
      {
        ua: { value: "Mozilla/5.0", source: "probe" },
        timezone: { value: "Asia/Shanghai", source: "probe" },
        language: { value: "zh-CN", source: "probe" },
        screen_resolution: { value: "1920x1080", source: "probe" },
        hardware_concurrency: { value: 8, source: "probe" },
        device_memory: { value: 8, source: "probe" },
        do_not_track: { value: "1", source: "probe" },
        webgl_config: {
          value: {
            unmaskedVendor: "Google Inc.",
            unmaskedRenderer: "ANGLE Renderer"
          },
          source: "probe"
        },
        canvas: { value: "probe-canvas-hash", source: "probe" },
        webrtc: {
          value: {
            candidates: [],
            candidateTypes: []
          },
          source: "probe"
        }
      }
    );

    expect(checks.ua).toMatchObject({
      status: "一致",
      note: "设置值与 Probe一致"
    });
    expect(checks.timezone.status).toBe("一致");
    expect(checks.language.status).toBe("一致");
    expect(checks.screen_resolution.status).toBe("一致");
    expect(checks.hardware_concurrency.status).toBe("一致");
    expect(checks.device_memory.status).toBe("一致");
    expect(checks.do_not_track.status).toBe("一致");
    expect(checks.webgl_config.status).toBe("一致");
    expect(checks.canvas).toMatchObject({
      status: "需人工判断",
      note: "需人工判断：设置值与 Probe值语义不同"
    });
    expect(checks.webrtc.status).toBe("需人工判断");
    expect(checks.webrtc.note).toContain("ICE");
    expect(checks.tls).toMatchObject({
      status: "无法通过 JS 校验"
    });
  });

  it("marks random, IP-based, and host-follow settings as manual judgment", () => {
    const checks = buildProbeChecks(
      {
        random_ua: { ua_system_version: ["Windows"] },
        automatic_timezone: "1",
        language_switch: "1",
        screen_resolution: "random",
        hardware_concurrency: undefined
      },
      {
        ua: { value: "Mozilla/5.0", source: "probe" },
        timezone: { value: "Asia/Shanghai", source: "probe" },
        language: { value: "zh-CN", source: "probe" },
        screen_resolution: { value: "1920x1080", source: "probe" },
        hardware_concurrency: { value: 8, source: "probe" }
      }
    );

    expect(checks.ua.status).toBe("需人工判断");
    expect(checks.timezone.status).toBe("需人工判断");
    expect(checks.language.status).toBe("需人工判断");
    expect(checks.screen_resolution.status).toBe("需人工判断");
    expect(checks.hardware_concurrency.status).toBe("需人工判断");
  });
});
