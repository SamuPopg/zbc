import { describe, expect, it } from "vitest";
import { buildReportData } from "../src/runner.js";

describe("buildReportData", () => {
  it("keeps one failed profile and one successful profile in the same report", () => {
    const report = buildReportData([
      {
        profileId: "PROFILE_ID_1",
        status: "failed",
        notes: ["Local API start error"],
        settings: {
          profileId: "PROFILE_ID_1",
          settings: {},
          randomFingerprintEnabled: false,
          fetchStatus: "failed",
          error: "backend unavailable"
        }
      },
      {
        profileId: "PROFILE_ID_2",
        status: "ok",
        notes: [],
        settings: {
          profileId: "PROFILE_ID_2",
          settings: { ua: "Mozilla/5.0" },
          randomFingerprintEnabled: false,
          fetchStatus: "ok"
        },
        browserScan: {
          profileId: "PROFILE_ID_2",
          status: "ok",
          rawText: "",
          values: {
            ua: { value: "Mozilla/5.0", source: "runtime" }
          }
        }
      }
    ]);

    expect(report.profileIds).toEqual(["PROFILE_ID_1", "PROFILE_ID_2"]);
    expect(report.results).toHaveLength(2);
  });
});
